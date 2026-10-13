'use client'

/**
 * WhatsApp-style single tail for chat bubbles.
 *
 * The inner edge hugs the bubble side (x = 8 for the left tail) from the top
 * and only curls away toward the tip, so the tail never detaches from the
 * bubble — no wallpaper "wedge" glitch between tail and bubble.
 */
export function BubbleTail({
  side,
  className,
}: {
  side: 'left' | 'right'
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className={className}
      aria-hidden="true"
    >
      {side === 'left' ? (
        <path d="M8 0 H4 C1.6 0.7 0 2.8 0 6 V13 C2.2 11.9 4.6 9.6 6.2 6.6 C7.4 4.4 8 2 8 0 Z" />
      ) : (
        <path d="M0 0 H4 C6.4 0.7 8 2.8 8 6 V13 C5.8 11.9 3.4 9.6 1.8 6.6 C0.6 4.4 0 2 0 0 Z" />
      )}
    </svg>
  )
}

/** Blue double-check ticks for delivered/read messages. */
export function TicksDouble({
  color = '#53bdeb',
  className,
}: {
  color?: string
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 11"
      width="16"
      height="11"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M11.07.653a.5.5 0 0 0-.707-.003L5.06 6.02 3.42 4.42a.5.5 0 1 0-.696.718l1.994 1.94a.5.5 0 0 0 .7.003l5.66-5.72A.5.5 0 0 0 11.07.653Z"
        fill={color}
      />
      <path
        d="M15.07.653a.5.5 0 0 0-.707-.003L9.06 6.02l-.83-.807-.69.716 1.17 1.14a.5.5 0 0 0 .7.003l5.66-5.72a.5.5 0 0 0 .003-.7Z"
        fill={color}
      />
      <path
        d="M3.42 7.02 2.42 6.05a.5.5 0 1 0-.7.72l1.35 1.31a.5.5 0 0 0 .7 0l.35-.36-.7-.7Z"
        fill={color}
      />
    </svg>
  )
}

/** WhatsApp logo mark (green circle + phone). */
export function WhatsAppLogo({
  size = 28,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="15" fill="currentColor" />
      <path
        d="M22.4 18.6c-.3-.2-2-1-2.3-1.1-.3-.1-.5-.2-.8.1-.2.3-.8 1-1 1.2-.2.2-.4.3-.7.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6-.1-.2-.8-1.9-1.1-2.5-.3-.6-.6-.5-.8-.5h-.7c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8 0 1.6 1.2 3.2 1.3 3.4.2.2 2.4 3.7 5.8 5.2.8.4 1.4.6 1.9.7.8.3 1.6.2 2.2.2.7-.1 2-.9 2.3-1.7.3-.8.3-1.5.2-1.7-.1-.1-.3-.2-.6-.4Z"
        fill="#fff"
      />
      <path
        d="M16 3.5C9.1 3.5 3.5 9.1 3.5 16c0 2.2.6 4.4 1.7 6.3L3.5 28.5l6.4-1.7c1.8 1 3.9 1.5 6.1 1.5 6.9 0 12.5-5.6 12.5-12.5S22.9 3.5 16 3.5Zm0 22.8c-2 0-3.9-.5-5.6-1.5l-.4-.2-3.8 1 1-3.7-.3-.4A10.4 10.4 0 0 1 16 5.6c5.8 0 10.4 4.7 10.4 10.4S21.8 26.3 16 26.3Z"
        fill="#fff"
        opacity="0"
      />
    </svg>
  )
}

/** Subtle doodle pattern used as the chat background (like WhatsApp). */
export function DoodleBackground() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="wa-doodles"
          width="260"
          height="260"
          patternUnits="userSpaceOnUse"
        >
          <g fill="none" stroke="currentColor" strokeWidth="1.1">
            {/* camera */}
            <g transform="translate(18,14)">
              <rect x="0" y="6" width="26" height="18" rx="3" />
              <circle cx="13" cy="15" r="5" />
              <rect x="8" y="2" width="10" height="5" rx="1.5" />
            </g>
            {/* heart */}
            <path
              d="M120 30c-4-8-16-6-16 3 0 6 8 10 16 16 8-6 16-10 16-16 0-9-12-11-16-3Z"
              transform="translate(0,-8)"
            />
            {/* smiley */}
            <g transform="translate(196,18)">
              <circle cx="14" cy="14" r="13" />
              <circle cx="9" cy="11" r="1.4" fill="currentColor" />
              <circle cx="19" cy="11" r="1.4" fill="currentColor" />
              <path d="M8 18c2 2.6 10 2.6 12 0" />
            </g>
            {/* paper plane */}
            <path d="M60 90 96 76 74 96 78 108Z" />
            {/* coffee cup */}
            <g transform="translate(120,92)">
              <path d="M2 4h20v12a8 8 0 0 1-16 0Z" />
              <path d="M22 6h5a4 4 0 0 1 0 8h-5" />
              <path d="M8 0c0 2-2 2-2 4M14 0c0 2-2 2-2 4" />
            </g>
            {/* music note */}
            <g transform="translate(206,96)">
              <path d="M8 22V6l12-3v16" />
              <circle cx="5" cy="22" r="3.5" />
              <circle cx="17" cy="19" r="3.5" />
            </g>
            {/* location pin */}
            <g transform="translate(30,150)">
              <path d="M12 2a9 9 0 0 1 9 9c0 7-9 17-9 17S3 18 3 11a9 9 0 0 1 9-9Z" />
              <circle cx="12" cy="11" r="3.5" />
            </g>
            {/* chat bubbles */}
            <g transform="translate(110,150)">
              <rect x="0" y="0" width="24" height="17" rx="5" />
              <path d="M6 17v5l6-5" />
              <circle cx="8" cy="8.5" r="1.3" fill="currentColor" />
              <circle cx="13" cy="8.5" r="1.3" fill="currentColor" />
              <circle cx="18" cy="8.5" r="1.3" fill="currentColor" />
            </g>
            {/* sun */}
            <g transform="translate(190,152)">
              <circle cx="13" cy="13" r="6" />
              <path d="M13 0v4M13 22v4M0 13h4M22 13h4M3.8 3.8l2.8 2.8M19.4 19.4l2.8 2.8M22.2 3.8l-2.8 2.8M6.6 19.4l-2.8 2.8" />
            </g>
            {/* glasses */}
            <g transform="translate(56,210)">
              <circle cx="8" cy="10" r="6" />
              <circle cx="28" cy="10" r="6" />
              <path d="M14 10h8M0 8l2-3M36 8l-2-3" />
            </g>
            {/* star */}
            <path d="M140 222l3.2 6.6 7.2 1-5.2 5.1 1.2 7.2-6.4-3.4-6.4 3.4 1.2-7.2-5.2-5.1 7.2-1Z" />
            {/* clock */}
            <g transform="translate(206,214)">
              <circle cx="13" cy="13" r="12" />
              <path d="M13 6v7l5 3" />
            </g>
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wa-doodles)" />
    </svg>
  )
}
