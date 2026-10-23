/**
 * B1 — server-side merge for re-imports (twin of the device path in
 * lib/data/local/client.ts importParsed({ merge: true })).
 *
 * persistParsedChat() always creates a fresh chat and stamps aggregates from
 * the incoming rows — correct for first imports, wrong for re-imports of an
 * updated export (everything duplicates). mergeParsedIntoChat() instead:
 *
 *   1. fingerprints the existing transcript with makeMsgKey (ts|sender|body|
 *      type FNV-1a) and keeps only genuinely-new messages (self-duplicates
 *      inside the batch are dropped too),
 *   2. appends them after the current max idx (no idx collisions),
 *   3. re-indexes the chat by timestamp — only when incoming rows are older
 *      than existing ones (the common "updated export" case stays append-only),
 *   4. recomputes every chat aggregate via refreshChatAggregates — the
 *      existing chat's title/isGroup/sourceFile are preserved.
 *
 * Lives next to chat-service.ts but as a separate file so the import route
 * can opt into merge semantics without touching the legacy persist path.
 */

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { refreshChatAggregates } from '@/lib/chat-service'
import { makeMsgKey } from '@/lib/import-dedup'
import type { ParseResult } from '@/lib/whatsapp-parser'

export interface ServerMergeResult {
  chatId: string
  /** Rows actually written (0 when everything was a duplicate). */
  added: number
  /** Exact duplicates skipped (ts|sender|body|type fingerprints). */
  duplicatesSkipped: number
}

const INSERT_CHUNK = 150
const REINDEX_TX_CHUNK = 100

function msOf(ts: Date | string): number {
  const t = ts instanceof Date ? ts.getTime() : Date.parse(ts)
  return Number.isFinite(t) ? t : Number.NaN
}

export async function mergeParsedIntoChat(opts: {
  chatId: string
  parsed: ParseResult
  /** lowercase basename → stored media filename (already saved on disk). */
  mediaMap?: Map<string, string>
}): Promise<ServerMergeResult> {
  const { chatId, parsed } = opts
  const mediaMap = opts.mediaMap ?? new Map<string, string>()

  // 1 — fingerprint the existing transcript.
  const existing = await db.message.findMany({
    where: { chatId },
    select: { ts: true, sender: true, body: true, type: true },
  })
  const keys = new Set<string>()
  let maxExistingMs = Number.NEGATIVE_INFINITY
  for (const r of existing) {
    keys.add(makeMsgKey(r))
    const t = msOf(r.ts)
    if (!Number.isNaN(t) && t > maxExistingMs) maxExistingMs = t
  }

  // 2 — filter the incoming batch (also de-dupes within the batch itself).
  const incoming: typeof parsed.messages = []
  let duplicatesSkipped = 0
  let oldestIncomingMs = Number.POSITIVE_INFINITY
  for (const m of parsed.messages) {
    if (keys.has(makeMsgKey(m))) {
      duplicatesSkipped++
      continue
    }
    const t = msOf(m.ts)
    if (!Number.isNaN(t)) {
      if (t < oldestIncomingMs) oldestIncomingMs = t
    }
    incoming.push(m)
  }

  if (incoming.length === 0) {
    // Nothing new (or an empty target) — keep aggregates honest and bail.
    await refreshChatAggregates(chatId)
    return { chatId, added: 0, duplicatesSkipped }
  }

  // 3 — append after the current max idx (row shape mirrors persistParsedChat).
  const last = await db.message.findFirst({
    where: { chatId },
    orderBy: { idx: 'desc' },
    select: { idx: true },
  })
  const baseIdx = (last?.idx ?? -1) + 1

  const rows = incoming.map((m, i) => {
    let mediaPath: string | null = null
    let mediaName: string | null = m.mediaName
    if (mediaName) {
      const stored = mediaMap.get(mediaName.toLowerCase())
      if (stored) {
        mediaPath = stored
        mediaName = stored.split('/').pop() ?? stored
      }
    }
    return {
      chatId,
      idx: baseIdx + i,
      ts: m.ts,
      sender: m.sender,
      body: m.body.slice(0, 8000),
      type: m.type,
      mediaPath,
      mediaName: mediaName ? mediaName.slice(0, 255) : null,
      pollOptions: m.pollOptions?.length ? JSON.stringify(m.pollOptions) : null,
      reactions: m.reactions && Object.keys(m.reactions).length > 0
        ? JSON.stringify(m.reactions)
        : null,
      replyToId: null,
      _replyQuote: m.replyQuote ?? null,
      _rowIdx: baseIdx + i,
    }
  })

  // Reply quotes (v1.9 round-trip) resolve after the insert — the marker
  // fields are stripped before createMany.
  const quoteList = rows
    .map((r) => ({ rowIdx: r._rowIdx as number, q: r._replyQuote as { sender: string; body: string } | null }))
    .filter((x): x is { rowIdx: number; q: { sender: string; body: string } } => !!x.q)

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows
      .slice(i, i + INSERT_CHUNK)
      .map(({ _replyQuote: _q, _rowIdx: _ri, ...r }) => r)
    await db.message.createMany({ data: chunk })
  }

  // Resolve reply quotes → replyToId (sender + flattened-body prefix match).
  if (quoteList.length > 0) {
    const senders = [...new Set(quoteList.map((x) => x.q.sender))]
    const candidates = await db.message.findMany({
      where: { chatId, sender: { in: senders } },
      select: { id: true, sender: true, body: true },
      orderBy: { idx: 'desc' },
      take: 400,
    })
    for (const { rowIdx, q } of quoteList) {
      const want = q.body.toLowerCase()
      const hit = candidates.find(
        (c) =>
          c.sender === q.sender &&
          c.body
            .replace(/\s*\n\s*/g, ' ')
            .trim()
            .toLowerCase()
            .startsWith(want)
      )
      if (!hit) continue
      const row = await db.message.findFirst({
        where: { chatId, idx: rowIdx },
        select: { id: true },
      })
      if (row) {
        await db.message.update({
          where: { id: row.id },
          data: { replyToId: hit.id },
        })
      }
    }
  }

  // Chronological repair when incoming rows predate existing ones: stable
  // sort of (id, ts) by ts, then only rewrite idx where the occupant changed.
  if (oldestIncomingMs < maxExistingMs) {
    const order = await db.message.findMany({
      where: { chatId },
      select: { id: true, ts: true },
      orderBy: { idx: 'asc' },
    })
    const sorted = [...order].sort(
      (a, b) => (msOf(a.ts) || 0) - (msOf(b.ts) || 0)
    )
    const updates: Prisma.PrismaPromise<unknown>[] = []
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].id !== order[i].id) {
        updates.push(
          db.message.update({
            where: { id: sorted[i].id },
            data: { idx: i },
          })
        )
      }
    }
    for (let i = 0; i < updates.length; i += REINDEX_TX_CHUNK) {
      await db.$transaction(updates.slice(i, i + REINDEX_TX_CHUNK))
    }
  }

  // 4 — full recount (messageCount/mediaCount/firstAt/lastAt/preview…).
  await refreshChatAggregates(chatId)
  return { chatId, added: rows.length, duplicatesSkipped }
}
