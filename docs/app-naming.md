# App naming — decision & trademark guidance

> **✅ DECIDED (v1.4.0): the app is named "WA Archiver"** with application ID
> `io.github.avithegod2010.waarchiver` — matching the repository name
> (`Avithegod2010/WA-archiver`). Icon proposal **02 (carbon bubble)** remains
> the official app icon. v1.3.0 briefly renamed the app "Chat Archiver"
> (appId `io.github.avithegod2010.chatarchiver`); v1.4.0 returned to the
> repo-matching name after a name-safety review confirmed "WA Archiver"
> carries no copyright issues and lower trademark exposure than either
> "WhatsApp Viewer" or store-blocking risks.
>
> The original working title was "WhatsApp Viewer" (appId `com.whatsappviewer.app`) — see
> the trademark section below for why that had to change.

## ⭐ Top 3 picks

| # | Name | Why it works |
|---|------|--------------|
| 1 | **Charchive** | Chat + archive. Unique, brandable, describes the app in one word. Domain/repo friendly. |
| 2 | **Scrollback** | A real word (from terminal culture) meaning "scrolling back through history" — exactly what the app does. |
| 3 | **Rechat** | "re-" + chat: read your chats again. Short, memorable, easy to say. |

## All 20 candidates

| # | Name | Rationale |
|---|------|-----------|
| 1 | Charchive | Chat + archive portmanteau; instantly explains the purpose |
| 2 | Scrollback | Established term for browsing history; technical, nostalgic feel |
| 3 | Rechat | Read chats again; short & catchy |
| 4 | ChatVault | Your chats kept safe, locally |
| 5 | Chatkeeper | The keeper/custodian of your chat history |
| 6 | BubbleLog | Chat bubbles + log file — the two core concepts |
| 7 | ChatRelive | Relive old conversations & memories |
| 8 | ArchiveLens | A lens to look inside your chat archives |
| 9 | ChatPeek | A quick peek into your exports |
| 10 | Backchat | Real English word; playful double meaning |
| 11 | ChatTrail | Follow the trail of your conversations |
| 12 | MsgVault | Message vault; avoids the word "chat" entirely |
| 13 | ChatFossil | Fun: your old messages, perfectly preserved |
| 14 | PastChat | Simple and literal |
| 15 | ChatScope | Inspect & analyze chats (matches the Insights feature) |
| 16 | ChatStory | Your chats told as a story |
| 17 | LogChat | Literal, clean, easy to spell |
| 18 | ChatMem | Short for "chat memories" |
| 19 | OpenChatlog | FOSS flavor + literal description |
| 20 | Chatterbook | Like a logbook/phonebook of your chatter |

**Before committing to a name**, check that it is free as: GitHub repo name, app
display name, and (if you ever go wider) a Play Store listing. A suggested
application ID pattern for F-Droid friendliness: `io.github.avithegod2010.<name>`.

## ⚠️ Can the name contain "WhatsApp"?

**Short answer: no — remove it from the app *name* before publishing to IzzyOnDroid or F-Droid.**

Details (not legal advice, just the practical picture):

- **"WhatsApp" is a trademark of Meta Platforms.** Naming an unrelated third-party
  app "WhatsApp …" creates impersonation/confusion risk. Meta actively enforces
  its marks against chat-related apps.
- **Google Play** (relevant later): apps using "WhatsApp" in the title or even the
  *package name* are routinely removed under the impersonation & IP policies. A
  package/application ID containing `whatsapp` (like the current
  `io.github.avithegod2010.waarchiver`) is itself a liability if we ever target Play.
- **F-Droid**: does not mechanically reject trademarked names at submission, but
  its inclusion guidance requires respecting third-party trademarks, and apps are
  removed/renamed when a trademark holder complains. Reviewers commonly ask for
  a rename during review. You *could* get away with it for a while — it's a
  ticking box, not a wall.
- **IzzyOnDroid**: no automated trademark scan (our current scan result was about
  trackers/FOSS licensing, which passed), but Izzy follows the spirit of Play
  policy and will act on valid complaints. A clean name avoids the argument
  entirely.

### The safe pattern (what other FOSS apps do)

| Place | Use "WhatsApp"? |
|---|---|
| App display name | ❌ Never |
| Application ID / package | ❌ Never |
| Repo name (`WA-archiver`) | ⚠️ Gray — "WA" abbreviation is widely used by third-party tools and low-risk, fine to keep |
| App description | ✅ Yes — descriptive/nominative fair use: *"Reads chat logs **exported from WhatsApp**"* is exactly how it should be phrased |
| FAQ / disclaimer | ✅ Yes — our README + PRIVACY.md already carry the non-affiliation disclaimer |

### Recommended plan

1. Pick a name from the list above (rename decision is yours).
2. Before the next release (it's a breaking change — do it in one go):
   - Change application ID `io.github.avithegod2010.waarchiver` → `io.github.avithegod2010.<name>`
   - Update fastlane `title.txt` / `short_description.txt` / `full_description.txt`
   - Update PWA `manifest.webmanifest` `name`/`short_name`, Capacitor app name, README banner/tagline
3. Keep every mention of WhatsApp in *descriptions only*, always phrased as
   "exported WhatsApp chats" (descriptive use), and keep the non-affiliation
   disclaimer.
4. Repo can stay `WA-archiver`, or be renamed to match the chosen name — GitHub
   redirects old links automatically after a repo rename.
