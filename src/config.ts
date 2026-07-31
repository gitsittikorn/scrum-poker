/**
 * ============================================================
 *  🔧 CONFIG — ปรับแต่งค่าต่าง ๆ ของแอปได้ที่นี่
 * ============================================================
 *
 *  แก้ค่าในไฟล์นี้แล้ว refresh browser ได้เลย
 *  (ถ้ารัน dev server จะ hot-reload ให้อัตโนมัติ)
 */

/**
 * 🚩 Feature Flags — เปิด/ปิด feature เพื่อจำกัด Firebase quota
 *
 * ตั้งเป็น false เพื่อปิด feature นั้น (ซ่อน UI + ไม่ส่ง/รับ Firebase)
 */
export const FEATURES = {
  /** Poker point — การ์ดโหวต, Reveal, Reset */
  poker: true,
  /** Chat — แชทแผงขวา, ข้อความ, typing indicator */
  chat: true,
  /** React — floating emoji จาก bottom bar */
  react: true,
  /** Sound — เอฟเฟกต์เสียงจาก bottom bar */
  sound: true,
  /** Wheel — กงล้อสุ่มชื่อสมาชิก */
  wheel: true,
  /** Speaker Rotate — สุ่มผู้พูดแบบถ่วงน้ำหนัก (0.7^count) + โชว์ 🎤 count + ปุ่มล้าง. ปิด = uniform random (ของเดิม) + ซ่อนหมด */
  speakerRotate: true,
};

/** วินาทีที่จะ auto-unlock หลังจาก reveal (ค่า default สำหรับห้องใหม่) */
export const AUTO_UNLOCK_SECONDS = 30;

/** ระยะเวลาแสดง toast notification (ms) */
export const TOAST_DURATION_MS = 3000;

/** จำนวนข้อความแชทสูงสุดที่จะโหลด */
export const CHAT_MESSAGE_LIMIT = 100;

/** จำนวนประวัติการสุ่มกงล้อสูงสุดที่จะแสดง/เก็บ (ล่าสุดก่อน) */
export const WHEEL_HISTORY_LIMIT = 50;

/** ระยะเวลาแสดง floating emoji (ms) */
export const FLOATING_EMOJI_DURATION_MS = 5000;

/** ระยะเวลา typing indicator (ms) */
export const TYPING_TIMEOUT_MS = 3000;

/** ระยะเวลา keep-alive ของ typing indicator (ms) — คนอื่นเห็นว่ากำลังพิมพ์ */
export const TYPING_DISPLAY_MS = 15000;

/** ระดับเสียง (0.0 - 1.0) */
export const SOUND_VOLUME = 0.6;
