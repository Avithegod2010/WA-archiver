import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { assertAppUnlocked } from '@/lib/server-lock'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "Data and storage" dashboard (task 14-h).
 *
 * Walks the on-disk media root (`db/media/<chatId>/` — the same layout
 * media-store.ts writes to) and reports, per chat: total bytes, file count
 * and a breakdown by extension group (image / video / audio / doc).
 * Directories that no longer match a Chat row are reported separately as
 * "orphan" (untracked) media, so the numbers reconcile with the chat list.
 *
 * The SQLite database file size is included as `dbBytes` — it is the sibling
 * of the media root in the default layout, and both paths are derived from
 * the DATABASE_URL the Prisma client in src/lib/db.ts actually uses.
 *
 * IO-heavy (one readdir+stat per media file), so the report is cached in
 * memory for 30 s — mirrors the stats-route caching style. Nothing else is
 * exported: there is no remote cache-bust on purpose (a fresh read is at
 * most 30 s stale, which is imperceptible for a dashboard).
 */

/* ------------------------------ Path helpers ----------------------------- */

/**
 * Resolve the SQLite database file and the media root from DATABASE_URL.
 * The media root is the `media/` directory sitting NEXT TO the database
 * file — matching media-store.ts's `db/custom.db` + `db/media/` layout
 * without hardcoding it twice.
 */
function resolvePaths(): { dbFile: string; mediaRoot: string } {
  const raw = process.env.DATABASE_URL ?? ''
  let dbFile: string | null = null
  if (raw.startsWith('file:')) {
    const p = raw.slice('file:'.length)
    // Prisma resolves relative file: URLs against the schema directory.
    dbFile = path.isAbsolute(p) ? p : path.resolve(process.cwd(), 'prisma', p)
  }
  if (!dbFile) dbFile = path.join(process.cwd(), 'db', 'custom.db')
  return { dbFile, mediaRoot: path.join(path.dirname(dbFile), 'media') }
}

/* --------------------------- Extension grouping -------------------------- */

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'])
const VIDEO_EXT = new Set(['mp4', '3gp', 'mov', 'avi', 'mkv', 'webm'])
const AUDIO_EXT = new Set([
  'mp3',
  'm4a',
  'ogg',
  'oga',
  'opus',
  'wav',
  'aac',
  'flac',
  'amr',
  '3ga',
])

function extGroup(name: string): 'images' | 'videos' | 'audios' | 'docs' {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'images'
  if (VIDEO_EXT.has(ext)) return 'videos'
  if (AUDIO_EXT.has(ext)) return 'audios'
  return 'docs'
}

/* --------------------------------- Types --------------------------------- */

interface ChatStorageRow {
  chatId: string
  title: string
  isGroup: boolean
  messageCount: number
  bytes: number
  files: number
  images: number
  videos: number
  audios: number
  docs: number
}

interface StorageReport {
  /** Sum of all tracked (chat-owned) media bytes. */
  totalBytes: number
  /** Sum of all tracked media file counts. */
  fileCount: number
  /** Size of the SQLite database file on disk (0 when not found). */
  dbBytes: number
  /** Bytes in media dirs that no longer match any chat in the DB. */
  orphanBytes: number
  /** File count inside those orphan dirs. */
  orphanFiles: number
  /** Per-chat rows, sorted by bytes DESC, capped at 500. */
  chats: ChatStorageRow[]
}

/* -------------------------------- Compute -------------------------------- */

const MAX_CHAT_ROWS = 500

async function computeStorageReport(): Promise<StorageReport> {
  const { dbFile, mediaRoot } = resolvePaths()

  // All known chats — the set of valid chatIds, plus titles for the rows.
  const chats = await db.chat.findMany({
    select: { id: true, title: true, isGroup: true, messageCount: true },
  })
  const known = new Map(chats.map((c) => [c.id, c]))

  const rows = new Map<string, ChatStorageRow>()
  let orphanBytes = 0
  let orphanFiles = 0

  let dirNames: string[] = []
  try {
    dirNames = (await fs.readdir(mediaRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    /* media root missing — nothing stored yet */
  }

  for (const chatId of dirNames) {
    const dir = path.join(mediaRoot, chatId)
    let names: string[] = []
    try {
      names = await fs.readdir(dir)
    } catch {
      continue /* unreadable dir */
    }

    let bytes = 0
    let files = 0
    let images = 0
    let videos = 0
    let audios = 0
    let docs = 0
    for (const name of names) {
      try {
        const st = await fs.stat(path.join(dir, name))
        if (!st.isFile()) continue
        bytes += st.size
        files++
        const group = extGroup(name)
        if (group === 'images') images++
        else if (group === 'videos') videos++
        else if (group === 'audios') audios++
        else docs++
      } catch {
        /* file vanished between readdir and stat */
      }
    }

    // Empty dirs carry no storage — skip them entirely.
    if (files === 0) continue

    const chat = known.get(chatId)
    if (chat) {
      rows.set(chatId, {
        chatId,
        title: chat.title,
        isGroup: chat.isGroup,
        messageCount: chat.messageCount,
        bytes,
        files,
        images,
        videos,
        audios,
        docs,
      })
    } else {
      // Directory without a matching chat — untracked/orphan media.
      orphanBytes += bytes
      orphanFiles += files
    }
  }

  const allRows = [...rows.values()].sort((a, b) => b.bytes - a.bytes)
  const totalBytes = allRows.reduce((sum, r) => sum + r.bytes, 0)
  const fileCount = allRows.reduce((sum, r) => sum + r.files, 0)

  let dbBytes = 0
  try {
    dbBytes = (await fs.stat(dbFile)).size
  } catch {
    /* database file not found at the resolved path — report 0 */
  }

  return {
    totalBytes,
    fileCount,
    dbBytes,
    orphanBytes,
    orphanFiles,
    chats: allRows.slice(0, MAX_CHAT_ROWS),
  }
}

/* --------------------------------- Route --------------------------------- */

let cache: { at: number; data: StorageReport } | null = null
const STORAGE_TTL_MS = 30_000

export async function GET(req: Request) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  if (cache && Date.now() - cache.at < STORAGE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  try {
    const data = await computeStorageReport()
    cache = { at: Date.now(), data }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Could not scan storage' },
      { status: 500 },
    )
  }
}
