/**
 * ล้างข้อมูล "รอบโหวต" ของห้อง — logic กลางใช้ร่วมกัน 2 ที่:
 *  - ปุ่ม Reset ของ PO (voting.ts → doReset)
 *  - ปุ่มเคลียร์ task ✕ บน banner (clickup.ts → handleClearClickUpTask) —
 *    เคลียร์ task = จบรอบ ต้อง reset ข้อมูลรอบทันที
 * แยกเป็นไฟล์ของตัวเองเพราะ clickup.ts ห้าม import voting.ts โดยตรง
 * (กัน dependency cycle — voting เรียก renderTaskBanner ของ clickup ใน updateUI)
 */
import { db, get, ref } from "./firebase";
import { state } from "./state";
import type { User } from "./types";

/** สร้าง payload ล้างรอบโหวตทั้งห้อง: โหวตของคนทุกคน + revealed/locked/revealTime/
 *  drinkers (ลำโพง) + speakerCounts ตามเงื่อนไข allSpoken เดียวกับปุ่ม Reset
 *  (จบรอบ = ล้างตัวนับพูด, กลางรอบ = คงไว้ให้ anti-streak ทำงานต่อ)
 *  คืนเป็น object เพื่อให้ผู้เรียก merge field อื่น (เช่น activeTask: null)
 *  ลง update เดียวแบบ atomic · คืน null = ไม่มี users (ห้องว่าง/ถูกลบ) */
export async function buildRoundResetUpdates(): Promise<Record<string, unknown> | null> {
  const [usersSnap, countsSnap] = await Promise.all([
    get(ref(db, `rooms/${state.currentRoom}/users`)),
    get(ref(db, `rooms/${state.currentRoom}/speakerCounts`)),
  ]);
  if (!usersSnap.exists()) return null;
  const users = (usersSnap.val() as Record<string, User> | null) ?? {};
  const updates: Record<string, unknown> = {};
  Object.entries(users).forEach(([uid]) => {
    updates[`users/${uid}/vote`] = null;
  });
  updates["revealed"] = false;
  updates["locked"] = false;
  updates["revealTime"] = null;
  updates["drinkers"] = null; // Firebase field kept as "drinkers" (backward compat)
  const counts: Record<string, number> = countsSnap.val() ?? {};
  // เคลียร์ count เฉพาะตอน "รอบจบ" = ทุกคนที่โหวต (non-PO, non-left, เลข) เคยพูด ≥1 ครั้ง
  // ถ้ายังไม่ครบ = reset เพื่อโหวตใหม่เรื่องเดิม → คง count ไว้ให้ anti-streak ทำงานต่อ
  const allSpoken = Object.entries(users).every(([uid, u]) => {
    if (u.role === "po" || u.left === true) return true;
    if (isNaN(parseFloat(u.vote ?? ""))) return true;
    return (counts[uid] ?? 0) >= 1;
  });
  if (allSpoken) updates["speakerCounts"] = null;
  return updates;
}

/** ล้าง UI โหวตฝั่งเครื่องตัวเองทันที (highlight การ์ด + ค่าในช่อง custom)
 *  ไม่ต้องรอ room tick — เรียกหลังเขียน reset ลง DB สำเร็จ */
export function resetLocalVoteUi(): void {
  state.selectedCardCustom = false;
  state.selectedCard = null;
  document
    .querySelectorAll(".poker-card")
    .forEach((el) => el.classList.remove("selected"));
  document.querySelectorAll(".custom-point-input").forEach((el) => {
    (el as HTMLInputElement).value = "";
  });
}
