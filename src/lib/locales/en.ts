/**
 * English strings — the source of truth for every translation key.
 * Flat key-value map; keys are grouped by prefix (app / nav / chats /
 * select / settings / theme.studio / common) but kept flat for t().
 *
 * hi.ts mirrors this shape 1:1 (Record<TranslationKey, string>), so a
 * missing or extra key in any locale fails typecheck.
 */

export const strings = {
  /* App shell */
  'app.name': 'WA Archiver',
  'app.tagline': 'Read your exported chats — private & local',

  /* Navigation / search */
  'nav.search': 'Search',

  /* Chats list (tabs convert in a follow-up wave — ChatList is stable) */
  'chats.title': 'Chats',
  'chats.tab.all': 'All',
  'chats.tab.unread': 'Unread',
  'chats.tab.groups': 'Groups',
  'chats.tab.favorites': 'Favorites',
  'chats.empty': 'No chats yet',

  /* Bulk-select toolbar (future use — ChatList) */
  'select.title': 'Select chats',
  'select.toolbar.selected': '{count} selected',
  'select.action.delete': 'Delete',
  'select.action.export': 'Export',
  'select.action.favorite': 'Favorite',
  'select.action.pin': 'Pin',
  'select.action.moveFolder': 'Move to folder',
  'select.action.clear': 'Clear',
  'select.action.close': 'Close',

  /* Settings dialog */
  'settings.title': 'Settings',
  'settings.description':
    'Everything stays on this device — nothing is uploaded anywhere.',
  'settings.section.ai': 'AI features',
  'settings.section.backup': 'Backup & restore',
  'settings.section.personal': 'Personal data',
  'settings.section.appearance': 'Appearance',
  'settings.section.themeStudio': 'Theme studio',
  'settings.section.language': 'Language',
  'settings.section.display': 'Display',
  'settings.section.storage': 'Data and storage',
  'settings.section.export': 'Export',
  'settings.section.lock': 'App lock (PIN)',
  'settings.section.shortcuts': 'Keyboard shortcuts',
  'settings.section.install': 'Install & offline',
  'settings.section.about': 'About',
  'settings.language.label': 'App language',
  'settings.language.hint': 'Changes labels across the app. More languages soon.',

  /* Theme studio (C1 #13) */
  'theme.studio.hint':
    'Pick a theme, add an accent, then save the whole look as a preset.',
  'theme.studio.presets': 'Themes',
  'theme.studio.custom': 'Your presets',
  'theme.studio.save': 'Save current look as preset…',
  'theme.studio.namePlaceholder': 'Preset name',
  'theme.studio.saveButton': 'Save',
  'theme.studio.active': 'Active',
  'theme.studio.delete': 'Delete preset',
  'theme.studio.confirmDelete': 'Delete “{name}”?',
  'theme.studio.confirmDeleteHint':
    'Only the preset is removed — your current look stays as it is.',
  'theme.studio.saved': 'Preset saved — {name}',
  'theme.studio.applied': 'Preset applied — {name}',
  'theme.studio.deleted': 'Preset deleted',
  'theme.studio.limit': 'Preset slots full — delete one to save another (max 12).',
  'theme.studio.nameRequired': 'Give your preset a name first.',
  'theme.studio.nameTaken': 'A preset with that name already exists.',
  'theme.studio.storageError': 'Could not save — device storage is full.',
  'theme.studio.includesWallpaper': 'Wallpaper',
  'theme.studio.aria.applyNamed': 'Apply theme {name}',

  /* Common / shared */
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.apply': 'Apply',
  'common.close': 'Close',
  'common.offline.title': "You're offline",
  'common.offline.body':
    'Chats you already opened stay available — reconnect to load new pages.',
} as const

export type TranslationKey = keyof typeof strings
