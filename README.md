# 🃏 Scrum Poker

เว็บ Planning Poker สำหรับทีม Agile — ใช้ร่วมกันได้หลายคนแบบ real-time

**URL:** https://scrum-poker-5fbac.web.app

---

## วิธีใช้งาน

1. เปิดเว็บ → ใส่ชื่อ (สูงสุด 15 ตัวอักษร) → เลือก Role → เลือกห้อง → กด **เข้าร่วมห้อง**
2. เลือกคะแนนจากไพ่ หรือพิมพ์เลขเอง (กด Enter เพื่อ submit, สูงสุด 5 ตัวอักษร)
3. รอทุกคนโหวตเสร็จ → PO กด **Reveal** เปิดเผยคะแนน
4. ระบบจะนับถอยหลัง auto-unlock อัตโนมัติ สมาชิกสามารถเปลี่ยนคะแนนได้โดยไม่ต้องรอ PO ปลดล็อค
5. PO กด **Reset** เพื่อเริ่มรอบใหม่

---

## ห้องที่มี

| ห้อง | ชื่อ |
|---|---|
| Kitsune | Kitsune |
| Phoenix | Phoenix |
| UX/UI | UX/UI |
| ห้องเย็น | ห้องเย็น |
| ห้องเย็นเจี๊ยบ | ห้องเย็นเจี๊ยบ |

---

## Role

| Role | Icon | สี |
|---|---|---|
| PO | 📋 | ส้ม |
| Dev | 👨‍💻 | ฟ้า |
| QA | 🐛 | ม่วง |
| UX/UI | 🎨 | ชมพู |

Role ใช้แยกคอลัมน์สมาชิก + คำนวณค่าเฉลี่ยแยกตาม role

---

## ไพ่คะแนน

### แถว 1
| 0 | 0.1 | 0.3 | 0.5 | 1 | 2 | 3 |
|---|---|---|---|---|---|---|
| Free | 24 นาที | 1 ชั่วโมง | 2 ชั่วโมง | 4 ชั่วโมง | 1 วัน | 1.5 วัน |

### แถว 2
| 4 | 5 | 8 | 13 | 21 | กำหนดเอง |
|---|---|---|---|---|---|
| 2 วัน | 2.5 วัน | 4 วัน | ผีหลอก | เสร็จกันยา | พิมพ์เลขเอง (สูงสุด 5 ตัวอักษร) |

---

## สิทธิ์ตาม Role

| การกระทำ | PO | Dev | QA | UX/UI |
|---|---|---|---|---|
| โหวตเลือกคะแนน | ✅ | ✅ | ✅ | ✅ |
| 🎡 ใช้ Random Wheel | ✅ | ✅ | ✅ | ✅ |
| 💬 ใช้ Chat | ✅ | ✅ | ✅ | ✅ |
| 😀 ส่ง Reaction | ✅ | ✅ | ✅ | ✅ |
| 🔊 ส่งเสียง | ✅ | ✅ | ✅ | ✅ |
| 📊 ดู Database Usage | ✅ | ✅ | ✅ | ✅ |
| 👁 Reveal เปิดเผยคะแนน | ✅ | — | — | — |
| 🔄 Reset เคลียร์คะแนน | ✅ | — | — | — |
| 🗑 ลบห้อง | ✅ | — | — | — |
| ⚙️ ตั้งค่าห้อง | ✅ | — | — | — |

---

## 🎡 Random Wheel (กงล้อสุ่มชื่อ)

สุ่มชื่อสมาชิกในห้อง ดึงรายชื่อจาก Firebase อัตโนมัติ

### วิธีใช้
1. กดปุ่ม 🎡 **Wheel** ที่ Bottom Bar
2. Panel จะ slide ออกมาจากด้านซ้าย พร้อมกงล้อแสดงรายชื่อสมาชิก
3. กด **🎡 Spin** เพื่อสุ่ม — กงล้อหมุน 5 วินาที พร้อมเสียง tick
4. เมื่อหมุนเสร็จ แสดงผู้ถูกสุ่ม + เสียง "แกไม่รอดแน่" + จุดไฟฉลอง
5. รายชื่อที่ถูกสุ่มจะถูกลบออกจากกงล้ออัตโนมัติ

### ปุ่มควบคุม
| ปุ่ม | ทำงาน |
|---|---|
| 🎡 **Spin** | สุ่มผู้โชคดี |
| 🔀 **Shuffle** | สลับตำแหน่งชื่อบนกงล้อ |
| 🔄 **เริ่มใหม่** | ดึงรายชื่อสมาชิกจาก Firebase ใหม่ |
| 🗑 **Clear** | ลบรายชื่อทั้งหมด |

### ตัวเลือก
- **Duplicate** — เพิ่มชื่อซ้ำ (2×-5×) เพื่อเพิ่มโอกาสถูกสุ่ม
- **ลบผู้ถูกสุ่ม** — เปิดแล้วชื่อที่ถูกสุ่มจะหายจากกงล้ออัตโนมัติ
- **สุ่มตำแหน่งอัตโนมัติ** — shuffle ตำแหน่งทุกรอบก่อนหมุน ป้องกันเดาล่วงหน้า

### จัดการรายชื่อ
- เพิ่มชื่อใหม่ได้ (สูงสุด 15 ตัวอักษร)
- ลบ / แก้ไขชื่อแต่ละรายการได้
- ลากขอบขวาของ panel เพื่อปรับความกว้าง (320-800px)

---

## 💬 Chat

แชท real-time ด้านขวา กดปุ่ม 💬 **Chat** ที่ Bottom Bar เพื่อเปิด/ปิด

