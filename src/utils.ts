import type { GroomMode, TaskLink, User } from "./types";

export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** ค่าเดียวที่ "ทุกคน" ในกลุ่มโหวตเหมือนกัน — groom ต้อง unanimous ถึงบันทึกได้
 *  คืน null เมื่อ: กลุ่มว่าง / มีคนยังไม่โหวต / โหวต non-numeric / โหวตไม่เท่ากัน */
export function unanimousFor(list: [string, { vote: string | null }][]): number | null {
  if (list.length === 0) return null;
  const nums: number[] = [];
  for (const [, u] of list) {
    if (u.vote == null) return null;
    const n = parseFloat(u.vote);
    if (isNaN(n)) return null;
    nums.push(n);
  }
  return nums.every((v) => v === nums[0]) ? nums[0] : null;
}

/** ช่วงโหวต "min-max" ของเลขในกลุ่ม สำหรับ pre-groom — เช่น "1-3" (min==max → "3")
 *  คืน null เมื่อไม่มีใครโหวตเลขเลย (ค่าที่ไม่ใช่เลขไม่นับ) */
export function rangeFor(list: [string, { vote: string | null }][]): string | null {
  const nums = list
    .filter(([, u]) => u.vote != null)
    .map(([, u]) => parseFloat(u.vote!))
    .filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? String(min) : `${min}-${max}`;
}

/** ตัวกลับของ rangeFor — แยก string ช่วงกลับเป็น min/max เพื่อรวมยอดใน history
 *  "1-3" → {min:1, max:3} · "3" → {min:3, max:3} · null/ไม่ใช่เลข → null */
export function parseRange(range: string | null | undefined): { min: number; max: number } | null {
  if (!range) return null;
  const [lo, hi] = range.split("-");
  const min = parseFloat(lo);
  if (isNaN(min)) return null;
  const max = hi === undefined ? min : parseFloat(hi);
  return { min, max: isNaN(max) ? min : max };
}

