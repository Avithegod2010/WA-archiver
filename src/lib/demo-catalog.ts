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
      'Reports, the parking-lot “view” and the great croissant investigation — coffee Thursday, Brenda bakes.',
    emoji: '💼',
    isGroup: false,
    members: ['Emma Watson', 'You'],
    size: '~62 messages',
  },
  {
    id: 'group',
    title: 'Weekend Trip Planning',
    description:
      'A cabin with a hot tub, an 8am mutiny and Marcus’s one-pot incident redemption arc.',
    emoji: '🏔️',
    isGroup: true,
    members: ['Alex', 'Sarah', 'Marcus', 'Priya', 'You'],
    size: '~61 messages',
  },
  {
    id: 'family',
    title: 'Sharma Family 🏡',
    description:
      'Dad’s “top secret” biryani, Daisy’s first birthday and Mom’s constitutional salad ultimatum.',
    emoji: '🏡',
    isGroup: true,
    members: ['Mom', 'Dad', 'Anjali', 'You'],
    size: '~60 messages',
  },
  {
    id: 'work',
    title: 'Design Team — Acme',
    description:
      'Sprint 14: legal vs the small print, a keycap agenda and demo-day triumph.',
    emoji: '🎨',
    isGroup: true,
    members: ['Priya N.', 'Tom B.', 'Sofia R.', 'You'],
    size: '~60 messages',
  },
  {
    id: 'friend',
    title: 'Rohan Patel',
    description:
      'A patch that patches the patch, 3 years of rickroll warfare and Tank, guardian of the router.',
    emoji: '🎮',
    isGroup: false,
    members: ['Rohan Patel', 'You'],
    size: '~62 messages',
  },
  {
    id: 'squad',
    title: 'The Squad 🐍',
    description:
      'Chaat vs biryani diplomacy, a labelled-container crime and plans that refuse to cancel.',
    emoji: '🎉',
    isGroup: true,
    members: ['Kabir', 'Meera', 'Jules', 'You'],
    size: '~62 messages',
  },
]