- ส่งข้อความ + emoji picker (40 emoji)
- ตอบกลับ (Reply/Quote) ข้อความได้
- ข้อความระบบ: แจ้งเตือนเข้า/ออก/Reveal/Reset อัตโนมัติ
- Typing indicator แบบ real-time
- แสดงผู้อ่านไม่หมด (unread badge)

---

## 😀 Reactions

ส่ง emoji ลอยขึ้นจากด้านล่าง ทุกคนในห้องเห็นแบบ real-time

- กด **React** ที่ Bottom Bar → เลือก emoji
- กด ❤️😂🤔 ฯลฯ ที่ข้อความแชทได้ (message reactions)

---

## 🔊 Sound Effects

ส่งเสียงเอฟเฟกต์ให้ทุกคนในห้องได้ยิน (เสียง 15 เสียง)

---

## ปุ่มควบคุม

### หน้าโหวต (กลางจอ) — เฉพาะ PO

| ปุ่ม | ทำงาน |
|---|---|
| 👁 **Reveal** | เปิดเผยคะแนนทั้งหมด + ล็อคโหวต + เริ่มนับถอยหลัง auto-unlock |
| 🔄 **Reset** | เคลียร์คะแนนทั้งหมด + เตะคน offline ออกจากห้อง |

### Auto-unlock

หลังจาก PO กด Reveal ระบบจะนับถอยหลัง (default 20 วินาที):
- **ครบเวลา** → ปลดล็อคอัตโนมัติ สมาชิกเปลี่ยนคะแนนได้ทันที โดยยังเห็นคะแนนเดิมอยู่
- **PO กด Reset** → ยกเลือกการนับถอยหลัง

### Header (มุมขวาบน)

| ปุ่ม | ทำงาน |
|---|---|
| 🏠 **Home** | กลับหน้าแรก |
| 📊 **Database Usage** | ดูขนาดข้อมูล Firebase (ทุกคนเห็น) |
| 🔗 **แชร์** | คัดลอกลิงก์ห้องส่งให้เพื่อน |
| ☀️/🌙 **Theme** | สลับ Dark/Light mode |
| ⚙️ **Settings** | ตั้งค่า auto-unlock + feature flags (เฉพาะ PO) |
| 🗑 **ลบห้อง** | ลบห้องทั้งห้อง ทุกคนต้องเข้าใหม่ (เฉพาะ PO, มี confirm) |

### Bottom Bar (ด้านล่าง)

| ปุ่ม | ทำงาน |
|---|---|
| 🎡 **Wheel** | เปิด/ปิด panel กงล้อสุ่มชื่อ |
| 😀 **React** | เปิด emoji picker ส่ง floating reaction |
| 🔊 **Sound** | เปิด sound picker ส่งเสียง |
| 💬 **Chat** | เปิด/ปิดแชท panel |

---

## สถานะสมาชิก

| สถานะ | LED | ความหมาย |
|---|---|---|
| 🟢 เขียว | Online | อยู่ในห้อง |
| 🔴 แดง | Offline | ปิดเบราว์เซอร์ไปแล้ว |

---

## ผลโหวต (หลัง Reveal)

แสดงค่าเฉลี่ยแยกตาม role + ข้อความสรุป:

| สถานการณ์ | ข้อความ |
|---|---|
| role มี 1 คน | **ชื่อ รับจบ สวยๆ** |
| role ตรงกัน | **Dev จิตใจตรงกัน** |
| role ไม่ตรงกัน | **QA คุยกันหน่อย** |

---

## 📊 Database Usage

ดูขนาดข้อมูล Firebase ได้ทุกคน (กดปุ่ม 📊 ที่ header)
- แสดงจำนวนห้อง, ผู้ใช้, ข้อความแชท
- แสดงขนาดข้อมูล + % ที่ใช้จาก 1 GB (Spark plan)
- มีลิงก์ไป Firebase Console ดู monthly usage

---

## การพัฒนา

### ต้องการ

- Node.js 18+
- pnpm
- Firebase CLI (`npm install -g firebase-tools`)

### รัน local

```bash
pnpm install
pnpm dev
```

เปิด http://localhost:5173

### Build & Deploy

```bash
pnpm build
firebase deploy
```

---

## Tech Stack

- Vanilla TypeScript (ไม่มี framework)
- Firebase Realtime Database
- Firebase Anonymous Auth
- Vite 6+
- HTML5 Canvas (กงล้อสุ่มชื่อ)
- pnpm

---

## โครงสร้างโปรเจกต์

```
src/
├── index.html       ← SPA: landing page + room page
├── style.css        ← CSS + dark/light theme + responsive
├── app.ts           ← Entry point: init() + bindEvents()
├── firebase.ts      ← Firebase SDK init + re-exports
├── types.ts         ← TypeScript interfaces
├── constants.ts     ← CARDS, EMOJIS, SOUNDS, APP_VERSION
├── config.ts        ← Feature flags + ค่า default
├── state.ts         ← Shared mutable state + isPO()
├── dom.ts           ← DOM element references
├── utils.ts         ← escapeHtml, formatChatTime
├── auth.ts          ← Firebase auth, version check, auto-rejoin
├── room.ts          ← Room lifecycle: join/leave/listen/delete
├── voting.ts        ← Card rendering, vote, reveal, results
├── chat.ts          ← Chat panel, messages, typing, emoji, reply
├── reactions.ts     ← Floating reactions, message reactions
├── sounds.ts        ← Sound effects, Firebase sound listener
├── ui.ts            ← Theme, toast, settings, firework, DB report
└── wheel.ts         ← Random Wheel: canvas, spin, entry management
```

---

## Firebase Config

ตั้งค่าที่ `src/firebase.ts` — ดูรายละเอียดที่ `SETUP.md`
