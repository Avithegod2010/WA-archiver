'use client'

import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  Ban,
  Check,
  ImagePlus,
  Loader2,
  Palette,
  Pipette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
  Trash2,
  Layers,
  Brush,
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
  WALLPAPER_COLORS,
  WALLPAPER_PATTERNS,
  WALLPAPER_PRESETS,
  downscaleImage,
  hasWallpaperOverride,
  readWallpaper,
  resetWallpaper,
  subscribeWallpaper,
  writeWallpaper,
  type WallpaperConfig,
} from './wallpaper'
import { colorForName } from './types'

/**
 * A self-tracking slider: while the pointer drags, the thumb follows local
 * state 1:1 (immune to any storage round-trip hiccup), then resyncs with the
 * store on release (onValueCommit). Slider values are plain integers on BOTH
 * sides (value and onChange) — never mix unit scales.
 */
function FineSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string
  /** Current display value, e.g. 35 meaning 35% */
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const shown = Math.min(Math.max(drag ?? value, min), max)
  return (
    <div className={cn(disabled && 'pointer-events-none opacity-40')}>
      <div className="mb-1 flex items-center justify-between text-[12px] text-(--wa-text)">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-(--wa-text-2)">{format(shown)}</span>
      </div>
      <Slider
        value={[shown]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => {
          setDrag(v)
          onChange(v)
        }}
        onValueCommit={() => setDrag(null)}
        aria-label={label}
      />
    </div>
  )
}

function SectionLabel({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="mb-1.5 mt-3.5 flex items-baseline justify-between first:mt-0">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
        {icon}
        {title}
      </p>
      {hint && (
        <span className="text-[9.5px] text-(--wa-text-2)/80">{hint}</span>
      )}
    </div>
  )
}

/** Round solid-color swatch used in the Colors section. */
function ColorSwatch({
  active,
  style,
  label,
  onClick,
  children,
}: {
  active: boolean
  style?: React.CSSProperties
  label: string
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className="group flex items-center justify-center p-0.5 transition-transform duration-150 hover:scale-110 active:scale-95"
    >
      <span
        style={style}
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-black/15 transition-shadow group-hover:shadow-md dark:ring-white/20',
          active && 'ring-2 ring-(--wa-accent) ring-offset-2 ring-offset-(--wa-panel) dark:ring-offset-(--wa-panel-2)'
        )}
      >
        {children}
        {active && (
          <Check className="absolute h-3.5 w-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]" />
        )}
      </span>
    </button>
  )
}

/** Deterministic string hash (same recipe as colorForName). */
function hashStr(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  }
  return hash
}

