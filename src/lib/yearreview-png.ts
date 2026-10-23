/**
 * Year-in-review share card PNG — dependency-free canvas renderer.
 *
 * Turns the wrapped-style rewind stats (the same numbers shown in
 * YearInReviewDialog) into a 4:5 portrait share card (1080×1350 design,
 * rendered at 2× for crispness) that can be posted to status/stories or
 * sent straight into a chat.
 *
 * Visual language mirrors the dialog's hero: deep WhatsApp-teal gradient,
 * white type, translucent stat chips in a 2-column grid and a footer.
 * Runs fully on-device — no server round trip, no telemetry.
 */

import { downloadBlob } from './wordcloud-png'

export interface YearReviewStat {
  label: string
  value: string
  sub?: string
}

export interface YearReviewCard {
  yearLabel: string
  chatTitle: string
  messageCount: number
  activeDays: number
  stats: YearReviewStat[]
  footerText: string
}

/* 2× internal scale — canvas px are double the design px. */
const WIDTH = 2160
const HEIGHT = 2700 // 4:5 portrait (1080×1350 design)
const PAD = 128
const CHIP_GAP = 32

function fontFor(px: number, weight = 600): string {
  return (
    `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, ` +
    `'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Tamil', 'Noto Nastaliq Urdu', sans-serif`
  )
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** Ellipsize `text` so it fits `maxWidth` at the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 4 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '…'
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Render the share card to a PNG blob.
 * Throws when the canvas API is unavailable (very old WebView).
 */
export async function renderYearReviewPng(card: YearReviewCard): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('canvas unavailable')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  canvas.width = WIDTH
  canvas.height = HEIGHT

  const innerWidth = WIDTH - PAD * 2

  // --- background: deep teal gradient (accent hero of the dialog) ---------
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  bg.addColorStop(0, '#00a884')
  bg.addColorStop(0.55, '#008069')
  bg.addColorStop(1, '#075e54')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Subtle celebratory confetti dots (deterministic pseudo-random)
  let seed = 42
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let i = 0; i < 26; i++) {
    const x = rand() * WIDTH
    const y = rand() * HEIGHT * 0.55
    const r = 6 + rand() * 14
    ctx.globalAlpha = 0.05 + rand() * 0.06
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  ctx.textBaseline = 'alphabetic'
  let y = PAD + 84

  // --- kicker: "2025 IN REVIEW" -------------------------------------------
  ctx.font = fontFor(44, 700)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  const kicker = `${card.yearLabel.toUpperCase()} IN REVIEW  ·  🎉`
  ctx.fillText(kicker, PAD, y)
  y += 130

  // --- chat title ----------------------------------------------------------
  ctx.font = fontFor(72, 700)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillText(fitText(ctx, card.chatTitle.trim() || 'Chat', innerWidth), PAD, y)
  y += 220

  // --- hero number ---------------------------------------------------------
  ctx.font = fontFor(300, 800)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(fmt(card.messageCount), PAD, y)
  y += 96

  // --- subtitle ------------------------------------------------------------
  ctx.font = fontFor(56, 500)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  const days = fmt(card.activeDays)
  const subtitle =
    card.messageCount === 1
      ? `message across ${days} active ${card.activeDays === 1 ? 'day' : 'days'}`
      : `messages across ${days} active ${card.activeDays === 1 ? 'day' : 'days'}`
  ctx.fillText(fitText(ctx, subtitle, innerWidth), PAD, y)
  y += 140

  // --- stat chips (2-column grid) ------------------------------------------
  const stats = card.stats.slice(0, 6)
  if (stats.length > 0) {
    const chipW = (innerWidth - CHIP_GAP) / 2
    const chipH = 248
    ctx.font = fontFor(38, 600) // label
    const valueH = 74
    const subGap = 42
    // uniform chip height (a couple of chips have subs)
    for (let i = 0; i < stats.length; i += 2) {
      const row = Math.floor(i / 2)
      const cy = y + row * (chipH + CHIP_GAP)
      for (let col = 0; col < 2; col++) {
        const s = stats[i + col]
        if (!s) break
        const cx = PAD + col * (chipW + CHIP_GAP)
        ctx.fillStyle = 'rgba(255,255,255,0.13)'
        roundRect(ctx, cx, cy, chipW, chipH, 36)
        ctx.fill()

        const tx = cx + 40
        let ty = cy + 44 + 38 // label baseline
        ctx.font = fontFor(38, 600)
        ctx.fillStyle = 'rgba(255,255,255,0.65)'
        ctx.fillText(fitText(ctx, s.label.toUpperCase(), chipW - 80), tx, ty)

        ty += valueH
        ctx.font = fontFor(62, 700)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(fitText(ctx, s.value, chipW - 80), tx, ty)

        if (s.sub) {
          ty += subGap
          ctx.font = fontFor(36, 500)
          ctx.fillStyle = 'rgba(255,255,255,0.75)'
          ctx.fillText(fitText(ctx, s.sub, chipW - 80), tx, ty)
        }
      }
    }
    y += Math.ceil(stats.length / 2) * (chipH + CHIP_GAP)
  }

  // --- footer ---------------------------------------------------------------
  ctx.font = fontFor(44, 500)
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(card.footerText, PAD, HEIGHT - PAD + 40)

  // thin accent bar along the top edge
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(0, 0, WIDTH, 12)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  )
  if (!blob) throw new Error('toBlob failed')
  return blob
}

export { downloadBlob }

/** Suggested download name: year-in-review-2025-<chat>.png */
export function yearReviewFileName(yearLabel: string, chatTitle: string): string {
  const slug =
    chatTitle
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff\u0600-\u06ff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'chat'
  const year = yearLabel.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'all'
  return `year-in-review-${year}-${slug}.png`
}
