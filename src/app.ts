import {
  usernameInput,
  roomSelect,
  btnJoinRoom,
  btnLeave,
  btnHome,
  btnCopyLink,
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
  btnDbReport,
  dbReportModal,
  btnDbReportClose,
  btnWheel,
  btnWheelClose,
  btnWheelSpin,
  btnWheelShuffle,
  btnWheelReset,
  btnWheelClear,
  btnWheelAdd,
  wheelAddInput,
} from "./dom";
import { loadTheme, toggleTheme, loadUsername, openSettings, closeSettings, saveSettings, spawnFirework, applyFeatureFlags, openDbReport, closeDbReport } from "./ui";
import { checkVersion, initAuth, autoRejoinFromUrl } from "./auth";
import { handleJoinRoom, handleLeave, handleCopyLink, handleDeleteRoom, handleClearAllRooms, checkUrlRoom, setupBeforeUnload, startCleanupScheduler } from "./room";
import { renderCards, handleReveal, handleReset } from "./voting";
import { toggleChat, sendChatMessage, handleChatTyping, toggleEmojiPicker, insertEmoji, setReply, cancelReply, handleEmojiPickerOutsideClick } from "./chat";
import { toggleReactPicker, sendLiveReaction, toggleMessageReaction, showQuickReactions, closeQuickPopup, handleReactPickerOutsideClick, handleQuickPopupOutsideClick, animateFloatingEmoji } from "./reactions";
import { toggleSoundPicker, sendSound, renderSoundPicker, handleSoundPickerOutsideClick, playSound } from "./sounds";
import { toggleWheel, handleSpin, handleShuffle, handleReset as handleWheelReset, handleClear, handleAddEntry } from "./wheel";
import { state } from "./state";
import { FEATURES } from "./config";

function init(): void {
  checkVersion();
  loadUsername();
  loadTheme();
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
    autoRejoinFromUrl();
  });
  startCleanupScheduler();
}

function bindEvents(): void {
  btnJoinRoom.addEventListener("click", handleJoinRoom);
  btnLeave.addEventListener("click", () => handleLeave());
  btnHome.addEventListener("click", () => handleLeave());
  btnCopyLink.addEventListener("click", handleCopyLink);
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
  // Close link for non-PO users
  document.getElementById("settings-close-link")?.addEventListener("click", closeSettings);

  // DB Report modal
  btnDbReport.addEventListener("click", openDbReport);
  btnDbReportClose.addEventListener("click", closeDbReport);
  dbReportModal.addEventListener("click", (e) => {
    if (e.target === dbReportModal) closeDbReport();
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

  btnReveal.addEventListener("click", handleReveal);
  btnReset.addEventListener("click", handleReset);
  btnDeleteRoom.addEventListener("click", () => {
    if (confirm("⚠️ ต้องการลบห้องนี้?\n\nทุกคนจะถูกออกจากห้อง")) {
      handleDeleteRoom();
    }
  });
  document.getElementById("btn-clear-all")?.addEventListener("click", () => {
    if (confirm("⚠️ ต้องการเคลียร์ข้อมูลทุกห้อง?\n\n• ข้อความแชททั้งหมดจะถูกลบ\n• คะแนนโหวตจะถูกรีเซ็ต\n• ทุกคนจะถูกออกจากห้องทันที")) {
      handleClearAllRooms();
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
      // Show floating emoji locally immediately (don't wait for Firebase)
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

  roomSelect.addEventListener("change", () => {
    const show = roomSelect.value === "Kitsune";
    roomBanner.classList.toggle("hidden", !show);
    if (show) spawnFirework(roomBanner);
  });

  setupBeforeUnload();
}

document.addEventListener("DOMContentLoaded", init);
