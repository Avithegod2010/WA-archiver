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

  /* Chats list (tabs convert in a follow-up wave — ChatList is stable) */
  'chats.title': 'चैट',
  'chats.tab.all': 'सभी',
  'chats.tab.unread': 'अपठित',
  'chats.tab.groups': 'ग्रुप',
  'chats.tab.favorites': 'पसंदीदा',
  'chats.empty': 'अभी कोई चैट नहीं',

  /* Bulk-select toolbar (future use — ChatList) */
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
  'common.cancel': 'रद्द करें',
  'common.save': 'सेव',
  'common.delete': 'हटाएँ',
  'common.apply': 'लागू करें',
  'common.close': 'बंद करें',
  'common.offline.title': 'आप ऑफ़लाइन हैं',
  'common.offline.body':
    'जो चैट आपने पहले खोली थीं वे उपलब्ध रहेंगी — नए पेज लोड करने के लिए दोबारा कनेक्ट करें।',
}
