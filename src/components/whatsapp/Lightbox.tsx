'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { Camera } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchCapturedAt } from '@/lib/exif'

const MIN_ZOOM = 1
const MAX_ZOOM = 4

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/**
 * Full-screen media viewer: backdrop click / Escape closes,
 * scroll-wheel zooms (1x–4x), double-click toggles 1x <-> 2x,
 * +/-/reset controls, drag-to-pan when zoomed and a download button.
 * Supports images, videos (inline player) and audio.
 * When `onPrev`/`onNext` are given, arrow keys + edge buttons navigate
 * between gallery items and a "n / total" counter is shown.
 */
export function Lightbox({
  src,
  caption,
  downloadName,
  kind = 'image',
  sentAt,
  onClose,
  onPrev,
  onNext,
  position,
  total,
}: {
  src: string
  caption?: string | null
  downloadName?: string | null
  kind?: 'image' | 'video' | 'audio'
  /** Message timestamp (epoch ms) — enables the EXIF "captured on" pill. */
  sentAt?: number
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  position?: number
  total?: number
}) {
  const [view, setView] = useState<{ zoom: number; x: number; y: number }>({
    zoom: 1,
    x: 0,
    y: 0,
  })
  const [panning, setPanning] = useState(false)
  // Reset zoom + pan when navigating between items (adjust-state-during-render)
  const [prevSrc, setPrevSrc] = useState(src)
  if (prevSrc !== src) {
    setPrevSrc(src)
    setView({ zoom: 1, x: 0, y: 0 })
  }
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const panStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  // Touch swipe -> prev/next on mobile
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  // EXIF capture date (JPEG only): fetch the file head once per src and
  // surface DateTimeOriginal when it disagrees with the send time by over
  // a minute (an old photo re-shared years later). Null-safe everywhere —
  // CORS/binary-less sources just leave the pill hidden.
  const [capturedAt, setCapturedAt] = useState<number | null>(null)
  // Reset + re-probe when the viewed item changes (render-time adjustment —
  // same pattern as the zoom reset above; the async fetch then lands via
  // its callback, so the effect never sets state synchronously).
  const [probeKey, setProbeKey] = useState('')
  const probeKeyNow = kind === 'image' && src ? src : ''
  if (probeKey !== probeKeyNow) {
    setProbeKey(probeKeyNow)
    setCapturedAt(null)
  }
  useEffect(() => {
    if (!probeKeyNow) return
    let alive = true
    fetchCapturedAt(probeKeyNow).then((ts) => {
      if (alive) setCapturedAt(ts)
    })
    return () => {
      alive = false
    }
  }, [probeKeyNow])
  const showCapturedAt =
    capturedAt !== null &&
    (sentAt === undefined || Math.abs(capturedAt - sentAt) > 60_000)

  /** Clamp pan offsets so the image can never be dragged fully off-screen. */
  const clampOffset = useCallback((z: number, ox: number, oy: number) => {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage) return { x: 0, y: 0 }
    const maxX = Math.max(0, (img.offsetWidth * z - stage.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * z - stage.clientHeight) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, ox)),
      y: Math.min(maxY, Math.max(-maxY, oy)),
    }
  }, [])

  const applyZoom = useCallback((next: number) => {
    const z = clampZoom(next)
    setView((v) =>
      z === 1 ? { zoom: 1, x: 0, y: 0 } : { zoom: z, ...clampOffset(z, v.x, v.y) }
    )
  }, [clampOffset])

  const zoomBy = useCallback(
    (factor: number) => {
      applyZoom(view.zoom * factor)
    },
    [applyZoom, view.zoom]
  )

  // Wheel zoom on the whole overlay (no ctrl needed) — non-passive so the
  // page behind never scrolls while the viewer is open.
  useEffect(() => {
    if (kind !== 'image') return
    const el = stageRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [kind, zoomBy])

  // Touch swipe -> prev/next on mobile (only at 1x; pan takes over when zoomed)
  function onTouchStart(e: React.TouchEvent) {
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current
    touchStart.current = null
    if (!start || view.zoom > 1 || !onPrev || !onNext) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    // Horizontal swipe dominant and long enough
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onNext()
      else onPrev()
    }
  }

  // Drag-to-pan (pointer events cover mouse + touch when zoomed in)
  function onPanPointerDown(e: React.PointerEvent) {
    if (view.zoom <= 1) return
    panStart.current = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y }
    setPanning(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer capture unavailable */
    }
  }
  function onPanPointerMove(e: React.PointerEvent) {
    const start = panStart.current
    if (!start) return
    setView((v) => ({
      zoom: v.zoom,
      ...clampOffset(v.zoom, start.ox + (e.clientX - start.px), start.oy + (e.clientY - start.py)),
    }))
  }
  function onPanPointerUp(e: React.PointerEvent) {
    panStart.current = null
    setPanning(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer capture unavailable */
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault()
        onNext()
      } else if (kind === 'image' && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        zoomBy(1.25)
      } else if (kind === 'image' && e.key === '-') {
        e.preventDefault()
        zoomBy(1 / 1.25)
      } else if (kind === 'image' && e.key === '0') {
        e.preventDefault()
        applyZoom(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = ''
    }
  }, [onClose, onPrev, onNext, kind, zoomBy, applyZoom])

  if (!mounted) return null

  const hasNav = !!(onPrev && onNext && total && total > 1)
  const isImage = kind === 'image'
  const zoom = view.zoom
  const offset = { x: view.x, y: view.y }
  const zoomPct = `${Math.round(view.zoom * 100)}%`

  function handleDownload() {
    toast.success('Downloading image — check your downloads')
  }

  // Portal to body so the lightbox escapes the chat pane's stacking context
  return createPortal(
    <div
      className="animate-in fade-in fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-sm duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={kind === 'video' ? 'Video player' : 'Image viewer'}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation()
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Toolbar */}
      <div
        className="animate-in fade-in slide-in-from-top-2 absolute right-4 top-4 z-10 flex items-center gap-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {hasNav && (
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium tabular-nums text-white/90">
            {position} / {total}
          </span>
        )}
        {isImage && (
          <>
            <span
              className="rounded-full bg-white/10 px-2.5 py-1.5 text-[11.5px] font-semibold tabular-nums text-white/90"
              aria-live="polite"
              aria-label={`Zoom level ${zoomPct}`}
            >
              {zoomPct}
            </span>
            <button
              onClick={() => zoomBy(1.25)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoom in"
              title="Zoom in (+)"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              onClick={() => zoomBy(1 / 1.25)}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Zoom out"
              title="Zoom out (−)"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <button
              onClick={() => applyZoom(1)}
              disabled={zoom === MIN_ZOOM}
              aria-label="Reset zoom"
              title="Reset zoom (0)"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              <Maximize className="h-5 w-5" />
            </button>
          </>
        )}
        <a
          href={src}
          download={downloadName ?? true}
          onClick={handleDownload}
          aria-label="Download media"
          title="Download"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          onClick={onClose}
          aria-label="Close viewer"
          title="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Prev / next edge buttons */}
      {hasNav && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPrev?.()
            }}
            aria-label="Previous item"
            title="Previous (←)"
            className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-all hover:scale-105 hover:bg-white/25 active:scale-95 sm:left-5"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNext?.()
            }}
            aria-label="Next item"
            title="Next (→)"
            className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-all hover:scale-105 hover:bg-white/25 active:scale-95 sm:right-5"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Media stage — owns wheel zoom + drag pan */}
      <div
        ref={stageRef}
        className="flex max-h-full max-w-full touch-none items-center justify-center overflow-hidden px-10 sm:px-16"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={isImage ? onPanPointerDown : undefined}
        onPointerMove={isImage ? onPanPointerMove : undefined}
        onPointerUp={isImage ? onPanPointerUp : undefined}
        onPointerCancel={isImage ? onPanPointerUp : undefined}
      >
        {isImage && (
          <img
            key={src}
            ref={imgRef}
            src={src}
            alt={caption ?? 'Chat image'}
            onDoubleClick={() => applyZoom(zoom >= 2 ? 1 : 2)}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            }}
            className={cn(
              'animate-in zoom-in-95 max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl duration-200 select-none',
              panning ? 'cursor-grabbing transition-none' : 'transition-transform duration-150 motion-reduce:transition-none',
              zoom > 1 && !panning && 'cursor-grab',
              zoom === 1 && 'cursor-zoom-in'
            )}
            draggable={false}
          />
        )}
        {kind === 'video' && (
          <video
            key={src}
            src={src}
            controls
            autoPlay
            className="max-h-[82vh] max-w-full rounded-lg shadow-2xl"
          />
        )}
        {kind === 'audio' && (
          <div className="flex w-[min(90vw,420px)] flex-col items-center gap-4 rounded-2xl bg-white/5 p-8 shadow-2xl backdrop-blur">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-(--wa-accent)/20 text-(--wa-accent)">
              <svg viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor">
                <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
              </svg>
            </span>
            <audio src={src} controls autoPlay className="w-full" />
            {caption && (
              <p className="max-w-full truncate text-center text-[13px] text-white/80">
                {caption}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Caption + zoom hint */}
      {isImage && (
        <div
          className="absolute bottom-6 flex flex-col items-center gap-1 px-6 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {caption && (
            <p className="max-w-lg rounded-full bg-white/10 px-4 py-1.5 text-[13px] text-white/90">
              {caption}
            </p>
          )}
          {showCapturedAt && (
            <p
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11.5px] font-medium text-white/85"
              title="Capture date from the photo's EXIF metadata"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden />
              Captured{' '}
              {new Date(capturedAt).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-white/50">
            {zoom > 1 ? (
              <>Scroll to zoom · drag to pan · double-click to reset</>
            ) : (
              <>
                <ZoomIn className="h-3 w-3" />
                {hasNav
                  ? 'Double-click or scroll to zoom · ← → or swipe to browse'
                  : 'Double-click or scroll to zoom'}
              </>
            )}
          </p>
        </div>
      )}
    </div>,
    document.body
  )
}
