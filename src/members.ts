import { db, ref, push, update, remove, onValue, off } from "./firebase";
import type { Member, MemberRole } from "./types";
import { showToast } from "./ui";

// ── Permanent member registry (super admin tab Member) ──────────────
// เก็บที่ members/{pushId} = { name, role } — อยู่นอก rooms/ จึงรอด
// ปุ่ม "เคลียร์ข้อมูลทั้งหมด" + scheduled cleanup (ทั้งสองอันลบแค่ rooms/)
//
// ผู้ใช้: ฟอร์มหน้าแรก (dropdown ชื่อจริงตาม role), super admin tab Member
// (CRUD), ห้อง Wheel (entries แยกตาม role แทนลิสต์ hardcode เดิม)
//
// Listener เดียวต่อ app — cache ไว้ใน module แล้ว broadcast ให้ทุก subscriber
// (pattern เดียวกับ chat.ts ที่กัน listener stacking ด้วย init/destroy)

let membersCache: Record<string, Member> = {};
let membersListenerRef: ReturnType<typeof ref> | null = null;
const subscribers = new Set<() => void>();
let firstSnapshotResolve: (() => void) | null = null;
const firstSnapshotPromise = new Promise<void>((resolve) => {
  firstSnapshotResolve = resolve;
});

/** เริ่มฟัง members/ — เรียกครั้งเดียวตอน init (ไม่ต้อง destroy) */
export function initMembersListener(): void {
  if (membersListenerRef) return;
  membersListenerRef = ref(db, "members");
  onValue(membersListenerRef, (snap) => {
    membersCache = (snap.val() as Record<string, Member> | null) ?? {};
    for (const cb of subscribers) cb();
    if (firstSnapshotResolve) {
      firstSnapshotResolve();
      firstSnapshotResolve = null;
    }
  });
}

/** รอ snapshot แรกจาก Firebase — Wheel room ใช้ก่อนสร้าง entries กันแข่งกับ listener */
export function whenMembersReady(): Promise<void> {
  return firstSnapshotPromise;
}

/** สมัครรับ event ตอน members เปลี่ยน (ฟอร์มหน้าแรก / admin tab / Wheel) */
export function onMembersChanged(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** ชื่อสมาชิกทั้งหมดของ role นั้น เรียงตามตัวอักษร (เหมือน attendees ใน ClickUp) */
export function getMemberNamesByRole(role: MemberRole): string[] {
  return Object.values(membersCache)
    .filter((m) => m?.role === role && typeof m.name === "string" && m.name.trim())
    .map((m) => m.name.trim())
    .sort((a, b) => a.localeCompare(b, "th"));
}

/** กลุ่มชื่อสำหรับ dropdown ห้อง Wheel — "All" = ทุก role */
export function getWheelTeamNames(team: string): string[] {
  if (team === "po" || team === "dev" || team === "qa" || team === "ux") {
    return getMemberNamesByRole(team);
  }
  return Object.values(membersCache)
    .filter((m) => m?.name && typeof m.name === "string" && m.name.trim())
    .map((m) => m.name.trim())
    .sort((a, b) => a.localeCompare(b, "th"));
}

/** ค้นหาชื่อที่ตรงกันในระบบ (กัน user พิมพ์เอง / ชื่อถูกลบไปแล้ว) */
export function isKnownMemberName(name: string, role: MemberRole): boolean {
  return getMemberNamesByRole(role).includes(name.trim());
}

/** เพิ่มสมาชิก — ไม่รับชื่อซ้ำใน role เดียวกัน */
export async function addMember(name: string, role: MemberRole): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) {
    showToast("พิมพ์ชื่อก่อนกดเพิ่ม");
    return false;
  }
  if (isKnownMemberName(trimmed, role)) {
    showToast(`มีชื่อ "${trimmed}" ใน role นี้อยู่แล้ว`);
    return false;
  }
  try {
    await push(ref(db, "members"), { name: trimmed, role });
    showToast(`✅ เพิ่ม ${trimmed} แล้ว`);
    return true;
  } catch (err) {
    console.error("[Members] Add error:", err);
    showToast("❌ เพิ่มชื่อไม่สำเร็จ");
    return false;
  }
}

/** แก้ไขชื่อสมาชิก (id = push key) */
export async function updateMemberName(id: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) {
    showToast("ชื่อห้ามว่าง");
    return false;
  }
  try {
    await update(ref(db, `members/${id}`), { name: trimmed });
    showToast(`✏️ แก้ไขเป็น ${trimmed} แล้ว`);
    return true;
  } catch (err) {
    console.error("[Members] Update error:", err);
    showToast("❌ แก้ไขไม่สำเร็จ");
    return false;
  }
}

/** ลบสมาชิก — คนที่เข้าห้องอยู่และเลือกชื่อนี้ไว้จะใช้ชื่อเดิมต่อจนจบเซสชัน (snapshot) */
export async function deleteMember(id: string): Promise<void> {
  try {
    await remove(ref(db, `members/${id}`));
    showToast("🗑 ลบชื่อแล้ว");
  } catch (err) {
    console.error("[Members] Delete error:", err);
    showToast("❌ ลบไม่สำเร็จ");
  }
}

/** รายการ [id, member] ทั้งหมด — สำหรับ render ตารางใน super admin */
export function getAllMembers(): [string, Member][] {
  return Object.entries(membersCache).filter(([, m]) => m && typeof m.name === "string");
}

/** หยุดฟัง (ใช้ตอนออกจาก admin room — ปล่อยฟอร์มหน้าแรกที่ไม่มีอะไรจะ update ก็ได้) */
export function destroyMembersListener(): void {
  if (membersListenerRef) {
    off(membersListenerRef);
    membersListenerRef = null;
  }
  membersCache = {};
}
