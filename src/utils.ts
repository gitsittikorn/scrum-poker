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
