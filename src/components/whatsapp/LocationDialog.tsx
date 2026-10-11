'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, MapPin, PencilLine, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ChatMessage } from './types'
import { cn } from '@/lib/utils'

/**
 * Build the OpenStreetMap URL for a coordinate pair — the same shape the
 * MessageBubble location card links to.
 */
function osmUrl(lat: number, lng: number): string {
  const a = Number(lat.toFixed(6))
  const o = Number(lng.toFixed(6))
  return `https://www.openstreetmap.org/?mlat=${a}&mlon=${o}#map=16/${a}/${o}`
}

/**
 * Decorative map-ish preview: SVG grid + roads + park blobs with a pulsing
 * MapPin in a white/accent circle. Pure vector — no external images, no
 * motion for reduced-motion users.
 */
function MiniMap({ className }: { className?: string }) {
  const pid = useId()
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-lg border border-black/5 bg-[#e7efe8] dark:border-white/10',
        className
      )}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 260 140"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern id={pid} width="22" height="22" patternUnits="userSpaceOnUse">
            <path
              d="M22 0H0v22"
              fill="none"
              stroke="rgba(11,20,26,0.07)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="260" height="140" fill={`url(#${pid})`} />
        <path
          d="M-8 96 C 60 76, 110 116, 178 72 S 250 52, 272 66"
          fill="none"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M52 -8 C 70 48, 40 96, 78 152"
          fill="none"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect x="196" y="14" width="52" height="34" rx="10" fill="rgba(114,166,106,0.35)" />
        <rect x="18" y="112" width="40" height="22" rx="8" fill="rgba(114,166,106,0.28)" />
      </svg>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute inset-0 animate-ping rounded-full bg-(--wa-accent)/30 motion-reduce:animate-none" />
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md ring-2 ring-(--wa-accent)">
          <MapPin className="h-5 w-5 text-(--wa-accent)" />
        </span>
      </div>
    </div>
  )
}

type Phase = 'locating' | 'ready' | 'manual'

/**
 * Send-a-location dialog — the + menu "Location" entry.
 *
 * Controlled: { chatId, open, onOpenChange, onSent }. On open it asks
 * navigator.geolocation for the current position (8s timeout, low accuracy).
 * Success → live preview card (coords + editable label, prefilled
 * "Current location" and best-effort reverse-named); denial / timeout /
 * unsupported → a manual form (place label + optional lat/lng, validated
 * lat -90..90, lng -180..180).
 *
 * Sends POST /api/chats/:id/messages with:
 *   { type: 'location', body: JSON.stringify({ lat?, lng?, label, url }) }
 * where url is the OpenStreetMap link when coords exist, else ''. The created
 * message is handed to onSent(msg) so the caller can append it (same prop
 * style Composer uses).
 */
