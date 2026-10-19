/**
 * Standalone HTML export — one self-contained file that renders the chat like
 * a WhatsApp transcript: bubbles, day dividers, system lines, reactions,
 * polls, and media embedded as base64 data URIs (within size caps). No
 * JavaScript, opens offline in any browser.
 *
 * Audio (voice notes) is opt-in via `options.embedAudio`: audio messages get
 * a dedicated budget (8 MB per file / 40 MB total) and render as
 * `<audio controls preload="none">` with a base64 data URI; when disabled or
 * past the budget they fall back to the "audio not included" chip. The first
 * time the total budget runs out an HTML comment notes the cap.
 */
import { promises as fsp } from 'fs'
import { mimeFromName, resolveMediaPath } from '@/lib/media-store'

export interface ChatHtmlOptions {
  /** Embed voice notes as data URIs (opt-in: ?audio=1 / wa_export_audio=1). */
  embedAudio?: boolean
}

export interface HtmlExportMessage {
  ts: Date
  sender: string | null
  body: string
  type: string
  mediaName: string | null
  mediaPath: string | null
  reactions: string | null
  pinned: boolean
  starred: boolean
  edited: boolean
  forwardedFrom: string | null
  pollOptions: string | null
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  // WhatsApp voice notes are ogg-wrapped opus — audio/ogg plays widest
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  amr: 'audio/amr',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  txt: 'text/plain',
}

