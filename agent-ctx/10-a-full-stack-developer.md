# Task 10-a — full-stack-developer (A) — Message bubble features + replyTo DTO/API

## Scope owned
- src/components/whatsapp/MessageBubble.tsx
- src/components/whatsapp/bubble-extras.css
- src/components/whatsapp/MessageActionSheet.tsx
- src/components/whatsapp/types.ts
- src/lib/message-dto.ts
- src/app/api/chats/[id]/messages/route.ts

## What was built
1. **types.ts** — `ChatMessage` gains optional (additive only):
   - `replyTo?: { id: string; sender: string; body: string; type: string } | null`
   - `linkPreview?: { url: string; title: string; description?: string; siteName?: string; image?: string } | null`
2. **message-dto.ts** — `MESSAGE_SELECT` + `replyToId`; `ApiMessage.replyTo?: ReplyToRef | null`;
   `serializeMessage(m, replyToById?)`; **`withReplyTos(rows)`** = ONE batched
   `findMany({ where: { id: { in: replyToIds } }, select: { id, sender, body, type } })` → Map → serialize. sender normalized to `''` if null.
3. **api/chats/[id]/messages** — GET returns `{ chat, messages }` with every message carrying `replyTo`.
   POST JSON payload gains `sender?` (trimmed ≤80, default `'You'`), `replyToId?` (must belong to same chat, else ignored), `forwardedFrom?` (≤120). Multipart also accepts `replyToId`/`forwardedFrom`. Response shape unchanged: `{ message }` (now with resolved `replyTo`).
4. **MessageBubble** — quote block (jump + flash), swipe-to-reply (pointer events, 56px trigger/72px max, touch-pan-y, reduced-motion safe, composed with long-press), inline edit composer (onEditSave, outgoing text only), link preview card (prop-driven), chromeless stickers ≤192px + time pill, GIF badge, `selectionMode` merged with `selectMode` (click-select, check circle, suppress swipe/reactions/hover — existing behavior kept).
5. **MessageActionSheet** — new optional `onReply` / `onEdit` / `onSelect` rows (48px), all previous rows kept.
6. **bubble-extras.css** — `.wa-quote*`, `.wa-quote-flash`, `.wa-swipe-hint`, `.wa-sticker-host/-img/-time`, `.wa-gif-badge`, `.wa-edit-*`, `.wa-linkprev*`; --wa-* vars only; reduced-motion guards.

## Exact new prop names (contracts for B/B2)
- `MessageBubble`: `onReply?: (m: ChatMessage) => void` · `onEditSave?: (id: string, body: string) => Promise<boolean>` (true = success) · `selectionMode?: boolean` (alias of `selectMode`) · `linkPreview?: ChatMessage['linkPreview']`
- `MessageActionSheet`: `onReply?: (msg) => void` · `onEdit?: (msg) => void` · `onSelect?: (msg) => void`
- POST payload fields: `sender`, `replyToId`, `forwardedFrom` (all optional)

## Verification
- `bun run lint` → clean. `bunx tsc --noEmit` (filtered) → 0 errors in src; only pre-existing examples//skills/ errors remain.
- DTO layer exercised end-to-end with a scratch bun script + fresh PrismaClient: page pass-through (`replyTo: null` everywhere), single batched reply-target query confirmed in query log, reply resolution `{id,sender,body,type}` correct, cross-chat replyToId rejected, test rows deleted (0 leftovers).
- ⚠️ **Dev server restart required (orchestrator)**: running server holds the stale Prisma client (pre-replyToId) in memory → messages GET/POST 500 until restart. Client regenerated on disk via `bunx prisma generate` (db:push NOT run, not needed). Home page compiles 200; lint/tsc clean.
