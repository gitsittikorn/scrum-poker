/**
 * ClickUp integration — banner บนหัวห้อง poker
 *
 * PO วางลิงก์ task → backend resolve เป็น taskId → เขียน
 * rooms/{roomId}/activeTask (real-time ทุกคนในห้องเห็นชื่อ task + ลิงก์)
 * ห้องมี 2 โหมด (rooms/{roomId}/groomMode — PO สลับเองผ่าน toggle บน banner):
 *  - "groom": หลัง reveal → ทุก role ต้องโหวตเท่ากัน → ค่านั้นเขียนลง custom
 *    field + คอมเม้น Grooming
 *  - "pre": pre-groom ของ lead → คอมเม้น Pre-Grooming เก็บ min-max ต่อ role
 *    อย่างเดียว ไม่แตะ custom field (token อยู่ฝั่ง backend เท่านั้น)
 *
 * ไม่ import voting.ts/room.ts เพื่อกัน dependency cycle (voting เรียก
 * renderTaskBanner ของไฟล์นี้ใน updateUI)
 */
import { db, get, orderByKey, push, query, ref, remove, serverTimestamp, set, update } from "./firebase";
import {
  btnClickupClear,
  btnClickupResolve,
  btnGroomModeGroom,
  btnGroomModePre,
  btnTaskHistory,
  clickupBanner,
  clickupInputRow,
  clickupLinks,
  clickupTaskDisplay,
  clickupTaskName,
  clickupTaskRow,
  clickupUrlInput,
  groomModeBadge,
  groomModeControls,
  groomModeRow,
} from "./dom";
import { showConfirmModal, showToast, showSaveSplash, showWakeNotice } from "./ui";
import { sendSystemMessage } from "./chat";
import { formatDateTime, rangeFor, unanimousFor } from "./utils";
import { FEATURES } from "./config";
import { ADMIN_ROOM } from "./constants";
import { isPO, state } from "./state";
import type { ActiveTask, GroomMode, RoomData, TaskHistoryEntry, TaskLink, User } from "./types";

interface ResolvedTask {
  taskId: string;
  name: string;
  url: string;
  customId: string | null;
  status: string | null;
  links: TaskLink[];
}

interface ExistingPoints {
  dev: number | null;
  qa: number | null;
}

type SaveResult = {
  dev?: { ok: boolean; error?: string; field?: string };
  qa?: { ok: boolean; error?: string; field?: string };
  comment?: { ok: boolean; error?: string };
};

/** POST เล็ก ๆ ไป backend — แปลง HTTP error เป็น message ภาษาไทยสำหรับ toast */
async function api<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("เชื่อมต่อ backend ไม่ได้ (ต้องรัน backend ก่อน)");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error || `backend error ${res.status}`);
  return data as T;
}

const fmt = (n: number): string => String(n);

/** จำนวนประวัติการดึง task สูงสุดต่อห้อง (เกินตัดรายการเก่าทิ้ง) */
const TASK_HISTORY_LIMIT = 30;

/** ลำดับกลุ่ม role ในคอมเม้น Attendees ("admin" = superadmin ถือเป็น PO ตาม isPO) */
const ATTENDEE_ROLES: { keys: string[]; label: string }[] = [
  { keys: ["po", "admin"], label: "PO" },
  { keys: ["dev"], label: "Dev" },
  { keys: ["qa"], label: "QA" },
  { keys: ["ux"], label: "UX/UI" },
];

/** ข้อความคอมเม้นท์ที่โพสต์ลงการ์ด ClickUp — dev/qa เป็น string สำเร็จรูปแล้ว
 *  ("3" ตอน groom / "1-3" ตอน pre-groom)
 *  Attendees บรรทัดเดียวต่อ role ชื่อคั่นด้วย comma (ข้าม role ที่ไม่มีคน)
 *  ใช้ชื่อจริง (realName จาก member list) — ชื่อเล่นแสดงแค่ในห้อง poker
 *  PO ที่เป็นคนกดบันทึก (savedByUid) จะมี "(owner)" ต่อท้ายชื่อ */
function buildGroomingComment(
  mode: GroomMode,
  dev: string | null,
  qa: string | null,
  attendees: [string, User][],
  savedByUid: string | null
): string {
  const header = mode === "pre" ? "Pre-Grooming" : "Grooming";
  // เวลาตอนกดบันทึก — เดิมใช้ revealTime ทำให้ย้อนหลังเท่ากับที่ reveal ค้างไว้
  // (reveal ไว้นาน แล้วมาบันทึกทีหลัง เวลาเลยดูเหมือน timezone ช้าไปหลายชั่วโมง)
  const lines = [`${header} : ${formatDateTime(Date.now())}`];
  if (dev !== null) lines.push(`Dev: ${dev}`);
  if (qa !== null) lines.push(`QA: ${qa}`);
  lines.push("", "Attendees");
  for (const { keys, label } of ATTENDEE_ROLES) {
    // ชื่อเรียงตามตัวอักษร a-z (localeCompare จัดการพ่วงวรรณยุกต์ไทยให้ด้วย)
    // เครื่องหมาย (owner) ใส่หลังเรียงแล้ว กัน suffix กระทบลำดับการเรียง
    const names = attendees
      .filter(([, u]) => keys.includes(u.role))
      .sort(([, a], [, b]) => (a.realName ?? a.name).localeCompare(b.realName ?? b.name, "th"))
      .map(([uid, u]) => {
        const n = u.realName ?? u.name; // fallback ชื่อเล่นเฉพาะข้อมูลเก่า/ห้องไม่บังคับ
        return uid === savedByUid ? `${n}(owner)` : n;
      });
    if (names.length === 0) continue;
    lines.push(`Role - ${label}: ${names.join(", ")}`);
  }
  return lines.join("\n");
}

