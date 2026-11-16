# Scrum Poker — Project Context

> Architecture diagrams (Mermaid) อยู่ที่ `docs/architecture.md`

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
| `src/state.ts` | Shared mutable state object (`state.currentRoom`, `state.currentUser`, etc.) + `isPO()` + `isRoomAdmin()` (PO + deputy เช่น Dev Cing: สิทธิ์เหมือน PO ทุกอย่างในห้อง — ตั้งค่า, reveal/reset/unlock, เตะ, โหมด groom/pre, บันทึก ClickUp, ลบห้อง, ล้างประวัติ/ตัวนับพูด — ตาม realName/uid จาก constants) |
| `src/dom.ts` | DOM element references + `$()` helper |
| `src/utils.ts` | Pure helpers: `escapeHtml`, `formatChatTime` |
| `src/ui.ts` | Theme, toast, settings modal, firework effect |
| `src/auth.ts` | Firebase auth, version check, auto-rejoin from URL |
| `src/room.ts` | Room lifecycle: join/leave/listen/delete, auto-unlock timer, beforeunload |
| `src/roomReset.ts` | Logic กลางล้างรอบโหวตทั้งห้อง (โหวต/reveal/lock/ลำโพง/speakerCounts) — ใช้ร่วมระหว่างปุ่ม Reset (voting) กับเคลียร์ task (clickup) |
| `src/voting.ts` | Card rendering, vote actions, participant grouping, results, `pickSpeakers` |
| `src/chat.ts` | Chat init/destroy, messages, typing indicator, emoji picker, reply |
| `src/reactions.ts` | Live floating reactions, message reactions, quick reaction popups |
| `src/members.ts` | Member registry (`members/` node): listener + cache (hydrate จาก localStorage ทันทีตอนโหลด + retry/watchdog ถ้า listener ค้าง), CRUD, name lookup per role |
| `src/couponCalc.ts` | คูปองส่วนลด TA — engine คำนวณ + validation 17 ข้อ (pure module พอร์ตสูตร Excel coupon-uat/references, ไม่แตะ DOM/Firebase) |
| `src/couponTestdata.ts` | Test Cases 24 เคส + expected values จากไฟล์ Excel "UAT คูปองส่วนลด TA(BOTH).xlsx" |
| `src/couponUat.ts` | หน้า Coupon UAT: เครื่องคำนวณ + test runner — tab ใน Super Admin Panel + standalone `?coupon=1` (มิเรอร์ pattern qaTool.ts) |
| `src/firebase.ts` | Firebase SDK init + re-exports |
| `src/index.html` | SPA: landing page + room page (chat panel, bottom bar, floating reactions) |
| `src/style.css` | Full CSS: dark/light themes, responsive, animations |
| `src/__tests__/` | Vitest: unit (utils, permissions) + DOM integration (updateUI/renderCards ผ่าน happy-dom + mock Firebase) |
| `e2e/features.e2e.mjs` | Playwright E2E (req reminders/wheel/wording) — รันกับ dev server + ห้อง Cold, ล้างห้องอัตโนมัติ |

## Key Commands
- `pnpm dev` or `npx vite --host` — dev server
- `npx tsc --noEmit` — type check
- `pnpm build` or `npx vite build` — production build to `dist/`
- `pnpm test` — unit + integration tests (vitest) · `pnpm test:watch` — watch mode
- `pnpm test:e2e` — Playwright E2E ฟีเจอร์ห้อง (ต้องรัน dev server :5173 ก่อน — ใช้ห้อง Cold)
- `pnpm test:e2e:save` — Playwright E2E บันทึก ClickUp ครบวงจร (ต้องมี dev server + backend :3000 + token; สร้างการ์ด `[E2E-TEST]` ใน Kitsune Sprint แล้วลบคืนตอนจบ)
- `pnpm test:e2e:noneedtest` — Playwright E2E No Need Test (tag + comment format + ไม่แตะ QA field; self-cleaning เหมือนชุด save)
- `firebase deploy` — deploy to Firebase Hosting (prod)

