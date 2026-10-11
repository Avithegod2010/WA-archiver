/**
 * Shared serialization for Message rows across the read/write API routes.
 * `pollOptions` is stored as a JSON string in SQLite and exposed as an array.
 * `reactions` is stored as a JSON string shaped { emoji: [sender, ...] } and
 * exposed as a parsed record.
 */

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

export function serializeMessage(m: MessageRow): ApiMessage {
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
  }
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
} as const
