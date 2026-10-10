'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Full-screen media viewer: backdrop click / Escape closes,
 * click image toggles 1x <-> 2x zoom, download button saves the file.
 * Supports images, videos (inline player) and audio.
 * When `onPrev`/`onNext` are given, arrow keys + edge buttons navigate
 * between gallery items and a "n / total" counter is shown.
 */
export function Lightbox({
  src,
  caption,
  downloadName,
  kind = 'image',
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
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  position?: number
  total?: number
}) {
  const [zoomed, setZoomed] = useState(false)
  // Reset zoom when navigating between items (adjust-state-during-render pattern)
  const [prevSrc, setPrevSrc] = useState(src)
  if (prevSrc !== src) {
    setPrevSrc(src)
    setZoomed(false)
  }
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  // Touch swipe -> prev/next on mobile
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current
    touchStart.current = null
    if (!start || !onPrev || !onNext) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    // Horizontal swipe dominant and long enough
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onNext()
      else onPrev()
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
      }
    }
    window.addEventListener('keydown', onKey, true)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = ''
    }
  }, [onClose, onPrev, onNext])

  if (!mounted) return null

  const hasNav = !!(onPrev && onNext && total && total > 1)

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
        <a
          href={src}
          download={downloadName ?? true}
          aria-label="Download media"
          title="Download"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          onClick={onClose}
          aria-label="Close viewer"
          title="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
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

      {/* Media */}
      <div
        className="flex max-h-full max-w-full items-center justify-center overflow-auto px-10 sm:px-16"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === 'image' && (
          <img
            key={src}
            src={src}
            alt={caption ?? 'Chat image'}
            onClick={() => setZoomed((z) => !z)}
            className={cn(
              'animate-in zoom-in-95 max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl duration-200',
              zoomed && 'max-h-none max-w-none scale-150 cursor-zoom-out',
              !zoomed && 'cursor-zoom-in'
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
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#00a884]/20 text-[#00a884]">
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
      {kind === 'image' && (
        <div
          className="absolute bottom-6 flex flex-col items-center gap-1 px-6 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {caption && (
            <p className="max-w-lg rounded-full bg-white/10 px-4 py-1.5 text-[13px] text-white/90">
              {caption}
            </p>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-white/50">
            {zoomed ? (
              <>
                <ZoomOut className="h-3 w-3" /> Click image to zoom out
              </>
            ) : (
              <>
                <ZoomIn className="h-3 w-3" />
                {hasNav ? 'Click to zoom · ← → or swipe to browse' : 'Click image to zoom in'}
              </>
            )}
          </p>
        </div>
      )}
    </div>,
    document.body
  )
}
