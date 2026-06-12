# 🃏 Scrum Poker

เว็บ Planning Poker สำหรับทีม Agile — ใช้ร่วมกันได้หลายคนแบบ real-time ผ่าน Firebase

**🔗 URL:** https://scrum-poker-5fbac.web.app

---

## ✨ ฟีเจอร์

| หมวด | ฟีเจอร์ | รายละเอียด |
|------|---------|-------------|
| 🃏 **Poker** | ไพ่โหวต 12 ใบ | คะแนน 0 – 21 + พิมพ์เลขเอง (สูงสุด 5 ตัวอักษร) |
| | 👁 Reveal | PO เปิดเผยคะแนน + แสดงค่าเฉลี่ยแยกตาม Role |
| | 🔓 Auto-unlock | หลัง Reveal สมาชิกเปลี่ยนคะแนนได้เอง (ตั้งเวลาใน Settings) |
| | 🔄 Reset | PO เริ่มรอบโหวตใหม่ |
| 💬 **Chat** | Real-time Chat | แชทสดพร้อม Typing Indicator |
| | ↩ Reply/Quote | ตอบกลับข้อความเฉพาะเจาะจง |
| | 😀 Emoji Picker | 40 อิโมจิให้เลือก |
| | 👍 Message Reactions | รีแอกต์ใต้ข้อความ (👍❤️😂🤔🎉🔥) toggle on/off |
| | 🤖 System Messages | แจ้งเตือนอัตโนมัติ (เข้าร่วม/ออก/Reveal/Reset) |
| 😀 **React** | 🎈 Floating Reactions | อิโมจิลอยขึ้นจากด้านล่างพร้อมชื่อผู้ส่ง (ทุกคนเห็น) |
| | ⚡ Quick Reactions | กดรีแอกต์เร็วจาก Bottom Bar |
| 🔊 **Sound** | 🎵 Sound Effects | เลือกเล่นเสียงฮา ๆ ได้ 25 เสียง |
| | 🔇 Mute Others | ปิดเสียงจากคนอื่นได้ใน Settings |
| 🎡 **Wheel** | 🎲 Random Wheel | กงล้อสุ่มชื่อสมาชิก |
| | ✏️ Custom Entries | เพิ่ม/ลบรายชื่อเอง หรือดึงจากสมาชิกในห้อง |
| | ⚙️ Wheel Options | Duplicate (1×–5×), ลบผู้ถูกสุ่ม, รวม/ไม่รวม PO |
| | 🔀 Controls | Shuffle · Reset · Clear |
| 🛡️ **Admin** | 🔐 Super Admin Panel | ห้อง admin (ซ่อน) สำหรับ Super Admin |
| | 🚩 Feature Permissions | เปิด/ปิด feature แต่ละห้อง (Poker, Chat, React, Sound, Wheel) |
| | 📊 Database Report | ดูการใช้งาน Database |
| | ⏰ Auto Cleanup | ตั้งเวลาลบข้อมูลทุกห้องอัตโนมัติทุกวัน |
| | 🗑 Clear All | เคลียร์ข้อมูลทุกห้องทันที |
| 🎨 **อื่น ๆ** | 🌗 Dark/Light Theme | สลับธีมจากหัวข้อห้อง |
| | 🚩 PO Feature Flags | PO เปิด/ปิด feature ได้เองในแต่ละห้อง |
| | 📱 Responsive | ใช้งานได้ทั้งมือถือและ desktop |
| | 🔑 Anonymous Auth | ไม่ต้องลงทะเบียน เข้าใช้ได้เลย |

---

## 🚀 วิธีใช้งาน

