import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseWhatsAppText } from '@/lib/whatsapp-parser'
import { persistParsedChat } from '@/lib/chat-service'
import { DEMO_CATALOG, type DemoChatMeta } from '@/lib/demo-catalog'
import { assertAppUnlocked } from '@/lib/server-lock'
// Demo transcript builders live in an isomorphic module (Phase 2) so device
// mode can seed the exact same chats without the server. The route's output
// is unchanged: same builders, same DEMO_VERSION, same sourceFile markers.
import {
  buildDemoScript,
  isDemoScriptId,
  legacyKey,
  v2Key,
} from '@/lib/demo-scripts'

export const runtime = 'nodejs'

/**
 * Rebuild an existing v1 chat in place with v2 content.
 * Preserves the chat id (folders, favorites, seen-state survive) and rewrites
 * sourceFile to the v2 key. Returns the chat id, or null when no v1 chat exists.
 */
async function upgradeLegacyChat(id: string, meta: DemoChatMeta): Promise<string | null> {
  const legacyChat = await db.chat.findFirst({
    where: { sourceFile: legacyKey(id) },
    select: { id: true },
  })
  if (!legacyChat) return null
  const text = buildDemoScript(id)
  if (!text) return null
  const parsed = parseWhatsAppText(text)
  await db.message.deleteMany({ where: { chatId: legacyChat.id } })
  await persistParsedChat({
    title: meta.title,
    sourceFile: v2Key(id),
    parsed,
    chatId: legacyChat.id,
  })
  return legacyChat.id
}

/**
 * POST /api/demo
 * Body (optional): { ids?: string[], migrateOnly?: boolean }
 * - migrateOnly=true: upgrade existing v1 demo chats to v2 in place; never
 *   creates new chats. Responds { ok, migrated: string[] } (titles upgraded).
 * - Otherwise: create/upgrade the selected demo chats (all if no ids given).
 *   v2 already exists → skip; v1 exists → upgrade in place (counts as created);
 *   else create new. Responds { ok, skipped, created, createdIds }.
 */
export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  try {
    const payload = (await req.json().catch(() => null)) as {
      ids?: unknown
      migrateOnly?: unknown
    } | null
    const migrateOnly = payload?.migrateOnly === true

    if (migrateOnly) {
      const migrated: string[] = []
      for (const meta of DEMO_CATALOG) {
        if (!isDemoScriptId(meta.id)) continue
        const chatId = await upgradeLegacyChat(meta.id, meta)
        if (chatId) migrated.push(meta.title)
      }
      return NextResponse.json({ ok: true, migrated })
    }

    const requested = Array.isArray(payload?.ids)
      ? payload.ids.filter(
          (id): id is string => typeof id === 'string' && isDemoScriptId(id)
        )
      : []
    const ids = requested.length ? requested : DEMO_CATALOG.map((d) => d.id)

    const createdNames: string[] = []
    const createdIds: string[] = []
    for (const id of ids) {
      const meta = DEMO_CATALOG.find((d) => d.id === id)
      if (!meta) continue
      const v2Exists = await db.chat.findFirst({
        where: { sourceFile: v2Key(id) },
        select: { id: true },
      })
      if (v2Exists) continue
      const upgradedId = await upgradeLegacyChat(id, meta)
      if (upgradedId) {
        createdNames.push(meta.title)
        createdIds.push(upgradedId)
        continue
      }
      const text = buildDemoScript(id)
      if (!text) continue
      const parsed = parseWhatsAppText(text)
      const chatId = await persistParsedChat({
        title: meta.title,
        sourceFile: v2Key(id),
        parsed,
      })
      createdNames.push(meta.title)
      createdIds.push(chatId)
    }

    return NextResponse.json({
      ok: true,
      skipped: createdNames.length === 0,
      created: createdNames,
      createdIds,
    })
  } catch (err) {
    console.error('Demo creation failed:', err)
    return NextResponse.json(
      { error: 'Could not create demo chats.' },
      { status: 500 }
    )
  }
}
