/**
 * Minimal JPEG EXIF reader — dependency-free DateTimeOriginal extraction.
 *
 * Parses only what's needed to show a "captured on" date in the Lightbox:
 *   SOI → APP1("Exif\0\0") → TIFF header → IFD0 →(0x8769)→ ExifIFD →
 *   0x9003 DateTimeOriginal (fallback 0x9004 DateTimeDigitized, then
 *   IFD0's 0x0132 DateTime).
 *
 * Designed for partial buffers: callers fetch the first ~128 KB of the
 * file (EXIF always lives at the front of a JPEG). Anything that points
 * outside the window aborts gracefully and returns null — a missing
 * capture date must never break the viewer.
 *
 * Non-JPEG inputs (PNG/WebP/MP4/…) bail immediately on the SOI check.
 */

const SOI = 0xffd8
const APP1 = 0xffe1
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

const TAG_EXIF_IFD = 0x8769
const TAG_DATETIME = 0x0132
const TAG_DT_ORIGINAL = 0x9003
const TAG_DT_DIGITIZED = 0x9004

/** Parse an EXIF ASCII timestamp "YYYY:MM:DD HH:MM:SS" → epoch ms (local). */
function exifDateToMs(s: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  const ts = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se)
  ).getTime()
  return Number.isFinite(ts) ? ts : null
}

interface Reader {
  u8: Uint8Array
  dv: DataView
  /** Read `len` bytes at `off` as an ASCII string; null when out of window. */
  ascii(off: number, len: number): string | null
  u16(off: number): number
  u32(off: number): number
}

function makeReader(buf: ArrayBuffer): Reader {
  const u8 = new Uint8Array(buf)
  const dv = new DataView(buf)
  return {
    u8,
    dv,
    ascii(off, len) {
      if (off < 0 || off + len > u8.length) return null
      let out = ''
      for (let i = 0; i < len; i++) {
        const c = u8[off + i]
        if (c === 0) break
        out += String.fromCharCode(c)
      }
      return out
    },
    u16(off) {
      return off >= 0 && off + 2 <= u8.length ? dv.getUint16(off) : -1
    },
    u32(off) {
      return off >= 0 && off + 4 <= u8.length ? dv.getUint32(off) : 0
    },
  }
}

/**
 * Extract the best "capture" timestamp from a JPEG buffer, or null.
 * Preference: DateTimeOriginal → DateTimeDigitized → DateTime.
 */
export function exifCapturedAt(buf: ArrayBuffer): number | null {
  try {
    const r = makeReader(buf)
    if (r.u16(0) !== SOI) return null
    // Find the Exif APP1 segment (scan a few markers deep — thumbnails may
    // insert APP0/APPsegments first).
    let tiffStart = -1
    let off = 2
    for (let guard = 0; guard < 32 && off + 4 < r.u8.length; guard++) {
      const marker = r.u16(off)
      if (marker === APP1) {
        const segLen = r.u16(off + 2)
        const h = off + 4
        let isExif = r.u8.length >= h + 6
        if (isExif) {
          for (let i = 0; i < 6; i++) {
            if (r.u8[h + i] !== EXIF_HEADER[i]) {
              isExif = false
              break
            }
          }
        }
        if (isExif) {
          tiffStart = h + 6
          break
        }
        off += 2 + segLen
      } else if ((marker & 0xff00) === 0xff00 && marker !== 0xffff) {
        // Another marker segment with a length field — skip it.
        const segLen = r.u16(off + 2)
        if (segLen <= 0) break
        off += 2 + segLen
      } else {
        break // SOS / pure data — stop scanning
      }
    }
    if (tiffStart < 0) return null

    // TIFF header: byte order + 0x2A + IFD0 offset
    const order = r.u16(tiffStart)
    const little = order === 0x4949 // "II"
    if (!little && order !== 0x4d4d) return null // "MM"
    // Rebuild reader views honoring endianness for the TIFF section.
    const dv = new DataView(buf)
    const u16le = (o: number) =>
      o >= 0 && o + 2 <= dv.byteLength ? dv.getUint16(o, little) : -1
    const u32le = (o: number) =>
      o >= 0 && o + 4 <= dv.byteLength ? dv.getUint32(o, little) : 0

    let captured: number | null = null
    let digitized: number | null = null
    let modified: number | null = null
    let exifIfdOffset = -1

    const ifd0Off = u32le(tiffStart + 4)
    walkIfdEndiannessAware({
      u16: u16le,
      u32: u32le,
      byteLength: dv.byteLength,
    }, tiffStart, ifd0Off, (tag, _type, count, valueOff) => {
      if (tag === TAG_EXIF_IFD) exifIfdOffset = u32le(valueOff)
      else if (tag === TAG_DATETIME && count >= 19) {
        modified = exifDateToMs(r.ascii(valueOff, 20) ?? '')
      }
    })

    if (exifIfdOffset >= 0) {
      walkIfdEndiannessAware({
        u16: u16le,
        u32: u32le,
        byteLength: dv.byteLength,
      }, tiffStart, exifIfdOffset, (tag, _type, count, valueOff) => {
        if (tag === TAG_DT_ORIGINAL && count >= 19 && captured === null) {
          captured = exifDateToMs(r.ascii(valueOff, 20) ?? '')
        } else if (tag === TAG_DT_DIGITIZED && count >= 19) {
          digitized = exifDateToMs(r.ascii(valueOff, 20) ?? '')
        }
      })
    }

    return captured ?? digitized ?? modified
  } catch {
    return null // corrupt structures never break the caller
  }
}

/** Endianness-aware IFD walk (TIFF sections use II/MM order, not host order). */
function walkIfdEndiannessAware(
  r: {
    u16(off: number): number
    u32(off: number): number
    byteLength: number
  },
  tiffStart: number,
  ifdOff: number,
  visit: (tag: number, type: number, count: number, valueOff: number) => void
): void {
  const base = tiffStart + ifdOff
  if (base < 0 || base + 2 > r.byteLength) return
  const n = r.u16(base)
  if (n <= 0 || n > 512) return
  for (let i = 0; i < n; i++) {
    const e = base + 2 + i * 12
    if (e + 12 > r.byteLength) return
    const tag = r.u16(e)
    const type = r.u16(e + 2)
    const count = r.u32(e + 4)
    const inline = type === 2 && count <= 4
    const valueOff = inline ? e + 8 : tiffStart + r.u32(e + 8)
    visit(tag, type, count, valueOff)
  }
}

/** Number of leading bytes that almost always contain the full EXIF block. */
export const EXIF_PROBE_BYTES = 131_072

/**
 * Fetch the head of `url` and extract the capture date. Range requests
 * keep this cheap (~128 KB of a multi-MB photo); servers without range
 * support fall back to a capped full fetch via reader semantics below.
 */
export async function fetchCapturedAt(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${EXIF_PROBE_BYTES - 1}` },
      cache: 'force-cache',
    })
    if (!res.ok && res.status !== 206) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > EXIF_PROBE_BYTES * 4) {
      // Refuse absurd bodies — only the head matters.
      return exifCapturedAt(buf.slice(0, EXIF_PROBE_BYTES * 4))
    }
    return exifCapturedAt(buf)
  } catch {
    return null
  }
}