/** Multiply a #rrggbb color's channels by `f` (0..1) for a dark variant. */
function darkenHex(hex: string, f: number): string {
  const raw = hex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const n = parseInt(full, 16)
  if (Number.isNaN(n) || full.length !== 6) return hex
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Pattern / pre-built tile with a small label under the swatch. */
function DesignTile({
  active,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean
  label: string
  title?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={title ?? label}
      className="group flex flex-col items-center gap-1 rounded-lg p-1 transition-transform duration-150 hover:scale-[1.05] active:scale-95"
    >
      <span
        className={cn(
          'relative h-10 w-full overflow-hidden rounded-md ring-1 ring-black/10 transition-shadow group-hover:shadow-md dark:ring-white/10',
          active && 'ring-2 ring-(--wa-accent)'
        )}
      >
        {children}
        {active && (
          <span className="anim-pop absolute inset-0 flex items-center justify-center">
            <Check className="h-4 w-4 text-(--wa-accent) drop-shadow" />
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-[9.5px] font-medium text-(--wa-text-2)">
        {label}
      </span>
    </button>
  )
}

/** Suggestion tile (h-14) — same visual language as DesignTile. */
function SuggestionTile({
  active,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean
  label: string
  title?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={title ?? label}
      className="group flex flex-col items-center gap-1 rounded-lg p-1 transition-transform duration-150 hover:scale-[1.05] active:scale-95"
    >
      <span
        className={cn(
          'relative h-14 w-full overflow-hidden rounded-md ring-1 ring-black/10 transition-shadow group-hover:shadow-md dark:ring-white/10',
          active && 'ring-2 ring-(--wa-accent)'
        )}
      >
        {children}
        {active && (
          <span className="anim-pop absolute inset-0 flex items-center justify-center">
            <Check className="h-4 w-4 text-(--wa-accent) drop-shadow" />
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-[9.5px] font-medium text-(--wa-text-2)">
        {label}
      </span>
    </button>
  )
}

/**
 * Wallpaper studio popover — three mixable sections (colors, patterns,
 * pre-built designs) + custom photo + dim/contrast/brightness/saturation/
 * blur fine-tuning. Per chat or app-wide.
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
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const raw = useSyncExternalStore(
    subscribeWallpaper,
    () =>
      localStorage.getItem(`wa-viewer:wallpaper:${chatId}`) ??
      localStorage.getItem('wa-viewer:wallpaper') ??
      '',
    () => ''
  )
  const cfg = useMemo<WallpaperConfig>(() => readWallpaper(chatId), [chatId, raw])
  const override = useMemo(() => hasWallpaperOverride(chatId), [chatId, raw])
  const isPhoto = cfg.k === 'custom' && !!cfg.photo

  /* ------- Suggested for this chat (#8): deterministic from the title ------- */
  const suggestions = useMemo(() => {
    const h = hashStr(chatTitle)
    const base = colorForName(chatTitle)
    const dark = darkenHex(base, 0.22)
    const pattern = WALLPAPER_PATTERNS[h % WALLPAPER_PATTERNS.length]
    const p1 = WALLPAPER_PRESETS[(h >>> 3) % WALLPAPER_PRESETS.length]
    let p2 =
      WALLPAPER_PRESETS[((h >>> 6) + 3) % WALLPAPER_PRESETS.length]
    if (p2.key === p1.key) {
      p2 =
        WALLPAPER_PRESETS[
          (WALLPAPER_PRESETS.indexOf(p1) + 1) % WALLPAPER_PRESETS.length
        ]
    }
    return [
      {
        key: 's-color',
        label: 'Avatar color',
        title: `Color matched to ${chatTitle}'s avatar`,
        active: (c: WallpaperConfig) =>
          c.k === 'color' && c.color?.toLowerCase() === base.toLowerCase(),
        apply: () => setColor(base, dark),
        preview: (
          <span
            className="absolute inset-0"
            style={{ background: `linear-gradient(180deg, ${base} 50%, ${dark} 50%)` }}
          />
        ),
      },
      {
        key: 's-combo',
        label: `+ ${pattern.label}`,
        title: `Avatar color with the ${pattern.label} pattern`,
        active: (c: WallpaperConfig) =>
          c.k === 'pattern' &&
          c.pattern === pattern.key &&
          c.color?.toLowerCase() === base.toLowerCase(),
        apply: () =>
          writeWallpaper(chatId, {
            k: 'pattern',
            color: base,
            colorDark: dark,
            pattern: pattern.key,
          }),
        preview: (
          <>
            <span className="absolute inset-0" style={{ background: base }} />
            <span className={cn('absolute inset-0 wpat-bg', `wpat-${pattern.key}`)} />
          </>
        ),
      },
      {
        key: `s-p1-${p1.key}`,
        label: p1.label,
        title: `Pre-built: ${p1.label}`,
        active: (c: WallpaperConfig) => c.k === 'preset' && c.preset === p1.key,
        apply: () => setPrebuilt(p1.key),
        preview: <span className={cn('absolute inset-0', p1.swatch)} />,
      },
      {
        key: `s-p2-${p2.key}`,
        label: p2.label,
        title: `Pre-built: ${p2.label}`,
        active: (c: WallpaperConfig) => c.k === 'preset' && c.preset === p2.key,
        apply: () => setPrebuilt(p2.key),
        preview: <span className={cn('absolute inset-0', p2.swatch)} />,
      },
    ]
  }, [chatTitle, chatId])

  /** A pattern can only be "on" when we're not showing a pre-built design */
  const patternOn = cfg.k !== 'preset' ? cfg.pattern : null
  const paletteLights = new Set(WALLPAPER_COLORS.map((c) => c.light.toLowerCase()))
  const isCustomColor =
    (cfg.k === 'color' || cfg.k === 'pattern') &&
    !!cfg.color &&
    !paletteLights.has(cfg.color.toLowerCase())

  function setColor(light: string | null, dark: string | null) {
    writeWallpaper(chatId, { k: 'color', color: light, colorDark: dark })
  }

  function setPattern(key: string | null) {
    writeWallpaper(chatId, { k: key ? 'pattern' : 'color', pattern: key })
  }

  function setPrebuilt(key: string) {
    writeWallpaper(chatId, { k: 'preset', preset: key })
  }

  /** Remove the custom photo and fall back to the classic doodle look. */
  function removePhoto() {
    writeWallpaper(chatId, { k: 'preset', preset: 'doodle', photo: null, blur: 0 })
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
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="wa-scroll max-h-[min(680px,85vh)] w-[304px] overflow-y-auto p-3.5 md:w-[592px]">
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

        <div className="md:grid md:grid-cols-2 md:gap-x-5">
          {/* ------------------------- LEFT: photo + colors + patterns */}
          <div>
            {/* Custom photo — prominent row */}
            <div className="mb-1 flex items-center gap-2.5 rounded-xl border border-dashed border-(--wa-line) bg-black/[0.03] p-2 dark:bg-white/[0.04]">
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

            {/* Hidden inputs */}
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
            <input
              ref={colorInputRef}
              type="color"
              defaultValue="#efeae2"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => setColor(e.target.value, null)}
            />

            {/* Section 0 — Suggested for this chat (#8) */}
            <SectionLabel
              icon={<Sparkles className="h-3 w-3" />}
              title={`Suggested for ${chatTitle}`}
              hint="tap to apply"
            />
            <div className="grid grid-cols-4 gap-2">
              {suggestions.map((s) => (
                <SuggestionTile
                  key={s.key}
                  label={s.label}
                  title={s.title}
                  active={s.active(cfg)}
                  onClick={s.apply}
                >
                  {s.preview}
                </SuggestionTile>
              ))}
            </div>

            {/* Section 1 — Colors */}
            <SectionLabel
              icon={<Palette className="h-3 w-3" />}
              title="Colors"
              hint="any color works"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {WALLPAPER_COLORS.map((c) => {
                const active =
                  cfg.k !== 'preset' &&
                  (c.key === 'auto' ? !cfg.color : cfg.color?.toLowerCase() === c.light.toLowerCase())
                return (
                  <ColorSwatch
                    key={c.key}
                    label={c.label}
                    active={active}
                    onClick={() => setColor(c.key === 'auto' ? null : c.light, c.key === 'auto' ? null : c.dark)}
                  >
                    {c.key === 'auto' ? (
                      <span className="h-full w-full rounded-full bg-(--wa-chat-bg)" />
                    ) : (
                      <span
                        className="h-full w-full rounded-full"
                        style={{ background: `linear-gradient(180deg, ${c.light} 50%, ${c.dark} 50%)` }}
                      />
                    )}
                  </ColorSwatch>
                )
              })}
              {/* Custom color wheel */}
              <ColorSwatch
                label="Pick any color"
                active={isCustomColor}
                onClick={() => colorInputRef.current?.click()}
              >
                <span
                  className="flex h-full w-full items-center justify-center rounded-full"
                  style={{
                    background:
                      'conic-gradient(#f87171,#fbbf24,#34d399,#2dd4bf,#a78bfa,#e879f9,#f87171)',
                  }}
                >
                  <Pipette className="h-3 w-3 text-white drop-shadow" />
                </span>
              </ColorSwatch>
            </div>

            {/* Section 2 — Patterns */}
            <SectionLabel
              icon={<Brush className="h-3 w-3" />}
              title="Patterns"
              hint="mix with any color"
            />
            <div className="grid grid-cols-4 gap-2">
              <DesignTile
                label="None"
                active={cfg.k !== 'preset' && !patternOn}
                onClick={() => setPattern(null)}
              >
                <span className="flex h-full w-full items-center justify-center bg-white dark:bg-[#141c24]">
                  <Ban className="h-4 w-4 text-(--wa-text-2)" />
                </span>
              </DesignTile>
              {WALLPAPER_PATTERNS.map((p) => (
                <DesignTile
                  key={p.key}
                  label={p.label}
                  active={patternOn === p.key}
                  onClick={() => setPattern(p.key)}
                >
                  <span className="absolute inset-0 bg-white dark:bg-[#141c24]" />
                  <span className={cn('absolute inset-0 wpat-bg', `wpat-${p.key}`)} />
                </DesignTile>
              ))}
            </div>
          </div>

          {/* ------------------------- RIGHT: pre-builts + fine-tuning */}
          <div className="md:border-l md:border-(--wa-line) md:pl-5">
            {/* Section 3 — Pre-built designs */}
            <SectionLabel
              icon={<SwatchBook className="h-3 w-3" />}
              title="Pre-built designs"
              hint="complete looks"
            />
            <div className="grid grid-cols-4 gap-2">
              {WALLPAPER_PRESETS.map((p) => {
                const active = cfg.k === 'preset' && cfg.preset === p.key
                return (
                  <DesignTile
                    key={p.key}
                    label={p.label}
                    active={active}
                    onClick={() => setPrebuilt(p.key)}
                  >
                    <span className={cn('absolute inset-0', p.swatch)} />
                  </DesignTile>
                )
              })}
            </div>

            {/* Fine-tuning */}
            <div className="mt-3.5 space-y-2.5 rounded-xl bg-black/[0.035] p-3 dark:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                  <Layers className="h-3 w-3" /> Fine-tuning
                </p>
                <button
                  className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium text-(--wa-text-2) transition-colors hover:bg-black/5 hover:text-(--wa-text) dark:hover:bg-white/10"
                  onClick={() => {
                    writeWallpaper(chatId, {
                      dim: 0,
                      blur: 0,
                      contrast: 1,
                      brightness: 1,
                      saturation: 1,
                    })
                    toast.info('Fine-tuning reset')
                  }}
                  title="Reset dim, contrast, brightness & saturation"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  Reset
                </button>
              </div>

              {/* NOTE: every slider works in whole-percent integers on BOTH the
                  value and the onChange side. The old dim slider fed a 0–0.75
                  fraction into a 0–75 track, pinning the thumb at the far left —
                  that is why it appeared to never move. */}
              <FineSlider
                label="Dim overlay"
                value={Math.round(cfg.dim * 100)}
                min={0}
                max={75}
                step={5}
                format={(v) => `${v}%`}
                onChange={(v) => writeWallpaper(chatId, { dim: v / 100 })}
              />

              <FineSlider
                label="Contrast"
                value={Math.round(cfg.contrast * 100)}
                min={60}
                max={160}
                step={5}
                format={(v) => `${v}%`}
                onChange={(v) => writeWallpaper(chatId, { contrast: v / 100 })}
              />

              <FineSlider
                label="Brightness"
                value={Math.round(cfg.brightness * 100)}
                min={60}
                max={130}
                step={5}
                format={(v) => `${v}%`}
                onChange={(v) => writeWallpaper(chatId, { brightness: v / 100 })}
              />

              <FineSlider
                label="Saturation"
                value={Math.round(cfg.saturation * 100)}
                min={0}
                max={200}
                step={10}
                format={(v) => `${v}%`}
                onChange={(v) => writeWallpaper(chatId, { saturation: v / 100 })}
              />

              <FineSlider
                label={`Blur${isPhoto ? '' : ' (photos)'}`}
                value={cfg.blur}
                min={0}
                max={12}
                step={1}
                format={(v) => `${v}px`}
                disabled={!isPhoto}
                onChange={(v) => writeWallpaper(chatId, { blur: v })}
              />
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
              Tip: pick a color, then a pattern — they combine. Photos are
              stored in your own database, nothing leaves this device.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