/** โหวตของกลุ่มเป็นข้อความ — สำหรับ toast บอกว่า role ไหนยังไม่ตรงกัน (คนไม่ได้โหวต = –) */
const votesStr = (list: [string, User][]): string =>
  list.map(([, u]) => u.vote ?? "–").join(", ");

// ===== Link icons จาก description ของการ์ด (SVG brand logos) =====

const LINK_LABELS: Record<TaskLink["type"], string> = {
  figma: "Figma",
  sheets: "Google Sheets",
  docs: "Google Docs",
  slides: "Google Slides",
  drive: "Google Drive",
  miro: "Miro",
  github: "GitHub",
  clickup: "ClickUp",
  image: "รูปภาพ",
  pdf: "ไฟล์ PDF",
  file: "ไฟล์แนบ",
  link: "ลิงก์",
};

const LINK_ICONS: Record<TaskLink["type"], string> = {
  // Figma logo — 5 วงกลม (สีทางการ)
  figma: `<svg viewBox="0 0 38 57" aria-hidden="true"><path fill="#F24E1E" d="M19 0H9.5A9.5 9.5 0 0 0 9.5 19H19V0z"/><path fill="#FF7262" d="M19 0h9.5a9.5 9.5 0 0 1 0 19H19V0z"/><path fill="#A259FF" d="M19 19H9.5a9.5 9.5 0 0 0 0 19H19V19z"/><path fill="#1ABCFE" d="M19 38a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z"/><path fill="#0ACF83" d="M9.5 57a9.5 9.5 0 0 1 0-19H19v9.5A9.5 9.5 0 0 1 9.5 57z"/></svg>`,
  // Google Sheets — ไฟล์เขียว + ตารางขาว
  sheets: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0F9D58" d="M5 1h9l5 5v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/><path fill="#57BB8A" d="M14 1l5 5h-4a1 1 0 0 1-1-1V1z"/><path fill="#fff" d="M7 12h10v7H7v-7zm1.5 1.5V15h3v-1.5h-3zm4.5 0V15h3v-1.5h-3zM8.5 16.5V18h3v-1.5h-3zm4.5 0V18h3v-1.5h-3z"/></svg>`,
  // Google Docs — ไฟล์น้ำเงิน + บรรทัดข้อความขาว
  docs: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M5 1h9l5 5v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/><path fill="#A1C2FA" d="M14 1l5 5h-4a1 1 0 0 1-1-1V1z"/><path fill="#fff" d="M7 10h7v1.3H7V10zm0 3.2h10v1.3H7v-1.3zm0 3.5h10V18H7v-1.3z"/></svg>`,
  // Google Slides — ไฟล์เหลือง + สไลด์หัวข้อ/บรรทัด
  slides: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F4B400" d="M5 1h9l5 5v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/><path fill="#FCC948" d="M14 1l5 5h-4a1 1 0 0 1-1-1V1z"/><path fill="#fff" d="M7 11h10v7H7v-7z"/><path fill="#F4B400" d="M8.5 12.4h5v2.2h-5v-2.2zm0 3h7v1.2h-7v-1.2z"/></svg>`,
  // Google Drive — สามเหลี่ยม 3 สี (สีทางการ)
  drive: `<svg viewBox="0 0 87.3 78" aria-hidden="true"><path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"/><path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z"/><path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z"/><path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.5-1.4-3.75-1.8-1.25-.4-2.6-.6-3.9-.6H37.55c-1.3 0-2.65.25-3.9.7-.5.2-.95.4-1.4.65z"/><path fill="#2684fc" d="m57.15 50H30.15l-13.75 23.8c1.35.8 2.85 1.2 4.4 1.2h44.9c1.55 0 3.05-.4 4.4-1.2z"/><path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l13.7 23.8h27.45c0-1.55-.4-3.1-1.2-4.5z"/></svg>`,
  // Miro — พื้นเหลือง + ตัว M ขาว
  miro: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="4.8" fill="#FFD02F"/><path fill="#fff" d="M5.8 5.2h3.4L12 8.6l2.8-3.4h3.4v13.6h-3.4v-7.7L12 14.6l-2.8-3.5v7.7H5.8V5.2z"/></svg>`,
  // GitHub — octocat บนวงกลมดำ
  github: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#181717"/><path fill="#fff" d="M12 3.8a5.9 5.9 0 0 0-1.9 11.5c.3.1.4-.1.4-.3v-1c-1.6.3-1.9-.7-1.9-.7-.3-.7-.6-.8-.6-.8-.5-.4 0-.4 0-.4.6 0 .9.6.9.6.5.9 1.4.6 1.7.5.1-.4.2-.6.4-.8-1.3-.1-2.6-.6-2.6-2.8 0-.6.2-1.1.6-1.5-.1-.4-.2-1 .1-1.6 0 0 .5-.2 1.6.6a5.7 5.7 0 0 1 2.9 0c1.1-.7 1.6-.6 1.6-.6.3.6.2 1.2.1 1.6.4.4.6.9.6 1.5 0 2.2-1.3 2.7-2.6 2.8.2.2.4.6.4 1.1v1.5c0 .2.1.4.4.3A5.9 5.9 0 0 0 12 3.8z"/></svg>`,
  // ClickUp — chevron ซ้อนสีม่วงแบรนด์
  clickup: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#7B68EE" d="M2 6.6 12 1l10 5.6v3L12 4 2 9.6z"/><path fill="#7B68EE" opacity=".65" d="M2 17.4 12 23l10-5.6v-3L12 20 2 14.4z"/></svg>`,
  // รูปภาพ (ลิงก์ไฟล์รูปตรง ๆ) — icon เส้นตาม theme
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.9-3.9a2 2 0 0 0-2.8 0L6 19.5"/></svg>`,
  // PDF — ไฟล์แดง + ตัวอักษร PDF
  pdf: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#D93025" d="M5 1h9l5 5v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/><path fill="#F28B82" d="M14 1l5 5h-4a1 1 0 0 1-1-1V1z"/><text x="12" y="16.6" text-anchor="middle" font-family="Arial, sans-serif" font-size="6" font-weight="700" fill="#fff">PDF</text></svg>`,
  // ไฟล์แนบอื่น ๆ — กระดาษมีบรรทัด (icon เส้นตาม theme)
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
  // Generic — โซ่ลิงก์ (สีตาม theme ผ่าน currentColor)
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
};

