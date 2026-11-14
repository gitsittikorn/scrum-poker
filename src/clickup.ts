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
  noNeedToggles,
  noNeedTaskCheckbox,
  noNeedTestCheckbox,
  hotFixCheckbox,
} from "./dom";
import { showConfirmModal, showToast, showSaveSplash, showWakeNotice } from "./ui";
import { sendSystemMessage } from "./chat";
import { buildGroomingComment, dedupeTaskLinks, formatDateTime, parseRange, rangeFor, safeHttpUrl, unanimousFor } from "./utils";
import { FEATURES } from "./config";
import { ADMIN_ROOM } from "./constants";
import { isPO, isRoomAdmin, state } from "./state";
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

/** Backend base URL จาก ENV (.env.development / .env.production) — ถ้า ENV ไม่ถูก
 *  define ตอน build จะได้ "" = same-origin (Hosting rewrite /api/** → function api)
 *  ป้องกัน bundle ที่ bake "undefined/api/..." แบบเงียบ ๆ แบบที่เคยเกิด */
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "";

/** POST เล็ก ๆ ไป backend — แปลง HTTP error เป็น message ภาษาไทยสำหรับ toast */
async function api<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
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

/** ชื่อที่ใช้แสดง/ส่งไป ClickUp ของผู้ใช้ปัจจุบัน — realName จาก member list
 *  (identity เดียวกับ attendees ใน comment) fallback ชื่อเล่นเฉพาะข้อมูลเก่า/ห้องไม่บังคับ */
const myDisplayName = (): string =>
  state.currentUser?.realName || state.currentUser?.name || "";

/** จำนวนประวัติการดึง task สูงสุดต่อห้อง (เกินตัดรายการเก่าทิ้ง) */
const TASK_HISTORY_LIMIT = 30;

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
  // req 15 — dedupe ก่อน render: รูปเดียวกันที่มาจากทั้ง description และ attachment
  // (หรือลิงก์เก่าใน Firebase ที่เก็บซ้ำมาก่อน) ต้องเหลือไอคอนเดียว
  const deduped = dedupeTaskLinks(links);
  const key = deduped.map((l) => `${l.type}:${l.url}`).join("|");
  if (key === renderedLinksKey) return;
  renderedLinksKey = key;
  clickupLinks.innerHTML = "";
  for (const l of deduped) {
    const a = document.createElement("a");
    a.className = "clickup-link" + (GENERIC_LINK_TYPES.has(l.type) ? " clickup-link-generic" : "");
    a.href = safeHttpUrl(l.url); // ลิงก์จาก Firebase — ยอมเฉพาะ http(s) กัน javascript:
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
  // req 14 — No Need Test ใช้ได้เฉพาะเมื่อมี task ปัจจุบัน (ดึงสำเร็จ = enabled
  // task ถูกล้าง/reset/บันทึกจบรอบ = unchecked + disabled) — sync ทุก room tick
  updateNoNeedTestCheckbox(task);
  updateHotFixCheckbox(task);
  // req 16 — checkbox ทั้งสองเห็นเฉพาะ admin ของห้อง (PO + deputy ตาม isRoomAdmin:
  // ตรวจ uid จาก PO_DEPUTY_UIDS ก่อน แล้ว realName จาก member list — ไม่ใช้ชื่อที่แสดง)
  noNeedToggles.classList.toggle("hidden", !isRoomAdmin());
  const po = isPO();
  // ซ่อนทั้งอันเมื่อปิด flag / ไม่มี task และไม่ใช่ admin ของห้อง (PO + deputy)
  clickupBanner.classList.toggle("hidden", !isRoomAdmin() && !task);
  // input ดึงการ์ด — admin ของห้อง (PO + deputy เช่น Dev Cing) ดึงการ์ดได้เหมือน PO
  // input ผู้ใช้กำลังพิมพ์อยู่ — ห้ามแตะ value ในนี้ ไม่งั้นโดนเคลียร์ทุก room tick
  clickupInputRow.classList.toggle("hidden", !isRoomAdmin());
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
    clickupTaskDisplay.href = safeHttpUrl(task.url);
    clickupTaskName.textContent = task.name; // แสดงแค่ชื่อการ์ด (ไม่ใส่ customId)
    clickupTaskDisplay.title = task.name;
    renderTaskLinks(task.links);
  } else {
    clickupTaskRow.classList.add("hidden");
    renderTaskLinks(undefined);
  }
}

// ===== Task Required Reminder ("ยังไม่ได้เลือกการ์ด" — เตือน admin ของห้อง) =====

/** เคย scroll ขึ้นไปโชว์แถบเตือนแล้วใน episode นี้ — กัน scroll ซ้ำทุก real-time tick
 *  (reset เป็น false เมื่อเงื่อนไขเตือนหายไป = มี task แล้ว / lock / reveal) */
let taskReminderScrolled = false;

/** roomData ล่าสุดจาก room tick — ให้ setNoNeedTest คำนวณการแสดงแถบเตือนใหม่ได้
 *  ทันทีตอน toggle checkbox (req 17: ห้องนิ่ง ๆ onValue ไม่ยิง ถ้ารอ tick เอง
 *  แถบที่ซ่อนไว้จะไม่กลับมาหลัง uncheck จนกว่าจะมีคนขยับห้อง) */
let lastReminderRoomData: RoomData | null = null;

/** แถบ "ยังไม่ได้เลือกการ์ด — กรุณาดึง Task จาก ClickUp ก่อนดำเนินการโหวต"
 *  แสดงเฉพาะ admin ของห้อง (PO + deputy เช่น Dev Cing — ตาม isRoomAdmin)
 *  สมาชิกทั่วไปไม่เห็น (banner ถูกซ่อนอยู่แล้วสำหรับ non-admin ที่ไม่มี task)
 *  แสดงตั้งแต่ยังไม่มี task (จะได้ดึงก่อนเริ่มโหวต) และเน้นย้ำเมื่อมีคนเริ่มโหวต
 *  PO ดึงการ์ดแล้ว = แถบหายทันที (real-time ผ่าน room tick)
 *  req 13 — "Groom ไม่มี Task" (rooms/{roomId}/noNeedTask — sync ทั้งห้อง) ทำให้
 *  active = false ทั้งแถบ: ซ่อนแถบ + ไม่ scroll + ไม่ pulse โดยไม่แตะข้อมูลห้องอื่น */
