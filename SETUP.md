# Scrum Poker — Setup Guide

Real-time Scrum Poker (Planning Poker) สำหรับทีม Agile — Vanilla TypeScript + Vite + Firebase RTDB
พร้อม ClickUp integration ผ่าน backend proxy (Express)

> ภาพรวมสถาปัตยกรรม/flow ต่าง ๆ ดู `docs/architecture.md` · บริบทโปรเจกต์เต็ม ดู `CLAUDE.md`

## 1. Firebase Setup

1. สร้าง project ใหม่ที่ [Firebase Console](https://console.firebase.google.com/)
2. เปิด **Realtime Database** (โปรเจกต์นี้ใช้ region `asia-southeast1`)
3. เปิด **Authentication → Sign-in method → Anonymous** (ระบบ sign-in อัตโนมัติ ไม่มีฟอร์ม login)
4. คัดลอก `firebaseConfig` จาก Project Settings → General → Your apps → Web app
5. แปะค่าลง `src/firebase.ts` (แทนที่ config เดิม)

## 2. Frontend — รัน local

ต้องใช้ **pnpm** (repo นี้เป็น pnpm workspace — backend เป็น member package)

```bash
pnpm install
pnpm dev          # vite dev server → http://localhost:5173
```

- หน้าเว็บ: **http://localhost:5173** (ไม่ใช่ 3000 — 3000 คือ backend)
- `.env.development` ชี้ `VITE_BACKEND_URL=http://localhost:3000` อยู่แล้ว

## 3. Backend (ClickUp proxy)

Backend เป็น Express app เดียวใช้ 2 ที่: local (`node server.js`) และ production
(Firebase Cloud Function `api` ผ่าน `backend/index.js`)

```bash
cd backend
cp .env.example .env      # ใส่ CLICKUP_API_TOKEN (ไม่มี = route ClickUp ทุกตัวพัง)
node server.js            # listening on http://localhost:3000
```

หมายเหตุ: `pnpm install` ที่ root ครั้งเดียวก็ครอบ backend (ดู `pnpm-workspace.yaml`)

## 4. Tests

```bash
pnpm test                 # unit + DOM integration (vitest)
cd backend && npm test    # backend integration (mock ClickUp — ไม่ยิงของจริง)
pnpm test:e2e             # Playwright E2E (ต้องรัน dev server :5173 + backend :3000 ก่อน)
pnpm test:e2e:save        # E2E บันทึก ClickUp ครบวงจร (ต้องมี token — สร้าง/ลบการ์ด [E2E-TEST] เอง)
pnpm test:e2e:noneedtest  # E2E No Need Test + tag + comment format (เงื่อนไขเดียวกัน)
```

## 5. Deploy (production)

ไม่ได้ใช้ GitHub Pages — production คือ **Firebase Hosting + Cloud Function**:

```bash
pnpm build        # tsc + vite build → dist/
firebase deploy   # Hosting (dist/) + function api (backend/) ตาม firebase.json
```

- Hosting rewrite `/api/**` → function `api` (asia-southeast1) = same-origin ไม่ต้อง CORS
- มี `render.yaml` สำหรับรัน backend บน Render อีกทาง (optional)
- **Deploy จริงต้องขออนุญาตเจ้าของระบบก่อนเสมอ — production มีผู้ใช้จริง**

## 6. Firebase Security Rules (ตัวอย่าง)

Production ควรจำกัด `.write` เฉพาะผู้ที่ sign-in แล้ว (ระบบนี้ใช้ anonymous auth):

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": "auth != null"
      }
    }
  }
}
```

## Project Structure (ย่อ — ดูรายละเอียดใน CLAUDE.md)

```
scrum-poker/
├── src/                # Frontend — TypeScript (entry: app.ts, DOM: index.html)
│   ├── voting.ts       # การ์ด/โหวต/reveal/reset/speakers
│   ├── clickup.ts      # banner task ClickUp + บันทึก point/tag/comment
│   ├── chat.ts · reactions.ts · sounds.ts · wheel.ts
│   ├── room.ts · auth.ts · members.ts · admin.ts
│   └── __tests__/      # vitest (unit + DOM integration ผ่าน happy-dom)
├── backend/            # Express ClickUp proxy (local + Cloud Function)
│   ├── app.js · links.js
│   └── test/           # node:test integration (mock ClickUp API)
├── e2e/                # Playwright E2E (.mjs)
├── firebase.json       # Hosting + Functions config
└── docs/architecture.md
```

## Tech Stack

- Vanilla **TypeScript** (no framework) + **Vite**
- **Firebase RTDB** (real-time) + **Firebase Anonymous Auth**
- **Express** backend proxy (token ClickUp ไม่ออกจาก backend เด็ดขาด)
- **pnpm** workspace · **vitest** + **Playwright** สำหรับ tests
