/**
 * Shared serialization for Message rows across the read/write API routes.
 * `pollOptions` is stored as a JSON string in SQLite and exposed as an array.
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
} as const
