import { db, ref, set, get, remove, push, serverTimestamp } from "./firebase";
import { state } from "./state";
import { chatMessages, floatingReactions, reactPickerBar } from "./dom";
import { EMOJIS } from "./constants";
import { FEATURES } from "./config";
import { escapeAttr, escapeHtml } from "./utils";

let activeQuickPopup: HTMLElement | null = null;
let reactPickerOpen = false;

export function toggleReactPicker(): void {
  reactPickerOpen = !reactPickerOpen;
  reactPickerBar.classList.toggle("hidden", !reactPickerOpen);
}

export function renderReactPickerBar(): void {
  reactPickerBar.innerHTML = EMOJIS.map(
    (e) => `<button class="emoji-item" data-emoji="${e}">${e}</button>`
  ).join("");
}

export async function sendLiveReaction(emoji: string): Promise<void> {
  if (!FEATURES.react) return;
  if (!state.currentRoom || !state.currentUser) return;
  await set(push(ref(db, `rooms/${state.currentRoom}/liveReactions`)), {
    emoji,
    senderName: state.currentUser.name,
    senderUid: state.currentUser.uid,
    timestamp: serverTimestamp(),
  });
}

export function animateFloatingEmoji(emoji: string, name: string): void {
  const el = document.createElement("div");
  // Set initial positioning inline so the element is correctly placed
  // even before the animation class is added (prevents 1-frame layout glitch)
  el.style.cssText = `position:absolute;bottom:0;left:${Math.random() * 80}px;display:flex;align-items:center;gap:8px;pointer-events:none;opacity:0;`;
  // emoji/name มาจาก Firebase (liveReactions ของคนอื่นในห้อง) — ต้อง escape ก่อน
  // ใส่ innerHTML เสมอ กันค่า malicious ที่ถูกเขียนตรง ๆ ลง RTDB
  el.innerHTML = `
    <span class="floating-emoji-icon">${escapeHtml(emoji)}</span>
    <span class="floating-emoji-name">${escapeHtml(name)}</span>
  `;
  floatingReactions.appendChild(el);
  // Use rAF to ensure the browser has laid out the element before starting animation
  // This prevents the "name cut off on first press" bug
  requestAnimationFrame(() => {
    el.style.opacity = "";
    el.classList.add("floating-emoji-active");
  });
  el.addEventListener("animationend", () => el.remove());
}

export async function toggleMessageReaction(
  msgId: string,
  emoji: string
): Promise<void> {
  if (!state.currentRoom || !state.currentUid || !state.currentUser) return;
  const reactionRef = ref(
    db,
    `rooms/${state.currentRoom}/messages/${msgId}/reactions/${emoji}/${state.currentUid}`
  );
  const snap = await get(reactionRef);
  if (snap.exists()) {
    await remove(reactionRef);
  } else {
    await set(reactionRef, state.currentUser.name);
  }
}

/** HTML ของ badge คอมเม้นต์รวม 1 อิโมจิ — ใช้ร่วมกันทั้ง reactions.ts
 *  (อัปเดต real-time) และ chat.ts (ตอน render ข้อความใหม่) กันสองที่
 *  เขียน HTML ไม่ตรงกัน · emoji เป็น key จาก Firebase ต้อง escape ทั้ง
 *  ตอนแสดงผล (innerHTML) และตอนใส่ attribute (ฟันหนู — escapeHtml เดี่ยวไม่พอ) */
export function reactionBadgeHtml(
  emoji: string,
  users: Record<string, string>,
  msgId: string
): string {
  const count = Object.keys(users).length;
  const isMine = state.currentUid && users[state.currentUid] ? " mine" : "";
  const names = Object.values(users).join(", ");
  return `<span class="reaction-badge${isMine}" data-emoji="${escapeAttr(emoji)}" data-msg-id="${escapeAttr(msgId)}" data-names="${escapeAttr(names)}">${escapeHtml(emoji)} <small>${count}</small></span>`;
}

export function renderMessageReactions(
  msgId: string,
  reactions: Record<string, Record<string, string>> | null
): void {
  const msgEl = chatMessages.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;

  let container = msgEl.querySelector(".chat-msg-reactions") as HTMLElement;
  if (!reactions || Object.keys(reactions).length === 0) {
    if (container) container.remove();
    return;
  }
  if (!container) {
    container = document.createElement("div");
    container.className = "chat-msg-reactions";
    const footer = msgEl.querySelector(".chat-msg-meta");
    footer?.before(container);
  }
  container.innerHTML = Object.entries(reactions)
    .map(([emoji, users]) => reactionBadgeHtml(emoji, users, msgId))
    .join("");
}

export function showQuickReactions(msgId: string): void {
  closeQuickPopup();
  const msgEl = chatMessages.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  const popup = document.createElement("div");
  popup.className = "quick-reactions";
  popup.innerHTML = EMOJIS.map(
    (e) =>
      `<button class="quick-react-item" data-emoji="${e}" data-msg-id="${msgId}">${e}</button>`
  ).join("");
  msgEl.appendChild(popup);
  activeQuickPopup = popup;
}

export function closeQuickPopup(): void {
  if (activeQuickPopup) {
    activeQuickPopup.remove();
    activeQuickPopup = null;
  }
}

export function handleReactPickerOutsideClick(target: HTMLElement): void {
  if (
    reactPickerOpen &&
    !target.closest(".react-picker-bar") &&
    !target.closest("#btn-bar-react")
  ) {
    reactPickerBar.classList.add("hidden");
    reactPickerOpen = false;
  }
}

export function handleQuickPopupOutsideClick(target: HTMLElement): void {
  if (
    activeQuickPopup &&
    !target.closest(".quick-reactions") &&
    !target.closest(".btn-react-msg")
  ) {
    closeQuickPopup();
  }
}
