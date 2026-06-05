import {
  db,
  ref,
  set,
  remove,
  push,
  query,
  limitToLast,
  serverTimestamp,
  onChildAdded,
  onChildChanged,
  onValue,
  off,
} from "./firebase";
import { state } from "./state";
import type { ChatMessage } from "./types";
import {
  chatPanel,
  chatMessages,
  chatInput,
  chatUnreadBadge,
  chatTyping,
  chatReplyBar,
  replyToName,
  replyToText,
  emojiPicker,
} from "./dom";
import { EMOJIS } from "./constants";
import { escapeHtml, formatChatTime } from "./utils";
import {
  renderReactPickerBar,
  animateFloatingEmoji,
  renderMessageReactions,
  showQuickReactions,
  closeQuickPopup,
  toggleMessageReaction,
} from "./reactions";

let chatOpen = false;
let chatUnread = 0;
let chatListenerQuery: ReturnType<typeof query> | null = null;
let typingListenerRef: ReturnType<typeof ref> | null = null;
let typingTimeout: ReturnType<typeof setTimeout> | null = null;
const renderedMsgIds = new Set<string>();
let emojiPickerOpen = false;
let replyTo: { msgId: string; senderName: string; text: string } | null = null;
let liveReactionListenerRef: ReturnType<typeof query> | null = null;
const messageCache = new Map<string, { senderName: string; text: string }>();

export function toggleChat(): void {
  chatOpen = !chatOpen;
  chatPanel.classList.toggle("open", chatOpen);
  if (chatOpen) {
    chatUnread = 0;
    updateChatUnread();
    chatInput.focus();
    scrollChatToBottom();
  }
}

function updateChatUnread(): void {
  if (chatUnread > 0) {
    chatUnreadBadge.textContent = String(chatUnread > 99 ? "99+" : chatUnread);
    chatUnreadBadge.classList.remove("hidden");
  } else {
    chatUnreadBadge.classList.add("hidden");
  }
}

export function initChat(): void {
  destroyChat();
  renderedMsgIds.clear();
  messageCache.clear();
  chatMessages.innerHTML = "";
  chatUnread = 0;
  updateChatUnread();
  renderEmojiPicker();
  renderReactPickerBar();

  const messagesQuery = query(
    ref(db, `rooms/${state.currentRoom}/messages`),
    limitToLast(100)
  );
  chatListenerQuery = messagesQuery;

  onChildAdded(messagesQuery, (snap) => {
    const msg = snap.val() as ChatMessage;
    const msgId = snap.key!;
    if (renderedMsgIds.has(msgId)) return;
    renderedMsgIds.add(msgId);
    renderChatMessage(msg, msgId);

    if (!chatOpen && msg.type === "user" && msg.senderUid !== state.currentUid) {
      chatUnread++;
      updateChatUnread();
    }
    scrollChatToBottom();
  });

  onChildChanged(messagesQuery, (snap) => {
    const msg = snap.val() as ChatMessage;
    const msgId = snap.key!;
    renderMessageReactions(msgId, msg.reactions || null);
  });

  const liveReactionQuery = query(
    ref(db, `rooms/${state.currentRoom}/liveReactions`),
    limitToLast(20)
  );
  liveReactionListenerRef = liveReactionQuery;
  onChildAdded(liveReactionQuery, (snap) => {
    const data = snap.val();
    if (data) {
      animateFloatingEmoji(data.emoji, data.senderName);
      const key = snap.key;
      setTimeout(() => {
        if (state.currentRoom && key)
          remove(ref(db, `rooms/${state.currentRoom}/liveReactions/${key}`));
      }, 4000);
    }
  });

  const typingRef = ref(db, `rooms/${state.currentRoom}/typing`);
  typingListenerRef = typingRef;
  onValue(typingRef, (snap) => {
    const typing = snap.val() as Record<
      string,
      { name: string; timestamp: number }
    > | null;
    if (!typing) {
      chatTyping.classList.add("hidden");
      return;
    }
    const now = Date.now();
    const names = Object.entries(typing)
      .filter(([uid, v]) => uid !== state.currentUid && now - v.timestamp < 15000)
      .map(([, v]) => v.name);
    if (names.length === 0) {
      chatTyping.classList.add("hidden");
    } else {
      chatTyping.classList.remove("hidden");
      chatTyping.textContent =
        names.length === 1
          ? `${names[0]} กำลังพิมพ์...`
          : `${names.join(", ")} กำลังพิมพ์...`;
    }
  });
}

export function destroyChat(): void {
  if (chatListenerQuery) {
    off(chatListenerQuery);
    chatListenerQuery = null;
  }
  if (typingListenerRef) {
    off(typingListenerRef);
    typingListenerRef = null;
  }
  if (liveReactionListenerRef) {
    off(liveReactionListenerRef);
    liveReactionListenerRef = null;
  }
  clearTypingTimeout();
  renderedMsgIds.clear();
  messageCache.clear();
  cancelReply();
  chatMessages.innerHTML = "";
  chatOpen = false;
  chatPanel.classList.remove("open");
  chatUnread = 0;
  updateChatUnread();
}

