import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Reconstructs a WhatsApp-format chat log from the stored messages:
 *   dd/mm/yyyy, hh:mm - Sender: body
 * System messages (no sender) omit the "Sender:" part.
 * Multiline bodies are re-exported as continuation lines.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: { title: true, sourceFile: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const messages = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    select: { ts: true, sender: true, body: true, type: true, mediaName: true },
  })

  const lines: string[] = []
  for (const m of messages) {
    const ts = `${pad(m.ts.getDate())}/${pad(m.ts.getMonth() + 1)}/${m.ts.getFullYear()}, ${pad(m.ts.getHours())}:${pad(m.ts.getMinutes())}`
    let body = m.body ?? ''
    if (!body && m.mediaName) body = `${m.mediaName} (file attached)`
    if (!body) {
      const labels: Record<string, string> = {
        image: '<Media omitted>',
        video: '<Media omitted>',
        audio: '<Media omitted>',
        sticker: '<Media omitted>',
        gif: '<Media omitted>',
        media: '<Media omitted>',
        document: 'document omitted',
        contact: 'contact card omitted',
        poll: 'POLL: (options not included in export)',
        location: 'location omitted',
        deleted: 'This message was deleted',
        call: 'Missed call',
      }
      body = labels[m.type] ?? '<Media omitted>'
    }
    const bodyLines = body.split('\n')
    const first = m.sender ? `${ts} - ${m.sender}: ${bodyLines[0]}` : `${ts} - ${bodyLines[0]}`
    lines.push(first, ...bodyLines.slice(1))
  }

  const text = lines.join('\n') + '\n'

  const safeTitle = (chat.title || 'chat')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 80)
  const filename = `WhatsApp Chat - ${safeTitle}.txt`

  return new NextResponse(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
