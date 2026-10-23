/**
 * Insights share card (v1.9) — a dependency-free canvas PNG of the
 * Insights dashboard headline numbers, in the same visual family as the
 * word-cloud / year-in-review cards: dark panel, accent bars, rounded
 * sections. Rendered at 2× (1080×1440 design px) for crisp WhatsApp/IG
 * sharing; downloaded as a file and offered to the native share sheet
 * (navigator.share with files) when available.
 */

import type { StatsData } from '@/components/whatsapp/types'

const W = 1080
const H = 1440
const SCALE = 2 // canvas px per design px

const BG = '#0b141a'
const PANEL = '#111f27'
const TEXT = '#e9edef'
const MUTED = '#8696a0'
const ACCENT = '#25d366'
const ACCENT_DIM = '#1f8f52'

function fontFor(px: number, weight = 600): string {
  // NOTE: the context is globally scaled by SCALE — fonts stay in design px.
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

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1)
  }
  return `${t}…`
}

function rangeLabel(stats: StatsData): string {
  const fmtDay = (iso: string | null): string => {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return `${fmtDay(stats.range.firstAt)} – ${fmtDay(stats.range.lastAt)}`
}

/** Render the share card and resolve a PNG blob. */
export async function renderInsightsSharePng(
  stats: StatsData
): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('canvas unavailable')
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  // Draw everything in DESIGN pixels — one global scale handles the 2×.
  ctx.scale(SCALE, SCALE)

  // ---- backdrop -----------------------------------------------------------
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // subtle accent glow top-left
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.7)
  glow.addColorStop(0, 'rgba(37, 211, 102, 0.14)')
  glow.addColorStop(1, 'rgba(37, 211, 102, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const M = 64
  let y = 84

  // ---- header -------------------------------------------------------------
  ctx.fillStyle = ACCENT
  ctx.font = fontFor(30, 800)
  ctx.fillText('WA ARCHIVER', M, y)
  ctx.fillStyle = MUTED
  ctx.font = fontFor(26, 500)
  ctx.textAlign = 'right'
  ctx.fillText('Insights', W - M, y)
  ctx.textAlign = 'left'
  y += 52

  ctx.fillStyle = TEXT
  ctx.font = fontFor(46, 700)
  ctx.fillText(fitText(ctx, 'Your chat story, in numbers', W - M * 2), M, y)
  y += 44
  ctx.fillStyle = MUTED
  ctx.font = fontFor(24, 500)
  ctx.fillText(rangeLabel(stats), M, y)
  y += 34

  // ---- KPI grid (2×2) -------------------------------------------------------
  const kpis: { label: string; value: string }[] = [
    { label: 'Messages', value: fmt(stats.totals.messages) },
    { label: 'Chats', value: fmt(stats.totals.chats) },
    { label: 'Media', value: fmt(stats.totals.media) },
    { label: 'Words', value: fmt(stats.totals.words) },
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
    ctx.font = fontFor(44, 800)
    ctx.fillText(k.value, x + 24, ky + 58)
    ctx.fillStyle = MUTED
    ctx.font = fontFor(20, 500)
    ctx.fillText(k.label.toUpperCase(), x + 24, ky + 94)
  })
  y += gh * 2 + 20 + 40

  // ---- Top chatters ----------------------------------------------------------
  ctx.fillStyle = TEXT
  ctx.font = fontFor(28, 700)
  ctx.fillText('Top chatters', M, y)
  y += 26
  const top = [...stats.participants].sort((a, b) => b.count - a.count).slice(0, 5)
  const maxCount = top[0]?.count ?? 1
  const rowH = 52
  const BAR_X = M + 320
  const BAR_MAX = W - M - 110 - BAR_X // room for the count on the right
  top.forEach((p, i) => {
    const ry = y + i * rowH
    const barW = (BAR_MAX * p.count) / maxCount
    ctx.fillStyle = TEXT
    ctx.font = fontFor(25, 600)
    ctx.fillText(fitText(ctx, p.sender, 290), M, ry + 26)
    ctx.fillStyle = i === 0 ? ACCENT : ACCENT_DIM
    roundRect(ctx, BAR_X, ry + 8, Math.max(barW, 8), 20, 10)
    ctx.fill()
    ctx.fillStyle = MUTED
    ctx.font = fontFor(24, 500)
    const label = fmt(p.count)
    ctx.fillText(label, W - M - ctx.measureText(label).width, ry + 26)
  })
  y += top.length * rowH + 34

  // ---- Weekday rhythm ----------------------------------------------------------
  ctx.fillStyle = TEXT
  ctx.font = fontFor(28, 700)
  ctx.fillText('Busiest days', M, y)
  y += 26
  const wd = stats.weekdays ?? []
  const wdMax = Math.max(1, ...wd.map((d) => d.count))
  const slot = (W - M * 2) / Math.max(wd.length, 7)
  const baseY = y + 120
  wd.forEach((d, i) => {
    const h = Math.max(6, (d.count / wdMax) * 96)
    const x = M + i * slot
    ctx.fillStyle = d.count === wdMax ? ACCENT : ACCENT_DIM
    roundRect(ctx, x + 6, baseY - h, slot - 14, h, 8)
    ctx.fill()
    ctx.fillStyle = MUTED
    ctx.font = fontFor(20, 500)
    const label = (d.weekday || '').slice(0, 3)
    ctx.fillText(label, x + slot / 2 - ctx.measureText(label).width / 2, baseY + 34)
  })
  y += 190

  // ---- Emoji leaderboard ----------------------------------------------------------
  const emojis = (stats.topEmojis ?? []).slice(0, 5)
  if (emojis.length > 0) {
    ctx.fillStyle = TEXT
    ctx.font = fontFor(28, 700)
    ctx.fillText('Most used reactions', M, y)
    y += 68
    emojis.forEach((e, i) => {
      const ex = M + i * ((W - M * 2) / 5)
      ctx.font = fontFor(52, 400)
      ctx.fillText(e.emoji, ex, y)
      ctx.fillStyle = MUTED
      ctx.font = fontFor(22, 500)
      ctx.fillText(fmt(e.count), ex + 4, y + 38)
    })
    y += 78
  }

  // ---- Fun footer row ----------------------------------------------------------
  // Keep the footer panel inside the card on data-dense layouts.
  if (y > H - 260) y = H - 260

  const facts: string[] = []
  if (stats.range.busiestDay) {
    const d = new Date(`${stats.range.busiestDay.date}T12:00:00`)
    const when = Number.isNaN(d.getTime())
      ? stats.range.busiestDay.date
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    facts.push(`Busiest day ${when} · ${fmt(stats.range.busiestDay.count)} messages`)
  }
  if (stats.streak.longest > 1) {
    facts.push(`Longest daily streak · ${stats.streak.longest} days`)
  }
  if (stats.fun.links > 0) facts.push(`${fmt(stats.fun.links)} links shared`)
  if (facts.length > 0) {
    ctx.fillStyle = PANEL
    roundRect(ctx, M, y, W - M * 2, 96, 20)
    ctx.fill()
    ctx.fillStyle = MUTED
    ctx.font = fontFor(20, 500)
    ctx.fillText(fitText(ctx, facts.join('  ·  '), W - M * 2 - 48), M + 24, y + 56)
    y += 96
  }

  // ---- footer ------------------------------------------------------------------
  ctx.fillStyle = MUTED
  ctx.font = fontFor(20, 500)
  ctx.fillText('made with WA Archiver — local-first WhatsApp archives', M, H - 48)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
      'image/png'
    )
  })
}

/** File name for the download, e.g. wa-archiver-insights-2026-10-25.png */
export function insightsShareFileName(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `wa-archiver-insights-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.png`
}
