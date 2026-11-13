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
};

export const isPO = (): boolean => state.currentRole === "po" || state.currentRole === "admin";

/** ผู้ที่ใช้ "ส่วนตั้งค่า" (settings modal) ได้เหมือน PO — PO ตาม role
 *  บวก deputy ที่กำหนดใน constants (ตรวจจาก uid ก่อน แล้วค่อย realName จาก member list)
 *  ใช้เฉพาะการ gate ส่วนตั้งค่า — ไม่ให้สิทธิ์ reveal/reset/kick/ล้างห้อง/บันทึก ClickUp
 *  ซึ่งยังเป็นของ isPO() เหมือนเดิม */
export const isRoomAdmin = (): boolean => {
  if (isPO()) return true;
  if (state.currentRole !== "dev" || !state.currentUser) return false;
  if (state.currentUid && PO_DEPUTY_UIDS.includes(state.currentUid)) return true;
  return PO_DEPUTY_REAL_NAMES.includes(state.currentUser.realName ?? "");
};

export const isSuperAdmin = (): boolean => state.isSuperAdmin;
