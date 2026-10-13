import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { promises as fs } from 'fs'
import path from 'path'
import { computeStats } from '@/lib/stats-compute'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

/** Walk db/media/<chatId>/ to compute on-disk media storage per chat. */
async function computeStorage(): Promise<{
  totalBytes: number
  files: number
  perChat: { chatId: string; bytes: number; files: number }[]
}> {
  const root = path.join(process.cwd(), 'db', 'media')
  const perChat: { chatId: string; bytes: number; files: number }[] = []
  let totalBytes = 0
  let files = 0
  try {
    const chatDirs = await fs.readdir(root, { withFileTypes: true })
    for (const d of chatDirs) {
      if (!d.isDirectory()) continue
      let bytes = 0
      let count = 0
      try {
        const names = await fs.readdir(path.join(root, d.name))
        for (const name of names) {
          try {
            const st = await fs.stat(path.join(root, d.name, name))
            if (st.isFile()) {
              bytes += st.size
              count++
            }
          } catch {
            /* file vanished between readdir and stat */
          }
        }
      } catch {
        /* unreadable dir */
      }
      if (count > 0) {
        perChat.push({ chatId: d.name, bytes, files: count })
        totalBytes += bytes
        files += count
      }
    }
  } catch {
    /* media root missing — zero storage */
  }
  perChat.sort((a, b) => b.bytes - a.bytes)
  return { totalBytes, files, perChat }
}

// Short TTL cache — the stats scan reads the whole messages table plus all
// media dirs per request; on big imports that's seconds of CPU per open.
// 60s staleness is imperceptible for a dashboard, and any send/delete that
// matters can bust it via the exported helper.
let statsCache: { at: number; data: unknown } | null = null
const STATS_TTL_MS = 60_000
export function bustStatsCache(): void {
  statsCache = null
}

export async function GET(req: Request) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) {
    return NextResponse.json(statsCache.data as Record<string, unknown>)
  }
  const result = await buildStats()
  statsCache = { at: Date.now(), data: result }
  return NextResponse.json(result)
}

/** Fetch the rows the payload needs, then delegate to the pure core. */
async function buildStats() {
  const [chats, messages] = await Promise.all([
    db.chat.findMany({
      select: {
        id: true,
        title: true,
        isGroup: true,
        messageCount: true,
        mediaCount: true,
        firstAt: true,
        lastAt: true,
      },
      orderBy: { messageCount: 'desc' },
    }),
    db.message.findMany({
      select: { chatId: true, ts: true, sender: true, type: true, body: true },
    }),
  ])

  const storage = await computeStorage()

  // Pure isomorphic core (shared with the device-mode dashboard port) —
  // consumes the Prisma rows as-is, so the JSON payload is unchanged.
  return computeStats({ chats, messages, storage })
}
