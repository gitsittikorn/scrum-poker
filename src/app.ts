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
} from "./dom";
import { loadTheme, toggleTheme, loadUsername, openSettings, closeSettings, saveSettings, spawnFirework } from "./ui";
import { checkVersion, initAuth, autoRejoinFromUrl } from "./auth";
import { handleJoinRoom, handleLeave, handleCopyLink, handleDeleteRoom, checkUrlRoom, setupBeforeUnload } from "./room";
import { renderCards, handleReveal, handleReset } from "./voting";
import { toggleChat, sendChatMessage, handleChatTyping, toggleEmojiPicker, insertEmoji, setReply, cancelReply, handleEmojiPickerOutsideClick } from "./chat";
import { toggleReactPicker, sendLiveReaction, toggleMessageReaction, showQuickReactions, closeQuickPopup, handleReactPickerOutsideClick, handleQuickPopupOutsideClick } from "./reactions";

function init(): void {
  checkVersion();
  loadUsername();
  loadTheme();
  renderCards();
  bindEvents();
  checkUrlRoom();
  btnJoinRoom.disabled = true;
  btnJoinRoom.textContent = "กำลังเชื่อมต่อ...";
  initAuth().then(() => {
    btnJoinRoom.disabled = false;
    btnJoinRoom.textContent = "เข้าร่วมห้อง";
    autoRejoinFromUrl();
  });
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

  btnReveal.addEventListener("click", handleReveal);
  btnReset.addEventListener("click", handleReset);
  btnDeleteRoom.addEventListener("click", () => {
    if (confirm("ต้องการลบห้องทั้งหมด? ทุกคนจะถูกออกจากห้อง")) {
      handleDeleteRoom();
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
  btnBarReact.addEventListener("click", toggleReactPicker);
  reactPickerBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("emoji-item")) {
      sendLiveReaction(target.dataset.emoji!);
      reactPickerBar.classList.add("hidden");
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
