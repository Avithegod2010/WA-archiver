'use client'

import { useSyncExternalStore } from 'react'
import { Bookmark } from 'lucide-react'
import {
  getChatAvatar,
  subscribeChatAvatars,
} from './chat-avatars'
import { colorForName, initialsForName } from './types'
import { cn } from '@/lib/utils'

/**
 * Reactively read a chat's custom photo (null = show initials). Subscribes to
 * set/remove events and cross-tab storage changes.
 */
export function useChatAvatar(chatId: string): string | null {
  return useSyncExternalStore(
    subscribeChatAvatars,
    () => getChatAvatar(chatId),
    () => null
  )
}

export function Avatar({
  name,
  size = 49,
  className,
  src,
}: {
  name: string
  size?: number
  className?: string
  /** Custom photo (data URL) — replaces the initials fallback when set. */
  src?: string | null
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-white',
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: colorForName(name),
        fontSize: Math.max(11, size * 0.36),
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        initialsForName(name)
      )}
    </div>
  )
}

/** Accent-colored avatar with a bookmark glyph — used for Saved Messages. */
export function SavedAvatar({
  size = 49,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full bg-(--wa-accent) text-white shadow-sm',
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Bookmark className="fill-current" style={{ width: size * 0.42, height: size * 0.42 }} />
    </div>
  )
}
