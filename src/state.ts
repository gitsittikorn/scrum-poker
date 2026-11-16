import type { CurrentUser } from "./types";
import { PO_DEPUTY_REAL_NAMES, PO_DEPUTY_UIDS } from "./constants";

export const state = {
  currentRoom: null as string | null,
  currentUser: null as CurrentUser | null,
  currentUid: null as string | null,
  selectedCard: null as string | null,
  /** True when the current vote was entered via the custom-input card (so the
   *  custom card is highlighted instead of any fixed card sharing the same value). */
  selectedCardCustom: false,
  /** Card currently focused (keyboard) / under consideration — distinct from selectedCard (voted) */
  activeCard: null as string | null,
  currentRole: null as string | null,
  isSuperAdmin: false,
  isWheelRoom: false,
  /** "Groom ไม่มี Task" — mirror ของ rooms/{roomId}/noNeedTask (sync ทั้งห้อง real-time)
   *  ซ่อนแถบเตือน "ยังไม่ได้เลือกการ์ด" ของ admin ทุกเครื่อง ไม่แตะ task/โหวตเดิม */
  noNeedTask: false,
  /** "No Need Test" — mirror ของ rooms/{roomId}/noNeedTest (sync ทั้งห้อง real-time)
   *  ติ๊กโดย admin: QA ไม่ต้องใส่ point รอบนี้ — การ์ด QA ถูกล็อค + ไม่ nudge QA
   *  ตั้งค่าต่อ task (reset เมื่อดึง task ใหม่/ล้าง task/บันทึกจบรอบ) */
  noNeedTest: false,
  /** "Hot Fix" — mirror ของ rooms/{roomId}/hotFix (sync ทั้งห้อง real-time)
   *  ติ๊กแล้ว เมื่อบันทึก Point ระบบติด tag "hot fix" บนการ์ด ClickUp
   *  ใช้ร่วมกับ No Need Test ได้ (เลือกอย่างเดียวหรือทั้งคู่) */
  hotFix: false,
};

export const isPO = (): boolean => state.currentRole === "po" || state.currentRole === "admin";

/** ผู้ดูแลห้อง — PO ตาม role บวก deputy ที่กำหนดใน constants (ตรวจจาก uid
 *  ก่อน แล้วค่อย realName จาก member list): deputy ใช้ได้เหมือน PO ทุกอย่าง
 *  ในห้อง — ส่วนตั้งค่า, reveal/reset/unlock, เตะ, สลับโหมด groom/pre,
 *  บันทึก point ลง ClickUp, ลบห้อง, ล้างประวัติ/ตัวนับพูด */
export const isRoomAdmin = (): boolean => {
  if (isPO()) return true;
  if (state.currentRole !== "dev" || !state.currentUser) return false;
  if (state.currentUid && PO_DEPUTY_UIDS.includes(state.currentUid)) return true;
  return PO_DEPUTY_REAL_NAMES.includes(state.currentUser.realName ?? "");
};

export const isSuperAdmin = (): boolean => state.isSuperAdmin;
