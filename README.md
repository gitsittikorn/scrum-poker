# Scrum Poker

เว็บ Planning Poker สำหรับทีม Agile — ใช้ร่วมกันได้หลายคนแบบ real-time

**URL:** https://scrum-poker-5fbac.web.app

---

## วิธีใช้งาน

1. เปิดเว็บ → ใส่ชื่อ → เลือก Role → เลือกห้อง → กด **เข้าร่วมห้อง**
2. เลือกคะแนนจากไพ่ หรือพิมพ์เลขเอง
3. รอทุกคนโหวตเสร็จ → กด **Reveal** เปิดเผยคะแนน
4. กด **Reset** เพื่อเริ่มรอบใหม่

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
| 2 วัน | 2.5 วัน | 4 วัน | ผีหลอก | เสร็จกันยา | พิมพ์เลขเอง |

---

## ปุ่มควบคุม

### หน้าโหวต (กลางจอ)

| ปุ่ม | ทำงาน |
|---|---|
| 👁 **Reveal** | เปิดเผยคะแนนทั้งหมด + ล็อคโหวต |
| 🔓 **Unlock** | ปลดล็อคให้โหวตใหม่ได้ (ปรากฏหลัง Reveal) |
| 🔄 **Reset** | เคลียร์คะแนนทั้งหมด + เตะคน offline ออกจากห้อง |

### Header (มุมขวาบน)

| ปุ่ม | ทำงาน |
|---|---|
| 🏠 **Home** | กลับหน้าแรก |
| 🔗 **แชร์** | คัดลอกลิงก์ห้องส่งให้เพื่อน |
| ☀️/🌙 **Theme** | สลับ Dark/Light mode |
| 🗑 **ลบห้อง** | ลบห้องทั้งห้อง ทุกคนต้องเข้าใหม่ (มี confirm ก่อนลบ) |

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

### Deploy

```bash
Ctrl+Shift+P → Tasks: Run Task → deploy
```

หรือ manual:

```bash
pnpm build
firebase deploy --only hosting
```

---

## Tech Stack

- Vanilla TypeScript (ไม่มี framework)
- Firebase Realtime Database
- Firebase Anonymous Auth
- Vite

---

## โครงสร้างโปรเจกต์

```
src/
├── index.html       ← หน้าเว็บ
├── style.css        ← CSS + dark mode + responsive
├── firebase.ts      ← Firebase config
└── app.ts           ← Logic ทั้งหมด
```

---

## Firebase Config

ตั้งค่าที่ `src/firebase.ts` — ดูรายละเอียดที่ `SETUP.md`