## Backend (ClickUp proxy — backend/)
- Express thin proxy: local `cd backend && node server.js` (:3000) · prod = Firebase Cloud Function `api` (asia-southeast1)
- Setup: `pnpm install` ที่ root ครั้งเดียว — backend เป็น workspace package (ดู `pnpm-workspace.yaml` → `packages: [backend]`)
- คัดลอก `backend/.env.example` → `backend/.env` แล้วใส่ `CLICKUP_API_TOKEN` (ไม่มี token = backend รันได้แต่ route ClickUp ทุกตัวพัง)
- `node backend/clickup-smoke.js` — E2E ดึง task จริง (ต้องมี dev server + backend + token; browser หาอัตโนมัติจาก ms-playwright)
- `cd backend && npm test` — backend integration tests (node:test + mock ClickUp API บน 127.0.0.1 ผ่าน `CLICKUP_API_BASE` — ไม่ยิง ClickUp จริง)

## Module Dependencies
```
types.ts ← constants.ts, state.ts, voting.ts, room.ts, chat.ts, auth.ts
constants.ts ← state.ts (isRoomAdmin deputy config), ui.ts, auth.ts, room.ts, voting.ts, chat.ts
state.ts ← ui.ts, auth.ts, room.ts, voting.ts, chat.ts, reactions.ts
dom.ts ← ui.ts, auth.ts, room.ts, voting.ts, chat.ts, reactions.ts, app.ts
firebase.ts ← ui.ts, auth.ts, room.ts, voting.ts, chat.ts, reactions.ts
utils.ts ← ui.ts, room.ts, voting.ts, chat.ts, reactions.ts, clickup.ts (buildGroomingComment = pure, test ได้)
roomReset.ts ← voting.ts, clickup.ts (ไฟล์กลาง — กัน cycle เพราะ clickup ห้าม import voting)
members.ts ← admin.ts, app.ts, room.ts, wheel.ts
couponCalc.ts ← couponTestdata.ts, couponUat.ts (pure — ไม่พึ่งโมดูลอื่น)
couponUat.ts ← admin.ts, app.ts
reactions.ts ← chat.ts
chat.ts ← room.ts, voting.ts, app.ts
voting.ts ← room.ts, clickup.ts (renderTaskBanner/updateTaskRequiredReminder)
room.ts ← auth.ts, app.ts
app.ts ← everything (orchestrator)
```

## Firebase RTDB Data Model
```
rooms/{roomId}/
  createdAt, revealed, locked, autoUnlockSeconds, revealTime, drinkers
  users/{uid}/ — name (ชื่อเล่น), realName (ชื่อจริงจาก member list, nullable), role, vote, online, lastSeen
  messages/{pushId}/ — text, senderName, senderUid, senderRole, type ("user"|"system"), timestamp, replyTo
    reactions/{emoji}/{uid} — senderName (toggle on/off)
  typing/{uid}/ — name, timestamp
  liveReactions/{pushId}/ — emoji, senderName, senderUid, timestamp

members/{pushId}/ — name, role ("po"|"dev"|"qa"|"ux")  ← ถาวร อยู่นอก rooms/ (รอด clear-all)
```

## Features
- **Rooms**: 6 squad rooms (Kitsune, Phoenix, Raiju, UX/UI, Cold, ColdJiab)
- **Real Name (ClickUp identity)**: ฟอร์มหน้าแรก = ชื่อในวงการ + Role + ชื่อสำหรับระบุตัวตนใน ClickUp (dropdown กรองตาม role จาก member list — บังคับเฉพาะ Kitsune/Phoenix/Raiju/UXUI/Cold/ColdJiab; Wheel/TQM1/TQM2/admin ใช้ฟอร์มเดิม) → ClickUp attendees ใช้ `realName ?? name`, ห้อง poker/wheel ในห้อง poker แสดงชื่อเล่น, ห้อง Wheel แสดงชื่อจริงจาก member list
- **Member list (super admin tab Member)**: 5 คอลัมน์ PO/Dev/QA/UX/UI/Monkey King เพิ่ม/ลบ/แก้ไข เรียง a-z — เก็บถาวรที่ `members/` ไม่โดนลบตอนเคลียร์ข้อมูลทั้งหมด; `mk` (Monkey King) เป็น bucket ทีมสำหรับห้อง Wheel เท่านั้น ไม่ใช่ role จริง (คนหนึ่งมี entry ซ้อน 2 คอลัมน์; All ใน wheel dedupe ชื่อ); แก้/ลบระหว่างเซสชัน คนในห้องใช้ชื่อ snapshot จนจบเซสชัน; ห้อง Wheel ดึง entries จากตรงนี้แยกตาม role (dropdown All/PO/Dev/QA/UX/UI/Monkey King) และ**ไม่แสดง section ดึง task ClickUp**
- **Roles**: PO (admin), Dev, QA, UX/UI — PO can reveal/reset/delete
- **No Need checkboxes (admin ของห้อง)**: ผูกกับ task ปัจจุบัน (default unchecked + disabled จนกว่าจะดึง task, reset เมื่อดึงใหม่/เคลียร์/บันทึกจบรอบ — sync ทั้งห้องผ่าน `rooms/{roomId}/<flag>`):
  - **No Need Test** (`noNeedTest`) — ตัด QA: การ์ดล็อค + เคลียร์ point QA + reveal/save ไม่นับ QA + comment "QA: no need test" + **ติด tag "no need test" ใน ClickUp**
  - **No Need Dev** (`noNeedDev`) — เหมือนกันแต่ฝั่ง Dev + comment "Dev: no need dev" + **ไม่ติด tag** (backend ไม่เขียน/ไม่ทับ Dev custom field เมื่อส่ง `dev: null`)
  - **No Need UX/UI** (`noNeedUx`) — เหมือนกันแต่ฝั่ง UX/UI (ไม่มีผลกับ ClickUp — UX ไม่มี custom field) + **ไม่ติด tag**
  - ตอนติ๊ก: เคลียร์ point ของ role นั้นทันที (atomic กับการเขียน flag) · deputy (Dev Cing) ก็ถูกล็อคการ์ดเมื่อ No Need Dev ทำงาน (โหวตในฐานะ dev)
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

