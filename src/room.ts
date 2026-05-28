import {
  db,
  ref,
  set,
  get,
  remove,
  update,
  onValue,
  serverTimestamp,
  onDisconnect,
} from "./firebase";
import { state } from "./state";
import type { RoomData } from "./types";
import { roleSelect, roomSelect, roomCodeDisplay, userBadge } from "./dom";
import { DEFAULT_AUTO_UNLOCK_SECONDS } from "./constants";
import { escapeHtml } from "./utils";
import { showPage, showToast, saveUsername } from "./ui";
import { initChat, destroyChat, sendSystemMessage } from "./chat";
import { updateUI, cancelUnlockTimer } from "./voting";

export function checkUrlRoom(): void {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) {
    const options = roomSelect.options;
    for (let i = 0; i < options.length; i++) {
      if (options[i].value === room) {
        roomSelect.value = room;
        break;
      }
    }
  }
}

export async function handleJoinRoom(): Promise<void> {
  const usernameInput = document.getElementById("username-input") as HTMLInputElement;
  const username = usernameInput.value.trim();
  const roomCode = roomSelect.value;
  if (!username) {
    showToast("Please enter your name");
    usernameInput.focus();
    return;
  }
  if (!roomCode) {
    showToast("Please select a room");
    roomSelect.focus();
    return;
  }
  if (!state.currentUid) {
    return;
  }

  saveUsername(username);
  localStorage.setItem("scrum-poker-room", roomCode);
  const role = roleSelect.value;
  state.currentUser = { uid: state.currentUid, name: username };

  try {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const snap = await get(roomRef);
    if (!snap.exists()) {
      await set(roomRef, {
        createdAt: serverTimestamp(),
        revealed: false,
        locked: false,
        autoUnlockSeconds: DEFAULT_AUTO_UNLOCK_SECONDS,
      });
    }
    await joinRoom(roomCode, true);
    window.history.replaceState(null, "", `?room=${roomCode}`);
  } catch (err) {
    console.error("[Join] Error:", err);
    showToast("Failed to join room — check Firebase config");
  }
}

export async function joinRoom(
  roomCode: string,
  clearVote: boolean = true
): Promise<void> {
  state.currentRoom = roomCode;
  state.currentRole = roleSelect.value;
  const selectedOption = roomSelect.options[roomSelect.selectedIndex];
  roomCodeDisplay.textContent = selectedOption
    ? selectedOption.text
    : roomCode;

  let existingVote: string | null = null;
  if (!clearVote) {
    const existingSnap = await get(
      ref(db, `rooms/${roomCode}/users/${state.currentUser!.uid}`)
    );
    if (existingSnap.exists()) {
      existingVote = existingSnap.val().vote ?? null;
    }
  }
  state.selectedCard = clearVote ? null : existingVote;

  const userRef = ref(db, `rooms/${roomCode}/users/${state.currentUser!.uid}`);
  await set(userRef, {
    name: state.currentUser!.name,
    role: roleSelect.value,
    vote: clearVote ? null : existingVote,
    online: true,
    lastSeen: serverTimestamp(),
  });

  const presenceRef = ref(
    db,
    `rooms/${roomCode}/users/${state.currentUser!.uid}/online`
  );
  await onDisconnect(presenceRef).set(false);

  const role = roleSelect.value;
  const roleIcon =
    role === "dev"
      ? "👨‍💻"
      : role === "qa"
        ? "🐛"
        : role === "ux"
          ? "🎨"
          : "📋";
  const roleName =
    role === "dev"
      ? "Dev"
      : role === "qa"
        ? "QA"
        : role === "ux"
          ? "UX/UI"
          : "PO";
  userBadge.className = `user-badge ${role}`;
  userBadge.innerHTML = `${roleIcon} ${escapeHtml(state.currentUser!.name)} <span class="user-role">(${roleName})</span>`;

  showPage("room");
  listenRoom();
  initChat();
  sendSystemMessage(`${state.currentUser!.name} เข้าร่วมแล้ว`);
  const typingPresenceRef = ref(
    db,
    `rooms/${roomCode}/typing/${state.currentUser!.uid}`
  );
  onDisconnect(typingPresenceRef).remove();
}

export function handleLeave(skipMessage = false): void {
  if (!state.currentRoom || !state.currentUser) return;
  const leavingName = state.currentUser.name;
  cancelUnlockTimer();
  if (!skipMessage) sendSystemMessage(`${leavingName} ออกจากห้อง`);
  destroyChat();
  remove(
    ref(db, `rooms/${state.currentRoom}/users/${state.currentUser.uid}`)
  );
  localStorage.removeItem("scrum-poker-room");
  state.currentRoom = null;
  state.currentUser = null;
  state.selectedCard = null;
  showPage("landing");
  window.history.replaceState(null, "", window.location.pathname);
}

export function handleCopyLink(): void {
  if (!state.currentRoom) return;
  const url = `${window.location.origin}${window.location.pathname}?room=${state.currentRoom}`;
  navigator.clipboard.writeText(url).then(() => showToast("Link copied!"));
}

export function listenRoom(): void {
  const roomStateRef = ref(db, `rooms/${state.currentRoom}`);
  onValue(roomStateRef, (snap) => {
    if (!snap.exists()) {
      showToast("Room closed");
      handleLeave();
      return;
    }
    updateUI(snap.val() as RoomData);
  });
}

export async function handleDeleteRoom(): Promise<void> {
  if (!state.currentRoom) return;
  await remove(ref(db, `rooms/${state.currentRoom}`));
  handleLeave(true);
  showToast("Room deleted");
}

export function setupBeforeUnload(): void {
  window.addEventListener("beforeunload", () => {
    if (!state.currentRoom || !state.currentUser) return;
    set(
      ref(
        db,
        `rooms/${state.currentRoom}/users/${state.currentUser.uid}/online`
      ),
      false
    );
    remove(
      ref(db, `rooms/${state.currentRoom}/typing/${state.currentUser.uid}`)
    );
  });
}