export function LocationDialog({
  chatId,
  open,
  onOpenChange,
  onSent,
}: {
  chatId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onSent: (msg: ChatMessage) => void
}) {
  const [phase, setPhase] = useState<Phase>('locating')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [label, setLabel] = useState('')
  const [latText, setLatText] = useState('')
  const [lngText, setLngText] = useState('')
  const [geoNote, setGeoNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const labelTouched = useRef(false)

  // On every open: reset and (re)try geolocation once.
  useEffect(() => {
    if (!open) return
    setPhase('locating')
    setCoords(null)
    setLabel('')
    setLatText('')
    setLngText('')
    setGeoNote('')
    setError('')
    setBusy(false)
    labelTouched.current = false

    let cancelled = false
    // Safety net beyond the browser's own 8s timeout.
    const fallback = setTimeout(() => {
      if (cancelled) return
      setPhase((p) => {
        if (p === 'locating') {
          setGeoNote('Getting your location took too long — enter it manually.')
          return 'manual'
        }
        return p
      })
    }, 8600)

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      clearTimeout(fallback)
      setPhase('manual')
      setGeoNote(
        'Geolocation is not available in this browser — enter the place manually.'
      )
      return () => {
        cancelled = true
      }
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return
        clearTimeout(fallback)
        const lat = Number(pos.coords.latitude.toFixed(6))
        const lng = Number(pos.coords.longitude.toFixed(6))
        setCoords({ lat, lng })
        setLabel('Current location')
        setPhase('ready')
        // Best-effort reverse geocode to prefill a nicer label — silently
        // ignored offline/blocked, and never overwrites an edited label.
        const ctrl = new AbortController()
        const abort = setTimeout(() => ctrl.abort(), 2500)
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`,
          { signal: ctrl.signal, headers: { Accept: 'application/json' } }
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((data: unknown) => {
            if (cancelled || labelTouched.current || !data) return
            const rec = data as { name?: unknown; display_name?: unknown }
            let name: string | undefined
            if (typeof rec.name === 'string' && rec.name.trim()) {
              name = rec.name.trim()
            } else if (
              typeof rec.display_name === 'string' &&
              rec.display_name.trim()
            ) {
              name = rec.display_name.split(',')[0].trim()
            }
            if (name) setLabel(name.slice(0, 120))
          })
          .catch(() => {})
          .finally(() => clearTimeout(abort))
      },
      (err) => {
        if (cancelled) return
        clearTimeout(fallback)
        const code = (err as { code?: number } | null)?.code
        setPhase('manual')
        setGeoNote(
          code === 1
            ? 'Location permission was denied — enter the place manually.'
            : code === 3
              ? 'Getting your location timed out — enter the place manually.'
              : 'Your location is unavailable — enter the place manually.'
        )
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    )

    return () => {
      cancelled = true
      clearTimeout(fallback)
    }
  }, [open])

  const latNum = latText.trim() === '' ? null : Number(latText)
  const lngNum = lngText.trim() === '' ? null : Number(lngText)
  const latOk =
    latNum === null || (Number.isFinite(latNum) && Math.abs(latNum) <= 90)
  const lngOk =
    lngNum === null || (Number.isFinite(lngNum) && Math.abs(lngNum) <= 180)
  const partialCoord = (latNum === null) !== (lngNum === null)
  const effCoords =
    coords ??
    (latNum !== null && lngNum !== null && latOk && lngOk
      ? { lat: latNum, lng: lngNum }
      : null)
  const cleanLabel = label.trim().slice(0, 120)
  const canSend =
    phase !== 'locating' &&
    cleanLabel.length > 0 &&
    latOk &&
    lngOk &&
    !partialCoord &&
    !busy

  function switchToManual() {
    if (coords) {
      setLatText(String(coords.lat))
      setLngText(String(coords.lng))
    }
    setPhase('manual')
  }

  async function send() {
    if (partialCoord) {
      setError('Enter both latitude and longitude — or leave both empty.')
      return
    }
    if (!cleanLabel) {
      setError('Add a place name first.')
      return
    }
    if (!latOk || !lngOk) {
      setError('Latitude must be -90..90 and longitude -180..180.')
      return
    }
    const payloadBody = effCoords
      ? {
          lat: effCoords.lat,
          lng: effCoords.lng,
          label: cleanLabel,
          url: osmUrl(effCoords.lat, effCoords.lng),
        }
      : { label: cleanLabel, url: '' }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'location',
          body: JSON.stringify(payloadBody),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not send location')
      onSent(data.message as ChatMessage)
      toast.success('Location sent')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send location')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-300">
              <MapPin className="h-4 w-4" />
            </span>
            Send location
          </DialogTitle>
          <DialogDescription>
            Share where you are — or drop a pin anywhere by hand. Stored only on
            this device.
          </DialogDescription>
        </DialogHeader>

        {phase === 'locating' ? (
          <div
            className="flex flex-col items-center gap-3 py-8"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-6 w-6 animate-spin text-(--wa-accent)" />
            <p className="text-[13.5px] text-(--wa-text-2)">
              Finding your location…
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-full text-[12.5px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/10"
              onClick={switchToManual}
            >
              <PencilLine className="h-3.5 w-3.5" /> Enter manually
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {phase === 'ready' && effCoords && (
              <div className="flex flex-col gap-2">
                <MiniMap className="h-36 w-full" />
                <p className="text-center text-[12px] tabular-nums text-(--wa-text-2)">
                  {effCoords.lat}, {effCoords.lng}
                </p>
                <button
                  type="button"
                  onClick={switchToManual}
                  className="mx-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-(--wa-accent-strong) transition-colors hover:bg-(--wa-accent)/10 dark:text-(--wa-accent)"
                >
                  <PencilLine className="h-3.5 w-3.5" /> Enter coordinates
                  manually
                </button>
              </div>
            )}

            {phase === 'manual' && (
              <div className="flex flex-col gap-3">
                {geoNote && (
                  <p
                    className="rounded-md bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-300"
                    role="status"
                  >
                    {geoNote}
                  </p>
                )}
                {effCoords && <MiniMap className="h-32 w-full" />}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label
                      htmlFor="location-lat"
                      className="mb-1 block text-[12.5px] font-medium text-(--wa-text)"
                    >
                      Latitude{' '}
                      <span className="font-normal text-(--wa-text-2)">
                        (optional)
                      </span>
                    </label>
                    <Input
                      suppressHydrationWarning
                      id="location-lat"
                      inputMode="decimal"
                      value={latText}
                      maxLength={20}
                      placeholder="e.g. 12.9716"
                      aria-invalid={!latOk}
                      className={cn(
                        !latOk &&
                          'border-rose-400 focus-visible:ring-rose-300 dark:border-rose-500/60'
                      )}
                      onChange={(e) => setLatText(e.target.value)}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="location-lng"
                      className="mb-1 block text-[12.5px] font-medium text-(--wa-text)"
                    >
                      Longitude{' '}
                      <span className="font-normal text-(--wa-text-2)">
                        (optional)
                      </span>
                    </label>
                    <Input
                      suppressHydrationWarning
                      id="location-lng"
                      inputMode="decimal"
                      value={lngText}
                      maxLength={20}
                      placeholder="e.g. 77.5946"
                      aria-invalid={!lngOk}
                      className={cn(
                        !lngOk &&
                          'border-rose-400 focus-visible:ring-rose-300 dark:border-rose-500/60'
                      )}
                      onChange={(e) => setLngText(e.target.value)}
                    />
                  </div>
                </div>
                {(!latOk || !lngOk) && (
                  <p className="text-[12px] font-medium text-rose-600 dark:text-rose-400">
                    Latitude must be -90..90 and longitude -180..180.
                  </p>
                )}
                {partialCoord && latOk && lngOk && (
                  <p className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                    Fill in both latitude and longitude — or leave both empty.
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                htmlFor="location-label"
                className="mb-1 block text-[12.5px] font-medium text-(--wa-text)"
              >
                Place name
              </label>
              <Input
                suppressHydrationWarning
                id="location-label"
                value={label}
                maxLength={120}
                placeholder={
                  phase === 'ready' ? 'Current location' : 'e.g. Coffee shop'
                }
                onChange={(e) => {
                  labelTouched.current = true
                  setLabel(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    send()
                  }
                }}
              />
            </div>

            {error && (
              <p
                className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
            disabled={phase === 'locating' || busy || !canSend}
            onClick={send}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <LocateFixed className="h-4 w-4" /> Send location
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