export function updateTaskRequiredReminder(roomData: RoomData): void {
  lastReminderRoomData = roomData; // เก็บ snapshot ไว้ให้ setNoNeedTask re-render ทันที (req 17)
  const el = document.getElementById("task-required-reminder");
  // sync ค่าจากห้อง → เครื่องนี้ (เฉพาะ admin): checkbox และ state mirror ค่าเดียวกันทั้งห้อง
  // ยึดค่าห้องเฉพาะเมื่อมาเป็น boolean ชัด ๆ — undefined = ยังไม่เคยติ๊กในห้องนี้ หรือ write
  // ของเครื่องเรายังไม่ propagation → ยึด state ในเครื่องไปก่อน กันแถบกะพริบตอนห้องนิ่ง
  if (isRoomAdmin() && typeof roomData.noNeedTask === "boolean") {
    const synced = roomData.noNeedTask;
    if (noNeedTaskCheckbox.checked !== synced) noNeedTaskCheckbox.checked = synced;
    state.noNeedTask = synced;
  }
  if (!el) return;
  const active =
    FEATURES.clickup &&
    !state.isWheelRoom &&
    state.currentRoom !== ADMIN_ROOM &&
    isRoomAdmin() &&
    !state.noNeedTask &&
    !roomData.activeTask &&
    !roomData.revealed &&
    !roomData.locked;
  el.classList.toggle("hidden", !active);
  if (active && !taskReminderScrolled) {
    taskReminderScrolled = true;
    // เลื่อนไปที่แถบเตือน (อยู่บนหัว banner เหนือช่อง URL ของ PO) — ครั้งเดียวต่อ episode
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (!active) taskReminderScrolled = false;
}

// ===== No Need Task / No Need Test (req 13-14) =====

/** req 13 — toggle "Groom ไม่มี Task": ซ่อน/แสดงแถบเตือนให้ดึง task ทันทีที่ toggle
 *  sync ทั้งห้อง — เขียนลง rooms/{roomId}/noNeedTask ให้ admin ทุกเครื่อง (PO + deputy)
 *  หายแถบพร้อมกันแบบ real-time (แก้จากเดิมที่เป็น preference รายเครื่อง)
 *  ไม่ลบ task ที่ดึงมาแล้วและไม่แตะคะแนนโหวตเดิม — payload มีเฉพาะ field เดียว
 *  req 17 — คำนวณการแสดงผลใหม่ทันทีทั้งตอน check (ซ่อน) และ uncheck (กลับมาแสดง)
 *  จาก snapshot ที่ patch ค่าใหม่ — ไม่ต้องรอ room tick (ห้องนิ่ง onValue ไม่ยิง)
 *  ค่าจริงจะมายืนยันทาง room tick ตามหลังเสมอ
 *  req 16 — เปลี่ยนสถานะได้เฉพาะ admin ของห้อง (กันเรียกจากผู้ไม่มีสิทธิ์/console) */
export function setNoNeedTask(checked: boolean): void {
  if (!isRoomAdmin()) return;
  state.noNeedTask = checked;
  if (state.currentRoom) {
    // sync ทั้งห้อง — เขียนเฉพาะ field เดียว ไม่แตะ task/โหวต
    void update(ref(db, `rooms/${state.currentRoom}`), { noNeedTask: checked }).catch(() => {});
  }
  if (lastReminderRoomData) {
    // patch snapshot ด้วยค่าที่เพิ่งติ๊กแล้ว re-render ทันที (รวม scroll episode ใหม่)
    lastReminderRoomData = { ...lastReminderRoomData, noNeedTask: checked };
    updateTaskRequiredReminder(lastReminderRoomData);
    return;
  }
  // ยังไม่เคยมี room tick เลย — ซ่อนได้อย่างเดียว (ไม่รู้ว่าเข้าเงื่อนไขเตือนไหม)
  if (checked) {
    document.getElementById("task-required-reminder")?.classList.add("hidden");
  }
}

/** req 14 — sync สถานะ checkbox No Need Test ตาม task + flag ของห้อง (ทุก tick):
 *  มี task (ดึงสำเร็จ) → enabled + checked ตาม rooms/{roomId}/noNeedTest (mirror
 *  ที่ state.noNeedTest) · ไม่มี task (ยังไม่ดึง/ถูกล้าง/reset หลังบันทึก) → unchecked + disabled
 *  req 16 — ใช้ได้เฉพาะ admin ของห้อง: คนอื่นถูก force unchecked + disabled
 *  ทุก tick (แม้จะแก้ DOM มือผ่าน devtools ก็ถูกรีเซ็ตกลับ) */
export function updateNoNeedTestCheckbox(task: ActiveTask | null): void {
  const admin = isRoomAdmin();
  noNeedTestCheckbox.disabled = !admin || !task;
  if (!admin || !task) noNeedTestCheckbox.checked = false;
  else if (noNeedTestCheckbox.checked !== state.noNeedTest) {
    noNeedTestCheckbox.checked = state.noNeedTest;
  }
}

/** "Hot Fix" — sync สถานะ checkbox ตาม task + flag ของห้อง (same pattern กับ No Need Test) */
export function updateHotFixCheckbox(task: ActiveTask | null): void {
  const admin = isRoomAdmin();
  hotFixCheckbox.disabled = !admin || !task;
  if (!admin || !task) hotFixCheckbox.checked = false;
  else if (hotFixCheckbox.checked !== state.hotFix) {
    hotFixCheckbox.checked = state.hotFix;
  }
}

/** req 14 — สถานะ checkbox No Need Test ณ เวลาเรียก (อ่านสดจาก DOM ตอนกดบันทึกจริง
 *  disabled = ใช้ไม่ได้ คืน false เสมอ กันค่าค้างจากจังหวะกดก่อน task ถูกล้าง) */
export function isNoNeedTestChecked(): boolean {
  return !noNeedTestCheckbox.disabled && noNeedTestCheckbox.checked;
}

/** toggle "No Need Test" โดย admin (change ของ checkbox):
 *  1. sync ทั้งห้อง — เขียน rooms/{roomId}/noNeedTest ให้ทุกเครื่องเห็นสถานะเดียวกัน
 *     (การ์ด QA ถูกล็อค + ข้อความ "ไม่ต้องใส่ point" บนเครื่อง QA ผ่าน updateUI)
 *  2. เมื่อ "ติ๊ก" = เคลียร์ point ของ QA ทุกคน (ที่ยังอยู่ในห้อง) ทันทีในคำสั่งเดียว
 *  uncheck = แค่เขียน flag กลับ (QA โหวตใหม่ได้ตามปกติ) */
export async function handleNoNeedTestToggle(checked: boolean): Promise<void> {
  if (!isRoomAdmin() || !state.currentRoom) return;
  const updates: Record<string, unknown> = { noNeedTest: checked };
  if (checked) {
    const snap = await get(ref(db, `rooms/${state.currentRoom}/users`));
    const users = (snap.val() as Record<string, User> | null) ?? {};
    for (const [uid, u] of Object.entries(users)) {
      if (u?.role === "qa" && u.left !== true && u.vote != null) {
        updates[`users/${uid}/vote`] = null;
      }
    }
  }
  try {
    await update(ref(db, `rooms/${state.currentRoom}`), updates);
  } catch {
    showToast("⚠️ ตั้งค่า No Need Test ไม่สำเร็จ — ลองติ๊กอีกครั้ง");
  }
}

/** toggle "Hot Fix" โดย admin — sync ทั้งห้อง (rooms/{roomId}/hotFix)
 *  อิสระจาก No Need Test (เลือกอย่างเดียว/ทั้งคู่ก็ได้) ไม่แตะโหวตใคร
 *  ผลคือตอนบันทึก Point ระบบจะติด tag "hot fix" บนการ์ด ClickUp */
export async function handleHotFixToggle(checked: boolean): Promise<void> {
  if (!isRoomAdmin() || !state.currentRoom) return;
  try {
    await update(ref(db, `rooms/${state.currentRoom}`), { hotFix: checked });
  } catch {
    showToast("⚠️ ตั้งค่า Hot Fix ไม่สำเร็จ — ลองติ๊กอีกครั้ง");
  }
}

// ===== Handlers =====

/** เขียน activeTask ลงห้อง + บันทึกลงประวัติ (trim เกิน 30 ตัดรายการเก่าทิ้ง)
 *  ใช้ร่วมทั้งตอน PO วางลิงก์และตอน "นำมา Groom ใหม่" จาก history
 *  activeTask เก็บ historyKey เพื่อให้ตอนบันทึก ClickUp จด savedAt กลับได้
 *  setBy/resolvedBy = realName (ถ้ามี) ให้ตรงกับชื่อที่ส่งไป comment ClickUp
 *  → History Modal แสดงชื่อเดียวกับบนการ์ดเสมอ */
async function applyResolvedTask(task: ResolvedTask): Promise<void> {
  if (!state.currentRoom) return;
  const displayName = myDisplayName();
  const histRef = push(ref(db, `rooms/${state.currentRoom}/taskHistory`));
  await update(ref(db, `rooms/${state.currentRoom}`), {
    // task ใหม่ = No Need Test / Hot Fix เริ่มใหม่ (unchecked) ตาม req 14
    noNeedTest: false,
    hotFix: false,
    activeTask: {
      taskId: task.taskId,
      name: task.name,
      url: task.url,
      customId: task.customId,
      setBy: displayName,
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
    resolvedBy: displayName,
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
  // deputy (เช่น Dev Cing) ดึงการ์ดได้เหมือน PO — ใช้สิทธิ์ admin ของห้อง
  if (!isRoomAdmin() || !state.currentRoom) return;
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
  // deputy เคลียร์การ์ดที่ดึงได้เหมือน PO — ใช้สิทธิ์ admin ของห้อง
  if (!isRoomAdmin() || !state.currentRoom) return;
  try {
    // ล้าง task = No Need Test / Hot Fix กลับ unchecked ด้วย (ผูกกับ task ปัจจุบัน)
    await update(ref(db, `rooms/${state.currentRoom}`), { activeTask: null, noNeedTest: false, hotFix: false });
  } catch (err) {
    console.error("[clickup] clear task failed:", err);
    showToast(`❌ เคลียร์ task ไม่สำเร็จ: ${(err as Error).message}`);
    return;
  }
  clickupUrlInput.value = "";
  showToast("🧹 เคลียร์ task แล้ว");
}

/** PO สลับโหมดห้อง groom/pre — เก็บใน Firebase ทุกคนเห็น real-time (ไม่ auto สลับกลับ) */
export async function handleSetGroomMode(mode: GroomMode): Promise<void> {
  if (!isPO() || !state.currentRoom) return;
  try {
    await update(ref(db, `rooms/${state.currentRoom}`), { groomMode: mode });
  } catch (err) {
    console.error("[clickup] set groom mode failed:", err);
    showToast(`❌ สลับโหมดไม่สำเร็จ: ${(err as Error).message}`);
    return;
  }
  const label = mode === "pre" ? "Pre-Groom (คอมเม้นอย่างเดียว)" : "Groom (บันทึก field + คอมเม้น)";
  const icon = mode === "pre" ? "🌱" : "✅";
  showToast(`${icon} สลับเป็นโหมด ${label}`);
  void sendSystemMessage(`${icon} ห้องนี้สลับเป็นโหมด ${label}`);
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

/** admin ของห้อง (PO + deputy) — กดแล้ว re-resolve task เก่าให้เป็น task ปัจจุบัน (ได้ข้อมูลสดจาก ClickUp) */
async function handleReuseHistoryTask(entry: TaskHistoryEntry, btn: HTMLButtonElement): Promise<void> {
  if (!isRoomAdmin() || !state.currentRoom || historyReuseInFlight) return;
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

/** Modal ประวัติการดึง task — ทุกคนเปิดดูได้ (ปุ่ม reuse เฉพาะ PO) · เรียงเก่า→ใหม่
 *  กรองตาม PO ได้: dropdown ที่ header (เฉพาะ PO ที่เคยบันทึก) หรือคลิกชื่อในคอลัมน์ PO */
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
  header.append(h2, closeBtn);

  const list = document.createElement("div");
  list.className = "task-history-list";
  list.textContent = "…กำลังโหลด";

  content.append(header, list);
  overlay.appendChild(content);
  // ปิด modal ทุกทาง (✕ / คลิกนอกกล่อง / Esc / ปุ่มล้างประวัติ) ผ่าน closeModal
  // อันเดียว — ถอด keydown listener ทุกครั้ง กัน listener ซ้อนกันเมื่อเปิด-ปิด
  // หลายรอบโดยไม่ได้กด Esc (เดิม ✕/คลิกนอกไม่ถอด ทิ้ง listener ค้างทุกรอบ)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (overlay.isConnected) {
      e.preventDefault();
      closeModal();
    }
  };
  const closeModal = (): void => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", onKey);
  (document.getElementById("app") || document.body).appendChild(overlay);

  let entries: [string, TaskHistoryEntry][];
  try {
    const snap = await get(query(ref(db, `rooms/${state.currentRoom}/taskHistory`), orderByKey()));
    entries = Object.entries((snap.val() ?? {}) as Record<string, TaskHistoryEntry>);
  } catch (err) {
    // โหลดไม่ได้ → บอกผู้ใช้แทนค้าง "…กำลังโหลด" ตลอดไป (และไม่ปล่อย unhandled)
    console.error("[clickup] load task history failed:", err);
    list.textContent = "❌ โหลดประวัติไม่สำเร็จ — ปิดแล้วลองเปิดใหม่";
    return;
  }
  list.textContent = "";
  if (entries.length === 0) {
    list.textContent = "ยังไม่มีประวัติการดึง task ในห้องนี้";
    return;
  }
  // ── ตัวกรองตาม PO (คนกดดึง = resolvedBy) — dropdown เอาเฉพาะชื่อ PO ที่เคยบันทึก (savedAt)
  //  คลิกชื่อในคอลัมน์ PO ก็กรองได้ · 🔁 และยอดรวมคำนวณใหม่ใน subset ที่กรองทุกครั้ง ──
  let poFilter: string | null = null;
  let poSelect: HTMLSelectElement | null = null;
  const savedPoNames = [
    ...new Set(entries.filter(([, e]) => e.savedAt != null).map(([, e]) => e.resolvedBy)),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "th"));
  if (savedPoNames.length > 0) {
    const sel = document.createElement("select");
    sel.className = "task-history-filter";
    sel.title = "กรองรายการตาม PO ที่บันทึกลง ClickUp";
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "ทุก PO";
    sel.appendChild(allOpt);
    for (const n of savedPoNames) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      poFilter = sel.value || null;
      renderList();
    });
    poSelect = sel;
    header.insertBefore(sel, closeBtn); // h2 | dropdown กรอง | ✕
  }

  const hasValues = (e: TaskHistoryEntry): boolean =>
    e.dev != null || e.qa != null || e.devRange != null || e.qaRange != null;
  // ── แยกตาราง Pre-Groom / Groom — มีโหมดไหนแสดงเฉพาะโหมดนั้น ──
  // groomMode จดตอนบันทึกสำเร็จ · รายการเก่าก่อนมี field นี้ infer จากชนิดค่า
  // (มีแต่ช่วง = pre) · แถวที่ยังไม่บันทึก ("—") = task ที่กำลัง groom อยู่ → ตาราง Groom
  const modeOf = (e: TaskHistoryEntry): "pre" | "groom" =>
    e.groomMode ?? (e.dev == null && e.qa == null && (e.devRange != null || e.qaRange != null) ? "pre" : "groom");

  const pointText = (v: number | null | undefined, range: string | null | undefined): string =>
    v != null ? fmt(v) : range ?? "—";

  // แถวหัวตาราง — บอกความหมายคอลัมน์ (ช่องท้ายแถว = point ของฝั่ง Dev / QA แยกกัน)
  const buildHeadRow = (): HTMLElement => {
    const row = document.createElement("div");
    row.className = "task-history-headrow";
    const no = document.createElement("span");
    no.className = "task-history-no";
    no.textContent = "#";
    const time = document.createElement("span");
    time.className = "task-history-time";
    time.textContent = "เวลา";
    const name = document.createElement("span");
    name.className = "task-history-name";
    name.textContent = "Task";
    row.append(no, time, name);
    if (isPO()) {
      // spacer กว้างเท่าปุ่ม reuse — จัดหัวคอลัมน์หลังจากนี้ให้ตรงแถวข้อมูล (มองไม่เห็น ไม่กดได้)
      const reuseSpacer = document.createElement("span");
      reuseSpacer.className = "btn-task-history-reuse task-history-spacer";
      reuseSpacer.textContent = "นำมา Groom ใหม่";
      row.appendChild(reuseSpacer);
    }
    const duration = document.createElement("span");
    duration.className = "task-history-duration";
    duration.textContent = "ใช้เวลา";
    const dev = document.createElement("span");
    dev.className = "task-history-point";
    dev.textContent = "Dev";
    dev.title = "point ที่บันทึกลง ClickUp ของฝั่ง Dev";
    const qa = document.createElement("span");
    qa.className = "task-history-point";
    qa.textContent = "QA";
    qa.title = "point ที่บันทึกลง ClickUp ของฝั่ง QA";
    const po = document.createElement("span");
    po.className = "task-history-po";
    po.textContent = "PO";
    po.title = "คนที่ดึงและบันทึกรอบนี้ — คลิกชื่อในแถวเพื่อกรองรายการของคนนั้น";
    row.append(duration, dev, qa, po);
    return row;
  };

  /** แถวข้อมูล 1 รอบ — no = ลำดับภายในตารางนั้น (เริ่มนับใหม่ทุกตาราง) */
  const buildDataRow = (entry: TaskHistoryEntry, no: number, oldRound: boolean): HTMLElement => {
    const row = document.createElement("div");
    row.className = "task-history-row";

    const noEl = document.createElement("span");
    noEl.className = "task-history-no";
    noEl.textContent = String(no);

    const time = document.createElement("span");
    time.className = "task-history-time";
    time.textContent = entry.resolvedAt ? formatDateTime(entry.resolvedAt) : "—";

    // name cell ห่อลิงก์ + badge 🔁 ไว้ในช่องเดียว — แถวที่มี badge ไม่ดันคอลัมน์หลังให้เพี้ยน
    const nameCell = document.createElement("span");
    nameCell.className = "task-history-name-cell";
    const link = document.createElement("a");
    link.className = "task-history-name";
    link.href = safeHttpUrl(entry.url); // จาก Firebase — ยอมเฉพาะ http(s) กัน javascript:
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${entry.name} ↗`;
    link.title = entry.name; // ดูชื่อเต็มตอนโดนตัดเป็น ...
    nameCell.appendChild(link);
    if (oldRound) {
      const regroom = document.createElement("span");
      regroom.className = "task-history-regroom";
      regroom.textContent = "🔁";
      regroom.title = "การ์ดนี้ถูกนำมา groom ใหม่ในรอบหลัง ๆ — ค่าของบรรทัดนี้ไม่ถูกนับในยอดรวม";
      nameCell.appendChild(regroom);
    }

    row.append(noEl, time, nameCell);
    if (isRoomAdmin()) {
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
    // คอลัมน์ PO — คลิกชื่อเพื่อกรองตารางตามคนนั้น (คลิกซ้ำ = เอาตัวกรองออก)
    if (entry.resolvedBy) {
      const poBtn = document.createElement("button");
      poBtn.type = "button";
      poBtn.className = "task-history-po" + (poFilter === entry.resolvedBy ? " active" : "");
      poBtn.textContent = entry.resolvedBy;
      poBtn.title = `กรองรายการของ ${entry.resolvedBy}`;
      poBtn.addEventListener("click", () => {
        poFilter = poFilter === entry.resolvedBy ? null : entry.resolvedBy;
        if (poSelect) {
          // ชื่อที่คลิกอาจไม่อยู่ใน dropdown (PO ที่ยังไม่เคยบันทึก) — เพิ่มชั่วคราวไม่งั้น select โชว์ว่าง
          if (poFilter && ![...poSelect.options].some((o) => o.value === poFilter)) {
            const opt = document.createElement("option");
            opt.value = poFilter;
            opt.textContent = poFilter;
            poSelect.appendChild(opt);
          }
          // เอากรองออก → ลบ option ชั่วคราว คืนกฎ "dropdown = ทุก PO + ที่เคยบันทึกเท่านั้น"
          if (!poFilter) [...poSelect.options].forEach((o) => {
            if (o.value && !savedPoNames.includes(o.value)) o.remove();
          });
          poSelect.value = poFilter ?? "";
        }
        renderList();
      });
      row.append(dev, qa, poBtn);
    } else {
      const poEmpty = document.createElement("span");
      poEmpty.className = "task-history-po";
      poEmpty.textContent = "—";
      row.append(dev, qa, poEmpty);
    }
    return row;
  };

  // แถวรวมท้ายตาราง (column ตรงกับแถวข้อมูล) — wrapper เดียวให้ sticky ทั้งกลุ่ม
  // ตาราง Groom = เลขยืนยันแล้ว (ขอบ accent) · ตาราง Pre = ช่วง Σmin–Σmax ยังไม่ยืนยัน (ขอบเรียบ)
  const buildTotalRow = (
    label: string,
    title: string,
    devText: string,
    devTitle: string,
    qaText: string,
    qaTitle: string,
    extraClass = ""
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = "task-history-row task-history-total" + (extraClass ? ` ${extraClass}` : "");
    const emptyNo = document.createElement("span");
    emptyNo.className = "task-history-no";
    const emptyTime = document.createElement("span");
    emptyTime.className = "task-history-time";
    const labelEl = document.createElement("span");
    labelEl.className = "task-history-total-label";
    labelEl.textContent = label;
    labelEl.title = title;
    row.append(emptyNo, emptyTime, labelEl);
    if (isPO()) {
      // spacer กว้างเท่าปุ่ม reuse — จัดคอลัมน์ Dev/QA ให้ตรงแถวข้อมูล (มองไม่เห็น ไม่กดได้)
      const reuseSpacer = document.createElement("span");
      reuseSpacer.className = "btn-task-history-reuse task-history-spacer";
      reuseSpacer.textContent = "นำมา Groom ใหม่";
      row.appendChild(reuseSpacer);
    }
    const durSpacer = document.createElement("span");
    durSpacer.className = "task-history-duration";
    row.appendChild(durSpacer);
    const devEl = document.createElement("span");
    devEl.className = "task-history-point";
    devEl.textContent = devText;
    devEl.title = devTitle;
    const qaEl = document.createElement("span");
    qaEl.className = "task-history-point";
    qaEl.textContent = qaText;
    qaEl.title = qaTitle;
    const poSpacer = document.createElement("span");
    poSpacer.className = "task-history-po";
    row.append(devEl, qaEl, poSpacer);
    return row;
  };
  /** ช่วงรวม pre — "Σmin-Σmax" ติดกัน (min==max ทุกใบ → เลขเดียว) */
  const rangeTotalText = (min: number, max: number): string =>
    min === max ? fmt(min) : `${fmt(min)}-${fmt(max)}`;

  /** ตาราง 1 โหมด — หัวเรื่อง + หัวคอลัมน์ + แถวข้อมูล (ASC) + ยอดรวม sticky ท้ายตาราง
   *  superseded คำนวณตาม subset ที่กรองแล้ว (renderList) → ส่งเข้ามาเพราะต่างกันทุกครั้งที่กรอง */
  const buildSection = (
    mode: "pre" | "groom",
    idxs: number[],
    totalRow: HTMLElement,
    superseded: Set<number>
  ): HTMLElement => {
    const section = document.createElement("div");
    section.className = `task-history-section ${mode}`;

    const title = document.createElement("div");
    title.className = "task-history-section-title";
    const name = document.createElement("span");
    name.className = "task-history-section-name";
    name.textContent = mode === "pre" ? "🌱 Pre-Groom" : "✅ Groom";
    const sub = document.createElement("span");
    sub.className = "task-history-section-sub";
    sub.textContent =
      mode === "pre"
        ? "point เป็นช่วง min–max ยังไม่ยืนยัน (บันทึกเป็นคอมเม้นอย่างเดียว)"
        : "point ยืนยันแล้ว — คอลัมน์ Dev / QA คือ point ของแต่ละฝั่ง";
    title.append(name, sub);

    const totals = document.createElement("div");
    totals.className = "task-history-totals";
    totals.appendChild(totalRow);

    section.append(title, buildHeadRow());
    // push key เรียงตามเวลาอยู่แล้ว → วนตามลำดับ index = ASC (เก่า → ใหม่) ภายในตาราง
    idxs.forEach((i, pos) => section.appendChild(buildDataRow(entries[i][1], pos + 1, superseded.has(i))));
    section.appendChild(totals);
    return section;
  };

  /** วาดตารางใหม่ตามตัวกรอง PO — 🔁 และยอดรวมคำนวณใหม่ใน subset ที่กรองทุกครั้ง */
  const renderList = (): void => {
    list.textContent = "";
    // index ของรายการที่โชว์ (ทั้งหมด หรือเฉพาะ PO ที่กรอง) — ทุกการคำนวณด้านล่างใช้ subset นี้
    const idx = entries.map((_, i) => i).filter((i) => !poFilter || entries[i][1].resolvedBy === poFilter);
    /** index ของรอบเก่าที่มีรอบใหม่กว่า (การ์ดเดียวกัน) — 🔁 + point จางลง + ไม่นับยอดรวม */
    const superseded = new Set<number>();
    /** taskId → index รอบล่าสุดที่มีค่า — ตัวที่ถูกนับในยอดรวม */
    const latestByTask = new Map<string, number>();
    idx.forEach((i) => {
      const e = entries[i][1];
      if (!hasValues(e)) return;
      const prev = latestByTask.get(e.taskId);
      if (prev !== undefined) superseded.add(prev);
      latestByTask.set(e.taskId, i);
    });
    const preIdx = idx.filter((i) => modeOf(entries[i][1]) === "pre");
    const groomIdx = idx.filter((i) => modeOf(entries[i][1]) === "groom");

    // ยอดรวมแยกตามตาราง — เลขยืนยันเข้าตาราง Groom · ช่วง ("1-3") แยก min/max รวมเป็น Σmin–Σmax เข้าตาราง Pre
    let totalDev = 0;
    let totalQa = 0;
    let devCards = 0;
    let qaCards = 0;
    let preDevMin = 0;
    let preDevMax = 0;
    let preDevCards = 0;
    let preQaMin = 0;
    let preQaMax = 0;
    let preQaCards = 0;
    for (const i of latestByTask.values()) {
      const e = entries[i][1];
      if (modeOf(e) === "groom") {
        if (e.dev != null) {
          totalDev += e.dev;
          devCards++;
        }
        if (e.qa != null) {
          totalQa += e.qa;
          qaCards++;
        }
      } else {
        const d = parseRange(e.devRange);
        if (d) {
          preDevMin += d.min;
          preDevMax += d.max;
          preDevCards++;
        }
        const q = parseRange(e.qaRange);
        if (q) {
          preQaMin += q.min;
          preQaMax += q.max;
          preQaCards++;
        }
      }
    }

    // บอกในแถวรวมว่ากำลังกรองอยู่ — กันหลงว่ายอดนี้ไม่ใช่ของทั้งห้อง
    const filterTag = poFilter ? ` · กรอง: ${poFilter}` : "";
    // แสดงเฉพาะโหมดที่มีรายการ — Pre-Groom ก่อน Groom ตามลำดับการทำงานจริง
    if (preIdx.length > 0) {
      list.appendChild(
        buildSection(
          "pre",
          preIdx,
          buildTotalRow(
            `รวม Pre-Groom${filterTag}`,
            'รวม min กับ max ของช่วงแยกกัน — "3-7" คือ ต่ำสุด 3 สูงสุด 7 · การ์ดที่ถูกนำมา groom ใหม่นับเฉพาะรอบล่าสุด',
            preDevCards > 0 ? rangeTotalText(preDevMin, preDevMax) : "—",
            `ช่วงรวม Dev ของค่าล่าสุด ${preDevCards} การ์ด (${fmt(preDevMin)}-${fmt(preDevMax)})`,
            preQaCards > 0 ? rangeTotalText(preQaMin, preQaMax) : "—",
            `ช่วงรวม QA ของค่าล่าสุด ${preQaCards} การ์ด (${fmt(preQaMin)}-${fmt(preQaMax)})`,
            "pre"
          ),
          superseded
        )
      );
    }
    if (groomIdx.length > 0) {
      list.appendChild(
        buildSection(
          "groom",
          groomIdx,
          buildTotalRow(
            `รวม Groom${filterTag}`,
            "การ์ดที่ถูกนำมา groom ใหม่นับเฉพาะค่ารอบล่าสุด · ค่า = point ที่บันทึกลง ClickUp",
            devCards > 0 ? fmt(totalDev) : "—",
            `ผลรวม Dev ของค่าล่าสุด ${devCards} การ์ด`,
            qaCards > 0 ? fmt(totalQa) : "—",
            `ผลรวม QA ของค่าล่าสุด ${qaCards} การ์ด`
          ),
          superseded
        )
      );
    }
  };
  renderList();

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
          closeModal();
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

/** req 14.1 — tag ที่ติดการ์ดเมื่อบันทึกสำเร็จโดยติ๊ก No Need Test
 *  ใช้เป็นข้อความใน comment (QA: no need test) ด้วย — ต้องเป็นตัวเดียวกัน */
const NO_NEED_TEST_TAG = "no need test";
const HOT_FIX_TAG = "hot fix";

/** req 14.1 — เพิ่ม tag "no need test" ให้การ์ดปัจจุบันผ่าน backend
 *  (backend เช็ค tag ซ้ำก่อนเขียน และไม่แตะ tags อื่นของการ์ด)
 *  best-effort เหมือน comment: point ขึ้นการ์ดแล้ว ถือว่ารอบจบแม้ tag พัง
 *  แต่โชว์ toast เตือนให้รู้ว่าต้องติด tag เอง */
async function addNoNeedTestTag(taskId: string): Promise<void> {
  try {
    await api("/api/clickup/add-tag", { taskId, tag: NO_NEED_TEST_TAG });
  } catch (err) {
    showToast(`⚠️ บันทึกสำเร็จ แต่เพิ่ม tag "${NO_NEED_TEST_TAG}" ไม่สำเร็จ: ${(err as Error).message}`);
  }
}

/** ติด tag "hot fix" หลังบันทึกสำเร็จ — best-effort เหมือน no need test */
async function addHotFixTag(taskId: string): Promise<void> {
  try {
    await api("/api/clickup/add-tag", { taskId, tag: HOT_FIX_TAG });
  } catch (err) {
    showToast(`⚠️ บันทึกสำเร็จ แต่เพิ่ม tag "${HOT_FIX_TAG}" ไม่สำเร็จ: ${(err as Error).message}`);
  }
}

/** ติด tags ที่เลือกไว้ (no need test / hot fix — เลือกอย่างเดียวหรือทั้งคู่ก็ได้)
 *  เรียกหลังบันทึกสำเร็จเท่านั้น · best-effort: point ขึ้นการ์ดแล้วถือว่ารอบจบ */
async function addSelectedTags(taskId: string, noNeedTest: boolean, hotFix: boolean): Promise<void> {
  if (noNeedTest) await addNoNeedTestTag(taskId);
  if (hotFix) await addHotFixTag(taskId);
}

export async function handleSaveToClickUp(): Promise<void> {
  if (!isPO() || !state.currentRoom || saveInFlight) return;
  await withSaveBusy(doSaveToClickUp);
}

/** Reset รอบโหวตหลังบันทึกลง ClickUp สำเร็จ (req Reset After Saving Point)
 *  — ล้างคะแนนทุกคนทุก role + ปลดล็อค + เคลียร์ task/URL ที่ค้างอยู่บนหน้าจอ
 *  เรียกหลังยืนยันบันทึกสำเร็จเท่านั้น (ผลลัพธ์ field ok) — ระหว่าง reveal→บันทึก
 *  ห้องถูก lock อยู่ โหวตเปลี่ยนไม่ได้ จึงไม่มีคะแนนหลุดก่อน reset
 *  ทุก client เห็นสถานะใหม่ตรงกันผ่าน room tick เดิม (real-time)
 *  taskHistory ที่บันทึกสำเร็จแล้วไม่ถูกแตะ (recordSavedAt จดก่อนหน้านี้แล้ว) */
async function resetRoomAfterSave(users: Record<string, User>): Promise<void> {
  if (!state.currentRoom) return;
  const updates: Record<string, unknown> = {};
  Object.keys(users ?? {}).forEach((uid) => {
    updates[`users/${uid}/vote`] = null;
  });
  updates.revealed = false;
  updates.locked = false;
  updates.revealTime = null;
  updates.drinkers = null;
  updates.activeTask = null; // ล้าง task ปัจจุบัน — แถว task/URL หายจากหน้าจอทุกคน
  updates.noNeedTest = false; // จบรอบ = No Need Test กลับ unchecked
  updates.hotFix = false; // จบรอบ = Hot Fix กลับ unchecked
  try {
    await update(ref(db, `rooms/${state.currentRoom}`), updates);
  } catch (err) {
    console.warn("[clickup] reset after save failed:", err);
    showToast("⚠️ บันทึกสำเร็จ แต่ล้างรอบโหวตไม่สำเร็จ — กด 🔄 Reset เองอีกครั้ง");
    return;
  }
  // เคลียร์ของค้างบนจอเครื่องผู้บันทึก (URL ใน input เห็นเฉพาะฝั่ง PO)
  clickupUrlInput.value = "";
  document
    .querySelectorAll(".poker-card")
    .forEach((el) => el.classList.remove("selected"));
  document.querySelectorAll(".custom-point-input").forEach((el) => {
    (el as HTMLInputElement).value = "";
  });
  state.selectedCardCustom = false;
  void sendSystemMessage("🔄 บันทึกสำเร็จ — เริ่มรอบโหวตใหม่");
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
  // req 14 — No Need Test: QA ถูกตัดออกจากรอบนี้ (comment บอก "no need test"
  // ไม่มีช่วง QA + ติด tag บนการ์ดเมื่อบันทึกสำเร็จ)
  if (mode === "pre") {
    const noNeedTest = isNoNeedTestChecked();
    const dev = rangeFor(devList);
    const qa = noNeedTest ? null : rangeFor(qaList);
    if (dev === null && qa === null) {
      showToast("⚠️ ไม่มีโหวตจาก Dev/QA ให้บันทึก");
      return;
    }
    try {
      await api("/api/clickup/post-comment", {
        taskId: task.taskId,
        comment: buildGroomingComment(
          mode,
          dev,
          noNeedTest ? NO_NEED_TEST_TAG : qa,
          entries,
          state.currentUser?.uid ?? null,
          task.name
        ),
      });
      const parts = [
        dev !== null && `Dev ${dev}`,
        noNeedTest ? `QA ${NO_NEED_TEST_TAG}` : qa !== null && `QA ${qa}`,
      ]
        .filter(Boolean)
        .join(" · ");
      // สำเร็จ — ใช้ splash กลางจออย่างเดียวเหมือน groom (ไม่มี toast มุมล่าง)
      showSaveSplash(
        [
          dev !== null && { label: "Dev", value: dev },
          !noNeedTest && qa !== null && { label: "QA", value: qa },
        ].filter(Boolean) as { label: string; value: string }[],
        "🌱 บันทึก Pre-Groom ลง ClickUp แล้ว"
      );
      void sendSystemMessage(`บันทึก Pre-Groom ลง ClickUp แล้ว → ${task.name} (${parts})`);
      await addSelectedTags(task.taskId, noNeedTest, state.hotFix);
      void recordSavedAt(task.historyKey, {
        mode,
        dev: null,
        qa: null,
        devRange: dev,
        qaRange: qa,
      });
      // บันทึกสำเร็จ → เริ่มรอบใหม่ (ล้างโหวต + task ทุกคนแบบ real-time)
      await resetRoomAfterSave(data.users ?? {});
    } catch (err) {
      showToast(`❌ ${(err as Error).message}`);
    }
    return;
  }

  // ── Groom: ทุกคนใน role (ไม่นับคนที่ออกแล้ว) ต้องโหวตเลขเดียวกันถึงบันทึกได้ ──
  // req 14 — No Need Test: QA ไม่ถูกบันทึกในรอบนี้ → ไม่บังคับให้ QA โหวตตรงกัน
  //  (บันทึกเฉพาะ Dev ตามปกติ) · qa = null ส่งไป backend = ไม่แตะ custom field ของ QA เลย
  const noNeedTest = isNoNeedTestChecked();
  const dev = unanimousFor(devList);
  const qa = noNeedTest ? null : unanimousFor(qaList);
  const pending: string[] = [];
  if (devList.length > 0 && dev === null) pending.push(`Dev (${votesStr(devList)})`);
  if (!noNeedTest && qaList.length > 0 && qa === null) pending.push(`QA (${votesStr(qaList)})`);
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
    // req 14 — อ่านสถานะ No Need Test สด ๆ ตอนบันทึกจริง (ผู้ใช้อาจ toggle ระหว่าง
    // confirm modal "บันทึกทับ" เปิดค้างอยู่) แล้วคำนวณ QA ใหม่ตามสถานะล่าสุดเสมอ
    const noNeedTest = isNoNeedTestChecked();
    const qaSave = noNeedTest ? null : unanimousFor(qaList);
    try {
      const result = await api<SaveResult>("/api/clickup/save-points", {
        taskId: task.taskId,
        dev,
        // req 14.2 — noNeedTest → qa เป็น null: backend ไม่เขียน/ไม่ทับ custom field
        // ของ QA ด้วยค่าใด ๆ (รวมถึง 0/null) — บันทึกเฉพาะ role อื่นตามปกติ
        qa: qaSave,
        comment: buildGroomingComment(
          mode,
          dev !== null ? fmt(dev) : null,
          noNeedTest ? NO_NEED_TEST_TAG : qaSave !== null ? fmt(qaSave) : null,
          entries,
          state.currentUser?.uid ?? null,
          task.name
        ),
      });
      const saved: string[] = [];
      const failed: string[] = [];
      if (result.dev) (result.dev.ok ? saved : failed).push(`Dev ${fmt(dev!)}`);
      if (result.qa) (result.qa.ok ? saved : failed).push(`QA ${fmt(qaSave!)}`);
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
            result.qa?.ok && { label: result.qa.field ?? "QA", value: fmt(qaSave!) },
          ].filter(Boolean) as { label: string; value: string }[]
        );
      }
      if (saved.length) {
        // req 14.3 — noNeedTest บอกในแชทห้องด้วยว่ารอบนี้ QA ไม่มี point (ไม่ได้ลืมบันทึก)
        const parts = noNeedTest ? [...saved, `QA ${NO_NEED_TEST_TAG}`] : saved;
        void sendSystemMessage(
          `บันทึกคะแนนลง ClickUp แล้ว → ${task.name} (${parts.join(" · ")})`
        );
      }
      // จด duration + point เฉพาะรอบที่ field สำเร็จครบ (บางส่วนพัง = รอบยังไม่จบ อย่าให้ history หลอกว่าเสร็จ)
      if (failed.length === 0 && saved.length > 0) {
        // req 14.1 — ติด tag "no need test" / "hot fix" ที่เลือกไว้ (best-effort)
        await addSelectedTags(task.taskId, noNeedTest, state.hotFix);
        void recordSavedAt(task.historyKey, {
          mode: "groom",
          dev,
          qa: qaSave,
          devRange: null,
          qaRange: null,
        });
        // บันทึกสำเร็จ → เริ่มรอบใหม่ (ล้างโหวต + task ทุกคนแบบ real-time)
        // → room tick ถัดไป updateNoNeedTestCheckbox(null) = reset checkbox ตาม req 14.4
        // comment พังอย่างเดียว (best-effort) ถือว่ารอบจบ — point ขึ้นการ์ดแล้ว
        await resetRoomAfterSave(data.users ?? {});
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
