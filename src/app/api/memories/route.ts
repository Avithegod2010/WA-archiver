/**
 * GET /api/memories — "On this day" memories (task 14-a).
 *
 * Returns messages whose UTC calendar month+day matches the target date and
 * whose timestamp is strictly before the start (00:00 UTC) of today, grouped
 * by year (newest year first, newest message first within a year).
 *
 * Query: ?mmd=MM-DD (optional, e.g. 10-12) — defaults to today in UTC.
 * Response: { date: 'MM-DD', groups: [{ key: 'YYYY', label, items: [...] }] }
 *   item: { id, chatId, chatTitle, isGroup, sender, ts (ISO), type,
 *           preview, hasMedia, mediaName? }
 *   preview = body trimmed to 200 chars for text-like types; '' for media
 *   types (the client renders a friendly chip from `type` + `mediaName`).
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

/** Valid MM-DD strings (month 01-12, day 01-31). */
const MMD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Types whose memory card renders a media chip instead of a text preview. */
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image',
  'video',
  'gif',
  'audio',
  'sticker',
  'document',
  'location',
  'contact',
  'poll',
  'call',
  'deleted',
  'media',
])

const MAX_ITEMS = 120

/** Raw row shape coming back from $queryRaw (SQLite via Prisma). */
interface MemoryRow {
  id: string
  chatId: string
  ts: Date | number | string
  sender: string | null
  body: string
  type: string
  mediaPath: string | null
  mediaName: string | null
  chatTitle: string
  isGroup: number | boolean
}

interface MemoryItem {
  id: string
  chatId: string
  chatTitle: string
  isGroup: boolean
  sender: string | null
  ts: string
  type: string
  preview: string
  hasMedia: boolean
  mediaName?: string
}

/** Normalize whatever $queryRaw hands back for the ts column to an ISO string. */
function toIso(value: Date | number | string): string {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
}

function itemFromRow(row: MemoryRow): MemoryItem {
  const hasMedia = MEDIA_TYPES.has(row.type)
  const item: MemoryItem = {
    id: row.id,
    chatId: row.chatId,
    chatTitle: row.chatTitle,
    isGroup: Boolean(row.isGroup),
    sender: row.sender ?? null,
    ts: toIso(row.ts),
    type: row.type,
    preview: hasMedia ? '' : (row.body ?? '').trim().slice(0, 200),
    hasMedia,
  }
  if (row.mediaName) item.mediaName = row.mediaName
  return item
}

/** Year-diff → relative label ("2 years ago", "Last year", "Earlier this year"). */
function relativeLabel(yearDiff: number): string {
  if (yearDiff <= 0) return 'Earlier this year'
  if (yearDiff === 1) return 'Last year'
  return `${yearDiff} years ago`
}

export async function GET(req: Request) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  // Target month-day: explicit ?mmd=MM-DD or today in UTC.
  const raw = new URL(req.url).searchParams.get('mmd')
  let mmd: string
  if (raw != null) {
    if (!MMD_RE.test(raw)) {
      return NextResponse.json(
        { error: 'Invalid mmd — expected MM-DD, e.g. 10-12' },
        { status: 400 },
      )
    }
    mmd = raw
  } else {
    const now = new Date()
    mmd = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  }

  // "Strictly before the start (00:00 UTC) of today".
  const startOfToday = new Date()
  startOfToday.setUTCHours(0, 0, 0, 0)

  // Prisma stores SQLite DateTimes as epoch-ms integers, so the calendar
  // match goes through unixepoch conversion; the "before today" guard and
  // the ordering compare the raw integer ms directly.
  let rows: MemoryRow[]
  try {
    rows = await db.$queryRaw<MemoryRow[]>`
      SELECT m.id, m.chatId, m.ts, m.sender, m.body, m.type,
             m.mediaPath, m.mediaName,
             c.title AS chatTitle, c.isGroup AS isGroup
      FROM Message m
      JOIN Chat c ON c.id = m.chatId
      WHERE m.type != 'system'
        AND strftime('%m-%d', m.ts / 1000, 'unixepoch') = ${mmd}
        AND m.ts < ${startOfToday.getTime()}
      ORDER BY m.ts DESC
      LIMIT ${MAX_ITEMS}
    `
  } catch {
    return NextResponse.json(
      { error: 'Could not load memories' },
      { status: 500 },
    )
  }

  const currentYear = new Date().getUTCFullYear()
  const byYear = new Map<number, MemoryItem[]>()
  for (const row of rows) {
    const year = new Date(toIso(row.ts)).getUTCFullYear()
    const item = itemFromRow(row)
    const bucket = byYear.get(year)
    if (bucket) bucket.push(item)
    else byYear.set(year, [item])
  }

  const groups = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({
      key: String(year),
      label: `${year} · ${relativeLabel(currentYear - year)}`,
      items,
    }))

  return NextResponse.json({ date: mmd, groups })
}