| ลำดับ | ขั้นตอน |
|:-----:|---------|
| 1️⃣ | เปิดเว็บ → ใส่ชื่อ (สูงสุด 15 ตัวอักษร) → เลือก Role → เลือกห้อง → กด **เข้าร่วมห้อง** |
| 2️⃣ | เลือกคะแนนจากไพ่ หรือพิมพ์เลขเอง (กด Enter เพื่อ submit) |
| 3️⃣ | รอทุกคนโหวตเสร็จ → PO กด **Reveal** เปิดเผยคะแนน |
| 4️⃣ | ระบบนับถอยหลัง auto-unlock → สมาชิกเปลี่ยนคะแนนได้เอง |
| 5️⃣ | PO กด **Reset** เพื่อเริ่มรอบใหม่ |

---

## 🏠 ห้องที่มี

| ไอคอน | ห้อง | หมายเหตุ |
|:-----:|------|----------|
| 🦊 | Kitsune | — |
| 🔥 | Phoenix | — |
| 🎨 | UX/UI | — |
| ❄️ | ห้องเย็น | 🧪 ใช้ทดสอบได้ |
| 🥶 | ห้องเย็นเจี๊ยบ | 🧪 ใช้ทดสอบได้ |
| 🛡️ | admin | 🔒 ซ่อน (Super Admin เท่านั้น) |

---

## 👥 Role & สิทธิ์

| Role | โหวต | แชท | React | Sound | Wheel | Reveal/Reset | ลบห้อง | Feature Flags | Admin Panel |
|:----:|:-----:|:----:|:-----:|:-----:|:-----:|:------------:|:------:|:------------:|:-----------:|
| 📋 PO | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 👨‍💻 Dev | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| 🐛 QA | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| 🎨 UX/UI | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| 🛡️ Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 🛠️ Tech Stack

| เทคโนโลยี | ประเภท | รายละเอียด |
|-----------|:------:|-------------|
| 🟦 **TypeScript** | Language | Vanilla TS (ไม่ใช้ framework) — DOM manipulation |
| ⚡ **Vite 6.3+** | Bundler | Dev server + Build (`src/` → `dist/`) |
| 🔥 **Firebase RTDB** | Database | Real-time Database (region: `asia-southeast1`) |
| 🔑 **Firebase Auth** | Auth | Anonymous Auth — auto sign-in ไม่ต้องล็อกอิน |
| 📦 **pnpm** | Package Manager | Fast, disk-efficient |

### Dependencies

| ประเภท | Package | เวอร์ชัน |
|--------|---------|----------|
| 🔴 Runtime | `firebase` | ^11.7.1 |
| 🔵 Dev | `typescript` | ^5.7.0 |
| 🔵 Dev | `vite` | ^6.3.0 |

---

## 📁 โครงสร้างไฟล์ (`src/`)

| ไฟล์ | หมวด | หน้าที่ |
|------|:----:|---------|
| `app.ts` | 🚪 Entry | `init()` + `bindEvents()` — orchestrator หลัก |
| `types.ts` | 📐 Types | TypeScript interfaces ทั้งหมด |
| `config.ts` | ⚙️ Config | Feature flags, ค่า default ต่าง ๆ |
| `constants.ts` | 📋 Constants | CARDS, EMOJIS, SOUNDS, APP_VERSION |
| `state.ts` | 🗃️ State | Shared mutable state (`currentRoom`, `currentUser`, …) |
| `dom.ts` | 🖥️ DOM | DOM element references + `$()` helper |
| `utils.ts` | 🔧 Utils | Pure helpers: `escapeHtml`, `formatChatTime` |
| `ui.ts` | 🎨 UI | Theme, toast, settings modal, firework effect |
| `auth.ts` | 🔑 Auth | Firebase auth, version check, auto-rejoin |
| `room.ts` | 🏠 Room | Room lifecycle: join/leave/listen/delete, auto-unlock timer |
| `voting.ts` | 🃏 Voting | Card rendering, vote, participant grouping, results |
| `chat.ts` | 💬 Chat | Chat init/destroy, messages, typing, emoji picker, reply |
| `reactions.ts` | 😀 React | Floating reactions, message reactions, quick popups |
| `firebase.ts` | 🔥 Firebase | SDK init + re-exports |
| `index.html` | 📄 HTML | SPA: landing page + room page |
| `style.css` | 🎨 CSS | dark/light themes, responsive, animations |