/** icon ไม่มีแบรนด์ — ใช้สีโทน muted ตาม theme (เหมือนโซ่ลิงก์ generic) */
const GENERIC_LINK_TYPES = new Set<TaskLink["type"]>(["link", "image", "file"]);

/** กัน rebuild DOM ทุก room tick — rebuild เฉพาะเมื่อชุดลิงก์เปลี่ยนจริง ๆ */
let renderedLinksKey = "";

function renderTaskLinks(links: TaskLink[] | undefined): void {
  const key = (links ?? []).map((l) => `${l.type}:${l.url}`).join("|");
  if (key === renderedLinksKey) return;
  renderedLinksKey = key;
  clickupLinks.innerHTML = "";
  for (const l of links ?? []) {
    const a = document.createElement("a");
    a.className = "clickup-link" + (GENERIC_LINK_TYPES.has(l.type) ? " clickup-link-generic" : "");
    a.href = l.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = LINK_LABELS[l.type];
    a.setAttribute("aria-label", LINK_LABELS[l.type]);
    a.innerHTML = LINK_ICONS[l.type]; // SVG คงที่จาก code — URL ไปที่ href เท่านั้น
    clickupLinks.appendChild(a);
  }
}

// ===== Banner render (เรียกจาก updateUI ทุก tick) =====

export function renderTaskBanner(task: ActiveTask | null, groomMode: GroomMode = "groom"): void {
  // ห้อง admin (super admin console) และห้อง Wheel ไม่มี ClickUp — ใช้เฉพาะห้อง poker จริงเท่านั้น
  if (!FEATURES.clickup || !state.currentRoom || state.currentRoom === ADMIN_ROOM || state.isWheelRoom) {
    clickupBanner.classList.add("hidden");
    return;
  }
  const po = isPO();
  // ซ่อนทั้งอันเมื่อปิด flag / ไม่มี task และไม่ใช่ PO (non-PO ไม่เห็น input เปล่า ๆ)
  clickupBanner.classList.toggle("hidden", !po && !task);
  // input ผู้ใช้กำลังพิมพ์อยู่ — ห้ามแตะ value ในนี้ ไม่งั้นโดนเคลียร์ทุก room tick
  clickupInputRow.classList.toggle("hidden", !po);
  btnClickupClear.classList.toggle("hidden", !task);

  // แถวโหมด: toggle เฉพาะ PO · badge ตอน pre (non-PO) · ปุ่ม History เห็นทุกคน
  groomModeRow.classList.remove("hidden");
  groomModeControls.classList.toggle("hidden", !po);
  if (po) {
    btnGroomModePre.classList.toggle("active", groomMode === "pre");
    btnGroomModeGroom.classList.toggle("active", groomMode === "groom");
  }
  groomModeBadge.classList.toggle("hidden", po || groomMode !== "pre");

  if (task) {
    clickupTaskRow.classList.remove("hidden");
    clickupTaskDisplay.href = task.url;
    clickupTaskName.textContent = task.name; // แสดงแค่ชื่อการ์ด (ไม่ใส่ customId)
    clickupTaskDisplay.title = task.name;
    renderTaskLinks(task.links);
  } else {
    clickupTaskRow.classList.add("hidden");
    renderTaskLinks(undefined);
  }
}

