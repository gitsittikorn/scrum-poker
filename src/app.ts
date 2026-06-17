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
import { loadTheme, toggleTheme, loadUsername, openSettings, closeSettings, saveSettings, showToast, spawnFirework, applyFeatureFlags, openDbReport, showWarningModal, showConfirmModal } from "./ui";
import { checkVersion, initAuth, autoRejoinFromUrl } from "./auth";
import { handleJoinRoom, handleLeave, handleDeleteRoom, handleClearAllRooms, checkUrlRoom, setupBeforeUnload, startCleanupScheduler, listenForceRefresh, writeForceRefreshVersion } from "./room";
import { db, ref, update } from "./firebase";
import { renderCards, handleReveal, handleReset } from "./voting";
import { toggleChat, sendChatMessage, handleChatTyping, toggleEmojiPicker, insertEmoji, setReply, cancelReply, handleEmojiPickerOutsideClick } from "./chat";
import { toggleReactPicker, sendLiveReaction, toggleMessageReaction, showQuickReactions, closeQuickPopup, handleReactPickerOutsideClick, handleQuickPopupOutsideClick, animateFloatingEmoji } from "./reactions";
import { toggleSoundPicker, sendSound, renderSoundPicker, handleSoundPickerOutsideClick, playSound } from "./sounds";
import { toggleWheel, handleSpin, handleShuffle, handleReset as handleWheelReset, handleClear, handleAddEntry } from "./wheel";
import { state } from "./state";
import { FEATURES } from "./config";
import { SUPER_ADMIN_NAME } from "./constants";

function init(): void {
  checkVersion();
  loadUsername();
  loadTheme();
  // Show admin room/role options if saved username is super admin
  if (usernameInput.value.trim() === SUPER_ADMIN_NAME) {
    adminRoomOption.style.display = "";
    adminRoleOption.style.display = "";
  }
  if (FEATURES.poker) renderCards();
  if (FEATURES.sound) renderSoundPicker();
  bindEvents();
  applyFeatureFlags();
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
  btnSettingsClose.addEventListener("click", closeSettings);
  btnSettingsSave.addEventListener("click", saveSettings);
  settingsInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") btnSettingsSave.click();
  });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
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

  btnReveal.addEventListener("click", handleReveal);
  btnReset.addEventListener("click", handleReset);
  btnDeleteRoom.addEventListener("click", () => {
    showWarningModal({
      title: "ลบห้องนี้?",
      message: "ทุกคนจะถูกเตะออกจากห้อง และข้อมูลภายในห้องจะถูกลบทิ้งทั้งหมด",
      confirmText: "ลบห้อง",
      onConfirm: handleDeleteRoom,
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
      const file = target.dataset.file!;
      const emoji = target.dataset.emoji!;
      // Play locally immediately (this click is the gesture that unlocks audio) +
      // show floating emoji — don't wait for the Firebase round-trip
      playSound(file);
      if (state.currentUser) animateFloatingEmoji(emoji, state.currentUser.name);
      sendSound(file);
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
