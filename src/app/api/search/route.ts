import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * Global search across ALL chats' message bodies.
 * SQLite `contains` maps to LIKE (ASCII case-insensitive), matching the
 * in-chat search behaviour. Results are grouped by chat with per-chat totals,
 * capped at MAX_HITS message rows overall (most recent first).
 */
const MAX_HITS = 200
const MAX_PER_CHAT = 20

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) {
    return NextResponse.json({ query: '', chats: [] })
  }
  if (q.length > 200) {
    return NextResponse.json(
      { error: 'Query too long (max 200 chars)' },
      { status: 400 }
    )
  }

  const where = { body: { contains: q } }

  const [rows, counts] = await Promise.all([
    db.message.findMany({
      where,
      orderBy: { ts: 'desc' },
      take: MAX_HITS,
      select: {
        id: true,
        idx: true,
        ts: true,
        sender: true,
        body: true,
        type: true,
        chatId: true,
        chat: { select: { id: true, title: true, isGroup: true } },
      },
    }),
    db.message.groupBy({ by: ['chatId'], where, _count: { _all: true } }),
  ])

  const countMap = new Map(
    counts.map((c) => [c.chatId, c._count._all] as const)
  )

  // Group rows per chat, preserving the ts-desc order of the first hit
  const orderedChats: {
    id: string
    title: string
    isGroup: boolean
    count: number
    hits: {
      id: string
      idx: number
      ts: string
      sender: string | null
      body: string
      type: string
    }[]
  }[] = []
  const byChat = new Map<string, (typeof orderedChats)[number]>()
  for (const r of rows) {
    let entry = byChat.get(r.chatId)
    if (!entry) {
      entry = {
        id: r.chat.id,
        title: r.chat.title,
        isGroup: r.chat.isGroup,
        count: countMap.get(r.chatId) ?? 0,
        hits: [],
      }
      byChat.set(r.chatId, entry)
      orderedChats.push(entry)
    }
    if (entry.hits.length < MAX_PER_CHAT) {
      entry.hits.push({
        id: r.id,
        idx: r.idx,
        ts: r.ts.toISOString(),
        sender: r.sender,
        body: r.body,
        type: r.type,
      })
    }
  }

  return NextResponse.json({
    query: q,
    totalChats: orderedChats.length,
    totalHits: rows.length,
    truncated: rows.length >= MAX_HITS,
    chats: orderedChats,
  })
}