export function formatChatTime(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

/** "DD/MM/YYYY HH:mm" เวลาท้องถิ่นของผู้ใช้ — ใช้ในคอมเม้น Grooming บนการ์ด ClickUp */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** UTF-8 safe Base64 encode — btoa() alone throws on non-Latin1 characters */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** UTF-8 safe Base64 decode — atob() alone mangles non-Latin1 characters */
export function base64ToUtf8(base64: string): string {
  let binary: string;
  try {
    binary = atob(base64.trim());
  } catch {
    throw new Error("Invalid Base64 string");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * True if `cards` is a non-empty array with at least one slot carrying a point
 * value. Used to decide whether to use the stored poker-card config or fall back
 * to the default seed. Defensive against malformed Firebase data (non-object /
 * null / string entries) so a bad write can't crash the poker view.
 */
export function hasConfiguredCards(cards: unknown): boolean {
  if (!Array.isArray(cards)) return false;
  return cards.some((c) => {
    if (c == null || typeof c !== "object") return false;
    const v = (c as { value?: unknown }).value;
    return typeof v === "string" && v.trim() !== "";
  });
}

// ── ClickUp task links dedup (req 15) ───────────────────────────────────
// (pure — มิเรอร์ logic เดียวกับ backend/links.js เพื่อกันไอคอนซ้ำที่หน้า render
//  แม้ข้อมูลเก่าใน Firebase จะเก็บลิงก์ซ้ำมาก่อน)

/** query params ที่เป็น signature ชั่วคราว — ไฟล์เดียวกันที่ดึงคนละครั้งได้ค่าต่างกัน
 *  (เช่น signed URL ของ attachment) ตัดออกก่อนเทียบ โดยไม่แตะ query ที่ใช้ระบุไฟล์จริง */
const VOLATILE_QUERY_KEYS =
  /^(sig|signature|token|access_?token|auth|expires?|expiry|expiration|date|ts|timestamp|nonce|cb|_cb|_t|x-amz-[a-z-]+|x-goog-[a-z-]+|awsaccesskeyid)$/i;

/** key ระบุ "ไฟล์" ของลิงก์ — host + path เสมอ บวกเฉพาะ query ที่ระบุไฟล์จริง
 *  (signature ตัดทิ้ง · path ว่าง = ยึดทั้ง URL เพื่อไม่รวมไฟล์ต่างกันที่อยู่ใน query) */
export function taskLinkKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (!path) return `${u.hostname}${u.search}`.toLowerCase();
    const identity = [...u.searchParams.entries()]
      .filter(([k]) => !VOLATILE_QUERY_KEYS.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
    return `${u.hostname}${path}${identity ? `?${identity}` : ""}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** req 15 — ตัดลิงก์รูป/ไฟล์เดียวกันที่มาจากหลายแหล่ง (description + attachment)
 *  เหลือเฉพาะที่ไม่ซ้ำโดยคงลำดับเดิม — เรียกก่อน render เพื่อไม่โชว์ไอคอนซ้ำ */
export function dedupeTaskLinks(links: TaskLink[] | null | undefined): TaskLink[] {
  const seen = new Set<string>();
  const out: TaskLink[] = [];
  for (const l of links ?? []) {
    const key = taskLinkKey(l.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

// ── ClickUp grooming comment ─────────────────────────────────────────
// (ย้ายมาจาก clickup.ts เป็น pure function — ให้ unit test ตรวจรูปแบบ
//  คอมเม้นได้โดยไม่ต้องแตะ DOM/Firebase)

/** req 20 — โซนเวลาของ timestamp ใน comment (แสดงเวลาไทยทุกเครื่อง) */
const BANGKOK_TZ = "Asia/Bangkok";

/** req 20 — เส้นคั่นหัว/ท้าย comment + หัวข้อกลาง (แยกแต่ละรอบการบันทึก
 *  point บนการ์ดให้เห็นชัด โดยเฉพาะตอนแก้ไข point แล้วบันทึกซ้ำหลายครั้ง) */
const COMMENT_RULE = "━".repeat(20);
const COMMENT_HEADER = "🃏 SCRUM POKER | POINT UPDATE";

/** req 20 — เวลาไทย "DD/MM/YYYY HH:mm" จาก Date ใด ๆ
 *  ใช้ Intl timeZone เพื่อให้ถูกต้องแม้เครื่องผู้กดบันทึกอยู่ timezone อื่น */
export function formatBangkokDateTime(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** ลำดับกลุ่ม role ในคอมเม้น Attendees ("admin" = superadmin ถือเป็น PO ตาม isPO) */
const ATTENDEE_ROLES: { keys: string[]; label: string }[] = [
  { keys: ["po", "admin"], label: "PO" },
  { keys: ["dev"], label: "Dev" },
  { keys: ["qa"], label: "QA" },
  { keys: ["ux"], label: "UX/UI" },
];

/** ข้อความคอมเม้นท์ที่โพสต์ลงการ์ด ClickUp — dev/qa เป็น string สำเร็จรูปแล้ว
 *  ("3" ตอน groom / "1-3" ตอน pre-groom / "no need test" ตอนติ๊ก No Need Test)
 *  req 20 — โครงร่างเดียวกันทุกครั้ง (บันทึกครั้งแรกหรือแก้ไขแล้วบันทึกซ้ำ):
 *    ━━━━━━━━━━━━━━━━━━━━
 *    🃏 SCRUM POKER | POINT UPDATE
 *    📅 DD/MM/YYYY HH:mm   ← เวลาไทย Asia/Bangkok ณ ตอนกดบันทึกจริง
 *    ✅ Grooming / 🌱 Pre-Grooming
 *    (ว่าง 1 บรรทัด)
 *    Dev: … / QA: …
 *    (ว่าง 1 บรรทัด)
 *    Attendees + ชื่อแยกตาม role
 *    (ว่าง 1 บรรทัด)
 *    ชื่อการ์ด
 *    ━━━━━━━━━━━━━━━━━━━━
 *  Attendees บรรทัดเดียวต่อ role ชื่อคั่นด้วย comma (ข้าม role ที่ไม่มีคน)
 *  ใช้ชื่อจริง (realName จาก member list) — ชื่อเล่นแสดงแค่ในห้อง poker
 *  PO ที่เป็นคนกดบันทึก (savedByUid) จะมี "(owner)" ต่อท้ายชื่อ
 *  cardName = ชื่อการ์ด ClickUp ที่โหวต — วางท้ายสุดก่อนเส้นคั่นปิด (req 20 ข้อ 7)
 *  now = เวลาที่กดบันทึก (inject ได้เพื่อให้ test ตรวจ format แบบ deterministic) */
export function buildGroomingComment(
  mode: GroomMode,
  dev: string | null,
  qa: string | null,
  attendees: [string, User][],
  savedByUid: string | null,
  cardName: string,
  now: Date = new Date()
): string {
  const modeLabel = mode === "pre" ? "🌱 Pre-Grooming" : "✅ Grooming";
  // req 20 — เวลาตอนกดบันทึกจริงแสดงเป็นเวลาไทย (Asia/Bangkok) เสมอ
  const lines = [
    COMMENT_RULE,
    COMMENT_HEADER,
    `📅 ${formatBangkokDateTime(now)}`,
    modeLabel,
    "",
  ];
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
    lines.push(`${label}: ${names.join(", ")}`);
  }
  // req 20 ข้อ 7 — ชื่อการ์ดอยู่ท้ายสุดของเนื้อหา ก่อนเส้นคั่นปิด comment
  if (cardName) lines.push("", cardName);
  lines.push(COMMENT_RULE);
  return lines.join("\n");
}
