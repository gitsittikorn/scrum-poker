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
