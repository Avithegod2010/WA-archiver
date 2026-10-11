import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseWhatsAppText } from '@/lib/whatsapp-parser'
import { persistParsedChat } from '@/lib/chat-service'
import { DEMO_CATALOG, type DemoChatMeta } from '@/lib/demo-catalog'

export const runtime = 'nodejs'

/** Current content version for demo chats. v2 = longer, funnier scripts. */
const DEMO_VERSION = 2

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
    // ── Day 13: the Henderson report begins ──
    line(dayAt(13, 9, 2), null, 'Messages and calls are end-to-end encrypted.'),
    line(dayAt(13, 9, 3), 'Emma Watson', 'Quick heads up: the Henderson report is due Friday and I have NOT started'),
    line(dayAt(13, 9, 5), 'You', 'good news: I have a draft skeleton\nbad news: the skeleton is mostly vibes'),
    line(dayAt(13, 9, 6), 'Emma Watson', 'vibes are load-bearing. send it'),
    line(dayAt(13, 9, 8), 'You', 'report-draft.pdf (file attached)'),
    line(dayAt(13, 9, 9), 'You', 'Section 2 is thin. Be gentle'),
    line(dayAt(13, 10, 16), 'Emma Watson', 'page 7 says "as previously mentioned" four times. mentioned WHERE?'),
    line(dayAt(13, 10, 17), 'You', 'in my heart'),
    line(dayAt(13, 10, 22), 'Emma Watson', 'Also table 3 numbers are from 2021. We need fresh ones'),
    line(dayAt(13, 10, 24), 'You', 'the 2021 numbers are vintage. aged like wine'),
    line(dayAt(13, 10, 25), 'Emma Watson', 'they aged like milk. updating now'),
    line(dayAt(13, 12, 40), 'Emma Watson', 'Check the MDN page before you touch the API section\nhttps://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'),
    line(dayAt(13, 12, 41), 'You', 'ah, CORS. my sworn enemy'),
    line(dayAt(13, 12, 42), 'Emma Watson', 'may your preflights be short 🙏'),
    // ── Day 13 evening: the "view" scandal ──
    line(dayAt(13, 17, 55), 'Emma Watson', '<Media omitted>'),
    line(dayAt(13, 17, 56), 'Emma Watson', 'The view from the office this morning 🌅'),
    line(dayAt(13, 18, 1), 'You', 'that is stunning?? where even IS that'),
    line(dayAt(13, 18, 2), 'Emma Watson', "that's the stock photo screensaver. the real view is the parking lot"),
    line(dayAt(13, 18, 4), 'Emma Watson', 'location: https://maps.app.goo.gl/kQ3fRZx8Yh7L2mN19'),
    line(dayAt(13, 18, 4), 'Emma Watson', 'Real view adjacent: the harbour café. Thursday?'),
    line(dayAt(13, 19, 30), 'You', 'Thursday works. I will bring the good notes'),
    line(dayAt(13, 19, 31), 'Emma Watson', 'perfect. calendar invite incoming'),
    // ── Day 11, late night: Brenda is born ──
    line(dayAt(11, 23, 12), 'Emma Watson', 'ok important question before I forget'),
    line(dayAt(11, 23, 12), 'Emma Watson', "my sourdough starter needs a name. it's alive and judging me"),
    line(dayAt(11, 23, 15), 'You', 'Brenda'),
    line(dayAt(11, 23, 16), 'Emma Watson', 'BRENDA. yes. she looks EXACTLY like a Brenda'),
    line(dayAt(11, 23, 20), 'You', 'never doubted it. goodnight to Brenda'),
    // ── Day 10: Brenda updates ──
    line(dayAt(10, 8, 45), 'Emma Watson', '<Media omitted>'),
    line(dayAt(10, 8, 45), 'Emma Watson', "voice note: 40 seconds of Brenda news — she has DOUBLED overnight"),
    line(dayAt(10, 9, 10), 'You', 'Brenda is thriving while I cannot keep a basil plant alive'),
    line(dayAt(10, 9, 11), 'Emma Watson', 'basil is a scam. Brenda is the future'),
    // ── Day 9: the draft returns ──
    line(dayAt(9, 11, 30), 'You', 'report-draft-v2.pdf (file attached)'),
    line(dayAt(9, 11, 31), 'You', 'fresh numbers, fewer hearts. let me know'),
    line(dayAt(9, 14, 20), 'Emma Watson', 'Genuinely good 👏 one typo on page 9: "pubic" → "public"'),
    line(dayAt(9, 14, 21), 'You', 'This message was deleted'),
    line(dayAt(9, 14, 21), 'You', 'fixing it. we will never speak of page 9'),
    line(dayAt(9, 14, 30), 'Emma Watson', 'Submitted. If Henderson asks, the vibes were load-bearing'),
    // ── Day 8, early morning: the croissant investigation ──
    line(dayAt(8, 7, 15), 'Emma Watson', 'CROISSANT INVESTIGATION UPDATE'),
    line(dayAt(8, 7, 16), 'Emma Watson', 'someone ate my croissant from the office fridge. it had a POST-IT on it'),
    line(dayAt(8, 7, 20), 'You', "a post-it?? that's premeditated"),
    line(dayAt(8, 7, 21), 'Emma Watson', 'I did not eat it. I was in the kitchen for 40 minutes at 6am but I did NOT eat it'),
    line(dayAt(8, 7, 22), 'You', 'emma.'),
    line(dayAt(8, 7, 23), 'Emma Watson', 'it was a long 40 minutes. anyway, new suspect: Dave from finance'),
    // ── Day 7: case closed ──
    line(dayAt(7, 16, 40), 'Emma Watson', 'Dave bought a box of croissants for the whole office. no note'),
    line(dayAt(7, 16, 42), 'You', 'a guilty man buys in bulk'),
    line(dayAt(7, 16, 45), 'Emma Watson', 'case closed. Brenda sends her regards'),
    // ── Day 5: the missed call + BIG news ──
    line(dayAt(5, 13, 5), 'Emma Watson', 'Missed voice call'),
    line(dayAt(5, 13, 6), 'Emma Watson', 'called about Thursday — is 10am still good?'),
    line(dayAt(5, 14, 45), 'You', 'yep, 10am! also I have news. BIG news'),
    line(dayAt(5, 14, 50), 'Emma Watson', 'caps lock energy?? spill'),
    line(dayAt(5, 14, 51), 'You', 'I GOT THE PROMOTION 🎉🎉'),
    line(dayAt(5, 14, 52), 'Emma Watson', 'WHAT. YES. CONGRATULATIONS!!! 🥳'),
    line(dayAt(5, 14, 53), 'Emma Watson', 'Thursday coffee is now a celebration coffee. Brenda will bake in your honour'),
    line(dayAt(5, 15, 0), 'You', "tell Brenda she's the real MVP"),
    line(dayAt(5, 18, 30), 'Emma Watson', '<Media omitted>'),
    line(dayAt(5, 18, 31), 'Emma Watson', "voice note: Brenda's first successful loaf. she owes you everything"),
    // ── Day 3: the typo tax ──
    line(dayAt(3, 9, 40), 'You', 'see you Tuesday for coffee!'),
    line(dayAt(3, 9, 41), 'You', '*meant Thursday. Tuesday me is a liar'),
    line(dayAt(3, 9, 42), 'Emma Watson', '😂 Thursday it is. bringing the loaf'),
    // ── Day 0: the payoff ──
    line(dayAt(0, 7, 58), 'Emma Watson', 'today is the day. harbour café, 10am, window seat reserved'),
    line(dayAt(0, 8, 0), 'You', 'on my way. the good notes are loaded'),
    line(dayAt(0, 8, 1), 'Emma Watson', 'real view this time. no stock photos'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildGroupChat(): string {
  const lines: string[] = [
    // ── Day 14: group is born, cabin is chosen ──
    line(dayAt(14, 12, 1), null, 'Alex Morgan created group "Weekend Trip Planning"'),
    line(dayAt(14, 12, 1), null, 'Alex Morgan added Sarah Chen'),
    line(dayAt(14, 12, 1), null, 'Alex Morgan added Marcus Lee'),
    line(dayAt(14, 12, 1), null, 'Alex Morgan added Priya Sharma'),
    line(dayAt(14, 12, 2), 'Alex Morgan', 'Welcome everyone! Planning the mountain trip for next month'),
    line(dayAt(14, 12, 3), 'Sarah Chen', 'Finally!! 🎉 I have been mentally packed since January'),
    line(dayAt(14, 12, 5), 'Marcus Lee', 'I can drive, my car fits five people plus bags'),
    line(dayAt(14, 12, 6), 'Priya Sharma', 'five people?? there are four of us'),
    line(dayAt(14, 12, 7), 'Marcus Lee', 'space for snacks. non-negotiable'),
    line(dayAt(14, 12, 10), 'Alex Morgan', 'cabin-options.pdf (file attached)'),
    line(dayAt(14, 12, 10), 'Alex Morgan', 'Three options. Option 2 has a hot tub, just saying'),
    line(dayAt(14, 12, 11), 'Sarah Chen', 'Option 2. No further questions, your honour'),
    line(dayAt(14, 12, 13), 'Priya Sharma', 'the hot tub has decided for all of us'),
    line(dayAt(14, 12, 15), 'Marcus Lee', 'Booked! 🎉 paying my respects to the hot tub gods'),
    // ── Day 13: weather verification ──
    line(dayAt(13, 9, 30), 'Alex Morgan', 'Forecast says perfect. SUNNY. all three days ☀️'),
    line(dayAt(13, 9, 35), 'Priya Sharma', '<Media omitted>'),
    line(dayAt(13, 9, 35), 'Priya Sharma', 'screenshot from two sources. it is real. we are going'),
    // ── Day 11: poll + the trail with suspicious quotes ──
    line(dayAt(11, 18, 20), 'Alex Morgan', 'poll: Morning departure time — vote honestly 🙏\n6:00 AM: 1 vote\n8:00 AM: 3 votes\n10:00 AM: 1 vote'),
    line(dayAt(11, 18, 22), 'Sarah Chen', '8am gang. sleep is non-negotiable'),
    line(dayAt(11, 18, 23), 'Marcus Lee', '6am is a crime against the body'),
    line(dayAt(11, 18, 25), 'Alex Morgan', 'noted. democracy has spoken, 8am it is'),
    line(dayAt(11, 18, 30), 'Priya Sharma', 'https://alltrails.com/pine-ridge-loop'),
    line(dayAt(11, 18, 30), 'Priya Sharma', 'Saturday\'s trail. 4 hours, "moderate"'),
    line(dayAt(11, 18, 32), 'Marcus Lee', 'why is moderate in quotes, Priya'),
    line(dayAt(11, 18, 33), 'Priya Sharma', 'no reason 😇'),
    // ── Day 10: the one-pot incident surfaces ──
    line(dayAt(10, 20, 45), 'Marcus Lee', 'This message was deleted'),
    line(dayAt(10, 20, 46), 'Marcus Lee', 'wrong photo. that was NOT the trip snack plan'),
    line(dayAt(10, 20, 47), 'Sarah Chen', 'the snack plan was a photo of your KITCHEN??'),
    line(dayAt(10, 20, 48), 'Marcus Lee', "that's from the one-pot incident. we do not discuss the one-pot incident"),
    line(dayAt(10, 20, 50), 'Priya Sharma', 'the fire alarm remembers'),
    line(dayAt(10, 20, 51), 'Marcus Lee', 'the fire alarm is dramatic and overreacts'),
    // ── Day 9: Sarah imposes order ──
    line(dayAt(9, 8, 15), 'Sarah Chen', 'packing-list.pdf (file attached)'),
    line(dayAt(9, 8, 15), 'Sarah Chen', 'everything you need. check it twice. Marcus, twice'),
    line(dayAt(9, 8, 17), 'Marcus Lee', 'I was going to pack one hoodie for three days and live dangerously'),
    line(dayAt(9, 8, 18), 'Sarah Chen', 'not on my watch'),
    // ── Day 8: dinner justice ──
    line(dayAt(8, 11, 30), 'Priya Sharma', 'Marcus is doing dinner Friday. AGAIN. after the incident'),
    line(dayAt(8, 11, 32), 'Marcus Lee', 'that was two weeks ago and the pot was 90% fine'),
    line(dayAt(8, 11, 33), 'Sarah Chen', 'the SMOKE, Marcus'),
    line(dayAt(8, 11, 34), 'Marcus Lee', 'ambiance'),
    line(dayAt(8, 11, 36), 'Alex Morgan', "for the record I'm bringing backup pasta. just in case"),
    line(dayAt(8, 11, 37), 'Marcus Lee', 'I accept your lack of faith. the pot will be redeemed'),
    // ── Day 6: the map, finally ──
    line(dayAt(6, 16, 5), 'Sarah Chen', 'Missed video call'),
    line(dayAt(6, 16, 6), 'Sarah Chen', 'tried to show everyone the trail map, group call failed me'),
    line(dayAt(6, 16, 10), 'Priya Sharma', 'send it as a photo, this group cannot handle video'),
    line(dayAt(6, 16, 12), 'Sarah Chen', '<Media omitted>'),
    line(dayAt(6, 16, 12), 'Sarah Chen', 'trail map. red line = us. X = the summit burger place'),
    line(dayAt(6, 16, 14), 'Marcus Lee', "there's a burger place?? why did no one lead with this"),
    // ── Day 5: pin it, there's no signal ──
    line(dayAt(5, 10, 0), 'Alex Morgan', 'location: https://maps.app.goo.gl/cabinPineRidge'),
    line(dayAt(5, 10, 0), 'Alex Morgan', 'cabin pin. save it now, there is no signal up there'),
    line(dayAt(5, 10, 5), 'Priya Sharma', 'no signal?? for THREE days??'),
    line(dayAt(5, 10, 6), 'Sarah Chen', "Priya it's called nature. we are going to be FINE"),
    // ── Day 2, late night: hot tub panic ──
    line(dayAt(2, 23, 40), 'Priya Sharma', 'GUYS'),
    line(dayAt(2, 23, 40), 'Priya Sharma', 'the cabin just texted me. hot tub has an EXTRA cleaning fee??'),
    line(dayAt(2, 23, 42), 'Alex Morgan', 'I checked the booking. the fee is included. GO TO SLEEP'),
    line(dayAt(2, 23, 43), 'Priya Sharma', 'the hot tub is safe. goodnight'),
    // ── Day 1: the 7:45 that almost was ──
    line(dayAt(1, 14, 20), 'Marcus Lee', "pickup Saturday — I'm at Alex's place by 7:45"),
    line(dayAt(1, 14, 21), 'Marcus Lee', '*meant 8:45. I am not doing 7:45. I am not a monster'),
    line(dayAt(1, 14, 22), 'Sarah Chen', '😂 we almost lost everything'),
    // ── Day 0: the payoff ──
    line(dayAt(0, 8, 0), 'Alex Morgan', 'bags packed, car loaded, hot tub awaiting. pickup order: Marcus, Sarah, Priya'),
    line(dayAt(0, 8, 1), 'Marcus Lee', 'ready 🚗 the pot rides shotgun'),
    line(dayAt(0, 8, 2), 'Priya Sharma', 'the pot is not riding shotgun'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildFamilyChat(): string {
  const lines: string[] = [
    // ── Day 14: lunch declared, biryani claimed ──
    line(dayAt(14, 10, 0), null, 'Mom created group "Sharma Family 🏡"'),
    line(dayAt(14, 10, 0), null, 'Mom added Dad'),
    line(dayAt(14, 10, 0), null, 'Mom added Anjali'),
    line(dayAt(14, 10, 1), 'Mom', 'Good morning 🌞 Sunday lunch at home. Attendance is not optional'),
    line(dayAt(14, 10, 3), 'Dad', 'I am making my legendary biryani 😎'),
    line(dayAt(14, 10, 4), 'Anjali', 'THE biryani. capital L legendary'),
    line(dayAt(14, 10, 6), 'You', 'I will come early and help. mostly taste. I mean help'),
    line(dayAt(14, 10, 8), 'Mom', 'You will help FIRST, taste SECOND'),
    line(dayAt(14, 10, 9), 'Dad', 'the recipe stays top secret though. even from family'),
    // ── Day 13: the rival recipe ──
    line(dayAt(13, 19, 15), 'Anjali', 'Dad I found a biryani recipe online that claims it is better than yours'),
    line(dayAt(13, 19, 17), 'Dad', 'BLOCKED'),
    line(dayAt(13, 19, 17), 'Dad', 'send it to me'),
    line(dayAt(13, 19, 18), 'Anjali', 'https://recipes.example.com/biryani-royale'),
    line(dayAt(13, 19, 25), 'Dad', 'This message was deleted'),
    line(dayAt(13, 19, 26), 'Dad', 'I was not going to TRY it. I was going to critique it. scientifically'),
    line(dayAt(13, 19, 30), 'Mom', 'he saved it to favourites 😏'),
    line(dayAt(13, 19, 31), 'Dad', 'for RESEARCH'),
    // ── Day 12: the menu poll ──
    line(dayAt(12, 19, 0), 'Mom', 'poll: Sunday menu — final vote\nBiryani: 3 votes\nButter Chicken: 1 vote\nRogan Josh: 1 vote'),
    line(dayAt(12, 19, 2), 'Anjali', 'democracy has spoken. again'),
    line(dayAt(12, 19, 4), 'Dad', 'Biryani 3-1-1. the people are wise'),
    line(dayAt(12, 19, 6), 'Mom', 'I voted butter chicken. I live in this house differently'),
    // ── Day 11: Daisy's first birthday (morning cluster) ──
    line(dayAt(11, 8, 30), 'Anjali', '<Media omitted>'),
    line(dayAt(11, 8, 31), 'Anjali', 'DAISY TURNED 1 TODAY 🐶🎂'),
    line(dayAt(11, 8, 33), 'Mom', 'HAPPY BIRTHDAY BABY GIRL 🎉 extra treats today!'),
    line(dayAt(11, 8, 35), 'Dad', 'she ate more cake than me and I respect it'),
    line(dayAt(11, 8, 45), 'Anjali', 'she got a party hat. it lasted 4 seconds'),
    line(dayAt(11, 9, 0), 'Anjali', '<Media omitted>'),
    line(dayAt(11, 9, 0), 'Anjali', 'hat aftermath. she holds no grudges, only snacks'),
    // ── Day 9: the spice run ──
    line(dayAt(9, 18, 45), 'Mom', 'location: https://maps.app.goo.gl/newIndianGrocery'),
    line(dayAt(9, 18, 45), 'Mom', 'New spice shop near the highway. Cardamom is HALF price'),
    line(dayAt(9, 18, 50), 'Dad', 'I will go Saturday. stocking up for the biryani'),
    line(dayAt(9, 18, 52), 'Mom', "get saffron too. and don't come home with experimental pickles again"),
    line(dayAt(9, 18, 53), 'Dad', 'one time. that happened ONE time'),
    // ── Day 7: bowls diplomacy ──
    line(dayAt(7, 13, 10), 'Mom', 'Missed voice call'),
    line(dayAt(7, 13, 11), 'Mom', 'called about the serving bowls. call me back beta'),
    line(dayAt(7, 14, 2), 'You', 'called back ☎️ bowls are in the cupboard above the oven'),
    line(dayAt(7, 14, 5), 'Mom', 'Good. the blue ones, not the chipped ones'),
    line(dayAt(7, 14, 6), 'You', '<Media omitted>'),
    line(dayAt(7, 14, 6), 'You', 'voice note: proof the blue bowls are intact. the jury can rest'),
    line(dayAt(7, 14, 10), 'Mom', 'flawless work. see you Sunday'),
    // ── Day 5: 3am with Anjali + the typo tax ──
    line(dayAt(5, 3, 15), 'Anjali', 'anyone else awake or is it just me and my four assignments'),
    line(dayAt(5, 3, 20), 'You', 'just you and the assignments. go to sleep Anjali'),
    line(dayAt(5, 3, 21), 'Anjali', 'sleep is for people without deadlines'),
    line(dayAt(5, 8, 0), 'Mom', 'ANJALI MEHTA. (using your full name so you know I am serious)'),
    line(dayAt(5, 8, 2), 'Anjali', "that's not even my name and I'm still scared"),
    line(dayAt(5, 12, 30), 'Anjali', 'can I bring dessert on Sunday?'),
    line(dayAt(5, 12, 31), 'Anjali', '*meant to ask yesterday. exam brain. forgive me'),
    line(dayAt(5, 12, 35), 'Mom', 'chocolate cake for the birthday girl 🎂'),
    line(dayAt(5, 12, 40), 'Dad', 'cake AND biryani. this family runs on joy'),
    // ── Day 3: the official plan vs the salad ──
    line(dayAt(3, 12, 0), 'Dad', 'sunday-lunch-recipes.pdf (file attached)'),
    line(dayAt(3, 12, 1), 'Dad', 'Final plan. Print it. Fridge. No questions'),
    line(dayAt(3, 12, 5), 'Mom', 'you forgot "vegetables" on the plan, dear'),
    line(dayAt(3, 12, 6), 'Dad', 'the plan is biryani-positive, not vegetable-negative'),
    line(dayAt(3, 12, 7), 'Mom', 'salad. there WILL be salad'),
    line(dayAt(3, 12, 10), 'Anjali', 'mom said salad. the constitution is amended'),
    line(dayAt(3, 12, 12), 'Dad', 'fine. ONE salad. and it will be the best salad in town'),
    // ── Day 0: the payoff ──
    line(dayAt(0, 9, 5), 'Mom', "Today is the day! 1pm sharp 💚"),
    line(dayAt(0, 9, 6), 'Dad', 'biryani process begins NOW. layers matter'),
    line(dayAt(0, 9, 10), 'Anjali', 'bringing cake and my appetite 🥰'),
    line(dayAt(0, 9, 12), 'You', 'leaving in 30. saving everyone from the chipped bowls'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildWorkChat(): string {
  const lines: string[] = [
    // ── Day 14: sprint kickoff ──
    line(dayAt(14, 9, 0), null, 'Priya Nair created group "Design Team — Acme"'),
    line(dayAt(14, 9, 0), null, 'Priya Nair added Tom Becker'),
    line(dayAt(14, 9, 0), null, 'Priya Nair added Sofia Ruiz'),
    line(dayAt(14, 9, 1), 'Priya Nair', 'Morning team! Sprint 14 kicks off today 🚀'),
    line(dayAt(14, 9, 2), 'Priya Nair', 'standup-notes.md (file attached)'),
    line(dayAt(14, 9, 3), 'Tom Becker', 'The onboarding flow v3 mockups are up for review'),
    line(dayAt(14, 9, 4), 'Tom Becker', 'https://figma.com/file/onboarding-v3-final'),
    line(dayAt(14, 9, 8), 'You', 'Reviewing now. The empty states are SO clean 👏'),
    line(dayAt(14, 9, 10), 'Sofia Ruiz', 'clean until legal gets involved 👀'),
    line(dayAt(14, 9, 12), 'Priya Nair', 'sofia. do not summon them'),
    line(dayAt(14, 10, 15), 'Sofia Ruiz', 'Update: legal flagged the small print on checkout'),
    line(dayAt(14, 10, 16), 'Sofia Ruiz', 'Moved it above the CTA, bumped to 12px. Compliant AND readable'),
    line(dayAt(14, 10, 18), 'Tom Becker', '12px. tiny print stays winning'),
    line(dayAt(14, 10, 20), 'Priya Nair', 'Good save. Deadlines: dev handoff Thursday, QA Friday'),
    // ── Day 13: critique scheduling + keycap agenda ──
    line(dayAt(13, 15, 30), 'Tom Becker', 'poll: Design critique — pick your fighter\nTuesday 11:00: 3 votes\nWednesday 15:00: 2 votes\nThursday 9:30: 1 vote'),
    line(dayAt(13, 15, 35), 'You', 'Tuesday. morning brain is better brain'),
    line(dayAt(13, 15, 36), 'Sofia Ruiz', "agreed. post-lunch me is a stranger I don't trust"),
    line(dayAt(13, 15, 40), 'Priya Nair', 'Tuesday 11 it is. invite sent'),
    line(dayAt(13, 15, 41), 'Tom Becker', 'bringing my new keycaps to the critique'),
    line(dayAt(13, 15, 42), 'Sofia Ruiz', "tom. it's a design critique. not a keyboard convention"),
    line(dayAt(13, 15, 43), 'Tom Becker', 'the keycaps ARE design'),
    // ── Day 12: critique results ──
    line(dayAt(12, 11, 0), 'Tom Becker', 'critique notes uploaded. 14 comments, 3 "bold", 1 "are you sure"'),
    line(dayAt(12, 11, 5), 'You', 'the "are you sure" was about MY slide. I felt that'),
    line(dayAt(12, 11, 7), 'Sofia Ruiz', 'it was a constructive "are you sure"'),
    // ── Day 10: the mid-call update ──
    line(dayAt(10, 11, 5), 'Sofia Ruiz', 'Missed video call'),
    line(dayAt(10, 11, 6), 'Sofia Ruiz', 'my laptop updated itself mid-call. classic Windows moment 💀'),
    line(dayAt(10, 11, 8), 'Tom Becker', 'F'),
    line(dayAt(10, 11, 9), 'You', 'RIP. send the replay link when you can'),
    line(dayAt(10, 11, 15), 'Sofia Ruiz', "replay is up. watch me freeze at 4:12, it's art"),
    // ── Day 9: icon grid + the meme confession ──
    line(dayAt(9, 14, 45), 'Tom Becker', 'Pushed the new icon grid to the library — 128 icons, renamed, sorted'),
    line(dayAt(9, 14, 50), 'Priya Nair', 'Beautiful. this unblocks the mobile team'),
    line(dayAt(9, 14, 55), 'You', 'This message was deleted'),
    line(dayAt(9, 14, 55), 'You', 'sent that to the wrong team 😅 anyway: the icons look great'),
    line(dayAt(9, 14, 57), 'Sofia Ruiz', 'what did you send them. confess'),
    line(dayAt(9, 14, 58), 'You', 'a meme. corporate and HR-compliant. allegedly'),
    line(dayAt(9, 15, 0), 'Tom Becker', 'the audit trail demands the meme'),
    // ── Day 8: demo moved, panic colour-coded ──
    line(dayAt(8, 9, 20), 'Priya Nair', 'Client demo moved to Monday. EVERYTHING needs to be pixel perfect'),
    line(dayAt(8, 9, 21), 'Priya Nair', "I am not stressed. I have colour-coded my stress. it's fine"),
    line(dayAt(8, 9, 22), 'Sofia Ruiz', 'the colour coding is grey. all grey'),
    line(dayAt(8, 9, 25), 'Tom Becker', '<Media omitted>'),
    line(dayAt(8, 9, 25), 'Tom Becker', 'checkout screen take 3. small print fixed, contrast passes AA'),
    line(dayAt(8, 9, 30), 'You', 'This is the one. ship it 🚢'),
    // ── Day 6: the voice note ──
    line(dayAt(6, 16, 10), 'Priya Nair', '<Media omitted>'),
    line(dayAt(6, 16, 10), 'Priya Nair', 'voice note: 60-second demo script. listen before Monday'),
    line(dayAt(6, 16, 20), 'Sofia Ruiz', 'your voice note energy could power the office'),
    line(dayAt(6, 16, 25), 'You', 'listened twice. script locked in'),
    line(dayAt(6, 16, 30), 'Tom Becker', 'day 6 of sprint: keycap shipment still in customs. the pain continues'),
    // ── Day 5: QA growth ──
    line(dayAt(5, 10, 0), 'Sofia Ruiz', 'QA checklist done. 2 bugs found, 2 fixed, neither mine for once'),
    line(dayAt(5, 10, 5), 'Priya Nair', 'growth!'),
    // ── Day 3: rehearsal notes ──
    line(dayAt(3, 9, 15), 'You', 'demo-rehearsal-notes.pdf (file attached)'),
    line(dayAt(3, 9, 15), 'You', 'run of show for Monday. 10 slides, 0 surprises'),
    line(dayAt(3, 9, 20), 'Tom Becker', 'one surprise: I rehearsed TWICE. voluntarily'),
    line(dayAt(3, 9, 22), 'Priya Nair', 'who are you and what have you done with Tom'),
    // ── Day 1: eve of demo ──
    line(dayAt(1, 18, 30), 'Priya Nair', 'Final check tomorrow 9am, demo at 11. bring coffee and calm'),
    line(dayAt(1, 18, 32), 'Sofia Ruiz', 'calm is not in my skill tree. coffee I can do'),
    // ── Day 0: the payoff ──
    line(dayAt(0, 8, 58), 'Priya Nair', "demo day. we've got this 🚀"),
    line(dayAt(0, 11, 45), 'Sofia Ruiz', 'DEMO DONE. client said "best handoff deck this year"'),
    line(dayAt(0, 11, 47), 'Tom Becker', 'CAPS LOCK ON BECAUSE I AM VERY CALM AND PROFESSIONAL. WE DID IT'),
    line(dayAt(0, 11, 50), 'You', "best team I've ever panicked with 🥂"),
    line(dayAt(0, 12, 0), 'Priya Nair', 'Sprint 14: shipped. Sprint 15: next week. tonight: NOTHING'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildFriendChat(): string {
  const lines: string[] = [
    // ── Day 13: patch notes, the eternal walls ──
    line(dayAt(13, 21, 10), null, 'Messages and calls are end-to-end encrypted.'),
    line(dayAt(13, 21, 11), 'Rohan Patel', "BRO. patch notes just dropped. it's a PDF. a WHOLE pdf"),
    line(dayAt(13, 21, 12), 'You', 'did they patch the wall-clip exploit?'),
    line(dayAt(13, 21, 13), 'Rohan Patel', 'no they PATCHED the patch. the fix has fixes'),
    line(dayAt(13, 21, 14), 'You', 'so the walls are just... walls again? tragic'),
    line(dayAt(13, 21, 15), 'Rohan Patel', 'the meta is now "shoot the enemy". revolutionary stuff'),
    line(dayAt(13, 21, 16), 'You', 'queue tonight?'),
    line(dayAt(13, 21, 17), 'Rohan Patel', '9pm sharp. also linking one video, it is SAFE this time https://youtu.be/patch-notes-47'),
    line(dayAt(13, 22, 55), 'You', 'it was NOT safe. rickrolled at 11pm on a weeknight. AGAIN'),
    line(dayAt(13, 22, 56), 'Rohan Patel', '😂 the commitment is undefeated. three years running'),
    line(dayAt(13, 22, 57), 'You', 'counting the days until revenge'),
    // ── Day 12: Tank ──
    line(dayAt(12, 15, 30), 'Rohan Patel', '<Media omitted>'),
    line(dayAt(12, 15, 30), 'Rohan Patel', 'look at this absolute unit of a cat'),
    line(dayAt(12, 15, 32), 'You', '😹 the chonkiest. 10/10 would pet'),
    line(dayAt(12, 15, 33), 'Rohan Patel', 'his name is Tank. he guards the router. the internet has never been safer'),
    line(dayAt(12, 15, 35), 'You', 'Tank the internet guardian. give that cat a raise'),
    // ── Day 11: finale trauma, rant duel ──
    line(dayAt(11, 19, 20), 'Rohan Patel', 'Missed voice call'),
    line(dayAt(11, 19, 22), 'Rohan Patel', "called to rant about the series finale. it's URGENT"),
    line(dayAt(11, 20, 5), 'You', 'just finished it. I have THOUGHTS'),
    line(dayAt(11, 20, 6), 'You', '<Media omitted>'),
    line(dayAt(11, 20, 7), 'You', 'voice note: 6 minutes of pure rant. listen and suffer with me'),
    line(dayAt(11, 20, 40), 'Rohan Patel', 'listened. we are traumatised in stereo. the writers owe us money'),
    line(dayAt(11, 20, 41), 'Rohan Patel', 'replying with my rant: 9 minutes. I win'),
    line(dayAt(11, 20, 45), 'You', 'this is not a competition'),
    line(dayAt(11, 20, 46), 'Rohan Patel', 'everything is a competition. it is why I am Gold 3, mentality: Global Elite'),
    line(dayAt(11, 20, 47), 'You', 'rank: Gold. vibes: Champion. beautiful'),
    // ── Day 9: the energy drink tribunal ──
    line(dayAt(9, 22, 10), 'You', 'my energy drink stash is missing two cans'),
    line(dayAt(9, 22, 11), 'Rohan Patel', 'wild. anyway, ready for ranked?'),
    line(dayAt(9, 22, 12), 'You', 'rohan.'),
    line(dayAt(9, 22, 13), 'Rohan Patel', 'I did not drink your energy drinks. I was at your place for 3 hours yesterday but I did NOT drink them'),
    line(dayAt(9, 22, 14), 'You', 'suspiciously specific, your honour'),
    line(dayAt(9, 22, 15), 'Rohan Patel', 'I will replace them with the BERRY kind. berry is an upgrade. this is a service'),
    // ── Day 8: the clutch (late night cluster) ──
    line(dayAt(8, 21, 30), 'Rohan Patel', 'get on. ranked. NOW'),
    line(dayAt(8, 21, 31), 'You', 'logging in. this better be good'),
    line(dayAt(8, 22, 50), 'Rohan Patel', 'WE CLUTCHED IT. 1V4. I AM STILL SHAKING'),
    line(dayAt(8, 22, 51), 'You', 'I WATCHED YOU STEALTH-WALK PAST THE BOMB. LEGEND'),
    line(dayAt(8, 22, 52), 'Rohan Patel', 'Gold 2 now. mentality: immortal'),
    line(dayAt(8, 22, 56), 'Rohan Patel', '<Media omitted>'),
    line(dayAt(8, 22, 56), 'Rohan Patel', 'receipts. frame it'),
    line(dayAt(8, 23, 0), 'You', 'printing it. it goes on my wall'),
    // ── Day 6: the revenge link ──
    line(dayAt(6, 17, 45), 'You', 'rohan check this build guide https://youtu.be/never-gonna-give-you-up-again'),
    line(dayAt(6, 17, 47), 'Rohan Patel', 'I checked the URL. nice try. you waited SIX DAYS for that'),
    line(dayAt(6, 17, 48), 'You', 'patience is a virtue. revenge is a lifestyle'),
    line(dayAt(6, 17, 50), 'Rohan Patel', 'respect. the student has surpassed nothing yet, but respect'),
    // ── Day 4: movie night ──
    line(dayAt(4, 22, 40), 'Rohan Patel', "movie night saturday? the new one everyone's talking about is finally out"),
    line(dayAt(4, 22, 42), 'You', "I'm in. booking tickets tonight"),
    line(dayAt(4, 22, 43), 'Rohan Patel', 'back row centre. the superior seats. this is not up for debate'),
    line(dayAt(4, 22, 45), 'You', 'agreed. snacks on me after the energy drink betrayal'),
    line(dayAt(4, 22, 46), 'Rohan Patel', 'the betrayal was paid for in berry. we move forward'),
    // ── Day 3: the cable nest ──
    line(dayAt(3, 13, 15), 'Rohan Patel', '<Media omitted>'),
    line(dayAt(3, 13, 16), 'Rohan Patel', 'my desk after "cleaning". do NOT zoom in'),
    line(dayAt(3, 13, 18), 'You', 'the cable nest has a cable nest 😂'),
    line(dayAt(3, 13, 20), 'Rohan Patel', 'it is structural. I touch nothing and it holds'),
    line(dayAt(3, 13, 25), 'Rohan Patel', 'This message was deleted'),
    line(dayAt(3, 13, 25), 'Rohan Patel', "*meant to send the tidy version. the nest stays. it's iconic"),
    // ── Day 1: the 7pm that almost was 6pm ──
    line(dayAt(1, 18, 30), 'Rohan Patel', 'picking you up saturday 6pm for the movie'),
    line(dayAt(1, 18, 31), 'Rohan Patel', '*meant 7pm. 6pm me was optimistic'),
    line(dayAt(1, 18, 32), 'You', '😂 noted. 7pm. I will be dressed by 7:15'),
    line(dayAt(1, 18, 33), 'Rohan Patel', 'see? planning'),
    // ── Day 0: the payoff ──
    line(dayAt(0, 18, 0), 'Rohan Patel', 'T-minus 60. Tank is guarding the house, snacks acquired 🍿'),
    line(dayAt(0, 18, 5), 'You', 'on my way. revenge rickroll queued for the drive'),
    line(dayAt(0, 18, 6), 'Rohan Patel', 'I fear nothing. except that. good luck'),
  ]
  return ensureDayAmbiguityResolved(lines).join('\n')
}

function buildSquadChat(): string {
  const lines: string[] = [
    // ── Day 14: the squad convenes ──
    line(dayAt(14, 20, 0), null, 'Jules created group "The Squad 🐍"'),
    line(dayAt(14, 20, 1), 'Jules', 'welcome to chaos, coordination and cancelled plans'),
    line(dayAt(14, 20, 2), 'Meera', 'so what are we actually doing this weekend'),
    line(dayAt(14, 20, 4), 'Kabir', 'same as always: 10 ideas, 0 executions, one group nap'),
    line(dayAt(14, 20, 5), 'You', 'speak for yourself. I executed ONE plan last month'),
    line(dayAt(14, 20, 6), 'Jules', 'and history remembers. we built a monument. it was a nap'),
    // ── Day 13: the poll and the biryani lobby ──
    line(dayAt(13, 11, 0), 'Meera', 'poll: Saturday plan — final answer, NO takebacks\nBeach day: 2 votes\nGaming marathon: 1 vote\nFood crawl: 2 votes'),
    line(dayAt(13, 11, 3), 'Kabir', 'FOOD CRAWL. democracy has spoken'),
    line(dayAt(13, 11, 4), 'Meera', '2-2-1 is NOT a mandate. recount!'),
    line(dayAt(13, 11, 6), 'Jules', 'the tiebreaker is that I know a place doing 2am biryani 🍴'),
    line(dayAt(13, 11, 7), 'Meera', 'the biryani lobby strikes again'),
    line(dayAt(13, 11, 9), 'You', 'fine. crawl wins. but I pick the dessert stop and it is FINAL'),
    line(dayAt(13, 11, 10), 'Kabir', 'the dessert stop is the only thing holding this group together'),
    // ── Day 12: the spice rivalry ──
    line(dayAt(12, 17, 30), 'Meera', 'chaat crawl route, ranked by spice level: https://streeteats.example.com/chaat-trail'),
    line(dayAt(12, 17, 32), 'Kabir', 'ranked by spice?? I have a sensitive palate'),
    line(dayAt(12, 17, 33), 'Meera', 'your palate lost to a medium salsa, Kabir'),
    line(dayAt(12, 17, 35), 'Kabir', 'that salsa was aggressive and so are you'),
    line(dayAt(12, 17, 36), 'Jules', 'their rivalry fuels this group. never resolve it'),
    // ── Day 10: the emotional support cat ──
    line(dayAt(10, 16, 30), 'Kabir', '<Media omitted>'),
    line(dayAt(10, 16, 30), 'Kabir', 'mood'),
    line(dayAt(10, 16, 33), 'You', 'a cat in a business suit?? this is going straight to camera roll 💾'),
    // ── Day 8: roast interrupted ──
    line(dayAt(8, 21, 10), 'Jules', 'Missed group voice call'),
    line(dayAt(8, 21, 11), 'Jules', 'wifi died mid-roast. tragic. the bullying resumes when connection improves'),
    line(dayAt(8, 21, 13), 'Kabir', 'the roast will continue when the connection improves 🫡'),
    line(dayAt(8, 21, 15), 'Meera', 'I have notes prepared. bullet points. Kabir will not survive'),
    line(dayAt(8, 21, 17), 'Jules', '<Media omitted>'),
    line(dayAt(8, 21, 17), 'Jules', 'voice note: the unfinished roast, 2 minutes, please clap'),
    line(dayAt(8, 21, 25), 'Kabir', 'listened. I am pressing charges'),
    // ── Day 7: the pav bhaji tribunal ──
    line(dayAt(7, 13, 0), 'Meera', 'someone ate my leftover pav bhaji. the container was labelled MEERA'),
    line(dayAt(7, 13, 2), 'Kabir', "I did not eat it. I don't even like pav bhaji. I had two bites to confirm"),
    line(dayAt(7, 13, 3), 'Meera', 'TWO BITES??'),
    line(dayAt(7, 13, 4), 'Kabir', "quality control. you're welcome"),
    line(dayAt(7, 13, 6), 'Jules', 'suspiciously specific denial hall of fame, right here'),
    // ── Day 6: first stop locked ──
    line(dayAt(6, 12, 0), 'You', 'location: https://maps.app.goo.gl/chaatCentral'),
    line(dayAt(6, 12, 0), 'You', 'first stop locked: the chaat place. 7pm sharp'),
    line(dayAt(6, 12, 3), 'Meera', 'I will be early. Kabir will be "5 minutes away" for 40 minutes'),
    line(dayAt(6, 12, 5), 'Kabir', 'ETA is a construct'),
    // ── Day 4: birthday committee ──
    line(dayAt(4, 19, 0), 'Jules', 'whose birthday is next?? asking for playlist reasons 🎂'),
    line(dayAt(4, 19, 2), 'You', 'mine. 3 weeks. prepare accordingly 👀'),
    line(dayAt(4, 19, 4), 'Kabir', 'noted. my legendary playlist is in development'),
    line(dayAt(4, 19, 5), 'Meera', 'your playlist is 90% one artist, Kabir'),
    line(dayAt(4, 19, 6), 'Kabir', 'an artist of FOCUS'),
    line(dayAt(4, 19, 10), 'You', 'party-planning.ics (file attached)'),
    line(dayAt(4, 19, 10), 'You', 'calendar hold for everyone. attendance is mandatory and catered'),
    line(dayAt(4, 19, 12), 'Jules', 'catered?? I am emotional. committee convenes NOW'),
    line(dayAt(4, 19, 15), 'Meera', 'committee roles: me = cake, Jules = music, Kabir = vibes only'),
    line(dayAt(4, 19, 17), 'Kabir', 'vibes only is the most important role and we all know it'),
    // ── Day 3: the wrong chat leak ──
    line(dayAt(3, 22, 45), 'Jules', 'This message was deleted'),
    line(dayAt(3, 22, 46), 'Jules', 'wrong chat. pretend you saw nothing'),
    line(dayAt(3, 22, 47), 'Meera', '👀 👀 👀'),
    line(dayAt(3, 22, 48), 'Kabir', 'it was a cake idea for YOU wasn\'t it. I saw the word "surprise" twice'),
    line(dayAt(3, 22, 50), 'Jules', 'I said PRETEND'),
    line(dayAt(3, 22, 52), 'You', 'I am pretending so hard right now'),
    // ── Day 2: the final plan ──
    line(dayAt(2, 20, 30), 'Meera', 'SATURDAY CONFIRMED. 7PM. CHAAT FIRST, BIRYANI LAST, DESSERT IN THE MIDDLE'),
    line(dayAt(2, 20, 32), 'Kabir', 'dessert in the middle?? chaos. I love it'),
    line(dayAt(2, 20, 35), 'Jules', 'the 2am biryani place confirmed a table for 4. they know us by name now'),
    line(dayAt(2, 20, 36), 'Meera', 'the shame is part of the flavour'),
    // ── Day 0: the payoff ──
    line(dayAt(0, 10, 30), 'You', "today's the day. 7pm, chaat place, bring appetites and zero dignity"),
    line(dayAt(0, 10, 32), 'Kabir', 'bringing my appetite and zero budgeting skills. as is tradition'),
    line(dayAt(0, 10, 35), 'Jules', 'playlist locked. weather locked. THIS PLAN WILL NOT BE CANCELLED'),
    line(dayAt(0, 10, 40), 'Meera', 'if this gets cancelled I am starting a new squad with the business-suit cat'),
    line(dayAt(0, 10, 45), 'You', 'it will not. see you all at 7 🐍'),
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

/** sourceFile key for current-version demo chats. */
function v2Key(id: string): string {
  return `demo://${id}@v${DEMO_VERSION}`
}

/** sourceFile key used by v1 demo chats (pre-migration). */
function legacyKey(id: string): string {
  return `demo://${id}`
}

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
  const parsed = parseWhatsAppText(BUILDERS[id]())
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
  try {
    const payload = (await req.json().catch(() => null)) as {
      ids?: unknown
      migrateOnly?: unknown
    } | null
    const migrateOnly = payload?.migrateOnly === true

    if (migrateOnly) {
      const migrated: string[] = []
      for (const meta of DEMO_CATALOG) {
        if (!(meta.id in BUILDERS)) continue
        const chatId = await upgradeLegacyChat(meta.id, meta)
        if (chatId) migrated.push(meta.title)
      }
      return NextResponse.json({ ok: true, migrated })
    }

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
      const parsed = parseWhatsAppText(BUILDERS[id]())
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
