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

// Cache สำเนาลง localStorage ทุกครั้งที่ได้ snapshot — โหลดหน้าใหม่ใช้รายชื่อล่าสุด
// แสดงไว้ก่อน (stale-while-revalidate) แล้ว Firebase มาถึงค่อยเขียนทับ ชื่อจึงขึ้นทันที
// ไม่ต้องรอ connection — เดิม cache เริ่มว่างทุกครั้ง ทำให้ dropdown หน้าแรก /
// tab Member ของ super admin ว่างจนกว่า snapshot แรกจะมา (บางครั้งช้า/ต้อง refresh)
const MEMBERS_CACHE_KEY = "scrum-poker-members-cache";

function loadCachedMembers(): Record<string, Member> {
  try {
    const raw = localStorage.getItem(MEMBERS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Member> | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let membersCache: Record<string, Member> = loadCachedMembers();
let membersListenerRef: ReturnType<typeof ref> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
const subscribers = new Set<() => void>();
let firstSnapshotResolve: (() => void) | null = null;
const firstSnapshotPromise = new Promise<void>((resolve) => {
  firstSnapshotResolve = resolve;
});

/** เริ่มฟัง members/ — เรียกครั้งเดียวตอน init (ไม่ต้อง destroy) */
export function initMembersListener(): void {
  if (membersListenerRef || retryTimer) return;
  attachMembersListener();
  // Watchdog: snapshot แรกไม่มาใน 8 วิ = listen ค้าง (socket ตายแบบเงียบ) →
  // แนบใหม่เอง เท่ากับ refresh อัตโนมัติแทนที่ผู้ใช้จะต้องกด F5
  setTimeout(() => {
    if (!firstSnapshotResolve) return; // ได้ snapshot แล้ว
    console.warn("[Members] First snapshot late — re-attaching listener");
    scheduleListenerRetry();
  }, 8000);
}

function attachMembersListener(): void {
  membersListenerRef = ref(db, "members");
  onValue(
    membersListenerRef,
    (snap) => {
      membersCache = (snap.val() as Record<string, Member> | null) ?? {};
      try {
        localStorage.setItem(MEMBERS_CACHE_KEY, JSON.stringify(membersCache));
      } catch {
        /* cache เขียนไม่ได้ (quota/private mode) — แค่ไม่มี instant load รอบหน้า */
      }
      retryCount = 0;
      for (const cb of subscribers) cb();
      if (firstSnapshotResolve) {
        firstSnapshotResolve();
        firstSnapshotResolve = null;
      }
    },
    (err) => {
      // เดิมไม่มี error callback — listen พลาด (เช่น แนบก่อน auth เสร็จแล้วโดน
      // permission denied) จะเงียบไปทั้ง session จนต้อง refresh
      console.error("[Members] Listener error:", err);
      scheduleListenerRetry();
    },
  );
}

/** ถอด listener เดิมแล้วแนบใหม่แบบ backoff (1s → 2s → 4s... สูงสุด 15s) */
function scheduleListenerRetry(): void {
  if (retryTimer) return;
  if (membersListenerRef) {
    off(membersListenerRef);
    membersListenerRef = null;
  }
  const delay = Math.min(1000 * 2 ** retryCount, 15000);
  retryCount++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    attachMembersListener();
  }, delay);
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

/** กลุ่มชื่อสำหรับ dropdown ห้อง Wheel — "All" = ทุกคน (dedupe เพราะคนในทีม mk
 *  มี entry ซ้ำอยู่ในคอลัมน์ role ของตัวเองด้วย; "team" = หมุนเลือกชื่อทีม
 *  จึงไม่รวม entry "team" ใน "All" — ชื่อทีมไม่ใช่คน) */
export function getWheelTeamNames(team: string): string[] {
  if (
    team === "po" || team === "dev" || team === "qa" ||
    team === "ux" || team === "mk" || team === "team"
  ) {
    return getMemberNamesByRole(team);
  }
  const seen = new Set<string>();
  return Object.values(membersCache)
    .filter((m) => m?.name && m.role !== "team" && typeof m.name === "string" && m.name.trim())
    .map((m) => m.name.trim())
    .filter((n) => {
      const key = n.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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
