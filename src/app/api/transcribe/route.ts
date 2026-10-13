import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { assertAppUnlocked, getSetting, setSetting } from '@/lib/server-lock'
import { resolveMediaPath } from '@/lib/media-store'
import { isRateLimited, clientIpOf } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // 25 MB (original file)
const MAX_CONVERTED_BYTES = 50 * 1024 * 1024 // safety net for decoded WAVs
const MAX_TRANSCRIPT_CHARS = 64_000

/**
 * The ASR provider only accepts WAV and WebM — every other voice-note
 * container (mp3, m4a, ogg, opus, aac, flac, amr, 3ga…) is first transcoded
 * to a 16 kHz mono PCM WAV via ffmpeg (same execFile pattern as the video
 * poster generator in media-store).
 */
const PASSTHROUGH_EXT = new Set(['wav', 'webm'])

function ffmpegToWav(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        input,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        '-y',
        output,
      ],
      { timeout: 30_000 },
      (err) => (err ? reject(err) : resolve())
    )
  })
}

/**
 * Rate limit: 10 transcribe requests per minute per client (shared limiter).
 */
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60_000

/**
 * POST /api/transcribe
 * Body: { messageId: string }
 *
 * Transcribes a voice note (message type 'audio') with the built-in ASR
 * provider. Results are cached in AppSetting under `transcript:<messageId>`
 * and served instantly on repeat requests.
 *
 * Responses:
 *  200 { text, cached }          transcription (or cached copy)
 *  400 { error }                 invalid body
 *  401 { error }                 app locked
 *  404 { error }                 message or audio file not found
 *  413 { error }                 audio file over 25 MB
 *  415 { error }                 message is not a voice note
 *  429 { error }                 rate limited (10/min per client)
 *  502 { error }                 ASR failure (raw SDK errors never leak)
 */
export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  const ip = clientIpOf(req)
  if (isRateLimited(ip, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many transcription requests — please wait a moment' },
      { status: 429 }
    )
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { messageId } = (payload ?? {}) as { messageId?: unknown }
  if (typeof messageId !== 'string' || !messageId.trim()) {
    return NextResponse.json(
      { error: 'Field "messageId" must be a non-empty string' },
      { status: 400 }
    )
  }

  let msg: { id: string; chatId: string; type: string; mediaPath: string | null }
  try {
    const row = await db.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatId: true, type: true, mediaPath: true },
    })
    if (!row) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }
    msg = row
  } catch {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  if (msg.type !== 'audio' || !msg.mediaPath) {
    return NextResponse.json(
      { error: 'Only voice notes can be transcribed' },
      { status: 415 }
    )
  }

  // Traversal-safe resolution via the shared media-store helper.
  let filePath: string | null = null
  try {
    filePath = await resolveMediaPath(msg.chatId, msg.mediaPath)
  } catch {
    filePath = null
  }
  if (!filePath) {
    return NextResponse.json(
      { error: 'Voice note file not found' },
      { status: 404 }
    )
  }

  let size = 0
  try {
    size = (await fs.stat(filePath)).size
  } catch {
    return NextResponse.json(
      { error: 'Voice note file not found' },
      { status: 404 }
    )
  }
  if (size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: 'Voice note too large to transcribe (max 25 MB)' },
      { status: 413 }
    )
  }

  // Cached transcripts return instantly.
  const cacheKey = `transcript:${msg.id}`
  try {
    const cached = await getSetting(cacheKey)
    if (cached !== null) {
      return NextResponse.json({ text: cached, cached: true })
    }
  } catch {
    /* cache read failure is non-fatal — fall through to ASR */
  }

  try {
    const ext = (msg.mediaPath.split('.').pop() ?? '').toLowerCase()
    let base64: string
    let tmpWav: string | null = null
    try {
      if (PASSTHROUGH_EXT.has(ext)) {
        base64 = (await fs.readFile(filePath)).toString('base64')
      } else {
        tmpWav = path.join(tmpdir(), `wa-transcribe-${randomUUID()}.wav`)
        await ffmpegToWav(filePath, tmpWav)
        const wav = await fs.readFile(tmpWav)
        if (wav.byteLength > MAX_CONVERTED_BYTES) {
          return NextResponse.json(
            { error: 'Voice note too large to transcribe (max 25 MB)' },
            { status: 413 }
          )
        }
        base64 = wav.toString('base64')
      }
    } finally {
      if (tmpWav) await fs.rm(tmpWav, { force: true }).catch(() => {})
    }
    const zai = await ZAI.create()
    const response = await zai.audio.asr.create({ file_base64: base64 })
    const text = (response.text ?? '').trim()
    // Non-speech audio (tones, silence) comes back as bare symbols like "#".
    // Require at least one letter or digit before caching/returning.
    if (!text || !/\p{L}|\p{N}/u.test(text)) throw new Error('Empty transcript')
    const trimmed = text.slice(0, MAX_TRANSCRIPT_CHARS)
    await setSetting(cacheKey, trimmed)
    return NextResponse.json({ text: trimmed, cached: false })
  } catch {
    // Never leak raw SDK/network errors to the client.
    return NextResponse.json(
      { error: 'Transcription failed. Please try again.' },
      { status: 502 }
    )
  }
}
