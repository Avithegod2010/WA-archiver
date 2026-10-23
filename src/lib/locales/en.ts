/**
 * English strings — the source of truth for every translation key.
 * Flat key-value map; keys are grouped by prefix (app / nav / chats /
 * select / shell / settings / theme.studio / common) but kept flat for t().
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

  /* Chats list (ChatList) */
  'chats.title': 'Chats',
  'chats.tab.all': 'All',
  'chats.tab.unread': 'Unread',
  'chats.tab.groups': 'Groups',
  'chats.tab.favorites': 'Favorites',
  'chats.empty': 'No chats yet',

  /* Chats list (ChatList) — rows, tabs, folders */
  'chats.archived': 'Archived',
  'chats.divider.pinned': 'Pinned',
  'chats.divider.allChats': 'All chats',
  'chats.folders.aria': 'Chat folders',
  'chats.folders.manage': 'Manage folders',
  'chats.time.yesterday': 'Yesterday',
  'chats.type.photo': 'Photo',
  'chats.type.sticker': 'Sticker',
  'chats.type.gif': 'GIF',
  'chats.type.video': 'Video',
  'chats.type.voice': 'Voice message',
  'chats.type.document': 'Document',
  'chats.type.location': 'Location',
  'chats.type.contact': 'Contact card',
  'chats.type.poll': 'Poll',
  'chats.type.missedCall': 'Missed call',
  'chats.type.deleted': 'Deleted message',
  'chats.type.media': 'Media',
  'chats.row.select': 'Select',
  'chats.row.aria.select': 'Select {name}',
  'chats.row.aria.pinned': 'Pinned',
  'chats.row.aria.unreadOne': '1 unread message',
  'chats.row.aria.unreadMany': '{count} unread messages',
  'chats.row.aria.fav': 'Add {name} to favorites',
  'chats.row.aria.unfav': 'Remove {name} from favorites',
  'chats.row.title.fav': 'Add to favorites',
  'chats.row.title.unfav': 'Remove from favorites',
  'chats.row.aria.pin': 'Pin {name}',
  'chats.row.aria.unpin': 'Unpin {name}',
  'chats.row.title.pin': 'Pin chat',
  'chats.row.title.unpin': 'Unpin chat',
  'chats.row.aria.archive': 'Archive {name}',
  'chats.row.aria.unarchive': 'Unarchive {name}',
  'chats.row.title.archive': 'Archive chat',
  'chats.row.title.unarchive': 'Unarchive chat',
  'chats.row.aria.delete': 'Delete {name}',

  /* Word cloud dialog (WordCloudDialog) */
  'wordcloud.title': 'Word cloud',
  'wordcloud.description':
    'Top words in {chat} — tap one to search it in this chat.',
  'wordcloud.loading': 'Loading word cloud…',
  'wordcloud.loadFailed': 'Could not load the word cloud',
  'wordcloud.loadFailedHint': 'Something went wrong — try again in a moment.',
  'wordcloud.empty': 'No words yet',
  'wordcloud.emptyHint':
    "Words from this chat's text messages will show up here.",
  'wordcloud.aria.word': 'Search the word {word} in {chat}',
  'wordcloud.usesOne': '1 use — search in chat',
  'wordcloud.usesMany': '{count} uses — search in chat',
  'wordcloud.sizeHintOne': '1 word · sized by how often it appears',
  'wordcloud.sizeHintMany': '{count} words · sized by how often they appear',
  'wordcloud.exportPng': 'Download PNG',
  'wordcloud.exporting': 'Rendering PNG…',
  'wordcloud.exported': 'Word cloud saved as PNG',
  'wordcloud.exportFailed': 'Could not render the PNG',
  'wordcloud.pngFooter': 'Made with WA Archiver',

  /* Chats list — header, sidebar menu, search */
  'chats.header.import': 'Import',
  'chats.header.paletteTip':
    'Command palette — jump to chats & run actions (Ctrl/⌘+K)',
  'chats.header.paletteAria': 'Open command palette',
  'chats.header.moreTip': 'More — insights, memories, media hub, demo',
  'chats.header.moreAria': 'More sidebar tools',
  'chats.menu.explore': 'Explore',
  'chats.menu.insights': 'Insights across all chats',
  'chats.menu.memories': 'On this day memories',
  'chats.menu.mediaHub': 'Media hub',
  'chats.menu.try': 'Try',
  'chats.menu.demo': 'Demo chats',
  'chats.search.placeholder': 'Search or start a new chat',
  'chats.search.markAllTip': 'Mark all as read',
  'chats.search.markAllAria': 'Mark all chats as read',
  'chats.search.noMatch': 'No chats match “{query}”',
  'chats.search.messagesInstead': 'Search messages instead',
  'chats.search.searchMessagesFor': 'Search messages for “{query}”',
  'chats.search.findInAll': 'Find this text inside every chat',

  /* Chats list — folder empty states + import / drop targets */
  'chats.folderEmpty.allArchived': 'All chats are archived',
  'chats.folderEmpty.generic': 'Nothing here yet',
  'chats.folderEmpty.unread': 'No unread messages 🎉',
  'chats.folderEmpty.unreadHint': 'You are all caught up.',
  'chats.folderEmpty.groups': 'No group chats',
  'chats.folderEmpty.groupsHint':
    'Group conversations you are part of will show up here.',
  'chats.folderEmpty.favorites': 'No favorites yet',
  'chats.folderEmpty.favoritesHint':
    'Hover a chat and tap the ★ to add it to this folder.',
  'chats.folderEmpty.custom': 'No chats in this folder yet',
  'chats.folderEmpty.customHint':
    'Pick which chats belong here with the folder manager.',
  'chats.empty.importTitle': 'Import your chats',
  'chats.empty.importBodyPre': 'Drop WhatsApp export',
  'chats.empty.importBodyMid': '(with media) or',
  'chats.empty.importBodyPost':
    'files here — several at once works too — or use the Import button above.',
  'chats.empty.tryDemo': 'Try demo chats',
  'chats.empty.exportHint':
    'Open WhatsApp > a chat > menu > More > Export chat to create an export file.',
  'chats.drop.title': 'Drop to import chat export',

  /* Chats list — delete / move dialogs */
  'chats.delete.title': 'Delete chat?',
  'chats.delete.body':
    '“{name}” and its messages will be removed from this viewer. This cannot be undone.',
  'chats.move.pickOne': 'Pick a folder for the selected chat.',
  'chats.move.pickMany': 'Pick a folder for the {count} selected chats.',
  'chats.move.noFolders': 'No custom folders yet.',
  'chats.move.create': 'Create a folder',
  'chats.bulkDelete.titleOne': 'Delete 1 chat?',
  'chats.bulkDelete.titleMany': 'Delete {count} chats?',
  'chats.bulkDelete.body':
    'This cannot be undone. The chats and their messages will be removed from this viewer.',

  /* Chats list — bulk-select toolbar */
  'chats.bulk.aria.toolbar': 'Selected chat actions',
  'chats.bulk.aria.close': 'Close selection',
  'chats.bulk.title.close': 'Close (Esc)',
  'chats.bulk.selectAll': 'Select all',
  'chats.bulk.selectAllTip': 'Select all chats in this view',
  'chats.bulk.clearTip': 'Clear selection',
  'chats.bulk.title.fav': 'Favorite',
  'chats.bulk.title.unfav': 'Unfavorite',
  'chats.bulk.aria.favAll': 'Add selected chats to favorites',
  'chats.bulk.aria.unfavAll': 'Remove selected chats from favorites',
  'chats.bulk.title.pin': 'Pin',
  'chats.bulk.title.unpin': 'Unpin',
  'chats.bulk.aria.pinAll': 'Pin selected chats',
  'chats.bulk.aria.unpinAll': 'Unpin selected chats',
  'chats.bulk.aria.move': 'Move selected chats to a folder',
  'chats.bulk.title.export': 'Export as .txt',
  'chats.bulk.aria.export': 'Export selected chats as .txt',
  'chats.bulk.aria.delete': 'Delete selected chats',

  /* Chats list — toasts (One/Many pairs: English count plurals) */
  'chats.toast.markAllRead': 'All chats marked as read',
  'chats.toast.favoritedOne': 'Favorited 1 chat',
  'chats.toast.favoritedMany': 'Favorited {count} chats',
  'chats.toast.unfavoritedOne': 'Unfavorited 1 chat',
  'chats.toast.unfavoritedMany': 'Unfavorited {count} chats',
  'chats.toast.pinnedOne': 'Pinned 1 chat',
  'chats.toast.pinnedMany': 'Pinned {count} chats',
  'chats.toast.unpinnedOne': 'Unpinned 1 chat',
  'chats.toast.unpinnedMany': 'Unpinned {count} chats',
  'chats.toast.updateFailedOne': 'Could not update 1 chat',
  'chats.toast.updateFailedMany': 'Could not update {count} chats',
  'chats.toast.movedOne': 'Moved 1 chat to {folder}',
  'chats.toast.movedMany': 'Moved {count} chats to {folder}',
  'chats.toast.moveFailed': 'Could not update folders',
  'chats.toast.deletedOne': 'Deleted 1 chat',
  'chats.toast.deletedMany': 'Deleted {count} chats',
  'chats.toast.deleteFailedOne': 'Could not delete 1 chat',
  'chats.toast.deleteFailedMany': 'Could not delete {count} chats',
  'chats.toast.exportedOne': 'Exported 1 chat',
  'chats.toast.exportedMany': 'Exported {count} chats',
  'chats.toast.exportSelectedFailed': 'Could not export the selected chats',
  'chats.toast.exportFailedOne': 'Could not export 1 chat',
  'chats.toast.exportFailedMany': 'Could not export {count} chats',
  'chats.toast.exportFailed': 'Export failed',

  /* Bulk-select toolbar (ChatList) */
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

  /* App shell (WhatsAppApp) — skip link, app bar, display popover */
  'shell.skipToChat': 'Skip to conversation',
  'shell.aria.displaySettings': 'Display settings',
  'shell.aria.settingsTip': 'Settings — backup, app lock & shortcuts',
  'shell.aria.toggleDark': 'Toggle dark mode',
  'shell.aria.aboutHelp': 'About and help',
  'shell.display.title': 'Text size & font',
  'shell.display.textSize': 'Reading text size',
  'shell.display.textSizeHint': 'Applies to message text in every chat.',
  'shell.display.appTheme': 'App theme',
  'shell.display.appThemeHint':
    'Recolors the whole app — header, bubbles, buttons and charts. Works with light & dark mode.',
  'shell.display.accent': 'Accent color',
  'shell.display.customColor': 'Custom color',
  'shell.display.customColorAria': 'Custom accent color',
  'shell.display.followTheme': 'Follow the active theme',
  'shell.display.themeDefault': 'Theme default',
  'shell.display.accentHint':
    'Tints buttons, highlights and heat dots — on top of any theme.',
  'shell.display.auto': 'Auto',
  'shell.display.light': 'Light',
  'shell.display.dark': 'Dark',
  'shell.display.followingDevice': 'Following your device — currently {mode}.',
  'shell.display.autoHint': 'Auto follows your device setting.',
  'shell.display.chatFont': 'Chat font',
  'shell.display.fontSample': 'Hello! How are you?',
  'shell.display.chatFontHint':
    'Changes the typeface across the chat list and every conversation.',
  'shell.display.bubbleStyle': 'Bubble style',
  'shell.display.bubbleHint':
    'Reshapes every message bubble — corners tighten or round, and Compact fits more of the conversation on screen.',
  'shell.display.clock': 'Clock',
  'shell.display.clockHint':
    'How message times read everywhere — bubbles, lists, media and search results.',

  /* App shell — offline banner, import overlay, footer */
  'shell.offline.device':
    "You're offline — everything still works, data lives on this device.",
  'shell.offline.server':
    "You're offline — recently opened chats are still readable.",
  'shell.working': 'Working on it...',
  'shell.footer.importAria': 'Import chats',
  'shell.footer.statsOne':
    '{chats} chat · {messages} messages · all data stays on this device',
  'shell.footer.statsMany':
    '{chats} chats · {messages} messages · all data stays on this device',

  /* App shell — command palette action labels */
  'shell.palette.search': 'Search messages across all chats',
  'shell.palette.media': 'Media hub — photos, videos, voice & docs',
  'shell.palette.insights': 'Insights dashboard',
  'shell.palette.memories': 'On this day memories',
  'shell.palette.import': 'Import chats (.zip / .txt)',
  'shell.palette.demo': 'Load demo chats',
  'shell.palette.lightMode': 'Switch to light mode',
  'shell.palette.darkMode': 'Switch to dark mode',
  'shell.palette.guide': 'Open the guide',

  /* App shell — toasts (One/Many pairs: English count plurals) */
  'shell.toast.loadChatsFailed': 'Could not load chats',
  'shell.toast.demoUpgraded': 'Demo chats upgraded with richer stories: {names}',
  'shell.toast.savedMissing':
    'Could not find Saved Messages — shared content was not added',
  'shell.toast.savedMissingText':
    'Could not find Saved Messages — shared text was not added',
  'shell.toast.shared': 'Shared to Saved Messages',
  'shell.toast.sharePartialOne': 'Shared to Saved Messages (1 item failed)',
  'shell.toast.sharePartialMany':
    'Shared to Saved Messages ({count} items failed)',
  'shell.toast.shareFailed':
    'Could not save the shared content to Saved Messages',
  'shell.toast.shareTextFailed':
    'Could not save the shared text to Saved Messages',
  'shell.toast.autoCleanedOne': 'Auto-cleaned 1 archived chat (30+ days idle)',
  'shell.toast.autoCleanedMany':
    'Auto-cleaned {count} archived chats (30+ days idle)',
  'shell.toast.offlineCached': 'Offline — showing cached messages',
  'shell.toast.deviceStorage':
    'This chat lives in the device storage — switch storage mode in Settings to open it',
  'shell.toast.loadChatFailed': 'Could not load this chat',
  'shell.toast.chatDeleted': 'Chat deleted',
  'shell.toast.deleteFailed': 'Could not delete this chat',
  'shell.toast.pinFailed': 'Could not update pin',
  'shell.toast.archived': 'Chat archived',
  'shell.toast.unarchived': 'Chat unarchived',
  'shell.toast.archiveFailed': 'Could not update archive',
  'shell.toast.starFailed': 'Could not update star',

  /* App shell — import toasts */
  'shell.import.progressOf': 'Importing {index} of {total}...',
  'shell.import.progressFile': 'Importing {name}...',
  'shell.import.doneMessages': 'Imported {count} messages',
  'shell.import.merged':
    'Merged into “{chat}”: +{added} new, {skipped} duplicates skipped',
  'shell.import.doneWithMedia':
    'Imported {count} messages and {media} media files',
  'shell.import.failed': 'Import failed',
  'shell.import.fileFailed': '{name}: {reason}',
  'shell.import.batchOkOne': 'Imported 1 chat · {messages} messages',
  'shell.import.batchOkMany': 'Imported {count} chats · {messages} messages',
  'shell.import.batchOkMediaOne':
    'Imported 1 chat · {messages} messages · {media} media files',
  'shell.import.batchOkMediaMany':
    'Imported {count} chats · {messages} messages · {media} media files',
  'shell.import.batchFailed': '{count} failed',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.apply': 'Apply',
  'common.close': 'Close',
  'common.you': 'You',
  'common.offline.title': "You're offline",
  'common.offline.body':
    'Chats you already opened stay available — reconnect to load new pages.',

  /* v1.8/1.9 cloud sync, transfer, folder rules, snapshots, verify (i18n pass) */
  'cloud.title': 'Cloud sync',
  'cloud.test': 'Test connection',
  'cloud.push': 'Push to cloud',
  'cloud.pull': 'Pull & restore',
  'cloud.snapshots': 'Snapshots',
  'cloud.autopush': 'Sync automatically after every import / export',
  'cloud.history': 'Keep timestamped snapshots (last)',
  'cloud.incremental': 'Incremental snapshots (hash-chained deltas)',
  'cloud.selective': 'Sync only selected chats',
  'cloud.transfer': 'Move to another device',
  'cloud.pair': 'Pair',
  'transfer.title': 'Transfer to another device',
  'transfer.send': 'This device sends',
  'transfer.receive': 'This device receives',
  'transfer.copy': 'Copy pairing code',
  'transfer.adopt': 'Adopt configuration',
  'transfer.scan': 'Scan QR with camera',
  'folders.rules.title': 'Auto-file rules',
  'folders.rules.pattern': 'Title pattern, e.g. family|mom|dad',
  'folders.rules.add': 'Add',
  'folders.rules.on': 'On',
  'folders.rules.off': 'Off',
  'snapshots.title': 'On-device snapshots',
  'snapshots.now': 'Snapshot now',
  'snapshots.save': 'Save file',
  'snapshots.restore': 'Restore',
  'verify.title': 'Export round-trip report',
  'stats.share': 'Share card',
} as const

export type TranslationKey = keyof typeof strings
