# Task 10-d — full-stack-developer (D)

## Files owned / changed
- src/components/whatsapp/MediaGallery.tsx (rewritten: tabbed gallery)
- src/components/whatsapp/Lightbox.tsx (rewritten: zoom/pan system)
- src/components/whatsapp/VoicePlayer.tsx (small edit: persistent speed)
- src/app/api/link-preview/route.ts (NEW)

## Key facts for later agents
- Lightbox props UNCHANGED (src, caption, downloadName, kind, onClose, onPrev, onNext, position, total) — MessageBubble usage still valid. Zoom state is one object {zoom,x,y}; wheel listener attached non-passive to stage; swipe nav disabled while zoom>1.
- MediaGallery tab keys: all | photos | links | docs | voice | stickers. Grid tabs (all/photos/stickers) render MediaTile grid + select mode; links/docs/voice render list rows. Text messages for Links are lazy-fetched from /api/chats/[id]/messages on first Links activation (msgsRequestedRef guard keyed by chatId, reset on gallery reopen). URL regex: /https?:\/\/[^\s<>"'`{}|\\^\[\]]+/gi + tidyUrl() trailing-punct/balanced-paren trim; dedupe per message; newest first.
- /api/link-preview: 200 {ok:true,preview:{url,title,description?,siteName?,image?}} or 200 {ok:true,preview:null} (any failure), 400 {ok:false,error} for missing/invalid/non-http(s) url. In-memory Map cache 6h TTL / 300 entries / negative results cached. runtime='nodejs'. Sandbox outbound network WORKS (verified vs example.com + github.com).
- VoicePlayer: module-level `preferredRateIdx` persists chosen speed across tracks in-session; pill h-8 (32px).
- Tab pill hit areas use before:-inset-y-2.5 pseudo-element padding (44px+ without visual bulk) — reuse this trick for other compact pills.

## Verification
- bun run lint: exit 0. bunx tsc --noEmit (filtered): clean. GET / compiles 200. dev.log clean.
- curl /api/link-preview: example.com OK, vscode repo full OG OK (799ms→6ms cached), bad host → preview:null, missing/ftp → 400.
