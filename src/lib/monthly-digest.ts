/**
 * Monthly digest (task 2-e) — per-month recap for the Insights dashboard.
 *
 * Pure, dependency-light core:
 *   • computeMonthlyDigests — full digest from the raw message rows the
 *     dashboard's device-mode load already gathered (no extra queries).
 *   • computeLiteDigests — degraded digest for server mode, derived from the
 *     /api/stats payload the dashboard already holds (per-month totals +
 *     daily timeline buckets). Fields that need raw rows stay null and the
 *     UI hides them.
 *   • renderDigestPng — 1080×1440 canvas card in the same visual family as
 *     the v1.9 insights share card (src/lib/insights-share.ts), with the
 *     labels passed in pre-translated by the caller.
 */

import { EMOJI_RE } from '@/lib/chat-analytics'

/* ------------------------------- Types ---------------------------------- */

/** Minimal message row — the same projection the dashboard already builds. */
export interface DigestMessageRow {
  chatId: string
  ts: string | Date
  sender: string | null
  type: string
  body: string | null
}

/** One playful digest closing line. */
export interface DigestFunFact {
  kind: 'spike' | 'chat'
  /** spike: busiest day + how it compares to the month's daily average. */
  day?: string
  count?: number
  multiple?: number
  /** chat: the month's most active chat. */
  chatTitle?: string
  chatCount?: number
}

/** One month's recap. `null`/empty fields mean "not derivable" — UI hides. */
export interface MonthlyDigest {
  /** 'YYYY-MM' */
  month: string
  total: number
  activeDays: number | null
  busiestDay: { date: string; count: number } | null
  /** Top 3 chatters (excludes you + system, like the People section). */
  topChatters: { name: string; count: number }[]
  /** % of the month's messages sent by you. */
  youPct: number | null
  topEmoji: { emoji: string; count: number } | null
  funFact: DigestFunFact | null
}

/** Pre-translated strings for the digest PNG card. */
export interface DigestPngText {
  brand: string
  heading: string
  monthName: string
  kMessages: string
  kActiveDays: string
  kBusiestDay: string
  kSentByYou: string
  busiestDayValue: string
  sentByYouValue: string
  topChatters: string
  topEmojiValue: string | null
  funFact: string | null
  footer: string
}

/* ----------------------------- Computation ------------------------------ */

const MONTH_OF_TYPES = new Set(['text', 'image', 'video'])

interface MonthAcc {
  total: number
  you: number
  days: Map<string, number>
  senders: Map<string, number>
  chats: Map<string, number>
  emojis: Map<string, number>
}

/** Spike fun fact shared by both compute paths. */
function spikeFact(
  busiestDay: { date: string; count: number } | null,
  total: number,
  activeDays: number | null
): DigestFunFact | null {
  if (!busiestDay || !activeDays) return null
  const avg = total / activeDays
  if (avg <= 0) return null
  if (busiestDay.count < Math.max(10, 2 * avg)) return null
  return {
    kind: 'spike',
    day: busiestDay.date,
    count: busiestDay.count,
    multiple: Math.max(2, Math.round(busiestDay.count / avg)),
  }
}

/**
 * Full per-month digests from raw message rows. Months with at least one
 * message are returned newest-first. Conventions mirror computeStats:
 * participants exclude 'You' + system rows; emojis counted on text/image/
 * video bodies; totals count every message type.
 */
