/**
 * ============================================================
 *  🔧 CONFIG — ปรับแต่งค่าต่าง ๆ ของแอปได้ที่นี่
 * ============================================================
 *
 *  แก้ค่าในไฟล์นี้แล้ว refresh browser ได้เลย
 *  (ถ้ารัน dev server จะ hot-reload ให้อัตโนมัติ)
 */

/** วินาทีที่จะ auto-unlock หลังจาก reveal (ค่า default สำหรับห้องใหม่) */
export const AUTO_UNLOCK_SECONDS = 20;

/** ระยะเวลาแสดง toast notification (ms) */
export const TOAST_DURATION_MS = 3000;

/** จำนวนข้อความแชทสูงสุดที่จะโหลด */
export const CHAT_MESSAGE_LIMIT = 100;

/** ระยะเวลาแสดง floating emoji (ms) */
export const FLOATING_EMOJI_DURATION_MS = 4000;

/** ระยะเวลา typing indicator (ms) */
export const TYPING_TIMEOUT_MS = 3000;

/** ระยะเวลา keep-alive ของ typing indicator (ms) — คนอื่นเห็นว่ากำลังพิมพ์ */
export const TYPING_DISPLAY_MS = 15000;