---

## 🧪 คำสั่ง

| คำสั่ง | Action | รายละเอียด |
|--------|:------:|-------------|
| `pnpm dev` | ▶️ Run | Dev server (hot-reload) |
| `pnpm build` | 📦 Build | Production build → `dist/` |
| `pnpm preview` | 👁 Preview | Preview production build |
| `npx tsc --noEmit` | 🔍 Check | Type check |
| `firebase deploy` | 🚀 Deploy | Deploy to Firebase Hosting (prod) |

---

## 🔧 ตั้งค่า (`config.ts`)

แก้ไขไฟล์ `src/config.ts` แล้ว refresh browser ได้เลย:

| Variable | Default | รายละเอียด |
|----------|---------|-------------|
| `FEATURES.poker` | `true` | 🃏 ไพ่โหวต, Reveal, Reset |
| `FEATURES.chat` | `true` | 💬 แชท, typing indicator |
| `FEATURES.react` | `true` | 😀 floating emoji |
| `FEATURES.sound` | `true` | 🔊 เอฟเฟกต์เสียง |
| `FEATURES.wheel` | `true` | 🎡 กงล้อสุ่ม |
| `AUTO_UNLOCK_SECONDS` | `30` | 🔓 วินาที auto-unlock หลัง reveal |
| `CHAT_MESSAGE_LIMIT` | `100` | 💬 จำนวนแชทสูงสุดที่โหลด |
| `FLOATING_EMOJI_DURATION_MS` | `5000` | 🎈 ระยะเวลา floating emoji (ms) |
| `TYPING_TIMEOUT_MS` | `3000` | ⌨️ ระยะเวลา typing indicator (ms) |
| `TYPING_DISPLAY_MS` | `15000` | 👁 ระยะเวลา keep-alive typing (ms) |
| `SOUND_VOLUME` | `0.6` | 🔉 ระดับเสียง (0.0 – 1.0) |

---

## 🗄️ Firebase RTDB Data Model

| Path | Fields | รายละเอียด |
|------|--------|-------------|
| `rooms/{roomId}/` | `createdAt`, `revealed`, `locked`, `autoUnlockSeconds`, `revealTime`, `drinkers` | ข้อมูลห้อง |
| `rooms/{roomId}/users/{uid}/` | `name`, `role`, `vote`, `online`, `lastSeen` | สมาชิกในห้อง |
| `rooms/{roomId}/messages/{pushId}/` | `text`, `senderName`, `senderUid`, `senderRole`, `type`, `timestamp`, `replyTo` | ข้อความแชท |
| `rooms/{roomId}/messages/{pushId}/reactions/{emoji}/{uid}/` | `senderName` | รีแอกต์บนข้อความ (toggle on/off) |
| `rooms/{roomId}/typing/{uid}/` | `name`, `timestamp` | Typing indicator |
| `rooms/{roomId}/liveReactions/{pushId}/` | `emoji`, `senderName`, `senderUid`, `timestamp` | Floating reactions |

---

## ⚠️ Notes

| หัวข้อ | รายละเอียด |
|--------|-------------|
| 🚫 Deploy | ห้าม deploy โดยไม่ได้รับอนุญาต — production มีผู้ใช้งานจริง |
| 🧪 Testing | ทดสอบในห้องว่าง (❄️ ห้องเย็น, 🥶 ห้องเย็นเจี๊ยบ) เพื่อไม่รบกวนการใช้งานจริง |
| 🔗 URL Sharing | `?room=X` สำหรับแชร์ลิงก์ห้อง + auto-rejoin จาก localStorage |
| 🔄 Version | `APP_VERSION` เปลี่ยน = localStorage ถูกเคลียร์ (บังคับ session ใหม่) |

---

## 📄 License

MIT