function renderChatMessage(msg: ChatMessage, msgId: string): void {
  const div = document.createElement("div");
  div.className = "chat-msg";
  div.dataset.msgId = msgId;

  if (msg.type === "system") {
    div.classList.add("system");
    div.innerHTML = `
      <div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>
      <div class="chat-msg-meta"><span class="chat-msg-time">${formatChatTime(msg.timestamp)}</span></div>
    `;
  } else {
    const isSelf = msg.senderUid === state.currentUid;
    div.classList.add(isSelf ? "self" : "other");
    div.style.position = "relative";
    messageCache.set(msgId, { senderName: msg.senderName, text: msg.text });

    let replyRefHtml = "";
    if (msg.replyTo) {
      const truncated =
        msg.replyTo.text.length > 50
          ? msg.replyTo.text.slice(0, 50) + "..."
          : msg.replyTo.text;
      replyRefHtml = `<div class="chat-msg-reply-ref">
        <span class="reply-ref-name">${escapeHtml(msg.replyTo.senderName)}</span>
        <span class="reply-ref-text">${escapeHtml(truncated)}</span>
      </div>`;
    }

    let reactionsHtml = "";
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      reactionsHtml = `<div class="chat-msg-reactions">${
        Object.entries(msg.reactions)
          .map(([emoji, users]) => {
            const count = Object.keys(users).length;
            const isMine = state.currentUid && users[state.currentUid] ? " mine" : "";
            const names = Object.values(users as Record<string, string>).join(", ");
            return `<span class="reaction-badge${isMine}" data-emoji="${emoji}" data-msg-id="${msgId}" data-names="${escapeHtml(names)}">${emoji} <small>${count}</small></span>`;
          })
          .join("")
      }</div>`;
    }

    div.innerHTML = `
      ${!isSelf ? `<div class="chat-msg-sender ${msg.senderRole}">${escapeHtml(msg.senderName)}</div>` : ""}
      <div class="chat-msg-bubble">${replyRefHtml}${escapeHtml(msg.text)}</div>
      ${reactionsHtml}
      <div class="chat-msg-meta">
        <span class="chat-msg-time">${formatChatTime(msg.timestamp)}</span>
        <button class="btn-reply" title="Reply">Reply</button>
        <button class="btn-react-msg" title="React">😊</button>
      </div>
    `;
  }

  chatMessages.appendChild(div);
}

function scrollChatToBottom(): void {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

export async function sendChatMessage(): Promise<void> {
  const text = chatInput.value.trim();
  if (!text || !state.currentRoom || !state.currentUser) return;

  chatInput.value = "";
  clearTypingTimeout();
  remove(ref(db, `rooms/${state.currentRoom}/typing/${state.currentUid}`));

  const msgData: Record<string, unknown> = {
    text,
    senderName: state.currentUser.name,
    senderUid: state.currentUser.uid,
    senderRole: state.currentRole || "dev",
    type: "user",
    timestamp: serverTimestamp(),
  };

  if (replyTo) {
    msgData.replyTo = { senderName: replyTo.senderName, text: replyTo.text };
    cancelReply();
  }

  await set(push(ref(db, `rooms/${state.currentRoom}/messages`)), msgData);
}

export async function sendSystemMessage(text: string): Promise<void> {
  if (!state.currentRoom) return;
  await set(push(ref(db, `rooms/${state.currentRoom}/messages`)), {
    text,
    senderName: "",
    senderUid: "",
    senderRole: "",
    type: "system",
    timestamp: serverTimestamp(),
  });
}

export function handleChatTyping(): void {
  if (!state.currentRoom || !state.currentUid || !state.currentUser) return;
  set(ref(db, `rooms/${state.currentRoom}/typing/${state.currentUid}`), {
    name: state.currentUser.name,
    timestamp: { ".sv": "timestamp" },
  });

  clearTypingTimeout();
  typingTimeout = setTimeout(() => {
    if (state.currentRoom && state.currentUid) {
      remove(ref(db, `rooms/${state.currentRoom}/typing/${state.currentUid}`));
    }
  }, 3000);
}

function clearTypingTimeout(): void {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
}

function renderEmojiPicker(): void {
  emojiPicker.innerHTML = EMOJIS.map(
    (e) => `<button class="emoji-item" data-emoji="${e}">${e}</button>`
  ).join("");
}

export function toggleEmojiPicker(): void {
  emojiPickerOpen = !emojiPickerOpen;
  emojiPicker.classList.toggle("hidden", !emojiPickerOpen);
}

export function insertEmoji(emoji: string): void {
  const start = chatInput.selectionStart ?? chatInput.value.length;
  const end = chatInput.selectionEnd ?? chatInput.value.length;
  const before = chatInput.value.slice(0, start);
  const after = chatInput.value.slice(end);
  chatInput.value = before + emoji + after;
  chatInput.selectionStart = chatInput.selectionEnd = start + emoji.length;
  chatInput.focus();
  emojiPicker.classList.add("hidden");
  emojiPickerOpen = false;
}

export function setReply(msgId: string): void {
  const cached = messageCache.get(msgId);
  if (!cached) return;
  replyTo = { msgId, senderName: cached.senderName, text: cached.text };
  replyToName.textContent = cached.senderName;
  replyToText.textContent =
    cached.text.length > 60 ? cached.text.slice(0, 60) + "..." : cached.text;
  chatReplyBar.classList.remove("hidden");
  chatInput.focus();
}

export function cancelReply(): void {
  replyTo = null;
  chatReplyBar.classList.add("hidden");
}

export function handleEmojiPickerOutsideClick(target: HTMLElement): void {
  if (emojiPickerOpen && !target.closest(".emoji-wrapper")) {
    emojiPicker.classList.add("hidden");
    emojiPickerOpen = false;
  }
}
