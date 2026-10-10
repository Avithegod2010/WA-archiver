import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseWhatsAppText } from '@/lib/whatsapp-parser'
import { persistParsedChat } from '@/lib/chat-service'
import { DEMO_CATALOG } from '@/lib/demo-catalog'

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
  // +15 keeps every date unique (1..12 -> 16..27, no clamping collisions)
  return lines.map((l) => {
    const m = l.match(/^(\d{2})\/(\d{2})\/(\d{4}),/)
    if (!m) return l
    const day = Math.min(parseInt(m[1], 10) + 15, 27)
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
    line(dayAt(12, 12, 1), null, 'Alex Morgan created group "Weekend Trip Planning"'),
    line(dayAt(12, 12, 1), null, 'Alex Morgan added Sarah Chen'),
    line(dayAt(12, 12, 1), null, 'Alex Morgan added Marcus Lee'),
    line(dayAt(12, 12, 1), null, 'Alex Morgan added Priya Sharma'),
    line(dayAt(12, 12, 2), 'Alex Morgan', 'Welcome everyone! Planning the mountain trip for next month'),
    line(dayAt(12, 12, 3), 'Sarah Chen', 'Finally! 🎉 I have been waiting for this'),
    line(dayAt(12, 12, 5), 'Marcus Lee', 'I can drive, my car fits five people plus bags'),
    line(dayAt(12, 12, 8), 'Priya Sharma', 'Amazing 😍 What about the cabin?'),
    line(dayAt(12, 12, 10), 'Alex Morgan', 'cabin-options.pdf (file attached)'),
    line(dayAt(12, 12, 10), 'Alex Morgan', 'Three options with prices. Option 2 has the hot tub'),
    line(dayAt(12, 12, 11), 'Sarah Chen', 'Option 2. No further questions'),
    line(dayAt(12, 12, 13), 'Marcus Lee', 'Option 2 it is then. I will book it tonight'),
    line(dayAt(11, 9, 30), 'Priya Sharma', '☀️ Weather forecast looks perfect for that weekend'),
    line(dayAt(11, 9, 31), 'Priya Sharma', '<Media omitted>'),
    line(dayAt(11, 9, 31), 'Priya Sharma', 'Screenshot of the forecast, sunny all three days'),
    line(dayAt(11, 10, 15), 'Alex Morgan', 'Excellent. Packing list: 🥾 hiking boots, 🧥 warm layers, 🩳 swimsuit for the hot tub'),
    line(dayAt(11, 18, 40), 'Sarah Chen', 'Do we need cash for the cabin or is card fine?'),
    line(dayAt(11, 18, 55), 'Marcus Lee', 'Card is fine, but bring some cash for the parking meter'),
    line(dayAt(10, 8, 20), 'Alex Morgan', 'poll: Morning departure time — vote honestly 🙏\n6:00 AM: 1 vote\n8:00 AM: 3 votes\n10:00 AM: 1 vote'),
    line(dayAt(10, 8, 25), 'Marcus Lee', '8am gang. Sleep is non-negotiable'),
    line(dayAt(10, 8, 26), 'Sarah Chen', 'Agreed, 6am is a crime'),
    line(dayAt(10, 8, 30), 'Alex Morgan', 'Booked! Confirmation sent to everyone by email'),
    line(dayAt(10, 8, 31), 'Alex Morgan', 'This message was deleted'),
    line(dayAt(10, 8, 32), 'Alex Morgan', 'Wrong chat, sorry'),
    line(dayAt(10, 8, 33), 'Sarah Chen', 'Ha 😂 happens to the best of us'),
    line(dayAt(7, 16, 5), 'Priya Sharma', 'Grocery run on Friday afternoon, who is in?'),
    line(dayAt(7, 16, 6), 'Marcus Lee', 'I am in. I will handle breakfast stuff'),
    line(dayAt(7, 16, 8), 'Alex Morgan', 'I will take care of dinner ingredients'),
    line(dayAt(6, 11, 12), 'Sarah Chen', 'Missed video call'),
    line(dayAt(6, 11, 13), 'Sarah Chen', 'Tried to reach the group, wanted to show you the trail map'),
    line(dayAt(6, 11, 20), 'Priya Sharma', 'Send it as a picture instead, easier'),
    line(dayAt(6, 11, 25), 'Sarah Chen', '<Media omitted>'),
    line(dayAt(6, 11, 25), 'Sarah Chen', 'Trail map with the route marked in red'),
    line(dayAt(2, 10, 5), 'Alex Morgan', 'One more sleep. Bags packed everyone?'),
    line(dayAt(2, 10, 6), 'Marcus Lee', 'Ready 🚗 Pick me up first, I am closest'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildFamilyChat(): string {
  const lines: string[] = [
    line(dayAt(12, 10, 0), null, 'Mom created group "Sharma Family 🏡"'),
    line(dayAt(12, 10, 0), null, 'Mom added Dad'),
    line(dayAt(12, 10, 0), null, 'Mom added Anjali'),
    line(dayAt(12, 10, 1), 'Mom', 'Good morning everyone 🌞 Family lunch at home this Sunday, no excuses'),
    line(dayAt(12, 10, 3), 'Dad', 'Looking forward to it. I am making my special biryani 😎'),
    line(dayAt(12, 10, 4), 'Anjali', 'YES. The legendary biryani 🍛'),
    line(dayAt(12, 10, 6), 'You', 'I will come early and help set the table'),
    line(dayAt(11, 19, 15), 'Mom', 'poll: What should Dad cook on Sunday?\nBiryani: 2 votes\nButter Chicken: 2 votes\nRogan Josh: 1 vote'),
    line(dayAt(11, 19, 20), 'Dad', 'Biryani winning. As it should be 😄'),
    line(dayAt(11, 19, 25), 'Anjali', 'Democracy works after all'),
    line(dayAt(10, 8, 30), 'Anjali', '<Media omitted>'),
    line(dayAt(10, 8, 31), 'Anjali', 'Daisy turned 1 today 🐶🎂'),
    line(dayAt(10, 8, 33), 'Mom', 'Awww happy birthday Daisy!! 🎉 Give her extra treats'),
    line(dayAt(10, 8, 35), 'Dad', 'She ate more cake than me'),
    line(dayAt(10, 9, 0), 'You', '😂😂 classic Daisy'),
    line(dayAt(8, 18, 45), 'Mom', 'location: https://maps.app.goo.gl/newIndianGrocery'),
    line(dayAt(8, 18, 46), 'Mom', 'Found this new grocery near the highway. Much better prices for spices'),
    line(dayAt(8, 19, 0), 'Dad', 'I will go Saturday morning. Adding cardamom to the list'),
    line(dayAt(6, 13, 10), 'Mom', 'Missed voice call'),
    line(dayAt(6, 13, 11), 'Mom', 'Rang to check about the serving bowls, call me back beta'),
    line(dayAt(6, 14, 2), 'You', 'Called back ☎️ all good, bowls are in the cupboard above the oven'),
    line(dayAt(4, 20, 15), 'Anjali', 'This message was deleted'),
    line(dayAt(4, 20, 16), 'Anjali', 'Typo, sorry. Anyway — can I bring dessert?'),
    line(dayAt(4, 20, 17), 'Mom', 'Of course, chocolate cake for the birthday girl 🎂'),
    line(dayAt(2, 12, 30), 'Dad', 'sunday-lunch-recipes.pdf (file attached)'),
    line(dayAt(2, 12, 31), 'Dad', 'Final recipe list. Print it and stick it on the fridge'),
    line(dayAt(0, 9, 5), 'Mom', 'See everyone Sunday at 1pm sharp! 💚'),
    line(dayAt(0, 9, 6), 'Anjali', 'Wouldn\'t miss it 🥰'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildWorkChat(): string {
  const lines: string[] = [
    line(dayAt(13, 9, 0), null, 'Priya Nair created group "Design Team — Acme"'),
    line(dayAt(13, 9, 0), null, 'Priya Nair added Tom Becker'),
    line(dayAt(13, 9, 0), null, 'Priya Nair added Sofia Ruiz'),
    line(dayAt(13, 9, 1), 'Priya Nair', 'Morning team! Sprint 14 kicks off today 🚀'),
    line(dayAt(13, 9, 2), 'Priya Nair', 'standup-notes.md (file attached)'),
    line(dayAt(13, 9, 3), 'Tom Becker', 'The new onboarding flow mockups are ready for review'),
    line(dayAt(13, 9, 4), 'Tom Becker', 'https://figma.com/file/onboarding-v3-final'),
    line(dayAt(13, 9, 8), 'You', 'Reviewing now. The empty states look so much cleaner 👏'),
    line(dayAt(13, 10, 15), 'Sofia Ruiz', 'Legal flagged the small print on the checkout screen'),
    line(dayAt(13, 10, 16), 'Sofia Ruiz', 'Moved it above the CTA and bumped it to 12px. Should be compliant now'),
    line(dayAt(13, 10, 20), 'Priya Nair', 'Good call. Deadlines: dev handoff Thursday, QA Friday'),
    line(dayAt(12, 15, 30), 'Tom Becker', 'poll: Best time for the design critique?\nTuesday 11:00: 3 votes\nWednesday 15:00: 2 votes\nThursday 9:30: 1 vote'),
    line(dayAt(12, 15, 40), 'You', 'Tuesday works for me'),
    line(dayAt(12, 15, 42), 'Sofia Ruiz', 'Same. Morning brain is better brain'),
    line(dayAt(12, 16, 0), 'Priya Nair', 'Tuesday 11 it is. Meeting invite sent'),
    line(dayAt(10, 11, 5), 'Sofia Ruiz', 'Missed video call'),
    line(dayAt(10, 11, 6), 'Sofia Ruiz', 'My laptop updated itself mid-call. Classic Windows moment 💀'),
    line(dayAt(10, 11, 10), 'Tom Becker', 'F'),
    line(dayAt(10, 11, 12), 'You', 'RIP. Send the replay link when you can'),
    line(dayAt(8, 14, 45), 'Tom Becker', 'Pushed the new icon grid to the library — 128 icons, sorted and renamed'),
    line(dayAt(8, 14, 50), 'Priya Nair', 'Beautiful. This unblocks the mobile team'),
    line(dayAt(6, 10, 30), 'You', 'This message was deleted'),
    line(dayAt(6, 10, 31), 'You', 'Wrong thread, sorry 😅'),
    line(dayAt(4, 9, 20), 'Priya Nair', 'Heads up: client demo moved to Monday. Everything needs to be pixel perfect'),
    line(dayAt(4, 9, 25), 'Sofia Ruiz', '<Media omitted>'),
    line(dayAt(4, 9, 25), 'Sofia Ruiz', 'Updated checkout screen, take 3. Small print fixed and contrast passes AA'),
    line(dayAt(4, 9, 30), 'You', 'This is the one. Ship it 🚢'),
    line(dayAt(0, 17, 45), 'Priya Nair', 'Great sprint everyone. Logging off before the demo crunch starts 😄'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildFriendChat(): string {
  const lines: string[] = [
    line(dayAt(12, 21, 10), null, 'Messages and calls are end-to-end encrypted.'),
    line(dayAt(12, 21, 10), 'Rohan Patel', 'BRO. The new patch notes just dropped'),
    line(dayAt(12, 21, 12), 'You', 'oh no, what did they do to my main this time 😭'),
    line(dayAt(12, 21, 13), 'Rohan Patel', 'Buffed. FULLY buffed. We are SO back'),
    line(dayAt(12, 21, 15), 'You', 'GG, queue tonight then?'),
    line(dayAt(12, 21, 16), 'Rohan Patel', '9pm sharp. Also watch this, it breaks down the new meta https://youtu.be/meta-breakdown-v2'),
    line(dayAt(12, 22, 1), 'You', 'clicked that at 3am. it was NOT the meta video. never again'),
    line(dayAt(12, 22, 2), 'Rohan Patel', '😂😂 you fell for the rickroll AGAIN'),
    line(dayAt(11, 15, 30), 'Rohan Patel', '<Media omitted>'),
    line(dayAt(11, 15, 30), 'Rohan Patel', 'look at this absolute unit of a cat'),
    line(dayAt(11, 15, 45), 'You', '😹 the chonkiest. 10/10 would pet'),
    line(dayAt(9, 19, 20), 'Rohan Patel', 'Missed voice call'),
    line(dayAt(9, 19, 22), 'Rohan Patel', 'called to rant about the series finale. call me when free'),
    line(dayAt(9, 20, 5), 'You', 'just watched it. I have THOUGHTS'),
    line(dayAt(9, 20, 6), 'You', '<Media omitted>'),
    line(dayAt(9, 20, 7), 'You', 'voice note of my 5-minute rant, listen and suffer with me'),
    line(dayAt(7, 22, 40), 'Rohan Patel', 'still not over that ending btw. anyway — movie night saturday?'),
    line(dayAt(7, 22, 41), 'Rohan Patel', 'the new one everyone is talking about is finally out'),
    line(dayAt(7, 22, 50), 'You', 'I am in. I will book the tickets tonight'),
    line(dayAt(7, 22, 51), 'Rohan Patel', 'legend 🙏 back row centre, the superior seats'),
    line(dayAt(4, 13, 15), 'Rohan Patel', '<Media omitted>'),
    line(dayAt(4, 13, 16), 'Rohan Patel', 'my desk setup after the cleanup. do NOT zoom in'),
    line(dayAt(4, 13, 20), 'You', 'the cable chaos is sending me 😂'),
    line(dayAt(0, 18, 30), 'Rohan Patel', 't-minus 2 hours. snacks acquired 🍿'),
    line(dayAt(0, 18, 31), 'You', 'on my way. saving you the good seat 🎬'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildSquadChat(): string {
  const lines: string[] = [
    line(dayAt(13, 20, 0), null, 'Jules created group "The Squad 🐍"'),
    line(dayAt(13, 20, 1), 'Jules', 'welcome to chaos, coordination and cancelled plans'),
    line(dayAt(13, 20, 2), 'Meera', 'so what are we actually doing this weekend'),
    line(dayAt(13, 20, 5), 'Kabir', 'same thing we do every weekend. suggest 10 ideas, execute none'),
    line(dayAt(13, 20, 8), 'You', 'speak for yourself, I executed ONE idea last month 😤'),
    line(dayAt(13, 20, 9), 'Jules', 'and we are all so proud of you'),
    line(dayAt(12, 11, 0), 'Meera', 'poll: Saturday plan — final answer, NO takebacks\nBeach day: 2 votes\nGaming marathon: 1 vote\nFood crawl: 2 votes'),
    line(dayAt(12, 11, 3), 'Kabir', 'FOOD CRAWL. democracy has spoken'),
    line(dayAt(12, 11, 5), 'Jules', 'I know a place that does 2am biryani 🍴'),
    line(dayAt(12, 11, 6), 'Meera', 'sold'),
    line(dayAt(12, 11, 7), 'You', 'fine. but I am choosing the dessert stop and my choice is final'),
    line(dayAt(10, 16, 30), 'Kabir', '<Media omitted>'),
    line(dayAt(10, 16, 30), 'Kabir', 'mood'),
    line(dayAt(10, 16, 35), 'You', 'this is going straight to Saved Messages 💾'),
    line(dayAt(8, 21, 10), 'Jules', 'Missed group voice call'),
    line(dayAt(8, 21, 11), 'Jules', 'wifi died mid-roast. tragic. will resume the bullying later'),
    line(dayAt(8, 21, 15), 'Kabir', 'the roast will continue when the connection improves 🫡'),
    line(dayAt(5, 12, 0), 'Meera', 'whose birthday is next?? asking for cake-planning reasons 🎂'),
    line(dayAt(5, 12, 2), 'You', 'mine. 3 weeks. save the date 👀'),
    line(dayAt(5, 12, 4), 'Kabir', 'noted. preparing my legendary playlist already'),
    line(dayAt(5, 12, 6), 'You', 'party-planning.ics (file attached)'),
    line(dayAt(5, 12, 7), 'You', 'calendar hold for everyone, attendance is mandatory'),
    line(dayAt(3, 22, 45), 'Jules', 'This message was deleted'),
    line(dayAt(3, 22, 46), 'Jules', 'wrong chat lol'),
    line(dayAt(3, 22, 47), 'Meera', '👀 👀 👀'),
    line(dayAt(0, 10, 30), 'Meera', 'See you all Saturday 7pm, first stop the chaat place 🐍'),
    line(dayAt(0, 10, 31), 'Kabir', 'bringing my appetite and zero budgeting skills'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

const BUILDERS: Record<string, () => string> = {
  personal: buildPersonalChat,
  group: buildGroupChat,
  family: buildFamilyChat,
  work: buildWorkChat,
  friend: buildFriendChat,
  squad: buildSquadChat,
}

/**
 * POST /api/demo
 * Body (optional): { ids: string[] } — create only the selected demo chats.
 * No body = create every missing demo chat. Idempotent per chat.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json().catch(() => null)) as {
      ids?: unknown
    } | null
    const requested = Array.isArray(payload?.ids)
      ? payload.ids.filter(
          (id): id is string => typeof id === 'string' && id in BUILDERS
        )
      : []
    const ids = requested.length ? requested : DEMO_CATALOG.map((d) => d.id)

    const createdNames: string[] = []
    const createdIds: string[] = []
    for (const id of ids) {
      const meta = DEMO_CATALOG.find((d) => d.id === id)
      if (!meta) continue
      const exists = await db.chat.findFirst({
        where: { sourceFile: `demo://${id}` },
        select: { id: true },
      })
      if (exists) continue
      const parsed = parseWhatsAppText(BUILDERS[id]())
      const chatId = await persistParsedChat({
        title: meta.title,
        sourceFile: `demo://${id}`,
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
