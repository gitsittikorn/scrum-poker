# Scrum Poker — Project Context

## Tech Stack
- **Vanilla TypeScript** (no framework) — DOM manipulation via `document.getElementById`, `createElement`
- **Vite 6.3+** — dev server + build (`src/` root, `dist/` output)
- **Firebase RTDB** — real-time database (region: asia-southeast1)
- **Firebase Anonymous Auth** — auto sign-in, no login form
- **pnpm** — package manager
- Only 1 runtime dep: `firebase`

## Source Files (`src/`)
| File | Purpose |
|------|---------|
| `src/app.ts` | Entry point: `init()` + `bindEvents()` — thin orchestrator |
| `src/types.ts` | All TypeScript interfaces (User, RoomData, ChatMessage, etc.) |
| `src/constants.ts` | CARDS, EMOJIS, APP_VERSION, TOAST_DURATION, etc. |
| `src/state.ts` | Shared mutable state object (`state.currentRoom`, `state.currentUser`, etc.) + `isPO()` |
| `src/dom.ts` | DOM element references + `$()` helper |
| `src/utils.ts` | Pure helpers: `escapeHtml`, `formatChatTime` |
| `src/ui.ts` | Theme, toast, settings modal, firework effect |
| `src/auth.ts` | Firebase auth, version check, auto-rejoin from URL |
| `src/room.ts` | Room lifecycle: join/leave/listen/delete, auto-unlock timer, beforeunload |
| `src/voting.ts` | Card rendering, vote actions, participant grouping, results, `pickSpeakers` |
| `src/chat.ts` | Chat init/destroy, messages, typing indicator, emoji picker, reply |
| `src/reactions.ts` | Live floating reactions, message reactions, quick reaction popups |
| `src/firebase.ts` | Firebase SDK init + re-exports |
| `src/index.html` | SPA: landing page + room page (chat panel, bottom bar, floating reactions) |
| `src/style.css` | Full CSS: dark/light themes, responsive, animations |

## Key Commands
- `pnpm dev` or `npx vite --host` — dev server
- `npx tsc --noEmit` — type check
- `pnpm build` or `npx vite build` — production build to `dist/`
- `firebase deploy` — deploy to Firebase Hosting (prod)

## Module Dependencies
```
types.ts ← constants.ts, state.ts, voting.ts, room.ts, chat.ts, auth.ts
state.ts ← ui.ts, auth.ts, room.ts, voting.ts, chat.ts, reactions.ts
dom.ts ← ui.ts, auth.ts, room.ts, voting.ts, chat.ts, reactions.ts, app.ts
firebase.ts ← ui.ts, auth.ts, room.ts, voting.ts, chat.ts, reactions.ts
utils.ts ← ui.ts, room.ts, voting.ts, chat.ts, reactions.ts
reactions.ts ← chat.ts
chat.ts ← room.ts, voting.ts, app.ts
voting.ts ← room.ts
room.ts ← auth.ts, app.ts
app.ts ← everything (orchestrator)
```

## Firebase RTDB Data Model
```
rooms/{roomId}/
  createdAt, revealed, locked, autoUnlockSeconds, revealTime, drinkers
  users/{uid}/ — name, role, vote, online, lastSeen
  messages/{pushId}/ — text, senderName, senderUid, senderRole, type ("user"|"system"), timestamp, replyTo
    reactions/{emoji}/{uid} — senderName (toggle on/off)
  typing/{uid}/ — name, timestamp
  liveReactions/{pushId}/ — emoji, senderName, senderUid, timestamp
```

## Features
- **Rooms**: 5 fixed rooms (Kitsune, Phoenix, UX/UI, Cold, ColdJiab)
- **Roles**: PO (admin), Dev, QA, UX/UI — PO can reveal/reset/delete
- **Voting**: 12 predefined cards + custom input, real-time via Firebase
- **Results**: Average per role, consensus check, speaker picker (min/max voter per group)
- **Chat Panel**: Side panel (right), real-time messages, typing indicator, system messages (join/leave/reveal/reset)
- **Reply/Quote**: Reply to specific messages, shows reference above bubble
- **Emoji Picker**: 40 emojis in chat input + bottom bar react picker
- **Message Reactions**: Quick reactions (👍❤️😂🤔🎉🔥) on each message, toggle on/off, real-time badges
- **Floating Reactions**: Bottom bar React → emoji floats up from bottom-left with sender name, visible to all users
- **Bottom Bar**: Fixed bar with Chat + React buttons, unread badge on Chat
- **Auto-unlock**: Timer after reveal, configurable per room
- **Themes**: Dark (default) / Light toggle

## Architecture Patterns
- Shared state via `state` object in `state.ts` (no state library)
- `onValue()` for room data, `onChildAdded` + `onChildChanged` for chat messages
- `onDisconnect()` for presence (online status + typing cleanup)
- Diff-based DOM updates for participant cards (avoid re-render flicker)
- `beforeunload` handler for cleanup
- URL params `?room=X` for room sharing + auto-rejoin from localStorage
- Firebase field `drinkers` kept for backward compat; TS code uses `speakers`/`pickSpeakers`

## Important Notes
- **DO NOT deploy without user confirmation** — prod has active users
- Test in empty rooms (Cold, ColdJiab) to avoid disturbing active sessions
- `handleLeave(skipMessage)` — pass `true` when deleting room to skip system message
- `initChat()` calls `destroyChat()` first to prevent listener stacking
- APP_VERSION change clears localStorage room (forces fresh session)