// ===== Handlers =====

/** เขียน activeTask ลงห้อง + บันทึกลงประวัติ (trim เกิน 30 ตัดรายการเก่าทิ้ง)
 *  ใช้ร่วมทั้งตอน PO วางลิงก์และตอน "นำมา Groom ใหม่" จาก history
 *  activeTask เก็บ historyKey เพื่อให้ตอนบันทึก ClickUp จด savedAt กลับได้ */
async function applyResolvedTask(task: ResolvedTask): Promise<void> {
  if (!state.currentRoom) return;
  const histRef = push(ref(db, `rooms/${state.currentRoom}/taskHistory`));
  await update(ref(db, `rooms/${state.currentRoom}`), {
    activeTask: {
      taskId: task.taskId,
      name: task.name,
      url: task.url,
      customId: task.customId,
      setBy: state.currentUser?.name ?? "",
      timestamp: serverTimestamp(),
      links: task.links ?? [],
      historyKey: histRef.key,
    },
  });
  await set(histRef, {
    taskId: task.taskId,
    name: task.name,
    customId: task.customId ?? null,
    url: task.url,
    links: task.links ?? [],
    resolvedBy: state.currentUser?.name ?? "",
    resolvedAt: serverTimestamp(),
    savedAt: null,
  });
  void trimTaskHistory();
}

/** ผล point ของรอบบันทึก — groom = เลขเดียว, pre = ช่วง "1-3"
 *  จดลง history เพื่อแสดงคอลัมน์ Dev/QA + รวมยอดในหน้า history */
interface SavedPoints {
  mode: GroomMode;
  dev: number | null;
  qa: number | null;
  devRange: string | null;
  qaRange: string | null;
}

/** จดเวลา + point ที่บันทึกสำเร็จลงรายการ history ของรอบนี้ (ไว้คำนวณ duration และยอดรวม) */
async function recordSavedAt(historyKey: string | undefined, points: SavedPoints): Promise<void> {
  if (!state.currentRoom || !historyKey) return;
  try {
    await update(ref(db, `rooms/${state.currentRoom}/taskHistory/${historyKey}`), {
      savedAt: serverTimestamp(),
      groomMode: points.mode,
      dev: points.dev,
      qa: points.qa,
      devRange: points.devRange,
      qaRange: points.qaRange,
    });
  } catch (err) {
    console.warn("[clickup] record savedAt failed:", err);
  }
}

/** คงประวัติไว้แค่ TASK_HISTORY_LIMIT รายการล่าสุด — push key เรียงตามเวลา ตัดหัวสุดทิ้ง */
async function trimTaskHistory(): Promise<void> {
  if (!state.currentRoom) return;
  try {
    const snap = await get(query(ref(db, `rooms/${state.currentRoom}/taskHistory`), orderByKey()));
    const keys = Object.keys((snap.val() as Record<string, unknown>) ?? {});
    if (keys.length <= TASK_HISTORY_LIMIT) return;
    const updates: Record<string, null> = {};
    for (const k of keys.slice(0, keys.length - TASK_HISTORY_LIMIT)) updates[k] = null;
    await update(ref(db, `rooms/${state.currentRoom}/taskHistory`), updates);
  } catch (err) {
    console.warn("[clickup] trim history failed:", err);
  }
}

export async function handleResolveClickUp(): Promise<void> {
  if (!isPO() || !state.currentRoom) return;
  const input = clickupUrlInput.value.trim();
  if (!input) {
    showToast("⚠️ วางลิงก์ ClickUp task ก่อน");
    clickupUrlInput.focus();
    return;
  }

  btnClickupResolve.disabled = true;
  btnClickupResolve.textContent = "…กำลังดึง";
  const wakeTimer = armWakeNotice("ดึง task");
  try {
    const task = await api<ResolvedTask>("/api/clickup/resolve-task", { input });
    await applyResolvedTask(task);
    // คง URL เดิมไว้ในช่อง input — จนกว่าจะกด ✕ เคลียร์ หรือลบเอง
    // (กด "ดึง Task" ซ้ำ = re-resolve การ์ดใหม่ สดวิธี refresh ข้อมูล description/links)
    showToast(`✅ ตั้ง task แล้ว: ${task.name}`);
  } catch (err) {
    showToast(`❌ ${(err as Error).message}`);
  } finally {
    window.clearTimeout(wakeTimer);
    btnClickupResolve.disabled = false;
    btnClickupResolve.textContent = "ดึง Task";
  }
}

export async function handleClearClickUpTask(): Promise<void> {
  if (!isPO() || !state.currentRoom) return;
  await update(ref(db, `rooms/${state.currentRoom}`), { activeTask: null });
  clickupUrlInput.value = "";
  showToast("🧹 เคลียร์ task แล้ว");
}

/** PO สลับโหมดห้อง groom/pre — เก็บใน Firebase ทุกคนเห็น real-time (ไม่ auto สลับกลับ) */
export async function handleSetGroomMode(mode: GroomMode): Promise<void> {
  if (!isPO() || !state.currentRoom) return;
  await update(ref(db, `rooms/${state.currentRoom}`), { groomMode: mode });
  const label = mode === "pre" ? "Pre-Groom (คอมเม้นอย่างเดียว)" : "Groom (บันทึก field + คอมเม้น)";
  showToast(`🎯 สลับเป็นโหมด ${label}`);
  void sendSystemMessage(`🎯 ห้องนี้สลับเป็นโหมด ${label}`);
}

