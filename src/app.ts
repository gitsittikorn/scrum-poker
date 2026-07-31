import {
  usernameInput,
  roomSelect,
  roleSelect,
  btnJoinRoom,
  btnLeave,
  btnToggleTheme,
  btnSettings,
  btnSettingsClose,
  btnSettingsSave,
  settingsInput,
  settingsModal,
  btnReveal,
  btnReset,
  btnDeleteRoom,
  btnClearSpeakerCounts,
  btnBarChat,
  btnChatClose,
  btnChatSend,
  chatInput,
  btnEmoji,
  btnCancelReply,
  btnBarReact,
  reactPickerBar,
  chatMessages,
  emojiPicker,
  roomBanner,
  btnBarSound,
  soundPickerBar,
  muteOthersSound,
  btnShortcutToggle,
  shortcutContent,
  shortcutEnabledToggle,
  btnWheel,
  btnWheelClose,
  btnWheelSpin,
  btnWheelShuffle,
  btnWheelReset,
  btnWheelClear,
  btnWheelAdd,
  wheelAddInput,
  adminRoomOption,
  adminRoleOption,
  cleanupTimeInput,
} from "./dom";
import { loadTheme, toggleTheme, loadUsername, fillPokerCardsForm, refreshPokerSaveButton, openSettings, closeSettings, saveSettings, showToast, spawnFirework, applyFeatureFlags, openDbReport, showWarningModal, showConfirmModal } from "./ui";
import { checkVersion, initAuth, autoRejoinFromUrl } from "./auth";
import { handleJoinRoom, handleLeave, handleDeleteRoom, handleClearAllRooms, checkUrlRoom, setupBeforeUnload, startCleanupScheduler, listenForceRefresh, writeForceRefreshVersion } from "./room";
import { db, ref, update } from "./firebase";
import type { CardDef } from "./types";
import { renderCards, initPokerCardsListener, handleReveal, handleReset, handleClearSpeakerCounts } from "./voting";
import { toggleChat, sendChatMessage, handleChatTyping, toggleEmojiPicker, insertEmoji, setReply, cancelReply, handleEmojiPickerOutsideClick } from "./chat";
import { toggleReactPicker, sendLiveReaction, toggleMessageReaction, showQuickReactions, closeQuickPopup, handleReactPickerOutsideClick, handleQuickPopupOutsideClick, animateFloatingEmoji } from "./reactions";
import { toggleSoundPicker, renderSoundPicker, handleSoundPickerOutsideClick, triggerSound, registerSoundShortcuts, renderSoundShortcutSlots, startKeyCapture, cancelKeyCapture, setShortcutSound, setShortcutsEnabled, clearShortcut } from "./sounds";
import { toggleWheel, handleSpin, handleShuffle, handleReset as handleWheelReset, handleClear, handleAddEntry } from "./wheel";
import { state } from "./state";
import { FEATURES } from "./config";
import { SUPER_ADMIN_NAME, DEFAULT_POKER_CARDS } from "./constants";

function init(): void {
  checkVersion();
  loadUsername();
  loadTheme();
  // Show admin room/role options if saved username is super admin
  if (usernameInput.value.trim() === SUPER_ADMIN_NAME) {
    adminRoomOption.style.display = "";
    adminRoleOption.style.display = "";
  }
  if (FEATURES.poker) {
    renderCards();
    initPokerCardsListener();
  }
  if (FEATURES.sound) renderSoundPicker();
  bindEvents();
  applyFeatureFlags();
  registerSoundShortcuts();
  checkUrlRoom();
  btnJoinRoom.disabled = true;
  btnJoinRoom.textContent = "กำลังเชื่อมต่อ...";
  initAuth().then(() => {
    btnJoinRoom.disabled = false;
    btnJoinRoom.textContent = "เข้าร่วมห้อง";
    writeForceRefreshVersion();
    autoRejoinFromUrl();
  });
  startCleanupScheduler();
  listenForceRefresh();
}

