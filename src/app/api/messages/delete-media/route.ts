import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { assertAppUnlocked } from '@/lib/server-lock'
import { isValidChatId, posterPathFor } from '@/lib/media-store'

export const runtime = 'nodejs'

const MEDIA_ROOT = path.join(process.cwd(), 'db', 'media')
const MAX_IDS = 500

/**
 * Bulk media deletion (media hub → select → Delete).
 *
 * Deletes the stored file (and its video poster) behind each message, then
 * marks the row `type='deleted'` with body "Media deleted: <name>" — the
 * message stays in the transcript (WhatsApp-style placeholder), the bytes
 * go. Ids without media are ignored. Returns the number updated.
 */
export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const ids = (body as { ids?: unknown })?.ids
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 128)
  ) {
    return NextResponse.json(
      { error: 'ids must be a non-empty array of message ids' },
      { status: 400 }
    )
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Too many ids (max ${MAX_IDS} per call)` },
      { status: 400 }
    )
  }

  // Only rows that actually carry media can be deleted.
  const rows = await db.message.findMany({
    where: { id: { in: ids as string[] }, mediaPath: { not: null } },
    select: { id: true, chatId: true, mediaPath: true, mediaName: true },
  })
  if (rows.length === 0) {
    return NextResponse.json({ deleted: 0 })
  }

  // Best-effort file removal — a missing file must not block the row update.
  let freedBytes = 0
  await Promise.all(
    rows.map(async (r) => {
      if (!r.mediaPath || !isValidChatId(r.chatId)) return
      const dir = path.join(MEDIA_ROOT, r.chatId)
      for (const name of [r.mediaPath, posterPathFor(r.mediaPath)]) {
        // Guard: the resolved path must stay inside the chat's media dir.
        const abs = path.resolve(dir, name)
        if (!abs.startsWith(path.resolve(dir) + path.sep)) return
        try {
          const st = await fs.stat(abs)
          freedBytes += st.size
          await fs.unlink(abs)
        } catch {
          /* already gone / never extracted — fine */
        }
      }
    })
  )

  await db.$transaction(
    rows.map((r) =>
      db.message.update({
        where: { id: r.id },
        data: {
          type: 'deleted',
          body: `Media deleted: ${r.mediaName ?? r.mediaPath ?? 'file'}`,
          mediaPath: null,
          mediaName: null,
        },
      })
    )
  )

  return NextResponse.json({ deleted: rows.length, freedBytes })
}
