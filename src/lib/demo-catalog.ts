/**
 * Catalog of built-in demo chats. Shared by the /api/demo route (which owns
 * the message builders) and the client-side demo picker (metadata only).
 */

export interface DemoChatMeta {
  id: string
  title: string
  description: string
  emoji: string
  isGroup: boolean
  members: string[]
  /** Rough size shown on the picker card. */
  size: string
}

export const DEMO_CATALOG: DemoChatMeta[] = [
  {
    id: 'personal',
    title: 'Emma Watson',
    description:
      'One-on-one with a colleague — documents, links, voice notes and location shares.',
    emoji: '💼',
    isGroup: false,
    members: ['Emma Watson', 'You'],
    size: '~30 messages',
  },
  {
    id: 'group',
    title: 'Weekend Trip Planning',
    description:
      'Planning a mountain getaway — cabin bookings, packing lists and a trail map.',
    emoji: '🏔️',
    isGroup: true,
    members: ['Alex', 'Sarah', 'Marcus', 'Priya', 'You'],
    size: '~33 messages',
  },
  {
    id: 'family',
    title: 'Sharma Family 🏡',
    description:
      'Sunday lunch plans, a birthday poll for the dog and Dad’s classic biryani debate.',
    emoji: '🏡',
    isGroup: true,
    members: ['Mom', 'Dad', 'Anjali', 'You'],
    size: '~28 messages',
  },
  {
    id: 'work',
    title: 'Design Team — Acme',
    description:
      'Sprint standups, Figma handoffs, deadline calls and a critique-time poll.',
    emoji: '🎨',
    isGroup: true,
    members: ['Priya N.', 'Tom B.', 'Sofia R.', 'You'],
    size: '~26 messages',
  },
  {
    id: 'friend',
    title: 'Rohan Patel',
    description:
      'Gaming banter, memes, rickrolls and spontaneous movie-night planning.',
    emoji: '🎮',
    isGroup: false,
    members: ['Rohan Patel', 'You'],
    size: '~22 messages',
  },
  {
    id: 'squad',
    title: 'The Squad 🐍',
    description:
      'Group-friends chaos: cancelled plans, food crawls, birthday countdowns.',
    emoji: '🎉',
    isGroup: true,
    members: ['Kabir', 'Meera', 'Jules', 'You'],
    size: '~25 messages',
  },
]
