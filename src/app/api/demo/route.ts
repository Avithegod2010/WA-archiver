import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseWhatsAppText } from '@/lib/whatsapp-parser'
import { persistParsedChat } from '@/lib/chat-service'

export const runtime = 'nodejs'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dmy(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Build an Android-style export line: `dd/mm/yyyy, hh:mm - Sender: body` */
function line(d: Date, sender: string | null, body: string): string {
  const ts = `${dmy(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sender ? `${ts} - ${sender}: ${body}` : `${ts} - ${body}`
}

function dayAt(offsetDays: number, h: number, m: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - offsetDays)
  d.setHours(h, m, 0, 0)
  return d
}

/** Ensure at least one timestamp has day > 12 so the D/M/Y order is locked in. */
function ensureDayAmbiguityResolved(lines: string[]): string[] {
  const hasUnambiguous = lines.some((l) => {
    const m = l.match(/^(\d{2})\//)
    return m ? parseInt(m[1], 10) > 12 : false
  })
  if (hasUnambiguous) return lines
  return lines.map((l) => {
    const m = l.match(/^(\d{2})\/(\d{2})\/(\d{4}),/)
    if (!m) return l
    const day = parseInt(m[1], 10) + 20 > 28 ? 28 : parseInt(m[1], 10) + 20
    return l.replace(/^(\d{2})\//, `${pad(day)}/`)
  })
}

function buildPersonalChat(): string {
  const lines: string[] = [
    line(dayAt(6, 9, 12), null, 'Messages and calls are end-to-end encrypted.'),
    line(dayAt(6, 9, 13), 'Emma Watson', 'Hey! Did you get the documents I sent over yesterday?'),
    line(dayAt(6, 9, 15), 'You', 'Hey, yes I did. Just going through them now'),
    line(dayAt(6, 9, 16), 'You', 'The summary looks great, but I have a few notes\nabout the second section - will type them up tonight'),
    line(dayAt(6, 9, 17), 'Emma Watson', 'Perfect, no rush 👍'),
    line(dayAt(6, 9, 18), 'Emma Watson', 'Also, check this out when you get a chance: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'),
    line(dayAt(6, 9, 19), 'You', 'Ah yes, the classic CORS rabbit hole. Reading it now'),
    line(dayAt(6, 10, 2), 'Emma Watson', '<Media omitted>'),
    line(dayAt(6, 10, 3), 'Emma Watson', 'The view from the office this morning'),
    line(dayAt(6, 10, 15), 'You', 'That is stunning 😍 Where is that?'),
    line(dayAt(6, 10, 16), 'Emma Watson', 'location: https://maps.app.goo.gl/kQ3fRZx8Yh7L2mN19'),
    line(dayAt(6, 10, 16), 'Emma Watson', 'Right by the harbour. We should grab coffee there sometime'),
    line(dayAt(5, 14, 22), 'You', 'Sounds good. How about Thursday?'),
    line(dayAt(5, 14, 23), 'Emma Watson', 'Thursday works. I will send a calendar invite'),
    line(dayAt(5, 18, 5), 'Emma Watson', '<Media omitted>'),
    line(dayAt(5, 18, 5), 'Emma Watson', 'Voice note with the directions, it is easier'),
    line(dayAt(5, 20, 41), 'You', 'Got it, thanks! 🙏'),
    line(dayAt(5, 20, 41), 'You', 'report-draft.pdf (file attached)'),
    line(dayAt(5, 20, 42), 'You', 'Finished the first draft. Let me know what you think'),
    line(dayAt(4, 11, 30), 'Emma Watson', 'Reading it now...'),
    line(dayAt(4, 11, 47), 'Emma Watson', 'This is really good 👏 Small note: the numbers in table 3 need updating'),
    line(dayAt(4, 11, 48), 'You', 'Oops, you are right. Fixing'),
    line(dayAt(4, 11, 52), 'You', 'This message was deleted'),
    line(dayAt(4, 11, 52), 'You', 'Wrong file, one sec'),
    line(dayAt(4, 11, 55), 'You', 'report-draft-v2.pdf (file attached)'),
    line(dayAt(1, 8, 15), 'Emma Watson', 'Missed voice call'),
    line(dayAt(1, 8, 16), 'Emma Watson', 'Call me when you are free please'),
    line(dayAt(0, 7, 45), 'You', 'On it ☕ - calling you in 10'),
    line(dayAt(0, 9, 30), 'Emma Watson', 'Thanks for the chat. I will handle the client follow-up'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildGroupChat(): string {
  const lines: string[] = [
    line(dayAt(8, 12, 1), null, 'Alex Morgan created group "Weekend Trip Planning"'),
    line(dayAt(8, 12, 1), null, 'Alex Morgan added Sarah Chen'),
    line(dayAt(8, 12, 1), null, 'Alex Morgan added Marcus Lee'),
    line(dayAt(8, 12, 1), null, 'Alex Morgan added Priya Sharma'),
    line(dayAt(8, 12, 2), 'Alex Morgan', 'Welcome everyone! Planning the mountain trip for next month'),
    line(dayAt(8, 12, 3), 'Sarah Chen', 'Finally! 🎉 I have been waiting for this'),
    line(dayAt(8, 12, 5), 'Marcus Lee', 'I can drive, my car fits five people plus bags'),
    line(dayAt(8, 12, 8), 'Priya Sharma', 'Amazing 😍 What about the cabin?'),
    line(dayAt(8, 12, 10), 'Alex Morgan', 'cabin-options.pdf (file attached)'),
    line(dayAt(8, 12, 10), 'Alex Morgan', 'Three options with prices. Option 2 has the hot tub'),
    line(dayAt(8, 12, 11), 'Sarah Chen', 'Option 2. No further questions'),
    line(dayAt(8, 12, 13), 'Marcus Lee', 'Option 2 it is then. I will book it tonight'),
    line(dayAt(7, 9, 30), 'Priya Sharma', '☀️ Weather forecast looks perfect for that weekend'),
    line(dayAt(7, 9, 31), 'Priya Sharma', '<Media omitted>'),
    line(dayAt(7, 9, 31), 'Priya Sharma', 'Screenshot of the forecast, sunny all three days'),
    line(dayAt(7, 10, 15), 'Alex Morgan', 'Excellent. Packing list: 🥾 hiking boots, 🧥 warm layers, 🩳 swimsuit for the hot tub'),
    line(dayAt(7, 18, 40), 'Sarah Chen', 'Do we need cash for the cabin or is card fine?'),
    line(dayAt(7, 18, 55), 'Marcus Lee', 'Card is fine, but bring some cash for the parking meter'),
    line(dayAt(6, 8, 20), 'Alex Morgan', 'Booked! Confirmation sent to everyone by email'),
    line(dayAt(6, 8, 21), 'Alex Morgan', 'This message was deleted'),
    line(dayAt(6, 8, 22), 'Alex Morgan', 'Wrong chat, sorry'),
    line(dayAt(6, 8, 23), 'Sarah Chen', 'Ha 😂 happens to the best of us'),
    line(dayAt(3, 16, 5), 'Priya Sharma', 'Grocery run on Friday afternoon, who is in?'),
    line(dayAt(3, 16, 6), 'Marcus Lee', 'I am in. I will handle breakfast stuff'),
    line(dayAt(3, 16, 8), 'Alex Morgan', 'I will take care of dinner ingredients'),
    line(dayAt(2, 11, 12), 'Sarah Chen', 'Missed video call'),
    line(dayAt(2, 11, 13), 'Sarah Chen', 'Tried to reach the group, wanted to show you the trail map'),
    line(dayAt(2, 11, 20), 'Priya Sharma', 'Send it as a picture instead, easier'),
    line(dayAt(2, 11, 25), 'Sarah Chen', '<Media omitted>'),
    line(dayAt(2, 11, 25), 'Sarah Chen', 'Trail map with the route marked in red'),
    line(dayAt(0, 10, 5), 'Alex Morgan', 'One more sleep. Bags packed everyone?'),
    line(dayAt(0, 10, 6), 'Marcus Lee', 'Ready 🚗 Pick me up first, I am closest'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

export async function POST() {
  try {
    // Idempotent per chat — recreate whichever demo chat is missing
    // (e.g. the user deleted one of them on purpose).
    const [personalExists, groupExists] = await Promise.all([
      db.chat.findFirst({
        where: { sourceFile: 'demo://personal' },
        select: { id: true },
      }),
      db.chat.findFirst({
        where: { sourceFile: 'demo://group' },
        select: { id: true },
      }),
    ])

    let created = false
    const createdNames: string[] = []
    if (!personalExists) {
      const personal = parseWhatsAppText(buildPersonalChat())
      await persistParsedChat({
        title: 'Emma Watson',
        sourceFile: 'demo://personal',
        parsed: personal,
      })
      created = true
      createdNames.push('Emma Watson')
    }
    if (!groupExists) {
      const group = parseWhatsAppText(buildGroupChat())
      await persistParsedChat({
        title: 'Weekend Trip Planning',
        sourceFile: 'demo://group',
        parsed: group,
      })
      created = true
      createdNames.push('Weekend Trip Planning')
    }

    return NextResponse.json({ ok: true, skipped: !created, created: createdNames })
  } catch (err) {
    console.error('Demo creation failed:', err)
    return NextResponse.json(
      { error: 'Could not create demo chats.' },
      { status: 500 }
    )
  }
}
