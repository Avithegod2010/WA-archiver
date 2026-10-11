/**
 * Shared serialization for Message rows across the read/write API routes.
 * `pollOptions` is stored as a JSON string in SQLite and exposed as an array.
 * `reactions` is stored as a JSON string shaped { emoji: [sender, ...] } and
 * exposed as a parsed record.
 * `replyTo` is resolved in batch by `withReplyTos` (one extra query per page).
 */

import { db } from '@/lib/db'

/** Quoted-message summary attached to a serialized message. */
export interface ReplyToRef {
  id: string
  sender: string
  body: string
  type: string
}

export interface ApiMessage {
  id: string
  idx: number
  ts: string
  sender: string | null
  body: string
  type: string
  mediaPath: string | null
  mediaName: string | null
  starred: boolean
  edited: boolean
  forwardedFrom: string | null
  pollOptions: string[] | null
  pinned: boolean
  reactions: Record<string, string[]> | null
  replyTo?: ReplyToRef | null
}

interface MessageRow {
  id: string
  idx: number
  ts: Date
  sender: string | null
  body: string
  type: string
  mediaPath: string | null
  mediaName: string | null
  starred: boolean
  edited: boolean
  forwardedFrom: string | null
  pollOptions: string | null
  pinned: boolean
  reactions: string | null
  replyToId: string | null
}

/**
 * Safely parse the reactions JSON column ("{\"👍\":[\"You\"]}") into a
 * record. Returns null for missing or malformed data. Values are normalized
 * to non-empty string arrays; emoji keys are kept as-is.
 */
export function parseReactions(
  raw: string | null | undefined
): Record<string, string[]> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const out: Record<string, string[]> = {}
    let any = false
    for (const [emoji, senders] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!emoji || !Array.isArray(senders)) continue
      const list = senders.filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      )
      if (list.length === 0) continue
      out[emoji] = list
      any = true
    }
    return any ? out : null
  } catch {
    /* malformed — treat as none */
    return null
  }
}

export function serializeMessage(
  m: MessageRow,
  replyToById?: Map<string, ReplyToRef>
): ApiMessage {
  let pollOptions: string[] | null = null
  if (m.pollOptions) {
    try {
      const parsed = JSON.parse(m.pollOptions)
      if (Array.isArray(parsed)) {
        pollOptions = parsed
          .filter((o) => typeof o === 'string')
          .map((o) => o.slice(0, 100))
          .slice(0, 12)
      }
    } catch {
      /* malformed — treat as none */
    }
  }
  const replyTo = m.replyToId ? (replyToById?.get(m.replyToId) ?? null) : null
  return {
    id: m.id,
    idx: m.idx,
    ts: m.ts.toISOString(),
    sender: m.sender,
    body: m.body,
    type: m.type,
    mediaPath: m.mediaPath,
    mediaName: m.mediaName,
    starred: m.starred,
    edited: m.edited,
    forwardedFrom: m.forwardedFrom,
    pollOptions,
    pinned: m.pinned,
    reactions: parseReactions(m.reactions),
    replyTo,
  }
}

/**
 * Serialize one chat's message rows with `replyTo` batch-resolved: a single
 * extra Prisma query (id IN replyToIds, id/sender/body/type only) feeding a
 * Map lookup. Rows without a reply target pass through untouched.
 */
export async function withReplyTos(rows: MessageRow[]): Promise<ApiMessage[]> {
  const ids = [
    ...new Set(
      rows
        .map((r) => r.replyToId)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    ),
  ]
  if (ids.length === 0) {
    return rows.map((r) => serializeMessage(r))
  }
  const targets = await db.message.findMany({
    where: { id: { in: ids } },
    select: { id: true, sender: true, body: true, type: true },
  })
  const map = new Map<string, ReplyToRef>(
    targets.map((t) => [
      t.id,
      { id: t.id, sender: t.sender ?? '', body: t.body, type: t.type },
    ])
  )
  return rows.map((r) => serializeMessage(r, map))
}

export const MESSAGE_SELECT = {
  id: true,
  idx: true,
  ts: true,
  sender: true,
  body: true,
  type: true,
  mediaPath: true,
  mediaName: true,
  starred: true,
  edited: true,
  forwardedFrom: true,
  pollOptions: true,
  pinned: true,
  reactions: true,
  replyToId: true,
} as const
