'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Full-screen image viewer: backdrop click / Escape closes,
 * click image toggles 1x <-> 2x zoom, download button saves the file.
 */
export function Lightbox({
  src,
  caption,
  downloadName,
  onClose,
}: {
  src: string
  caption?: string | null
  downloadName?: string | null
  onClose: () => void
}) {
  const [zoomed, setZoomed] = useState(false)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = ''
    }
  }, [onClose])

  if (!mounted) return null

  // Portal to body so the lightbox escapes the chat pane's stacking context
  return createPortal(
    <div
      className="animate-in fade-in fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-sm duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      {/* Toolbar */}
      <div
        className="animate-in fade-in slide-in-from-top-2 absolute right-4 top-4 z-10 flex items-center gap-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <a
          href={src}
          download={downloadName ?? true}
          aria-label="Download image"
          title="Download"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          onClick={onClose}
          aria-label="Close image viewer"
          title="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Image */}
      <div
        className="flex max-h-full max-w-full items-center justify-center overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={caption ?? 'Chat image'}
          onClick={() => setZoomed((z) => !z)}
          className={cn(
            'max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-300',
            zoomed && 'max-h-none max-w-none scale-150 cursor-zoom-out',
            !zoomed && 'cursor-zoom-in'
          )}
          draggable={false}
        />
      </div>

      {/* Caption + zoom hint */}
      {(caption || true) && (
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
                <ZoomIn className="h-3 w-3" /> Click image to zoom in
              </>
            )}
          </p>
        </div>
      )}
    </div>,
    document.body
  )
}