export function computeMonthlyDigests(
  messages: readonly DigestMessageRow[],
  chatTitleOf: (chatId: string) => string = () => 'Deleted chat'
): MonthlyDigest[] {
  const accs = new Map<string, MonthAcc>()

  for (const m of messages) {
    const d = new Date(m.ts)
    if (Number.isNaN(d.getTime())) continue
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    let acc = accs.get(ym)
    if (!acc) {
      acc = {
        total: 0,
        you: 0,
        days: new Map(),
        senders: new Map(),
        chats: new Map(),
        emojis: new Map(),
      }
      accs.set(ym, acc)
    }
    acc.total++
    const dayKey = `${ym}-${String(d.getDate()).padStart(2, '0')}`
    acc.days.set(dayKey, (acc.days.get(dayKey) ?? 0) + 1)
    if (m.sender === 'You') acc.you++
    if (m.sender && m.sender !== 'You' && m.type !== 'system') {
      acc.senders.set(m.sender, (acc.senders.get(m.sender) ?? 0) + 1)
    }
    acc.chats.set(m.chatId, (acc.chats.get(m.chatId) ?? 0) + 1)
    if (MONTH_OF_TYPES.has(m.type)) {
      const found = (m.body ?? '').match(EMOJI_RE)
      if (found) {
        for (const e of found) {
          acc.emojis.set(e, (acc.emojis.get(e) ?? 0) + 1)
        }
      }
    }
  }

  const digests: MonthlyDigest[] = []
  for (const [month, acc] of accs) {
    let busiestDay: { date: string; count: number } | null = null
    for (const [date, count] of acc.days) {
      if (!busiestDay || count > busiestDay.count) busiestDay = { date, count }
    }
    const topChatters = [...acc.senders.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }))
    let topEmoji: { emoji: string; count: number } | null = null
    for (const [emoji, count] of acc.emojis) {
      if (!topEmoji || count > topEmoji.count) topEmoji = { emoji, count }
    }
    let topChat: { title: string; count: number } | null = null
    for (const [chatId, count] of acc.chats) {
      if (!topChat || count > topChat.count) {
        topChat = { title: chatTitleOf(chatId), count }
      }
    }

    const activeDays = acc.days.size
    const funFact =
      spikeFact(busiestDay, acc.total, activeDays) ??
      (topChat && topChat.count >= 3
        ? {
            kind: 'chat' as const,
            chatTitle: topChat.title,
            chatCount: topChat.count,
          }
        : null)

    digests.push({
      month,
      total: acc.total,
      activeDays,
      busiestDay,
      topChatters,
      youPct: acc.total > 0 ? Math.round((acc.you / acc.total) * 100) : null,
      topEmoji,
      funFact,
    })
  }

  digests.sort((a, b) => b.month.localeCompare(a.month))
  return digests
}

/**
 * Server-mode digest: only what the /api/stats payload can answer without
 * the raw rows — per-month totals (data.months) plus, when the activity
 * timeline arrived as daily buckets, that month's active days / busiest day
 * (and the spike fun fact derived from them). Everything else stays null.
 */
export function computeLiteDigests(
  months: readonly { month: string; count: number }[],
  dayPoints: readonly { date: string; count: number }[]
): MonthlyDigest[] {
  return [...months]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map(({ month, count }) => {
      const days = dayPoints.filter(
        (p) => p.date.slice(0, 7) === month && p.count > 0
      )
      let busiestDay: { date: string; count: number } | null = null
      for (const p of days) {
        if (!busiestDay || p.count > busiestDay.count) {
          busiestDay = { date: p.date, count: p.count }
        }
      }
      const activeDays = days.length
      return {
        month,
        total: count,
        activeDays: activeDays > 0 ? activeDays : null,
        busiestDay,
        topChatters: [],
        youPct: null,
        topEmoji: null,
        funFact: spikeFact(busiestDay, count, activeDays),
      }
    })
}

/* ------------------------------- Helpers -------------------------------- */

/** "January 2026" — long label for the picker + card + PNG. */
export function digestMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

/** File name for the digest download, e.g. wa-archiver-digest-2026-01.png */
export function digestShareFileName(ym: string): string {
  return `wa-archiver-digest-${ym}.png`
}

/* ------------------------------ PNG card -------------------------------- */

const W = 1080
const H = 1440
const SCALE = 2 // canvas px per design px — same 2× as the insights card

const BG = '#0b141a'
const PANEL = '#111f27'
const TEXT = '#e9edef'
const MUTED = '#8696a0'
const ACCENT = '#25d366'
const ACCENT_DIM = '#1f8f52'

