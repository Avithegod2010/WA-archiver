/**
 * Message change log — per-chat audit of local edits and unsends.
 *
 * The tombstone rows carry the "what" (type='deleted'); this store carries
 * the "when + what changed": every markMessageEdited / unsendMessage is
 * appended here from ChatView and surfaced in the per-chat "Message
 * changes" panel (and future export round-trips).
 *
 * Client-only, localStorage-backed (works in BOTH transports — server mode
 * and the on-device engine), capped per chat so it can never grow unbounded.
 */

const KEY_PREFIX = 'wa-viewer:msg-changes:'
const MAX_PER_CHAT = 300

export type MsgChangeKind = 'edited' | 'unsent'

export interface MsgChange {
  id: string
  chatId: string
  messageId: string
  kind: MsgChangeKind
  /** Epoch ms when the change happened. */
  at: number
  sender: string | null
  /** Body before the change (tombstones keep the original text here). */
  before: string
  /** Body after the change (null for unsends). */
  after: string | null
}

function keyFor(chatId: string): string {
  return KEY_PREFIX + chatId
}

/** Newest-first change list for one chat (empty when none). */
export function getMsgChanges(chatId: string): MsgChange[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(keyFor(chatId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as MsgChange[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Append one change (caps the log; newest first). */
export function recordMsgChange(entry: {
  chatId: string
  messageId: string
  kind: MsgChangeKind
  sender?: string | null
  before: string
  after: string | null
}): void {
  if (typeof window === 'undefined') return
  try {
    const list = getMsgChanges(entry.chatId)
    const change: MsgChange = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      chatId: entry.chatId,
      messageId: entry.messageId,
      kind: entry.kind,
      at: Date.now(),
      sender: entry.sender ?? null,
      before: entry.before.slice(0, 2000),
      after: entry.after === null ? null : entry.after.slice(0, 2000),
    }
    const next = [change, ...list].slice(0, MAX_PER_CHAT)
    window.localStorage.setItem(keyFor(entry.chatId), JSON.stringify(next))
  } catch {
    /* storage full / unavailable — the audit log is best-effort */
  }
}

/** Drop every recorded change for a chat (e.g. when the chat is deleted). */
export function clearMsgChanges(chatId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(keyFor(chatId))
  } catch {
    /* ignore */
  }
}

/** How many chats currently have recorded changes (settings badge, etc.). */
export function countChatsWithChanges(): number {
  if (typeof window === 'undefined') return 0
  try {
    let n = 0
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX)) n++
    }
    return n
  } catch {
    return 0
  }
}
