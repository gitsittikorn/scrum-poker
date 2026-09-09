// Seed รายชื่อสมาชิกเริ่มต้นลง members/ (ย้ายมาจากลิสต์ hardcode เดิมของห้อง Wheel)
// รัน: node scripts/seed-members.mjs  (จาก root ของ repo)
// ปลอดภัยต่อการรันซ้ำ — ข้ามชื่อที่มีอยู่แล้วใน role เดียวกัน (เทียบแบบไม่สนตัวพิมพ์)
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, push } from "firebase/database";

// ต้องตรงกับ src/firebase.ts
const firebaseConfig = {
  apiKey: "AIzaSyCk9-AWQqCm5lIVeyhojhD5wZYq8Ie2yaQ",
  authDomain: "scrum-poker-5fbac.firebaseapp.com",
  databaseURL: "https://scrum-poker-5fbac-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scrum-poker-5fbac",
  storageBucket: "scrum-poker-5fbac.firebasestorage.app",
  messagingSenderId: "500438075030",
  appId: "1:500438075030:web:f8e8fd3df92a49bc8ce4b7",
  measurementId: "G-5BHRC0Z0H1",
};

// Mapping จากหัวหน้าทีม (2026-09-09) — ย้ายจาก WHEEL_ROOM_DEFAULTS เดิม 22 คน
const SEED = [
  { name: "Yam", role: "po" },
  { name: "Nuji", role: "po" },
  { name: "Meaw", role: "po" },
  { name: "Tein", role: "dev" },
  { name: "Toon", role: "dev" },
  { name: "Pun", role: "dev" },
  { name: "Por", role: "dev" },
  { name: "Flouk", role: "dev" },
  { name: "Pou", role: "dev" },
  { name: "A", role: "dev" },
  { name: "Nub", role: "dev" },
  { name: "Cing", role: "dev" },
  { name: "Prince", role: "dev" },
  { name: "Max", role: "dev" },
  { name: "Poom", role: "dev" },
  { name: "Puy", role: "ux" },
  { name: "Char", role: "ux" },
  { name: "Toey", role: "ux" },
  { name: "Run", role: "qa" },
  { name: "Big", role: "qa" },
  { name: "May", role: "qa" },
  { name: "Pond", role: "qa" },
  // ทีม Monkey King — grouping สำหรับห้อง Wheel (คนเดียวกันกับในคอลัมน์ role ของตัวเอง)
  { name: "Cing", role: "mk" },
  { name: "Meaw", role: "mk" },
  { name: "Max", role: "mk" },
  { name: "Prince", role: "mk" },
  { name: "Nuji", role: "mk" },
  { name: "Yam", role: "mk" },
  { name: "Poom", role: "mk" },
];

const app = initializeApp(firebaseConfig);
await signInAnonymously(getAuth(app)); // mirror สิทธิ์ anonymous เหมือนในแอป
const db = getDatabase(app);

const snap = await get(ref(db, "members"));
const existing = snap.exists() ? Object.values(snap.val() ?? {}) : [];
console.log(`Existing members: ${existing.length}`);

let added = 0;
for (const m of SEED) {
  const dup = existing.some(
    (e) => e?.role === m.role && String(e?.name ?? "").toLowerCase() === m.name.toLowerCase(),
  );
  if (dup) {
    console.log(`  skip (exists): ${m.role} ${m.name}`);
    continue;
  }
  await push(ref(db, "members"), m);
  added++;
  console.log(`  added: ${m.role} ${m.name}`);
}
console.log(`Done — added ${added}, skipped ${SEED.length - added}`);
process.exit(0);
