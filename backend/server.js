// Local dev entry — `node server.js` (หรือ `pnpm dev`) จาก backend/
// ฝั่ง production ไม่ผ่านไฟล์นี้ — Cloud Function ใช้ index.js แทน
require("dotenv").config();

const app = require("./app");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[scrum-poker-backend] listening on http://localhost:${PORT}`);
  if (!process.env.CLICKUP_API_TOKEN) {
    console.warn("[warn] CLICKUP_API_TOKEN missing — ClickUp routes will fail");
  }
});

// Render free tier หลับเมื่อไม่มี request 15 นาที — ปลุกตัวเองทุก 7 นาทีกัน cold start
// (ทน ping พลาด 1 ครั้ง: 2×7=14 < 15 · โควตานับเป็นชั่วโมงที่มีชีวิต 744/750 ไม่ว่าจะ ping ถี่แค่ไหน
//  · RENDER_EXTERNAL_URL มีเฉพาะบน Render → local ไม่ทำงาน)
const keepaliveUrl = process.env.RENDER_EXTERNAL_URL;
if (keepaliveUrl) {
  setInterval(
    () => fetch(`${keepaliveUrl}/health`).catch(() => {}),
    7 * 60 * 1000
  ).unref();
  console.log(`[keepalive] self-ping ${keepaliveUrl}/health every 7 min`);
}
