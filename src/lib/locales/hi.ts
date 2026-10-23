/**
 * हिन्दी strings — mirrors en.ts 1:1 (Record<TranslationKey, string>,
 * so a missing/extra key fails typecheck). Kept short and natural;
 * the app name stays "WA Archiver".
 */

import type { TranslationKey } from './en'

export const strings: Record<TranslationKey, string> = {
  /* App shell */
  'app.name': 'WA Archiver',
  'app.tagline': 'एक्सपोर्ट किए गए चैट पढ़ें — प्राइवेट और लोकल',

  /* Navigation / search */
  'nav.search': 'खोजें',

  /* Chats list (ChatList) */
  'chats.title': 'चैट',
  'chats.tab.all': 'सभी',
  'chats.tab.unread': 'अपठित',
  'chats.tab.groups': 'ग्रुप',
  'chats.tab.favorites': 'पसंदीदा',
  'chats.empty': 'अभी कोई चैट नहीं',

  /* Chats list (ChatList) — rows, tabs, folders */
  'chats.archived': 'आर्काइव',
  'chats.divider.pinned': 'पिन किए गए',
  'chats.divider.allChats': 'सभी चैट',
  'chats.folders.aria': 'चैट फ़ोल्डर',
  'chats.folders.manage': 'फ़ोल्डर प्रबंधित करें',
  'chats.time.yesterday': 'कल',
  'chats.type.photo': 'फ़ोटो',
  'chats.type.sticker': 'स्टिकर',
  'chats.type.gif': 'GIF',
  'chats.type.video': 'वीडियो',
  'chats.type.voice': 'वॉइस संदेश',
  'chats.type.document': 'दस्तावेज़',
  'chats.type.location': 'लोकेशन',
  'chats.type.contact': 'कॉन्टैक्ट कार्ड',
  'chats.type.poll': 'पोल',
  'chats.type.missedCall': 'मिस्ड कॉल',
  'chats.type.deleted': 'हटाया गया संदेश',
  'chats.type.media': 'मीडिया',
  'chats.row.select': 'चुनें',
  'chats.row.aria.select': '{name} चुनें',
  'chats.row.aria.pinned': 'पिन किया गया',
  'chats.row.aria.unreadOne': '1 अपठित संदेश',
  'chats.row.aria.unreadMany': '{count} अपठित संदेश',
  'chats.row.aria.fav': '{name} को पसंदीदा में जोड़ें',
  'chats.row.aria.unfav': '{name} को पसंदीदा से हटाएँ',
  'chats.row.title.fav': 'पसंदीदा में जोड़ें',
  'chats.row.title.unfav': 'पसंदीदा से हटाएँ',
  'chats.row.aria.pin': '{name} पिन करें',
  'chats.row.aria.unpin': '{name} अनपिन करें',
  'chats.row.title.pin': 'चैट पिन करें',
  'chats.row.title.unpin': 'चैट अनपिन करें',
  'chats.row.aria.archive': '{name} आर्काइव करें',
  'chats.row.aria.unarchive': '{name} अनआर्काइव करें',
  'chats.row.title.archive': 'चैट आर्काइव करें',
  'chats.row.title.unarchive': 'चैट अनआर्काइव करें',
  'chats.row.aria.delete': '{name} हटाएँ',

  /* Chats list — header, sidebar menu, search */
  'chats.header.import': 'इंपोर्ट',
  'chats.header.paletteTip':
    'कमांड पैलेट — चैट पर जाएँ और ऐक्शन चलाएँ (Ctrl/⌘+K)',
  'chats.header.paletteAria': 'कमांड पैलेट खोलें',
  'chats.header.moreTip': 'और — इनसाइट्स, मेमरीज़, मीडिया हब, डेमो',
  'chats.header.moreAria': 'और साइडबार टूल',
  'chats.menu.explore': 'एक्सप्लोर',
  'chats.menu.insights': 'सभी चैट की इनसाइट्स',
  'chats.menu.memories': 'आज के दिन की यादें',
  'chats.menu.mediaHub': 'मीडिया हब',
  'chats.menu.try': 'आज़माएँ',
  'chats.menu.demo': 'डेमो चैट',
  'chats.search.placeholder': 'खोजें या नई चैट शुरू करें',
  'chats.search.markAllTip': 'सभी को पढ़ा हुआ मार्क करें',
  'chats.search.markAllAria': 'सभी चैट को पढ़ी हुई मार्क करें',
  'chats.search.noMatch': '“{query}” से मेल खाती कोई चैट नहीं',
  'chats.search.messagesInstead': 'इसकी जगह संदेश खोजें',
  'chats.search.searchMessagesFor': '“{query}” के लिए संदेश खोजें',
  'chats.search.findInAll': 'यह टेक्स्ट हर चैट में खोजें',

  /* Chats list — folder empty states + import / drop targets */
  'chats.folderEmpty.allArchived': 'सभी चैट आर्काइव में हैं',
  'chats.folderEmpty.generic': 'यहाँ अभी कुछ नहीं',
  'chats.folderEmpty.unread': 'कोई अपठित संदेश नहीं 🎉',
  'chats.folderEmpty.unreadHint': 'आपने सब कुछ पढ़ लिया है।',
  'chats.folderEmpty.groups': 'कोई ग्रुप चैट नहीं',
  'chats.folderEmpty.groupsHint': 'आपके ग्रुप संवाद यहाँ दिखाई देंगे।',
  'chats.folderEmpty.favorites': 'अभी कोई पसंदीदा नहीं',
  'chats.folderEmpty.favoritesHint':
    'किसी चैट पर होवर करें और ★ दबाकर उसे इस फ़ोल्डर में जोड़ें।',
  'chats.folderEmpty.custom': 'इस फ़ोल्डर में अभी कोई चैट नहीं',
  'chats.folderEmpty.customHint':
    'फ़ोल्डर मैनेजर से चुनें कि कौन-सी चैट यहाँ रहेंगी।',
  'chats.empty.importTitle': 'अपनी चैट इंपोर्ट करें',
  'chats.empty.importBodyPre': 'व्हाट्सऐप एक्सपोर्ट',
  'chats.empty.importBodyMid': '(मीडिया सहित) या',
  'chats.empty.importBodyPost':
    'फ़ाइलें यहाँ ड्रॉप करें — एक साथ कई भी चलेंगी — या ऊपर मौजूद इंपोर्ट बटन इस्तेमाल करें।',
  'chats.empty.tryDemo': 'डेमो चैट आज़माएँ',
  'chats.empty.exportHint':
    'एक्सपोर्ट फ़ाइल बनाने के लिए: व्हाट्सऐप खोलें > कोई चैट > मेनू > More > Export chat।',
  'chats.drop.title': 'इंपोर्ट करने के लिए चैट एक्सपोर्ट ड्रॉप करें',

  /* Chats list — delete / move dialogs */
  'chats.delete.title': 'चैट हटाएँ?',
  'chats.delete.body':
    '“{name}” और उसके संदेश इस व्यूअर से हटा दिए जाएँगे। इसे वापस नहीं किया जा सकता।',
  'chats.move.pickOne': 'चुनी गई चैट के लिए फ़ोल्डर चुनें।',
  'chats.move.pickMany': '{count} चुनी गई चैटों के लिए फ़ोल्डर चुनें।',
  'chats.move.noFolders': 'अभी कोई कस्टम फ़ोल्डर नहीं।',
  'chats.move.create': 'फ़ोल्डर बनाएँ',
  'chats.bulkDelete.titleOne': '1 चैट हटाएँ?',
  'chats.bulkDelete.titleMany': '{count} चैट हटाएँ?',
  'chats.bulkDelete.body':
    'इसे वापस नहीं किया जा सकता। चैटें और उनके संदेश इस व्यूअर से हटा दिए जाएँगे।',

  /* Chats list — bulk-select toolbar */
  'chats.bulk.aria.toolbar': 'चुनी गई चैटों के ऐक्शन',
  'chats.bulk.aria.close': 'चयन बंद करें',
  'chats.bulk.title.close': 'बंद करें (Esc)',
  'chats.bulk.selectAll': 'सभी चुनें',
  'chats.bulk.selectAllTip': 'इस व्यू की सभी चैट चुनें',
  'chats.bulk.clearTip': 'चयन हटाएँ',
  'chats.bulk.title.fav': 'पसंदीदा',
  'chats.bulk.title.unfav': 'पसंदीदा हटाएँ',
  'chats.bulk.aria.favAll': 'चुनी गई चैटों को पसंदीदा में जोड़ें',
  'chats.bulk.aria.unfavAll': 'चुनी गई चैटों को पसंदीदा से हटाएँ',
  'chats.bulk.title.pin': 'पिन',
  'chats.bulk.title.unpin': 'अनपिन',
  'chats.bulk.aria.pinAll': 'चुनी गई चैटों को पिन करें',
  'chats.bulk.aria.unpinAll': 'चुनी गई चैटों को अनपिन करें',
  'chats.bulk.aria.move': 'चुनी गई चैटों को फ़ोल्डर में ले जाएँ',
  'chats.bulk.title.export': '.txt के रूप में एक्सपोर्ट करें',
  'chats.bulk.aria.export': 'चुनी गई चैटें .txt के रूप में एक्सपोर्ट करें',
  'chats.bulk.aria.delete': 'चुनी गई चैटें हटाएँ',

  /* Chats list — toasts (One/Many pairs: English count plurals) */
  'chats.toast.markAllRead': 'सभी चैट पढ़ी हुई मार्क हो गईं',
  'chats.toast.favoritedOne': '1 चैट पसंदीदा की गई',
  'chats.toast.favoritedMany': '{count} चैटें पसंदीदा की गईं',
  'chats.toast.unfavoritedOne': '1 चैट पसंदीदा से हटाई गई',
  'chats.toast.unfavoritedMany': '{count} चैटें पसंदीदा से हटाई गईं',
  'chats.toast.pinnedOne': '1 चैट पिन की गई',
  'chats.toast.pinnedMany': '{count} चैटें पिन की गईं',
  'chats.toast.unpinnedOne': '1 चैट अनपिन की गई',
  'chats.toast.unpinnedMany': '{count} चैटें अनपिन की गईं',
  'chats.toast.updateFailedOne': '1 चैट अपडेट नहीं हो सकी',
  'chats.toast.updateFailedMany': '{count} चैटें अपडेट नहीं हो सकीं',
  'chats.toast.movedOne': '1 चैट {folder} में ले जाई गई',
  'chats.toast.movedMany': '{count} चैटें {folder} में ले जाई गईं',
  'chats.toast.moveFailed': 'फ़ोल्डर अपडेट नहीं हो सके',
  'chats.toast.deletedOne': '1 चैट हटा दी गई',
  'chats.toast.deletedMany': '{count} चैटें हटा दी गईं',
  'chats.toast.deleteFailedOne': '1 चैट हटाई नहीं जा सकी',
  'chats.toast.deleteFailedMany': '{count} चैटें हटाई नहीं जा सकीं',
  'chats.toast.exportedOne': '1 चैट एक्सपोर्ट हुई',
  'chats.toast.exportedMany': '{count} चैटें एक्सपोर्ट हुईं',
  'chats.toast.exportSelectedFailed': 'चुनी गई चैटें एक्सपोर्ट नहीं हो सकीं',
  'chats.toast.exportFailedOne': '1 चैट एक्सपोर्ट नहीं हो सकी',
  'chats.toast.exportFailedMany': '{count} चैटें एक्सपोर्ट नहीं हो सकीं',
  'chats.toast.exportFailed': 'एक्सपोर्ट विफल',

  /* Bulk-select toolbar (ChatList) */
  'select.title': 'चैट चुनें',
  'select.toolbar.selected': '{count} चुनी गईं',
  'select.action.delete': 'हटाएँ',
  'select.action.export': 'एक्सपोर्ट',
  'select.action.favorite': 'पसंदीदा',
  'select.action.pin': 'पिन',
  'select.action.moveFolder': 'फ़ोल्डर में ले जाएँ',
  'select.action.clear': 'चयन हटाएँ',
  'select.action.close': 'बंद करें',

  /* Settings dialog */
  'settings.title': 'सेटिंग्स',
  'settings.description':
    'सब कुछ इसी डिवाइस पर रहता है — कुछ भी कहीं अपलोड नहीं होता।',
  'settings.section.ai': 'AI फ़ीचर',
  'settings.section.backup': 'बैकअप और रीस्टोर',
  'settings.section.personal': 'पर्सनल डेटा',
  'settings.section.appearance': 'दिखावट',
  'settings.section.themeStudio': 'थीम स्टूडियो',
  'settings.section.language': 'भाषा',
  'settings.section.display': 'डिस्प्ले',
  'settings.section.storage': 'डेटा और स्टोरेज',
  'settings.section.export': 'एक्सपोर्ट',
  'settings.section.lock': 'ऐप लॉक (PIN)',
  'settings.section.shortcuts': 'कीबोर्ड शॉर्टकट',
  'settings.section.install': 'इंस्टॉल और ऑफ़लाइन',
  'settings.section.about': 'ऐप के बारे में',
  'settings.language.label': 'ऐप की भाषा',
  'settings.language.hint': 'ऐप के लेबल बदलते हैं। और भाषाएँ जल्द आ रही हैं।',

  /* Theme studio (C1 #13) */
  'theme.studio.hint':
    'थीम चुनें, एक्सेंट जोड़ें, फिर पूरा लुक प्रीसेट के रूप में सेव करें।',
  'theme.studio.presets': 'थीम',
  'theme.studio.custom': 'आपके प्रीसेट',
  'theme.studio.save': 'मौजूदा लुक प्रीसेट के रूप में सेव करें…',
  'theme.studio.namePlaceholder': 'प्रीसेट का नाम',
  'theme.studio.saveButton': 'सेव',
  'theme.studio.active': 'चालू',
  'theme.studio.delete': 'प्रीसेट हटाएँ',
  'theme.studio.confirmDelete': '“{name}” हटाएँ?',
  'theme.studio.confirmDeleteHint':
    'सिर्फ़ प्रीसेट हटेगा — आपका मौजूदा लुक वैसा ही रहेगा।',
  'theme.studio.saved': 'प्रीसेट सेव हुआ — {name}',
  'theme.studio.applied': 'प्रीसेट लागू हुआ — {name}',
  'theme.studio.deleted': 'प्रीसेट हटा दिया गया',
  'theme.studio.limit': 'प्रीसेट स्लॉट भर गए — नया सेव करने के लिए एक हटाएँ (अधिकतम 12)।',
  'theme.studio.nameRequired': 'पहले प्रीसेट को नाम दें।',
  'theme.studio.nameTaken': 'इस नाम का प्रीसेट पहले से मौजूद है।',
  'theme.studio.storageError': 'सेव नहीं हो सका — डिवाइस स्टोरेज भर गया है।',
  'theme.studio.includesWallpaper': 'वॉलपेपर',
  'theme.studio.aria.applyNamed': 'थीम लागू करें {name}',

  /* Common / shared */

  /* App shell (WhatsAppApp) — skip link, app bar, display popover */
  'shell.skipToChat': 'सीधे बातचीत पर जाएँ',
  'shell.aria.displaySettings': 'डिस्प्ले सेटिंग्स',
  'shell.aria.settingsTip': 'सेटिंग्स — बैकअप, ऐप लॉक और शॉर्टकट',
  'shell.aria.toggleDark': 'डार्क मोड टॉगल करें',
  'shell.aria.aboutHelp': 'ऐप के बारे में और सहायता',
  'shell.display.title': 'टेक्स्ट साइज़ और फ़ॉन्ट',
  'shell.display.textSize': 'पढ़ने का टेक्स्ट साइज़',
  'shell.display.textSizeHint': 'हर चैट में संदेश के टेक्स्ट पर लागू होता है।',
  'shell.display.appTheme': 'ऐप थीम',
  'shell.display.appThemeHint':
    'पूरे ऐप के रंग बदलता है — हेडर, बबल, बटन और चार्ट। लाइट और डार्क मोड दोनों के साथ काम करता है।',
  'shell.display.accent': 'एक्सेंट रंग',
  'shell.display.customColor': 'कस्टम रंग',
  'shell.display.customColorAria': 'कस्टम एक्सेंट रंग',
  'shell.display.followTheme': 'चालू थीम का पालन करें',
  'shell.display.themeDefault': 'थीम डिफ़ॉल्ट',
  'shell.display.accentHint':
    'किसी भी थीम के ऊपर बटन, हाइलाइट और हीट डॉट को रंग देता है।',
  'shell.display.auto': 'ऑटो',
  'shell.display.light': 'लाइट',
  'shell.display.dark': 'डार्क',
  'shell.display.followingDevice': 'आपके डिवाइस का पालन कर रहा है — अभी {mode}।',
  'shell.display.autoHint': 'ऑटो आपके डिवाइस की सेटिंग का पालन करता है।',
  'shell.display.chatFont': 'चैट फ़ॉन्ट',
  'shell.display.fontSample': 'नमस्ते! आप कैसे हैं?',
  'shell.display.chatFontHint':
    'चैट लिस्ट और हर बातचीत में टाइपफ़ेस बदलता है।',
  'shell.display.bubbleStyle': 'बबल स्टाइल',
  'shell.display.bubbleHint':
    'हर मैसेज बबल का आकार बदलता है — कोने नुकीले या गोल होते हैं, और कॉम्पैक्ट स्क्रीन पर ज़्यादा बातचीत दिखाता है।',
  'shell.display.clock': 'घड़ी',
  'shell.display.clockHint':
    'संदेश के समय हर जगह इसी अंदाज़ में दिखते हैं — बबल, लिस्ट, मीडिया और खोज परिणाम।',

  /* App shell — offline banner, import overlay, footer */
  'shell.offline.device':
    'आप ऑफ़लाइन हैं — सब कुछ फिर भी काम करता है, डेटा इसी डिवाइस पर रहता है।',
  'shell.offline.server':
    'आप ऑफ़लाइन हैं — हाल ही में खोली गई चैटें अब भी पढ़ी जा सकती हैं।',
  'shell.working': 'काम चल रहा है...',
  'shell.footer.importAria': 'चैट इंपोर्ट करें',
  'shell.footer.statsOne':
    '{chats} चैट · {messages} संदेश · सारा डेटा इसी डिवाइस पर रहता है',
  'shell.footer.statsMany':
    '{chats} चैट · {messages} संदेश · सारा डेटा इसी डिवाइस पर रहता है',

  /* App shell — command palette action labels */
  'shell.palette.search': 'सभी चैट में संदेश खोजें',
  'shell.palette.media': 'मीडिया हब — फ़ोटो, वीडियो, वॉइस और दस्तावेज़',
  'shell.palette.insights': 'इनसाइट्स डैशबोर्ड',
  'shell.palette.memories': 'आज के दिन की यादें',
  'shell.palette.import': 'चैट इंपोर्ट करें (.zip / .txt)',
  'shell.palette.demo': 'डेमो चैट लोड करें',
  'shell.palette.lightMode': 'लाइट मोड पर स्विच करें',
  'shell.palette.darkMode': 'डार्क मोड पर स्विच करें',
  'shell.palette.guide': 'गाइड खोलें',

  /* App shell — toasts (One/Many pairs: English count plurals) */
  'shell.toast.loadChatsFailed': 'चैट लोड नहीं हो सकीं',
  'shell.toast.demoUpgraded': 'डेमो चैटें बेहतर कहानियों के साथ अपग्रेड हुईं: {names}',
  'shell.toast.savedMissing':
    'सेव किए गए मैसेज नहीं मिले — शेयर की गई सामग्री जोड़ी नहीं गई',
  'shell.toast.savedMissingText':
    'सेव किए गए मैसेज नहीं मिले — शेयर किया गया टेक्स्ट जोड़ा नहीं गया',
  'shell.toast.shared': 'सेव किए गए मैसेज में शेयर हुआ',
  'shell.toast.sharePartialOne': 'सेव किए गए मैसेज में शेयर हुआ (1 आइटम विफल)',
  'shell.toast.sharePartialMany':
    'सेव किए गए मैसेज में शेयर हुआ ({count} आइटम विफल)',
  'shell.toast.shareFailed':
    'शेयर की गई सामग्री सेव किए गए मैसेज में सेव नहीं हो सकी',
  'shell.toast.shareTextFailed':
    'शेयर किया गया टेक्स्ट सेव किए गए मैसेज में सेव नहीं हो सका',
  'shell.toast.autoCleanedOne': '1 आर्काइव चैट ऑटो-क्लीन हुई (30+ दिन से निष्क्रिय)',
  'shell.toast.autoCleanedMany':
    '{count} आर्काइव चैटें ऑटो-क्लीन हुईं (30+ दिन से निष्क्रिय)',
  'shell.toast.offlineCached': 'ऑफ़लाइन — कैश किए गए संदेश दिखाए जा रहे हैं',
  'shell.toast.deviceStorage':
    'यह चैट डिवाइस स्टोरेज में है — खोलने के लिए सेटिंग्स में स्टोरेज मोड बदलें',
  'shell.toast.loadChatFailed': 'यह चैट लोड नहीं हो सकी',
  'shell.toast.chatDeleted': 'चैट हटा दी गई',
  'shell.toast.deleteFailed': 'यह चैट हटाई नहीं जा सकी',
  'shell.toast.pinFailed': 'पिन अपडेट नहीं हो सका',
  'shell.toast.archived': 'चैट आर्काइव हो गई',
  'shell.toast.unarchived': 'चैट आर्काइव से बाहर हो गई',
  'shell.toast.archiveFailed': 'आर्काइव अपडेट नहीं हो सका',
  'shell.toast.starFailed': 'स्टार अपडेट नहीं हो सका',

  /* App shell — import toasts */
  'shell.import.progressOf': '{index} / {total} इंपोर्ट हो रहा है...',
  'shell.import.progressFile': '{name} इंपोर्ट हो रहा है...',
  'shell.import.merged':
    '“{chat}” में मर्ज हुआ: +{added} नए, {skipped} डुप्लिकेट छोड़े गए',
  'shell.import.doneMessages': '{count} संदेश इंपोर्ट हुए',
  'shell.import.doneWithMedia':
    '{count} संदेश और {media} मीडिया फ़ाइलें इंपोर्ट हुईं',
  'shell.import.failed': 'इंपोर्ट विफल',
  'shell.import.fileFailed': '{name}: {reason}',
  'shell.import.batchOkOne': '1 चैट इंपोर्ट हुई · {messages} संदेश',
  'shell.import.batchOkMany': '{count} चैटें इंपोर्ट हुईं · {messages} संदेश',
  'shell.import.batchOkMediaOne':
    '1 चैट इंपोर्ट हुई · {messages} संदेश · {media} मीडिया फ़ाइलें',
  'shell.import.batchOkMediaMany':
    '{count} चैटें इंपोर्ट हुईं · {messages} संदेश · {media} मीडिया फ़ाइलें',
  'shell.import.batchFailed': '{count} विफल',

  'common.cancel': 'रद्द करें',
  'common.save': 'सेव',
  'common.delete': 'हटाएँ',
  'common.apply': 'लागू करें',
  'common.close': 'बंद करें',
  'common.you': 'आप',
  'common.offline.title': 'आप ऑफ़लाइन हैं',
  'common.offline.body':
    'जो चैट आपने पहले खोली थीं वे उपलब्ध रहेंगी — नए पेज लोड करने के लिए दोबारा कनेक्ट करें।',
}
