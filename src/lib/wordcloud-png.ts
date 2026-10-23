/**
 * Word-cloud PNG export — dependency-free canvas renderer.
 *
 * Lays the ranked words out in wrapped rows (greedy, flex-wrap-like) on a
 * WhatsApp "chat paper" background, with the chat title as header, a word
 * count subtitle and a footer line. Word color/size/opacity mirror the
 * in-app cloud (CLOUD_COLORS cycle, rank-scaled sizes) so the PNG looks
 * like the dialog it came from.
 *
 * Output: 2160px-wide PNG (2× internal scale for crispness) via
 * canvas.toBlob. Runs fully on-device — no server round trip.
 */

export interface WordCloudPngWord {
  word: string
  count: number
}

/** Same warm palette as WordCloudDialog (kept in sync manually). */
const CLOUD_COLORS = [
  '#e542a3',
  '#f2a33c',
  '#12b886',
  '#0ea5a4',
  '#b06ad4',
  '#ef6c6c',
  '#5f9b3f',
  '#c27a3f',
]

const WIDTH = 2160 // canvas px (2× a 1080pt design)
const PAD = 128
const TITLE_SIZE = 80
const SUBTITLE_SIZE = 38
const FOOTER_SIZE = 36
const WORD_MAX = 60 // top word, canvas px
const WORD_MIN = 24 // least frequent, canvas px
const ROW_GAP = 20
const CLOUD_TOP_GAP = 48

function fontFor(px: number): string {
  return (
    `600 ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, ` +
    `'Noto Sans', 'Noto Sans Devanagari', sans-serif`
  )
}

/**
 * Render `words` (already ranked, best first) to a PNG blob.
 * Throws when the canvas API is unavailable (very old WebView).
 */
export async function renderWordCloudPng(
  words: WordCloudPngWord[],
  chatTitle: string,
  subtitleText: string,
  footerText: string
): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('canvas unavailable')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  const innerWidth = WIDTH - PAD * 2
  const last = Math.max(words.length - 1, 1)

  // --- layout pass: greedy wrap, baseline-aligned like flex items-baseline
  interface PlacedWord {
    text: string
    size: number
    color: string
    opacity: number
    x: number // left edge, cloud-local
    y: number // baseline, cloud-local
  }
  const placed: PlacedWord[] = []

  let rowRight = 0 // right edge of the last word in the current row
  let rowTop = 0 // cloud-local top of the current row
  let rowAscent = 0 // tallest glyph height in the current row

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const rank = i / last // 0 = top word
    const size = Math.round(WORD_MAX - rank * (WORD_MAX - WORD_MIN))
    ctx.font = fontFor(size)
    const text = w.word
    const width = ctx.measureText(text).width
    const space = rowRight > 0 ? ctx.measureText(' ').width : 0

    if (rowRight > 0 && rowRight + space + width > innerWidth) {
      // wrap: next row starts below the tallest word so far
      rowTop += rowAscent + ROW_GAP
      rowRight = 0
      rowAscent = 0
    }
    const x = rowRight + space
    const y = rowTop + size // baseline under this word's own cap height
    placed.push({
      text,
      size,
      color: CLOUD_COLORS[i % CLOUD_COLORS.length],
      opacity: 0.55 + (1 - rank) * 0.45,
      x,
      y,
    })
    rowRight = x + width
    rowAscent = Math.max(rowAscent, size)
  }

  const cloudHeight = rowTop + rowAscent
  const titleBaseline = PAD + TITLE_SIZE
  const subtitleBaseline = titleBaseline + Math.round(TITLE_SIZE * 0.62)
  const headerH = subtitleBaseline + CLOUD_TOP_GAP
  const height = headerH + cloudHeight + ROW_GAP * 4 + FOOTER_SIZE + PAD

  canvas.width = WIDTH
  canvas.height = height

  // --- paint ---------------------------------------------------------------
  // Chat-paper background with the app's accent bar on top.
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#efeae2'
  ctx.fillRect(0, 0, WIDTH, height)
  ctx.fillStyle = '#008069'
  ctx.fillRect(0, 0, WIDTH, 12)

  // Title (ellipsized when it can't fit on one line)
  ctx.font = fontFor(TITLE_SIZE)
  ctx.fillStyle = '#111b21'
  let title = chatTitle.trim() || 'Chat'
  if (ctx.measureText(title).width > innerWidth) {
    const ell = '…'
    while (
      title.length > 4 &&
      ctx.measureText(title + ell).width > innerWidth
    ) {
      title = title.slice(0, -1)
    }
    title += ell
  }
  ctx.fillText(title, PAD, titleBaseline)

  // Subtitle — "N words · sized by how often they appear"
  ctx.font = fontFor(SUBTITLE_SIZE)
  ctx.fillStyle = 'rgba(17, 27, 33, 0.55)'
  ctx.fillText(subtitleText, PAD, subtitleBaseline)

  // Words
  for (const p of placed) {
    ctx.globalAlpha = p.opacity
    ctx.fillStyle = p.color
    ctx.font = fontFor(p.size)
    ctx.fillText(p.text, PAD + p.x, headerH + p.y)
  }
  ctx.globalAlpha = 1

  // Footer
  ctx.font = fontFor(FOOTER_SIZE)
  ctx.fillStyle = 'rgba(17, 27, 33, 0.45)'
  ctx.fillText(footerText, PAD, height - PAD + FOOTER_SIZE * 0.3)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  )
  if (!blob) throw new Error('toBlob failed')
  return blob
}

/** Trigger a client-side download of `blob` as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