## PO Access & Deputy (สิทธิ์ผู้ดูแลห้อง) — AI อ่านก่อนแตะเรื่องสิทธิ์
> Requirement จากเจ้าของโปรเจกต์: **deputy ต้องได้สิทธิ์เหมือน PO ทุกอย่างในห้อง** — ถ้าเพิ่มสิทธิ์ใหม่ให้ PO ต้องให้ deputy ด้วยเสมอ

**กลไก:** `isPO()` (role po/admin) ⊂ `isRoomAdmin()` (PO + deputy) — ฟีเจอร์ในห้อง poker ทุกอย่าง **gate ด้วย `isRoomAdmin()` เท่านั้น** (อย่าใช้ `isPO()` กับสิทธิ์ใหม่) · ตัวตน deputy ตรวจ uid จาก `PO_DEPUTY_UIDS` ก่อน แล้ว realName จาก `PO_DEPUTY_REAL_NAMES` (ต้อง join เป็น role **dev** เท่านั้น) — ทั้งคู่อยู่ที่ `src/constants.ts`

**สิทธิ์ PO/deputy ครบทุกอย่าง (อัปเดต 2026-11-16):**
- ส่วนตั้งค่า (settings modal): auto-unlock, การ์ด custom ทั้งห้อง
- Reveal / Reset / Unlock ก่อนครบเวลา / เตะคนออก (ปุ่มบนการ์ดสมาชิก)
- สลับโหมด **Groom / Pre-Groom** (toggle + `handleSetGroomMode`)
- **บันทึก point ลง ClickUp** (ปุ่ม + `handleSaveToClickUp`)
- ดึง/เคลียร์ task ClickUp · นำ task เก่ามา groom ใหม่ · ล้างประวัติ task ทั้งหมด
- Toggle No Need Task / No Need Test / No Need Dev / No Need UX/UI / Hot Fix
- **ลบห้อง** (bottom bar + ใน settings) · ล้างตัวนับพูด (speaker rotate)
- เห็นแถบเตือน "ยังไม่ได้เลือกการ์ด" (task-required reminder)

**เพิ่ม deputy คนใหม่:** แก้ `PO_DEPUTY_REAL_NAMES` (ชื่อจริงตาม member list) หรือ `PO_DEPUTY_UIDS` (ล็อกตามเครื่อง) ที่ `src/constants.ts` — สิทธิ์ทั้งหมดข้างบนมาอัตโนมัติ ไม่ต้องแต้จุดอื่น · ทดสอบ: `src/__tests__/permissions.test.ts` + describe "Dev Cing (deputy)" ใน noNeedCheckboxes/updateUI

**ข้อสังเกต:** deputy ยังต้องโหวตเหมือน dev ปกติ (นับเป็นผู้โหวตใน reveal gate และ last-voter) · สิทธิ์เป็น client-side gate ทั้งหมด (DB ไม่มี rules แยกตาม role) · Super Admin console (`isSuperAdmin`) เป็นคนละระบบ ไม่เกี่ยวกับ PO

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