const SENDER_COLORS = [
  '#e542a3',
  '#02a698',
  '#ffab00',
  '#a06dff',
  '#ff7043',
  '#26a69a',
  '#f06292',
  '#8bc34a',
  '#bf360c',
  '#c17a3f',
]

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return SENDER_COLORS[h % SENDER_COLORS.length]
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Linkify http(s) URLs — input must already be HTML-escaped. */
function linkify(safe: string): string {
  return safe.replace(
    /https?:\/\/[^\s<]+/g,
    (url) =>
      `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`
  )
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function dmy(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const PER_FILE_CAP = 2.5 * 1024 * 1024
const TOTAL_CAP = 24 * 1024 * 1024
// Voice notes get their own (larger) budget so a chat full of audio still
// exports playable audio without starving the image/video budget.
const AUDIO_PER_FILE_CAP = 8 * 1024 * 1024
const AUDIO_TOTAL_CAP = 40 * 1024 * 1024

/** Audio mime for a media filename — mimeFromName plus audio-only gaps. */
function audioMimeFromName(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (ext === 'oga') return 'audio/ogg'
  if (ext === '3ga') return 'audio/3gpp'
  if (ext === 'webm') return 'audio/webm' // audio message — not video/webm
  const mime = mimeFromName(name)
  return mime === 'application/octet-stream' ? 'audio/ogg' : mime
}

/** Read a media file and return a data URI, respecting the size budgets. */
async function embedMedia(
  chatId: string,
  mediaPath: string
): Promise<string | null> {
  try {
    const abs = await resolveMediaPath(chatId, mediaPath)
    if (!abs) return null
    const buf = await fsp.readFile(abs)
    if (buf.length > PER_FILE_CAP) return null
    const ext = (mediaPath.split('.').pop() ?? '').toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Read an audio file for embedding. Returns null when the file is missing
 * or over the per-file cap (8 MB) — the caller falls back to the placeholder.
 */
async function embedAudioMedia(
  chatId: string,
  mediaPath: string
): Promise<{ uri: string; bytes: number } | null> {
  try {
    const abs = await resolveMediaPath(chatId, mediaPath)
    if (!abs) return null
    const stat = await fsp.stat(abs)
    if (stat.size > AUDIO_PER_FILE_CAP) return null
    const buf = await fsp.readFile(abs)
    const mime = audioMimeFromName(mediaPath)
    return {
      uri: `data:${mime};base64,${buf.toString('base64')}`,
      bytes: buf.length,
    }
  } catch {
    return null
  }
}

function parseReactions(raw: string | null): Array<[string, string[]]> {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.entries(obj).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) &&
        entry[1].every((s) => typeof s === 'string')
    )
  } catch {
    return []
  }
}

function parsePoll(
  msg: HtmlExportMessage
): { q: string; options: Array<{ label: string; votes: number }> } | null {
  if (!msg.pollOptions) return null
  try {
    const opts = JSON.parse(msg.pollOptions) as unknown
    if (!Array.isArray(opts)) return null
    const options = opts
      .filter((o): o is string => typeof o === 'string')
      .map((o) => {
        const m = o.match(/^(.*?):\s*(\d+)\s*votes?$/i)
        return m
          ? { label: m[1], votes: parseInt(m[2], 10) }
          : { label: o, votes: 0 }
      })
    return { q: msg.body, options }
  } catch {
    return null
  }
}

function extOf(p: string | null): string {
  if (!p) return ''
  return (p.split('.').pop() ?? '').toLowerCase()
}

/** Render one message's content (everything between sender name and meta). */
function contentHtml(msg: HtmlExportMessage, uri: string | null): string {
  const name = esc(msg.mediaName ?? 'Media')
  switch (msg.type) {
    case 'image':
    case 'sticker':
      return uri
        ? `<img class="pic" src="${uri}" alt="${name}" loading="lazy">`
        : chipHtml('🖼️', name, 'image not included')
    case 'gif':
    case 'video':
      return uri
        ? `<video class="pic" controls preload="metadata" src="${uri}"></video>`
        : chipHtml('🎬', name, 'video not included')
    case 'audio':
      return uri
        ? `<div class="voice">🎙️ <b>${name === 'Media' ? 'Voice note' : name}</b></div><audio controls preload="none" src="${uri}"></audio>`
        : chipHtml('🎙️', name || 'Voice note', 'audio not included')
    case 'document':
      return uri
        ? `<a class="chip doc" href="${uri}" download="${name}">📄 <span>${name}</span><small>tap to save</small></a>`
        : chipHtml('📄', name, 'file not included')
    case 'location': {
      const url = msg.body.match(/https?:\/\/\S+/)?.[0] ?? '#'
      const caption = esc(msg.body.replace(/https?:\/\/\S+/, '').trim())
      return `<a class="chip doc" href="${esc(url)}" target="_blank" rel="noreferrer">📍 <span>${caption || 'Shared location'}</span><small>open in maps</small></a>`
    }
    default: {
      if (msg.type === 'deleted') {
        return `<div class="txt del">This message was deleted</div>`
      }
      if (msg.type === 'call') {
        return `<div class="txt del">📞 ${esc(msg.body)}</div>`
      }
      return `<div class="txt">${linkify(esc(msg.body)).replaceAll('\n', '<br>')}</div>`
    }
  }
}

function chipHtml(icon: string, name: string, note: string): string {
  return `<div class="chip">${icon} <span>${name}</span><small>${note}</small></div>`
}

function reactionsHtml(msg: HtmlExportMessage): string {
  const reactions = parseReactions(msg.reactions)
  if (reactions.length === 0) return ''
  const pills = reactions
    .sort((a, b) => {
      const am = a[1].includes('You') ? 0 : 1
      const bm = b[1].includes('You') ? 0 : 1
      return am - bm || b[1].length - a[1].length
    })
    .map(([emoji, senders]) => {
      const mine = senders.includes('You')
      return `<span class="pill${mine ? ' mine' : ''}">${esc(emoji)}<i>${senders.length}</i></span>`
    })
    .join('')
  return `<div class="pills">${pills}</div>`
}

function pollHtml(msg: HtmlExportMessage): string {
  const poll = parsePoll(msg)
  if (!poll) return ''
  const max = Math.max(1, ...poll.options.map((o) => o.votes))
  const rows = poll.options
    .map(
      (o) =>
        `<div class="opt"><div class="optrow"><span>${esc(o.label)}</span><b>${o.votes}</b></div><div class="bar"><i style="width:${Math.max(2, Math.round((o.votes / max) * 100))}%"></i></div></div>`
    )
    .join('')
  return `<div class="poll"><p class="q">📊 ${esc(poll.q)}</p>${rows}</div>`
}

/**
 * Build the full standalone document.
 * `isGroup` controls whether per-message sender names are shown.
 */
export async function buildChatHtml(
  chatId: string,
  title: string,
  isGroup: boolean,
  messages: HtmlExportMessage[],
  options: ChatHtmlOptions = {}
): Promise<string> {
  let budget = TOTAL_CAP
  const embedAudio = options.embedAudio === true
  let audioBudget = embedAudio ? AUDIO_TOTAL_CAP : 0
  let audioCapNoted = false
  const rows: string[] = []
  let prev: Date | null = null

  for (const msg of messages) {
    if (!prev || !sameDay(prev, msg.ts)) {
      rows.push(
        `<div class="day"><span>${esc(dayLabel(msg.ts))}</span></div>`
      )
    }
    prev = msg.ts

    // System / group events — centered pills
    if (msg.type === 'system') {
      rows.push(`<div class="row center"><span class="sys">${esc(msg.body)}</span></div>`)
      continue
    }
    if (msg.type === 'call') {
      rows.push(
        `<div class="row center"><span class="sys">📞 ${esc(msg.body)}</span></div>`
      )
      continue
    }

    const outgoing = msg.sender === 'You'
    const side = outgoing ? 'out' : 'in'
    let uri: string | null = null
    if (msg.mediaPath && !msg.mediaPath.endsWith('.poster.jpg')) {
      if (msg.type === 'audio') {
        // Voice notes are opt-in and use the dedicated audio budget.
        if (embedAudio && audioBudget > 0) {
          const embedded = await embedAudioMedia(chatId, msg.mediaPath)
          if (embedded) {
            if (embedded.bytes <= audioBudget) {
              uri = embedded.uri
              audioBudget -= embedded.bytes
            } else if (!audioCapNoted) {
              audioCapNoted = true
              rows.push(
                `<!-- wa-audio-cap: the ${Math.round(AUDIO_TOTAL_CAP / (1024 * 1024))} MB audio embedding budget was reached — remaining voice notes are listed as placeholders -->`
              )
            }
          }
        }
      } else if (budget > 0) {
        uri = await embedMedia(chatId, msg.mediaPath)
        if (uri) budget -= Math.round(uri.length * 0.75)
      }
    }

    const sender =
      isGroup && msg.sender && !outgoing
        ? `<div class="sender" style="color:${colorFor(msg.sender)}">${esc(msg.sender)}</div>`
        : ''
    const fw = msg.forwardedFrom
      ? `<div class="fw">↪ Forwarded from ${esc(msg.forwardedFrom)}</div>`
      : ''

    const body =
      msg.type === 'poll' ? pollHtml(msg) : contentHtml(msg, uri)

    const pills = reactionsHtml(msg)
    const flags = [
      msg.edited ? '<i class="flag">edited</i>' : '',
      msg.starred ? '<span class="flag star">★</span>' : '',
      msg.pinned ? '<span class="flag">📌</span>' : '',
      outgoing ? '<span class="ticks">✓✓</span>' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const meta = `<span class="meta">${fmtTime(msg.ts)}${flags ? ` ${flags}` : ''}</span>`
    const floor = pills
      ? `<div class="floor">${pills}${meta}</div>`
      : `<div class="metaline">${meta}</div>`

    rows.push(
      `<div class="row ${side}"><div class="bubble">${sender}${fw}${body}${floor}</div></div>`
    )
  }

  const first = messages[0]?.ts
  const last = messages[messages.length - 1]?.ts
  const range =
    first && last && !sameDay(first, last)
      ? `${dmy(first)} – ${dmy(last)}`
      : first
        ? dmy(first)
        : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Chat — ${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #efeae2; color: #111b21;
    font: 14.5px/1.45 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  header.top { background: #008069; color: #fff; padding: 14px 20px;
    display: flex; align-items: center; gap: 12px; }
  header.top .ava { width: 40px; height: 40px; border-radius: 999px;
    background: rgba(255,255,255,.25); display: flex; align-items: center;
    justify-content: center; font-size: 19px; flex: none; }
  header.top h1 { margin: 0; font-size: 16.5px; }
  header.top p { margin: 2px 0 0; font-size: 12.5px; opacity: .85; }
  main.chat { max-width: 860px; margin: 0 auto; padding: 18px 14px 30px; }
  .row { display: flex; padding: 1.5px 8px; }
  .row.in { justify-content: flex-start; }
  .row.out { justify-content: flex-end; }
  .row.center { justify-content: center; padding: 5px 8px; }
  .sys { background: #ffeecd; color: #54656f; font-size: 12.5px;
    padding: 6px 12px; border-radius: 8px; max-width: 82%; text-align: center; }
  .day { text-align: center; margin: 14px 0 8px; }
  .day span { background: #fff; color: #54656f; font-size: 12px; font-weight: 500;
    padding: 5px 12px; border-radius: 8px; box-shadow: 0 1px 1px rgb(11 20 26 / .08); }
  .bubble { max-width: 78%; background: #fff; border-radius: 8px; padding: 6px 9px 5px;
    box-shadow: 0 1px .5px rgb(11 20 26 / .13); }
  .bubble.out, .row.out .bubble { background: #d9fdd3; }
  .sender { font-size: 12.8px; font-weight: 600; margin-bottom: 1px; }
  .fw { font-size: 12.3px; font-style: italic; color: #008069; margin-bottom: 2px; }
  .txt { white-space: pre-wrap; word-break: break-word; }
  .txt a { color: #027eb5; word-break: break-all; }
  .txt.del { font-style: italic; color: #8696a0; }
  .pic { display: block; max-width: 100%; max-height: 420px; border-radius: 6px;
    margin: 2px 0; }
  .chip { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,.05);
    border-radius: 7px; padding: 9px 11px; margin: 3px 0; color: inherit;
    text-decoration: none; font-size: 13.5px; }
  .chip small { color: #8696a0; margin-left: auto; padding-left: 10px;
    font-size: 11px; white-space: nowrap; }
  .voice { font-size: 13.5px; margin: 3px 0 2px; }
  audio { display: block; width: min(320px, 100%); margin-bottom: 3px; }
  .poll { background: rgba(0,0,0,.045); border-radius: 7px; padding: 9px 11px; margin: 3px 0; }
  .poll .q { margin: 0 0 7px; font-weight: 600; font-size: 13.8px; }
  .opt { margin-bottom: 7px; }
  .optrow { display: flex; justify-content: space-between; gap: 10px; font-size: 13.2px; }
  .optrow b { color: #54656f; }
  .bar { height: 5px; background: rgba(0,0,0,.08); border-radius: 99px; margin-top: 3px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #008069; border-radius: 99px; }
  .floor { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .pills { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
  .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 13px;
    background: rgba(0,0,0,.06); border-radius: 99px; padding: 2.5px 8px; }
  .pill.mine { background: rgba(0,128,105,.14); box-shadow: inset 0 0 0 1px rgba(0,128,105,.45); }
  .pill i { font-style: normal; font-size: 11px; font-weight: 700; color: #54656f; }
  .pill.mine i { color: #008069; }
  .metaline { display: flex; justify-content: flex-end; margin-top: 2px; }
  .meta { margin-left: auto; font-size: 11px; color: #667781; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 4px; }
  .flag { font-size: 10.5px; font-style: italic; }
  .flag.star { color: #f2a33c; font-style: normal; }
  .ticks { letter-spacing: -1px; }
  footer { text-align: center; color: #8696a0; font-size: 12px; padding: 6px 0 26px; }
  @media print { .day span { box-shadow: none; } }
</style>
</head>
<body>
<header class="top">
  <div class="ava">${esc(title.slice(0, 1).toUpperCase())}</div>
  <div>
    <h1>${esc(title)}</h1>
    <p>${messages.length} messages${range ? ` · ${range}` : ''}${isGroup ? ' · group chat' : ''}</p>
  </div>
</header>
<main class="chat">
${rows.join('\n')}
</main>
<footer>Exported from WA Archiver · ${esc(`${dmy(new Date())}, ${fmtTime(new Date())}`)}</footer>
</body>
</html>
`
}
