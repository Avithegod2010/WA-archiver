'use client'

import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  Check,
  ImagePlus,
  Loader2,
  Palette,
  RotateCcw,
  Trash2,
  Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  WALLPAPER_PRESETS,
  downscaleImage,
  hasWallpaperOverride,
  presetByKey,
  readWallpaper,
  resetWallpaper,
  subscribeWallpaper,
  writeWallpaper,
  type WallpaperConfig,
} from './wallpaper'

/**
 * Wallpaper studio popover — presets, custom photo upload and dim/blur
 * controls, per chat or app-wide. Also exposed on mobile via ChatInfo-less
 * header button (hidden on the narrowest headers to save space).
 */
export function WallpaperPicker({
  chatId,
  chatTitle,
  onOpenChange,
  open,
  children,
}: {
  chatId: string
  chatTitle: string
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Custom trigger (the header palette button) */
  children: React.ReactNode
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [isCustomOverride, setIsCustomOverride] = useState(false)

  const raw = useSyncExternalStore(
    subscribeWallpaper,
    () =>
      localStorage.getItem(`wa-viewer:wallpaper:${chatId}`) ??
      localStorage.getItem('wa-viewer:wallpaper') ??
      '',
    () => ''
  )
  const cfg = useMemo<WallpaperConfig>(
    () => readWallpaper(chatId),
     
    [chatId, raw]
  )
  const override = useMemo(
    () => hasWallpaperOverride(chatId),
     
    [chatId, raw]
  )
  const preset = presetByKey(cfg.k)
  const isPhoto = cfg.k === 'custom' && !!cfg.photo

  function setPreset(k: string) {
    writeWallpaper(chatId, { k, photo: k === 'custom' ? cfg.photo : null })
  }

  /** Remove the custom photo and fall back to the classic doodle look. */
  function removePhoto() {
    writeWallpaper(chatId, { k: 'doodle', photo: null, blur: 0 })
    toast.info('Custom wallpaper removed')
  }

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file')
      return
    }
    setUploading(true)
    try {
      const blob = await downscaleImage(file)
      const form = new FormData()
      form.append('file', new File([blob], 'wallpaper.jpg', { type: blob.type || 'image/jpeg' }))
      const res = await fetch('/api/wallpaper', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      writeWallpaper(chatId, { k: 'custom', photo: data.url })
      toast.success('Custom wallpaper applied')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload photo')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setIsCustomOverride(hasWallpaperOverride(chatId))
        onOpenChange(v)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="wa-scroll max-h-[min(560px,80vh)] w-[304px] overflow-y-auto p-3.5">
        <div className="mb-0.5 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-(--wa-text)">
            <Palette className="h-4 w-4 text-(--wa-accent)" />
            Wallpaper
          </p>
          {override && (
            <span className="rounded-full bg-(--wa-accent)/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-(--wa-accent-strong) dark:text-(--wa-accent)">
              This chat
            </span>
          )}
        </div>
        <p className="mb-2.5 text-[11.5px] leading-snug text-(--wa-text-2)">
          {override
            ? `Only for ${chatTitle} — other chats keep their own.`
            : 'Applies to every chat. Open a chat to set a per-chat wallpaper.'}
        </p>

        {/* Custom photo — prominent row above the presets */}
        <div className="mb-2.5 flex items-center gap-2.5 rounded-xl border border-dashed border-(--wa-line) bg-black/[0.03] p-2 dark:bg-white/[0.04]">
          <button
            onClick={() => (isPhoto ? undefined : fileRef.current?.click())}
            aria-label={isPhoto ? 'Your photo wallpaper' : 'Upload your own photo'}
            title={isPhoto ? 'Your photo wallpaper' : 'Upload your own photo'}
            className={cn(
              'relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-black/5 ring-1 ring-black/10 transition-shadow hover:shadow-md dark:bg-white/5 dark:ring-white/10',
              isPhoto && 'ring-2 ring-(--wa-accent)'
            )}
          >
            {isPhoto && cfg.photo ? (
              <img
                src={cfg.photo}
                alt="Custom wallpaper"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-(--wa-text-2)">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-(--wa-text)">
              {isPhoto ? 'Your photo' : 'Use your own photo'}
            </p>
            <p className="truncate text-[11px] leading-snug text-(--wa-text-2)">
              {isPhoto
                ? 'Shown behind this chat'
                : 'JPG, PNG or WebP — resized locally'}
            </p>
          </div>
          {isPhoto ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-(--wa-text-2) hover:bg-rose-500/10 hover:text-rose-500"
              onClick={removePhoto}
              aria-label="Remove custom photo"
              title="Remove custom photo"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 shrink-0 gap-1.5 rounded-full bg-(--wa-accent)/10 px-3 text-[12px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Upload
            </Button>
          )}
        </div>

        {/* Presets */}
        <div className="grid grid-cols-4 gap-2">
          {WALLPAPER_PRESETS.map((p) => {
            const active = cfg.k === p.key
            return (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                aria-pressed={active}
                title={p.label}
                className={cn(
                  'group flex flex-col items-center gap-1 rounded-lg p-1 transition-transform duration-150 hover:scale-[1.05] active:scale-95',
                  active && 'bg-(--wa-accent)/10'
                )}
              >
                <span
                  className={cn(
                    'relative h-11 w-full rounded-md ring-1 ring-black/10 transition-shadow group-hover:shadow-md dark:ring-white/10',
                    p.swatch,
                    active && 'ring-2 ring-(--wa-accent)'
                  )}
                >
                  {active && (
                    <span className="anim-pop absolute inset-0 flex items-center justify-center">
                      <Check className="h-4 w-4 text-(--wa-accent) drop-shadow" />
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-[10px] font-medium text-(--wa-text-2)">
                  {p.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Hidden photo input */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
          }}
        />

        {/* Controls */}
        <div className="mt-3 space-y-2.5 rounded-xl bg-black/[0.035] p-3 dark:bg-white/[0.04]">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
            <Layers className="h-3.5 w-3.5" /> Fine-tuning
          </p>

          <div>
            <div className="mb-1 flex items-center justify-between text-[12px] text-(--wa-text)">
              <span className="font-medium">Dim (contrast)</span>
              <span className="tabular-nums text-(--wa-text-2)">
                {Math.round(cfg.dim * 100)}%
              </span>
            </div>
            <Slider
              value={[cfg.dim]}
              min={0}
              max={75}
              step={5}
              onValueChange={([v]) => writeWallpaper(chatId, { dim: v / 100 })}
              aria-label="Wallpaper dim level"
            />
          </div>

          <div className={cn(!isPhoto && 'pointer-events-none opacity-40')}>
            <div className="mb-1 flex items-center justify-between text-[12px] text-(--wa-text)">
              <span className="font-medium">Blur {isPhoto ? '' : '(photos)'}</span>
              <span className="tabular-nums text-(--wa-text-2)">{cfg.blur}px</span>
            </div>
            <Slider
              value={[cfg.blur]}
              min={0}
              max={12}
              step={1}
              onValueChange={([v]) => writeWallpaper(chatId, { blur: v })}
              aria-label="Wallpaper blur level"
              disabled={!isPhoto}
            />
          </div>
        </div>

        {/* Scope actions */}
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 flex-1 gap-1.5 rounded-full bg-(--wa-accent)/10 text-[12px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
            onClick={() => {
              writeWallpaper('', cfg)
              toast.success('Wallpaper applied to all chats')
            }}
            title="Copy this wallpaper to every chat"
          >
            <Layers className="h-3.5 w-3.5" />
            Apply to all
          </Button>
          {override ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-full px-3 text-[12px] text-(--wa-text-2) hover:text-rose-500"
              onClick={() => {
                resetWallpaper(chatId)
                toast.info('Using the app default wallpaper')
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-full px-3 text-[12px] text-(--wa-text-2)"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Upload
            </Button>
          )}
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-(--wa-text-2)">
          Tip: photos are resized locally and stored in your own database —
          nothing leaves this device.
        </p>
      </PopoverContent>
    </Popover>
  )
}