/** Duration ของรอบ groom — "hh:mm" ตั้งแต่ 1 ชม.ขึ้นไป · "xx min" ถ้าไม่ถึงชั่วโมง */
function formatHistoryDuration(entry: TaskHistoryEntry): string {
  if (!entry.savedAt || !entry.resolvedAt) return "⏱ —";
  const mins = Math.max(0, Math.round((entry.savedAt - entry.resolvedAt) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h >= 1 ? `⏱ ${h}:${String(m).padStart(2, "0")}` : `⏱ ${m} min`;
}

// ===== Task History (ประวัติการดึง task ของห้อง — เรียง ASC) =====

/** กัน PO กด "นำมา Groom ใหม่" หลายแถวพร้อมกัน (duplicate history + task เขียบทับกัน) */
let historyReuseInFlight = false;

/** PO เห็นเท่านั้น — กดแล้ว re-resolve task เก่าให้เป็น task ปัจจุบัน (ได้ข้อมูลสดจาก ClickUp) */
async function handleReuseHistoryTask(entry: TaskHistoryEntry, btn: HTMLButtonElement): Promise<void> {
  if (!isPO() || !state.currentRoom || historyReuseInFlight) return;
  historyReuseInFlight = true;
  btn.disabled = true;
  btn.textContent = "…กำลังดึง";
  try {
    const task = await api<ResolvedTask>("/api/clickup/resolve-task", { input: entry.taskId });
    await applyResolvedTask(task);
    showToast(`✅ นำ "${task.name}" กลับมา groom แล้ว`);
    document.getElementById("task-history-modal")?.remove();
  } catch (err) {
    showToast(`❌ ${(err as Error).message}`);
    btn.disabled = false;
    btn.textContent = "นำมา Groom ใหม่";
  } finally {
    historyReuseInFlight = false;
  }
}

/** Modal ประวัติการดึง task — ทุกคนเปิดดูได้ (ปุ่ม reuse เฉพาะ PO) · เรียงเก่า→ใหม่ */
export async function openTaskHistory(): Promise<void> {
  if (!FEATURES.clickup || !state.currentRoom) return;
  document.getElementById("task-history-modal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "task-history-modal";
  overlay.className = "modal-overlay active task-history-modal";

  const content = document.createElement("div");
  content.className = "modal-content task-history-content";

  const header = document.createElement("div");
  header.className = "modal-header";
  const h2 = document.createElement("h2");
  h2.textContent = "🕘 ประวัติการดึง Task";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-icon";
  closeBtn.title = "ปิด";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.append(h2, closeBtn);

  const list = document.createElement("div");
  list.className = "task-history-list";
  list.textContent = "…กำลังโหลด";

  content.append(header, list);
  overlay.appendChild(content);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  // Esc ปิด modal เหมือน confirm modal — ถอด listener เสมอเมื่อกด Esc
  // (กัน leak กรณี modal ถูกปิดไปก่อนหน้าจากทางอื่น เช่น ✕ หรือคลิกนอกกล่อง)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    document.removeEventListener("keydown", onKey);
    if (overlay.isConnected) {
      e.preventDefault();
      overlay.remove();
    }
  };
  document.addEventListener("keydown", onKey);
  (document.getElementById("app") || document.body).appendChild(overlay);

  const snap = await get(query(ref(db, `rooms/${state.currentRoom}/taskHistory`), orderByKey()));
  const entries = Object.entries((snap.val() ?? {}) as Record<string, TaskHistoryEntry>);
  list.textContent = "";
  if (entries.length === 0) {
    list.textContent = "ยังไม่มีประวัติการดึง task ในห้องนี้";
    return;
  }
  // ── คำนวณ "ค่าล่าสุดของแต่ละการ์ด" สำหรับยอดรวม ──
  // แสดงครบทุกรอบ (groom ซ้ำกี่ครั้ง = กี่บรรทัด เห็น duration แยกรอบ)
  // แต่ยอดรวมนับเฉพาะรอบล่าสุดที่บันทึกค่าได้ของแต่ละ taskId — รอบเก่าโดน mark 🔁
  const hasValues = (e: TaskHistoryEntry): boolean =>
    e.dev != null || e.qa != null || e.devRange != null || e.qaRange != null;
  /** index ของรอบเก่าที่มีรอบใหม่กว่า (การ์ดเดียวกัน) — 🔁 + point จางลง + ไม่นับยอดรวม */
  const superseded = new Set<number>();
  /** taskId → index รอบล่าสุดที่มีค่า — ตัวที่ถูกนับในยอดรวม */
  const latestByTask = new Map<string, number>();
  entries.forEach(([_, e], i) => {
    if (!hasValues(e)) return;
    const prev = latestByTask.get(e.taskId);
    if (prev !== undefined) superseded.add(prev);
    latestByTask.set(e.taskId, i);
  });
  let totalDev = 0;
  let totalQa = 0;
  let devCards = 0;
  let qaCards = 0;
  for (const i of latestByTask.values()) {
    const e = entries[i][1];
    // รวมเฉพาะเลขโหมด groom — ช่วง pre ("1-3") รวมกันไม่ได้
    if (e.dev != null) {
      totalDev += e.dev;
      devCards++;
    }
    if (e.qa != null) {
      totalQa += e.qa;
      qaCards++;
    }
  }

  const pointText = (v: number | null | undefined, range: string | null | undefined): string =>
    v != null ? fmt(v) : range ?? "—";

  // push key เรียงตามเวลาอยู่แล้ว → วนตามลำดับ = ASC (เก่า → ใหม่)
  entries.forEach(([_, entry], i) => {
    const oldRound = superseded.has(i);
    const row = document.createElement("div");
    row.className = "task-history-row";

    const no = document.createElement("span");
    no.className = "task-history-no";
    no.textContent = String(i + 1);

    const time = document.createElement("span");
    time.className = "task-history-time";
    time.textContent = entry.resolvedAt ? formatDateTime(entry.resolvedAt) : "—";

    const link = document.createElement("a");
    link.className = "task-history-name";
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${entry.name} ↗`;
    link.title = entry.name; // ดูชื่อเต็มตอนโดนตัดเป็น ...

    row.append(no, time, link);
    if (oldRound) {
      const regroom = document.createElement("span");
      regroom.className = "task-history-regroom";
      regroom.textContent = "🔁";
      regroom.title = "การ์ดนี้ถูกนำมา groom ใหม่ในรอบหลัง ๆ — ค่าของบรรทัดนี้ไม่ถูกนับในยอดรวม";
      row.appendChild(regroom);
    }
    if (isPO()) {
      const reuse = document.createElement("button");
      reuse.type = "button";
      reuse.className = "btn btn-task-history-reuse";
      reuse.textContent = "นำมา Groom ใหม่";
      reuse.addEventListener("click", () => void handleReuseHistoryTask(entry, reuse));
      row.appendChild(reuse);
    }
    const duration = document.createElement("span");
    duration.className = "task-history-duration";
    duration.textContent = formatHistoryDuration(entry);
    duration.title = "เวลาตั้งแต่ดึง task จนบันทึกลง ClickUp";
    row.appendChild(duration);

    const pointTitle = "point ที่บันทึกลง ClickUp ของรอบนี้ (— = ยังไม่บันทึก หรือรายการเก่าก่อนมีการจด)";
    const dev = document.createElement("span");
    dev.className = "task-history-point" + (oldRound ? " old" : "");
    dev.textContent = pointText(entry.dev, entry.devRange);
    dev.title = `Dev — ${pointTitle}`;
    const qa = document.createElement("span");
    qa.className = "task-history-point" + (oldRound ? " old" : "");
    qa.textContent = pointText(entry.qa, entry.qaRange);
    qa.title = `QA — ${pointTitle}`;
    row.append(dev, qa);
    list.appendChild(row);
  });

  // แถวรวมท้ายตาราง — sticky ก้นพื้นที่ scroll เห็นตลอด (column ตรงกับแถวข้อมูล)
  const totalRow = document.createElement("div");
  totalRow.className = "task-history-row task-history-total";
  const emptyNo = document.createElement("span");
  emptyNo.className = "task-history-no";
  const emptyTime = document.createElement("span");
  emptyTime.className = "task-history-time";
  const totalLabel = document.createElement("span");
  totalLabel.className = "task-history-total-label";
  totalLabel.textContent = "รวม (นับค่าล่าสุดของแต่ละการ์ด)";
  totalLabel.title =
    "การ์ดที่ถูก groom ซ้ำนับเฉพาะค่ารอบล่าสุด · ช่วง pre-groom (เช่น 1-3) ไม่เข้ายอดรวม";
  totalRow.append(emptyNo, emptyTime, totalLabel);
  if (isPO()) {
    // spacer กว้างเท่าปุ่ม reuse — จัดคอลัมน์ Dev/QA ให้ตรงแถวข้อมูล (มองไม่เห็น ไม่กดได้)
    const reuseSpacer = document.createElement("span");
    reuseSpacer.className = "btn-task-history-reuse task-history-spacer";
    reuseSpacer.textContent = "นำมา Groom ใหม่";
    totalRow.appendChild(reuseSpacer);
  }
  const durSpacer = document.createElement("span");
  durSpacer.className = "task-history-duration";
  totalRow.appendChild(durSpacer);
  const totalDevEl = document.createElement("span");
  totalDevEl.className = "task-history-point";
  totalDevEl.textContent = devCards > 0 ? fmt(totalDev) : "—";
  totalDevEl.title = `ผลรวม Dev ของค่าล่าสุด ${devCards} การ์ด`;
  const totalQaEl = document.createElement("span");
  totalQaEl.className = "task-history-point";
  totalQaEl.textContent = qaCards > 0 ? fmt(totalQa) : "—";
  totalQaEl.title = `ผลรวม QA ของค่าล่าสุด ${qaCards} การ์ด`;
  totalRow.append(totalDevEl, totalQaEl);
  list.appendChild(totalRow);

  // Footer ล่างขวา — ปุ่มล้างประวัติทั้งหมด (PO เท่านั้น และมีรายการให้ล้าง)
  if (isPO() && entries.length > 0) {
    const footer = document.createElement("div");
    footer.className = "task-history-footer";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "btn btn-task-history-clear";
    clearBtn.textContent = `🗑 ล้างประวัติทั้งหมด (${entries.length})`;
    clearBtn.addEventListener("click", () => {
      showConfirmModal({
        title: "ล้างประวัติการดึง Task?",
        message: `จะลบรายการทั้งหมด ${entries.length} รายการออกจากห้องนี้\nกู้คืนไม่ได้`,
        confirmText: "ล้างทั้งหมด",
        danger: true,
        onConfirm: async () => {
          if (!state.currentRoom) return;
          await remove(ref(db, `rooms/${state.currentRoom}/taskHistory`));
          overlay.remove();
          showToast("🧹 ล้างประวัติการดึง task แล้ว");
        },
      });
    });
    footer.appendChild(clearBtn);
    content.appendChild(footer);
  }
}

let saveInFlight = false;
/** ให้ voting.ts อ่าน (ปุ่มบันทึกโชว์ "…กำลังบันทึก" ระหว่างบันทึก — updateUI ทับ label ทุก tick
 *  จึงต้องเช็ค flag นี้ใน updateUI แทนการ set ค่าค้างไว้ตอนกด) */
export const isSaveInFlight = (): boolean => saveInFlight;

const saveStateListeners = new Set<() => void>();
/** voting.ts สมัครรับ event ตอนเริ่ม/จบการบันทึก เพื่อ re-render ปุ่มทันที —
 *  ห้ามรอ room tick อย่างเดียว (ระหว่างบันทึกห้องอาจนิ่ง onValue ไม่ยิง ปุ่มจะดูค้าง)
 *  คืนฟังก์ชันถอด listener กัน stacking เวลาเรียกซ้ำ */
export function onSaveStateChange(cb: () => void): () => void {
  saveStateListeners.add(cb);
  return () => saveStateListeners.delete(cb);
}

function setSaveInFlight(v: boolean): void {
  saveInFlight = v;
  for (const cb of saveStateListeners) cb();
}

/** ครอบ action ด้วยสถานะ "กำลังบันทึก" + wake notice — ใช้ทั้ง flow หลักและ onConfirm
 *  ของ modal ทับค่าเดิม (ตอนกดยืนยันใน modal handler หลักจบไปแล้ว ต้องครอบอีกรอบ
 *  ไม่งั้นช่วงบันทึกจริงไม่มี loading และกดปุ่มซ้ำได้) */
async function withSaveBusy(action: () => Promise<void>): Promise<void> {
  const wakeTimer = armWakeNotice("บันทึก");
  setSaveInFlight(true);
  try {
    await action();
  } finally {
    window.clearTimeout(wakeTimer);
    setSaveInFlight(false);
  }
}

/** ถ้า action ใช้เวลาเกิน 8 วิ (ปกติ backend หลับ) — กล่องกลางจอค้าง 4 วิ บอกว่ารอได้ ไม่ต้องกดซ้ำ */
function armWakeNotice(action: string): number {
  return window.setTimeout(() => showWakeNotice(action), 8000);
}

export async function handleSaveToClickUp(): Promise<void> {
  if (!isPO() || !state.currentRoom || saveInFlight) return;
  await withSaveBusy(doSaveToClickUp);
}

async function doSaveToClickUp(): Promise<void> {
  if (!state.currentRoom) return;
  const snap = await get(ref(db, `rooms/${state.currentRoom}`));
  const data = snap.val() as RoomData | null;
  if (!data) return;
  const task = data.activeTask ?? null;
  if (!data.revealed) {
    showToast("⚠️ ต้อง Reveal ผลโหวตก่อนบันทึก");
    return;
  }
  if (!task) {
    showToast("⚠️ ยังไม่ได้เลือก task จาก ClickUp");
    return;
  }

  const entries = Object.entries(data.users ?? {}).filter(([, u]) => !u.left);
  const devList = entries.filter(([, u]) => u.role === "dev");
  const qaList = entries.filter(([, u]) => u.role === "qa");
  const mode: GroomMode = data.groomMode ?? "groom";

  // ── Pre-Groom: คอมเม้น min-max อย่างเดียว ไม่แตะ custom field ──
  if (mode === "pre") {
    const dev = rangeFor(devList);
    const qa = rangeFor(qaList);
    if (dev === null && qa === null) {
      showToast("⚠️ ไม่มีโหวตจาก Dev/QA ให้บันทึก");
      return;
    }
    try {
      await api("/api/clickup/post-comment", {
        taskId: task.taskId,
        comment: buildGroomingComment(mode, dev, qa, entries, state.currentUser?.uid ?? null),
      });
      const parts = [dev !== null && `Dev ${dev}`, qa !== null && `QA ${qa}`]
        .filter(Boolean)
        .join(" · ");
      // สำเร็จ — ใช้ splash กลางจออย่างเดียวเหมือน groom (ไม่มี toast มุมล่าง)
      showSaveSplash(
        [
          dev !== null && { label: "Dev", value: dev },
          qa !== null && { label: "QA", value: qa },
        ].filter(Boolean) as { label: string; value: string }[],
        "✅ บันทึก Pre-Groom ลง ClickUp แล้ว"
      );
      void sendSystemMessage(`บันทึก Pre-Groom ลง ClickUp แล้ว → ${task.name} (${parts})`);
      void recordSavedAt(task.historyKey, {
        mode,
        dev: null,
        qa: null,
        devRange: dev,
        qaRange: qa,
      });
    } catch (err) {
      showToast(`❌ ${(err as Error).message}`);
    }
    return;
  }

  // ── Groom: ทุกคนใน role (ไม่นับคนที่ออกแล้ว) ต้องโหวตเลขเดียวกันถึงบันทึกได้ ──
  const dev = unanimousFor(devList);
  const qa = unanimousFor(qaList);
  const pending: string[] = [];
  if (devList.length > 0 && dev === null) pending.push(`Dev (${votesStr(devList)})`);
  if (qaList.length > 0 && qa === null) pending.push(`QA (${votesStr(qaList)})`);
  if (pending.length > 0) {
    showToast(`⚠️ ${pending.join(" และ ")} ยังโหวตไม่ตรงกัน — คุยกันให้ได้ค่าเดียวกันก่อน`);
    return;
  }
  if (dev === null && qa === null) {
    showToast("⚠️ ไม่มีโหวตจาก Dev/QA ให้บันทึก");
    return;
  }

  let existing: ExistingPoints;
  try {
    existing = await api<ExistingPoints>("/api/clickup/check-existing", {
      taskId: task.taskId,
    });
  } catch (err) {
    showToast(`❌ ${(err as Error).message}`);
    return;
  }

  const doSave = async (): Promise<void> => {
    try {
      const result = await api<SaveResult>("/api/clickup/save-points", {
        taskId: task.taskId,
        dev,
        qa,
        comment: buildGroomingComment(
          mode,
          dev !== null ? fmt(dev) : null,
          qa !== null ? fmt(qa) : null,
          entries,
          state.currentUser?.uid ?? null
        ),
      });
      const saved: string[] = [];
      const failed: string[] = [];
      if (result.dev) (result.dev.ok ? saved : failed).push(`Dev ${fmt(dev!)}`);
      if (result.qa) (result.qa.ok ? saved : failed).push(`QA ${fmt(qa!)}`);
      const commentFailed = result.comment && !result.comment.ok;
      if (failed.length) {
        showToast(`❌ บันทึกไม่สำเร็จ: ${failed.join(", ")}`);
      } else if (commentFailed) {
        showToast("⚠️ บันทึกคะแนนสำเร็จ แต่คอมเม้นบนการ์ดไม่สำเร็จ");
      } else {
        // สำเร็จ — ไม่มี toast มุมล่างแล้ว ใช้ splash กลางจออย่างเดียว
        // (โชว์ชื่อ custom field จริง + ค่าที่บันทึก + พลุ)
        showSaveSplash(
          [
            result.dev?.ok && { label: result.dev.field ?? "Dev", value: fmt(dev!) },
            result.qa?.ok && { label: result.qa.field ?? "QA", value: fmt(qa!) },
          ].filter(Boolean) as { label: string; value: string }[]
        );
      }
      if (saved.length) {
        void sendSystemMessage(
          `บันทึกคะแนนลง ClickUp แล้ว → ${task.name} (${saved.join(" · ")})`
        );
      }
      // จด duration + point เฉพาะรอบที่ field สำเร็จครบ (บางส่วนพัง = รอบยังไม่จบ อย่าให้ history หลอกว่าเสร็จ)
      if (failed.length === 0 && saved.length > 0) {
        void recordSavedAt(task.historyKey, {
          mode: "groom",
          dev,
          qa,
          devRange: null,
          qaRange: null,
        });
      }
    } catch (err) {
      showToast(`❌ ${(err as Error).message}`);
    }
  };

  // การ์ดมีค่าเดิม → ยืนยันก่อนเขียนทับ (modal รองรับ multi-line ผ่าน white-space: pre-line)
  // กดยืนยันแล้วครอบด้วย withSaveBusy อีกรอบ — handler หลักจบไปแล้ว ค่าเดิมจะได้มี loading เหมือนกัน
  if (existing.dev != null || existing.qa != null) {
    const changes: string[] = ["บันทึกทับค่าเดิมใน ClickUp ไหม?"];
    if (dev !== null) changes.push(`Dev: ${fmt(existing.dev ?? 0)} → ${fmt(dev)}`);
    if (qa !== null) changes.push(`QA: ${fmt(existing.qa ?? 0)} → ${fmt(qa)}`);
    showConfirmModal({
      title: "การ์ดนี้มีค่าอยู่แล้ว",
      message: changes.join("\n"),
      confirmText: "บันทึกทับ",
      danger: true,
      onConfirm: () => withSaveBusy(doSave),
    });
    return;
  }
  await doSave();
}
