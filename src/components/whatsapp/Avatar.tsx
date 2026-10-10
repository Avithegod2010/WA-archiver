'use client'

import { colorForName, initialsForName } from './types'
import { cn } from '@/lib/utils'

export function Avatar({
  name,
  size = 49,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full text-white',
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
      {initialsForName(name)}
    </div>
  )
}