function bindEvents(): void {
  btnJoinRoom.addEventListener("click", handleJoinRoom);
  btnLeave.addEventListener("click", () => {
    showConfirmModal({
      title: "ออกจากห้อง?",
      message: "คุณจะออกจากห้องนี้ (สามารถเข้าร่วมใหม่ได้)",
      confirmText: "ออกจากห้อง",
      onConfirm: handleLeave,
    });
  });
  btnToggleTheme.addEventListener("click", toggleTheme);

  btnSettings.addEventListener("click", openSettings);
  btnSettingsClose.addEventListener("click", () => { cancelKeyCapture(); closeSettings(); });
  btnSettingsSave.addEventListener("click", saveSettings);
  settingsInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") btnSettingsSave.click();
  });
  // ปิด settings modal ด้วย Esc เท่านั้น (เอา backdrop-click-to-close ออกแล้ว
  // — กัน PO คลิกโดนพื้นหลังตอนกำลังจะแก้แล้ว modal ปิดตัวเอง)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !settingsModal.classList.contains("active")) return;
    const ae = document.activeElement;
    // ถ้า focus อยู่นอก settings (เช่น confirm/warning modal เปิดทับอยู่) → ให้ modal นั้นจัดการ Esc เอง
    if (ae && ae !== document.body && !settingsModal.contains(ae)) return;
    cancelKeyCapture();
    closeSettings();
  });

  // Sound shortcut section: collapsible (collapsed by default) + key capture + sound select
  btnShortcutToggle.addEventListener("click", () => {
    const isOpen = !shortcutContent.classList.contains("hidden");
    if (isOpen) {
      shortcutContent.classList.add("hidden");
      btnShortcutToggle.classList.remove("open");
      cancelKeyCapture();
    } else {
      shortcutContent.classList.remove("hidden");
      btnShortcutToggle.classList.add("open");
      renderSoundShortcutSlots();
    }
  });
  shortcutContent.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const keyBtn = t.closest(".btn-shortcut-key") as HTMLElement | null;
    if (keyBtn) {
      const slot = Number(keyBtn.dataset.slot);
      if (!Number.isNaN(slot)) startKeyCapture(slot, () => showToast("⌨️ ปุ่มนี้ถูกใช้กับช่องอื่นแล้ว"));
      return;
    }
    const clearBtn = t.closest(".btn-shortcut-clear") as HTMLElement | null;
    if (clearBtn) {
      const slot = Number(clearBtn.dataset.slot);
      if (!Number.isNaN(slot)) clearShortcut(slot);
    }
  });
  shortcutContent.addEventListener("change", (e) => {
    const sel = e.target as HTMLElement;
    if (sel.classList.contains("select-shortcut-sound")) {
      const slot = Number((sel as HTMLSelectElement).dataset.slot);
      if (!Number.isNaN(slot)) setShortcutSound(slot, (sel as HTMLSelectElement).value);
    }
  });

  // DB Report collapsible toggle
  document.getElementById("btn-db-report-toggle")!.addEventListener("click", () => {
    const toggle = document.getElementById("btn-db-report-toggle")!;
    const content = document.getElementById("db-report-collapsible")!;
    const isOpen = !content.classList.contains("hidden");
    if (isOpen) {
      content.classList.add("hidden");
      toggle.classList.remove("open");
    } else {
      content.classList.remove("hidden");
      toggle.classList.add("open");
      openDbReport();
    }
  });

  // Wheel panel
  btnWheel.addEventListener("click", toggleWheel);
  btnWheelClose.addEventListener("click", () => toggleWheel());
  btnWheelSpin.addEventListener("click", handleSpin);
  btnWheelShuffle.addEventListener("click", handleShuffle);
  btnWheelReset.addEventListener("click", handleWheelReset);
  btnWheelClear.addEventListener("click", handleClear);
  btnWheelAdd.addEventListener("click", handleAddEntry);
  wheelAddInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") handleAddEntry();
  });

  // Sync aria-checked on toggle switches
  document.querySelectorAll<HTMLInputElement>('.toggle-label input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const sw = cb.nextElementSibling;
      if (sw) sw.setAttribute("aria-checked", String(cb.checked));
    });
  });

  // Mute others' sounds toggle (saves immediately to localStorage)
  muteOthersSound.addEventListener("change", () => {
    localStorage.setItem("scrum-poker-mute-others", String(muteOthersSound.checked));
  });

  // Master on/off for ALL sound shortcuts (saves immediately to localStorage)
  shortcutEnabledToggle.addEventListener("change", () => {
    setShortcutsEnabled(shortcutEnabledToggle.checked);
  });

  btnReveal.addEventListener("click", handleReveal);
  btnReset.addEventListener("click", handleReset);
  btnDeleteRoom.addEventListener("click", () => {
    showWarningModal({
      title: "ล้างห้องนี้?",
      message: "ทุกคนจะถูกให้ออกจากห้องทันที และข้อมูลทั้งหมด (แชท/โหวต) จะถูกล้างให้ว่าง",
      confirmText: "ล้างห้อง",
      onConfirm: handleDeleteRoom,
    });
  });
  btnClearSpeakerCounts.addEventListener("click", () => {
    showConfirmModal({
      title: "ล้างตัวนับพูด?",
      message: "จะรีเซ็ตจำนวนครั้งที่สุ่มพูดของทุกคนกลับเป็น 0 (เริ่มรอบใหม่)",
      confirmText: "ล้าง",
      onConfirm: handleClearSpeakerCounts,
    });
  });
  document.getElementById("btn-clear-all")?.addEventListener("click", () => {
    showWarningModal({
      title: "ล้างข้อมูลทุกห้อง?",
      message:
        "ทุกคนในทุกห้องจะถูกเตะออกทันที\n• ข้อความแชททั้งหมดจะถูกลบ\n• คะแนนโหวตจะถูกรีเซ็ต",
      confirmText: "ล้างทุกห้อง",
      onConfirm: handleClearAllRooms,
    });
  });

  // Super admin: save cleanup time
  document.getElementById("btn-super-admin-save-cleanup")?.addEventListener("click", async () => {
    const cleanupTime = cleanupTimeInput.value;
    if (cleanupTime) {
      await update(ref(db, `settings`), { cleanupTime });
      closeSettings();
      showToast("💾 บันทึกเวลาเคลียร์ข้อมูลแล้ว");
    }
  });

  // Super admin: poker card point inputs — limit to 1 decimal + normalize ".5" → "0.5"
  document.querySelectorAll<HTMLInputElement>("#poker-cards-config .pc-point").forEach((input) => {
    input.addEventListener("input", () => {
      let v = input.value;
      const m = v.match(/^\d*\.?\d{0,1}/);
      if (m && m[0] !== v) v = m[0];
      v = v.replace(/^\./, "0.");
      if (input.value !== v) input.value = v;
    });
  });

  // Super admin: save poker cards config (global — applies to all rooms)
  document.getElementById("btn-super-admin-save-cards")?.addEventListener("click", async () => {
    const container = document.getElementById("poker-cards-config");
    if (!container) return;
    const slots = Array.from(container.querySelectorAll<HTMLElement>(".pc-slot"));
    const cards: CardDef[] = [];
    let filled = 0;
    for (const slot of slots) {
      const pointInput = slot.querySelector<HTMLInputElement>(".pc-point");
      const descInput = slot.querySelector<HTMLInputElement>(".pc-desc");
      const value = (pointInput?.value ?? "").trim();
      if (value) {
        // positive number, ≤ 1 decimal — accept both "0.5" and ".5"
        if (!/^(\d+\.?\d{0,1}|\.\d{1})$/.test(value)) {
          showToast(`❌ "${value}" ไม่ใช่ตัวเลข (ทศนิยมไม่เกิน 1 ตำแหน่ง)`);
          return;
        }
        filled++;
      }
      // Keep empty slots in the array so the 2×5 grid positions (rows) are
      // preserved on render — an empty point hides that card but keeps its slot.
      // Canonicalize numeric form: "5." → "5", "007" → "7", ".5" → "0.5".
      const canonical = value ? String(parseFloat(value)) : "";
      cards.push({ value: canonical, label: (descInput?.value ?? "").trim() });
    }
    const customToggle = document.getElementById("poker-custom-enabled") as HTMLInputElement | null;
    const customOn = !!customToggle?.checked;
    // Rule: never allow saving a fully-empty config (no points AND custom off) —
    // it would wipe the live cards. The custom card counts as a usable card, so a
    // custom-only config is allowed.
    if (filled === 0 && !customOn) {
      showToast("❌ ต้องกรอก point อย่างน้อย 1 ช่อง หรือเปิดการ์ด Custom — ห้ามลบทุกอย่าง");
      return;
    }
    await update(ref(db, "settings"), {
      pokerCards: cards,
      pokerCustomCard: customOn,
    });
    closeSettings();
    showToast(`💾 บันทึกการ์ด Poker แล้ว (${filled} ใบ)`);
  });

  // Super admin: preview the default card grid in the form (commit via save).
  document.getElementById("btn-super-admin-reset-cards")?.addEventListener("click", () => {
    fillPokerCardsForm(DEFAULT_POKER_CARDS);
    refreshPokerSaveButton();
    showToast("ดึงค่า default แล้ว — กดบันทึกเพื่อใช้งาน");
  });

  // Live-toggle the poker save button: enabled when ≥1 point OR the custom card is on.
  document.getElementById("poker-cards-config")?.addEventListener("input", refreshPokerSaveButton);
  document.getElementById("poker-custom-enabled")?.addEventListener("change", refreshPokerSaveButton);

  // Chat events
  btnBarChat.addEventListener("click", toggleChat);
  btnChatClose.addEventListener("click", () => toggleChat());
  btnChatSend.addEventListener("click", sendChatMessage);
  chatInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  chatInput.addEventListener("input", handleChatTyping);
  btnEmoji.addEventListener("click", toggleEmojiPicker);
  btnCancelReply.addEventListener("click", cancelReply);
  emojiPicker.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("emoji-item")) {
      insertEmoji(target.dataset.emoji!);
    }
  });

  // React bar
  btnBarReact.addEventListener("click", () => { if (FEATURES.react) toggleReactPicker(); });
  reactPickerBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("emoji-item") && FEATURES.react) {
      const emoji = target.dataset.emoji!;
      // Show floating emoji locally immediately (don't wait for Firebase)
      if (state.currentUser) animateFloatingEmoji(emoji, state.currentUser.name);
      sendLiveReaction(emoji);
      reactPickerBar.classList.add("hidden");
    }
  });

  // Sound bar
  btnBarSound.addEventListener("click", () => { if (FEATURES.sound) toggleSoundPicker(); });
  soundPickerBar.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest(".sound-item") as HTMLElement;
    if (target && FEATURES.sound) {
      // Play locally immediately (this click is the gesture that unlocks audio) +
      // broadcast to the room + floating emoji (triggerSound does all three)
      triggerSound(target.dataset.file!);
      soundPickerBar.classList.add("hidden");
    }
  });

  // Chat message delegation
  chatMessages.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("btn-reply")) {
      const msgEl = target.closest(".chat-msg") as HTMLElement;
      if (msgEl?.dataset.msgId) setReply(msgEl.dataset.msgId);
      return;
    }
    if (target.classList.contains("btn-react-msg")) {
      const msgEl = target.closest(".chat-msg") as HTMLElement;
      if (msgEl?.dataset.msgId) showQuickReactions(msgEl.dataset.msgId);
      return;
    }
    if (target.classList.contains("quick-react-item")) {
      const emoji = target.dataset.emoji!;
      const msgId = target.dataset.msgId!;
      toggleMessageReaction(msgId, emoji);
      closeQuickPopup();
      return;
    }
    if (target.closest(".reaction-badge")) {
      const badge = target.closest(".reaction-badge") as HTMLElement;
      const emoji = badge.dataset.emoji!;
      const msgId = badge.dataset.msgId!;
      toggleMessageReaction(msgId, emoji);
      return;
    }
  });

  // Global click: close popups
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    handleEmojiPickerOutsideClick(t);
    handleReactPickerOutsideClick(t);
    handleQuickPopupOutsideClick(t);
    handleSoundPickerOutsideClick(t);
  });

  // Landing page shortcuts
  usernameInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") roomSelect.focus();
  });

  // Show/hide admin room option based on username
  usernameInput.addEventListener("input", () => {
    // จำกัดชื่อไม่เกิน 20 ตัวอักษรจริงๆ — กัน paste/IME/autocomplete ที่ข้าม maxlength
    if (usernameInput.value.length > 20) {
      usernameInput.value = usernameInput.value.slice(0, 20);
    }
    const isAdmin = usernameInput.value.trim() === SUPER_ADMIN_NAME;
    adminRoomOption.style.display = isAdmin ? "" : "none";
    adminRoleOption.style.display = isAdmin ? "" : "none";
    // If admin was selected and username changed, reset selection
    if (!isAdmin && roomSelect.value === "admin") {
      roomSelect.value = "";
    }
    if (!isAdmin && roleSelect.value === "admin") {
      roleSelect.value = "po";
    }
  });

  roomSelect.addEventListener("change", () => {
    const show = roomSelect.value === "Kitsune";
    roomBanner.classList.toggle("hidden", !show);
    if (show) spawnFirework(roomBanner);
  });

  setupBeforeUnload();
}

document.addEventListener("DOMContentLoaded", init);
