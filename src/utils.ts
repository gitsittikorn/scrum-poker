export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function formatChatTime(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
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
