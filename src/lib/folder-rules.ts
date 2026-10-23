/**
 * Folder auto-rules (v1.9) — file new imports by title regex.
 *
 * Rules are an ordered list of { pattern, folderId } entries persisted in
 * localStorage under 'wa-viewer:folder-rules'. When a chat is imported
 * (or created) its title is tested against each enabled pattern in order
 * (case-insensitive unless the pattern carries explicit flags); the FIRST
 * match files the chat into that folder.
 *
 * Pure module — the same applyFolderRules runs after every import path
 * (drag-drop, ImportPanel, share-intent) in both transports.
 */

import { getFolders, setFolders, type ChatFolder } from '@/components/whatsapp/chat-folders'

export const FOLDER_RULES_KEY = 'wa-viewer:folder-rules'
const RULES_EVENT = 'wa-folder-rules-changed'

export interface FolderRule {
  id: string
  /** JavaScript regex source — matched against the chat title. */
  pattern: string
  /** 'i' unless the user wrote flags inline; stored separately for clarity. */
  flags: string
  folderId: string
  enabled: boolean
}

export function genRuleId(): string {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sanitize(raw: unknown): FolderRule[] {
  if (!Array.isArray(raw)) return []
  const out: FolderRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id ? o.id : genRuleId()
    const pattern = typeof o.pattern === 'string' ? o.pattern.slice(0, 200) : ''
    const folderId = typeof o.folderId === 'string' ? o.folderId : ''
    if (!pattern || !folderId) continue
    let flags = typeof o.flags === 'string' ? o.flags : 'i'
    try {
      void new RegExp(pattern, flags)
    } catch {
      continue // never persist a rule that cannot compile
    }
    out.push({
      id,
      pattern,
      flags,
      folderId,
      enabled: o.enabled !== false,
    })
  }
  return out
}

export function getFolderRules(): FolderRule[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(FOLDER_RULES_KEY)
    return raw ? sanitize(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveFolderRules(rules: FolderRule[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FOLDER_RULES_KEY, JSON.stringify(sanitize(rules)))
    window.dispatchEvent(new CustomEvent(RULES_EVENT))
  } catch {
    /* ignore */
  }
}

export function subscribeFolderRules(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(RULES_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(RULES_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** Test a title against one rule; null when it doesn't match / fails. */
export function ruleMatches(rule: FolderRule, title: string): boolean {
  if (!rule.enabled) return false
  try {
    return new RegExp(rule.pattern, rule.flags).test(title)
  } catch {
    return false
  }
}

/** First matching rule for a title, or null. */
export function matchRuleForTitle(title: string): FolderRule | null {
  for (const rule of getFolderRules()) {
    if (ruleMatches(rule, title)) return rule
  }
  return null
}

/**
 * File a chat into its first matching rule's folder. Returns the folder
 * it landed in (or null). Safe to call for every import — no-ops when no
 * rule matches, the folder vanished, or the chat is already a member.
 */
export function applyFolderRuleForChat(
  chatId: string,
  title: string
): ChatFolder | null {
  const rule = matchRuleForTitle(title)
  if (!rule) return null
  const folders = getFolders()
  const folder = folders.find((f) => f.id === rule.folderId)
  if (!folder) return null
  if (folder.chatIds.includes(chatId)) return folder
  setFolders(
    folders.map((f) =>
      f.id === folder.id ? { ...f, chatIds: [...f.chatIds, chatId] } : f
    )
  )
  return folder
}

/**
 * Apply rules to a batch of imported chats. `titles` maps chat id → title;
 * returns how many chats were filed.
 */
export function applyFolderRulesForImports(
  titles: Record<string, string>
): number {
  let filed = 0
  for (const [id, title] of Object.entries(titles)) {
    if (applyFolderRuleForChat(id, title)) filed++
  }
  return filed
}

/**
 * Retro-fit: run every rule over the WHOLE current chat list (used when a
 * rule is created/edited so existing chats pick it up too).
 */
export function applyFolderRulesToAll(
  chats: { id: string; title: string }[]
): number {
  const folders = getFolders()
  const byId = new Map(folders.map((f) => [f.id, f]))
  const additions = new Map<string, string[]>()
  let filed = 0
  for (const c of chats) {
    const already = folders.some((f) => f.chatIds.includes(c.id))
    const rule = matchRuleForTitle(c.title)
    if (!rule) continue
    const folder = byId.get(rule.folderId)
    if (!folder) continue
    if (folder.chatIds.includes(c.id)) continue
    if (already && rule.folderId !== folders.find((f) => f.chatIds.includes(c.id))?.id) {
      // Chat belongs to a different folder — rules ADD membership, never move.
    }
    const list = additions.get(rule.folderId) ?? []
    if (!list.includes(c.id)) {
      list.push(c.id)
      additions.set(rule.folderId, list)
    }
    filed++
  }
  if (additions.size > 0) {
    setFolders(
      getFolders().map((f) => {
        const add = additions.get(f.id)
        if (!add) return f
        return { ...f, chatIds: [...f.chatIds, ...add.filter((id) => !f.chatIds.includes(id))] }
      })
    )
  }
  return filed
}