function fontFor(px: number, weight = 600): string {
  // The context is globally scaled by SCALE — fonts stay in design px.
  return `${weight} ${px}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return n.toLocaleString('en-US')
}

/** Render the monthly digest card as a PNG blob. */
export async function renderDigestPng(
  digest: MonthlyDigest,
  text: DigestPngText
): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('canvas unavailable')
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  // Draw everything in DESIGN pixels — one global scale handles the 2×.
  ctx.scale(SCALE, SCALE)

  // ---- backdrop ----------------------------------------------------------
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.7)
  glow.addColorStop(0, 'rgba(37, 211, 102, 0.14)')
  glow.addColorStop(1, 'rgba(37, 211, 102, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const M = 64
  let y = 84

  // ---- header ------------------------------------------------------------
  ctx.fillStyle = ACCENT
  ctx.font = fontFor(30, 800)
  ctx.fillText(text.brand.toUpperCase(), M, y)
  ctx.fillStyle = MUTED
  ctx.font = fontFor(26, 500)
  ctx.textAlign = 'right'
  ctx.fillText(text.heading, W - M, y)
  ctx.textAlign = 'left'
  y += 66

  // ---- month -------------------------------------------------------------
  ctx.fillStyle = TEXT
  ctx.font = fontFor(52, 800)
  ctx.fillText(text.monthName, M, y)
  y += 56

  // ---- KPI grid (2×2) ------------------------------------------------------
  const kpis: { label: string; value: string }[] = [
    { label: text.kMessages, value: fmt(digest.total) },
    { label: text.kActiveDays, value: digest.activeDays != null ? fmt(digest.activeDays) : '—' },
    { label: text.kBusiestDay, value: digest.busiestDay ? text.busiestDayValue : '—' },
    { label: text.kSentByYou, value: digest.youPct != null ? text.sentByYouValue : '—' },
  ]
  const gw = (W - M * 2 - 24) / 2
  const gh = 118
  kpis.forEach((k, i) => {
    const x = M + (i % 2) * (gw + 24)
    const ky = y + Math.floor(i / 2) * (gh + 20)
    ctx.fillStyle = PANEL
    roundRect(ctx, x, ky, gw, gh, 20)
    ctx.fill()
    ctx.fillStyle = ACCENT
    ctx.font = fontFor(42, 800)
    ctx.fillText(k.value, x + 24, ky + 58)
    ctx.fillStyle = MUTED
    ctx.font = fontFor(20, 500)
    ctx.fillText(k.label.toUpperCase(), x + 24, ky + 94)
  })
  y += gh * 2 + 20 + 46

  // ---- Top chatters --------------------------------------------------------
  ctx.fillStyle = TEXT
  ctx.font = fontFor(28, 700)
  ctx.fillText(text.topChatters, M, y)
  y += 30
  const top = digest.topChatters.slice(0, 3)
  if (top.length === 0) {
    ctx.fillStyle = MUTED
    ctx.font = fontFor(24, 500)
    ctx.fillText('—', M, y + 8)
    y += 44
  } else {
    const maxCount = top[0].count
    const rowH = 56
    const BAR_X = M + 320
    const BAR_MAX = W - M - 110 - BAR_X
    top.forEach((p, i) => {
      const ry = y + i * rowH
      const barW = (BAR_MAX * p.count) / maxCount
      ctx.fillStyle = TEXT
      ctx.font = fontFor(25, 600)
      ctx.fillText(p.name.slice(0, 18), M, ry + 26)
      ctx.fillStyle = i === 0 ? ACCENT : ACCENT_DIM
      roundRect(ctx, BAR_X, ry + 8, Math.max(barW, 8), 20, 10)
      ctx.fill()
      ctx.fillStyle = MUTED
      ctx.font = fontFor(24, 500)
      const label = fmt(p.count)
      ctx.fillText(label, W - M - ctx.measureText(label).width, ry + 26)
    })
    y += top.length * rowH + 30
  }

  // ---- Top emoji -----------------------------------------------------------
  if (digest.topEmoji && text.topEmojiValue) {
    ctx.fillStyle = TEXT
    ctx.font = fontFor(64, 400)
    ctx.fillText(digest.topEmoji.emoji, M, y + 20)
    ctx.fillStyle = MUTED
    ctx.font = fontFor(30, 600)
    ctx.fillText(text.topEmojiValue, M + 110, y + 12)
    y += 84
  }

  // ---- Fun fact --------------------------------------------------------------
  if (text.funFact) {
    // Keep the fact panel inside the card on data-dense layouts.
    if (y > H - 250) y = H - 250
    ctx.fillStyle = PANEL
    roundRect(ctx, M, y, W - M * 2, 96, 20)
    ctx.fill()
    ctx.fillStyle = ACCENT
    ctx.font = fontFor(30, 700)
    ctx.fillText('✦', M + 24, y + 58)
    ctx.fillStyle = TEXT
    ctx.font = fontFor(22, 500)
    wrapText(ctx, text.funFact, M + 64, y + 40, W - M * 2 - 100, 30)
    y += 120
  }

  // ---- footer ----------------------------------------------------------------
  ctx.fillStyle = MUTED
  ctx.font = fontFor(20, 500)
  ctx.fillText(text.footer, M, H - 48)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
      'image/png'
    )
  })
}

/** Two-line word wrap for the fun-fact panel (design px, pre-scaled ctx). */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(' ')
  let line = ''
  let cy = y
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cy)
      cy += lineHeight
      line = word
      if (cy > y + lineHeight) break // hard cap at two lines
    } else {
      line = next
    }
  }
  if (cy <= y + lineHeight) ctx.fillText(line, x, cy)
}
