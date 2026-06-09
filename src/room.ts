import {
  db,
  ref,
  set,
  get,
  remove,
  update,
  onValue,
  off,
  serverTimestamp,
  onDisconnect,
} from "./firebase";
import { state } from "./state";
import type { RoomData, User, FeatureFlags } from "./types";
import { roleSelect, roomSelect, roomCodeDisplay, userBadge } from "./dom";
import { AUTO_UNLOCK_SECONDS, FEATURES } from "./config";
import { escapeHtml } from "./utils";
import { showPage, showToast, saveUsername, applyFeatureFlags, closeSettings } from "./ui";
import { initChat, destroyChat, sendSystemMessage } from "./chat";
import { updateUI, cancelUnlockTimer } from "./voting";

let roomListenerRef: ReturnType<typeof ref> | null = null;

/** Track previous feature flags to detect changes */
let prevFeatures: FeatureFlags = {
  poker: true,
  chat: true,
  react: true,
  sound: true,
};

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
        autoUnlockSeconds: AUTO_UNLOCK_SECONDS,
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

  // Clear any existing kicked flag (allows rejoin after being kicked)
  await remove(ref(db, `rooms/${roomCode}/kicked/${state.currentUser!.uid}`));

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

  // Reset prevFeatures before listening
  prevFeatures = { poker: true, chat: true, react: true, sound: true };

  showPage("room");
  listenRoom();
  initChat(); // isReinit = false → sets joinedAt
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
  const roomCode = state.currentRoom;
  const uid = state.currentUser.uid;
  cancelUnlockTimer();
  if (!skipMessage) sendSystemMessage(`${leavingName} ออกจากห้อง`);
  destroyChat();
  if (roomListenerRef) {
    off(roomListenerRef);
    roomListenerRef = null;
  }
  localStorage.removeItem("scrum-poker-room");
  state.currentRoom = null;
  state.currentUser = null;
  state.selectedCard = null;
  showPage("landing");
  window.history.replaceState(null, "", window.location.pathname);

  // Set offline → remove user → cleanup check if room empty
  set(ref(db, `rooms/${roomCode}/users/${uid}/online`), false)
    .then(() => remove(ref(db, `rooms/${roomCode}/users/${uid}`)))
    .then(() => cleanupIfRoomEmpty(roomCode))
    .catch(console.error);
}

export function handleCopyLink(): void {
  if (!state.currentRoom) return;
  const url = `${window.location.origin}${window.location.pathname}?room=${state.currentRoom}`;
  navigator.clipboard.writeText(url).then(() => showToast("Link copied!"));
}

export function listenRoom(): void {
  if (roomListenerRef) {
    off(roomListenerRef);
    roomListenerRef = null;
  }
  roomListenerRef = ref(db, `rooms/${state.currentRoom}`);
  onValue(roomListenerRef, (snap) => {
    if (!snap.exists()) {
      showToast("Room closed");
      handleLeave();
      return;
    }
    const data = snap.val() as RoomData;

    // ── Check if current user was kicked ──
    if (state.currentUid && data.kicked && data.kicked[state.currentUid]) {
      remove(ref(db, `rooms/${state.currentRoom}/kicked/${state.currentUid}`));
      showToast("🥾 คุณถูกเตะออกจากห้องโดย PO");
      handleLeave(true);
      return;
    }

    // ── Feature flags from Firebase ──
    const newFeatures: FeatureFlags = data.features
      ? {
          poker: data.features.poker ?? true,
          chat: data.features.chat ?? true,
          react: data.features.react ?? true,
          sound: data.features.sound ?? true,
        }
      : { poker: true, chat: true, react: true, sound: true };

    const featuresChanged =
      prevFeatures.poker !== newFeatures.poker ||
      prevFeatures.chat !== newFeatures.chat ||
      prevFeatures.react !== newFeatures.react ||
      prevFeatures.sound !== newFeatures.sound;

    // Only re-init listeners when chat/react/sound flags changed (not poker)
    const listenersChanged =
      prevFeatures.chat !== newFeatures.chat ||
      prevFeatures.react !== newFeatures.react ||
      prevFeatures.sound !== newFeatures.sound;

    if (featuresChanged) {
      FEATURES.poker = newFeatures.poker;
      FEATURES.chat = newFeatures.chat;
      FEATURES.react = newFeatures.react;
      FEATURES.sound = newFeatures.sound;
      prevFeatures = { ...newFeatures };
      // Re-init chat/react/sound listeners only when those flags changed
      // isReinit = true → shows all messages (joinedAt = 0)
      if (listenersChanged && state.currentRoom) initChat(true);
      applyFeatureFlags();
    }

    updateUI(data);
  });
}

// ===== Room-empty cleanup (item 6) =====

async function cleanupIfRoomEmpty(roomCode: string): Promise<void> {
  try {
    const usersSnap = await get(ref(db, `rooms/${roomCode}/users`));
    if (!usersSnap.exists()) return; // Room already deleted
    const users = usersSnap.val() as Record<string, User>;
    const onlineCount = Object.values(users).filter(
      (u) => u.online !== false
    ).length;
    if (onlineCount === 0) {
      const updates: Record<string, unknown> = {};
      // Delete ephemeral data
      ["messages", "typing", "liveReactions", "sounds", "drinkers", "kicked"].forEach(
        (key) => {
          updates[key] = null;
        }
      );
      // Reset votes
      Object.keys(users).forEach((uid) => {
        updates[`users/${uid}/vote`] = null;
      });
      updates["revealed"] = false;
      updates["locked"] = false;
      await update(ref(db, `rooms/${roomCode}`), updates);
      console.log(`[Cleanup] Room ${roomCode} empty — cleaned ephemeral data`);
    }
  } catch (err) {
    console.error("[Cleanup] Error:", err);
  }
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

// ===== Scheduled Cleanup (item 7) =====

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Start the periodic cleanup check — called from app.ts init */
export function startCleanupScheduler(): void {
  if (cleanupInterval) return; // Guard: already running
  checkCleanup();
  // Check every 60 seconds
  cleanupInterval = setInterval(checkCleanup, 60_000);
}

async function checkCleanup(): Promise<void> {
  try {
    const settingsSnap = await get(ref(db, "settings"));
    if (!settingsSnap.exists()) return;
    const settings = settingsSnap.val();
    const cleanupTime = settings.cleanupTime as string | undefined;
    if (!cleanupTime) return;

    const now = new Date();
    const today = formatDate(now);

    // Already cleaned today
    if (settings.lastCleanupDate === today) return;

    // Parse cleanup time (HH:mm)
    const [hours, minutes] = cleanupTime.split(":").map(Number);
    const cleanupDate = new Date(now);
    cleanupDate.setHours(hours, minutes, 0, 0);

    // Current time is past the scheduled cleanup time
    if (now >= cleanupDate) {
      // Random delay 0-30s to spread across multiple clients
      const delay = Math.floor(Math.random() * 30000);
      await new Promise((r) => setTimeout(r, delay));
      // Re-check: another client may have already cleaned
      const recheckSnap = await get(ref(db, "settings/lastCleanupDate"));
      if (recheckSnap.exists() && recheckSnap.val() === today) return;
      await performCleanup(today);
    }
  } catch (err) {
    console.error("[ScheduledCleanup] Error:", err);
  }
}

/** Manual clear-all triggered by admin — deletes all rooms, kicks everyone out */
export async function handleClearAllRooms(): Promise<void> {
  // Close settings modal first
  closeSettings();
  // Leave current room (skip "Room closed" toast for self)
  handleLeave(true);
  // Delete all rooms — every other client gets "Room closed" + kicked out
  await remove(ref(db, "rooms"));
  const today = formatDate(new Date());
  await update(ref(db, "settings"), { lastCleanupDate: today });
  showToast("🗑 เคลียร์ข้อมูลทุกห้องแล้ว ทุกคนถูกออกจากห้อง");
}

async function performCleanup(todayStr: string): Promise<void> {
  try {
    const roomsSnap = await get(ref(db, "rooms"));
    if (!roomsSnap.exists()) {
      // No rooms — just mark as done
      await update(ref(db, "settings"), { lastCleanupDate: todayStr });
      return;
    }

    const rooms = roomsSnap.val() as Record<string, any>;
    const updates: Record<string, unknown> = {};

    for (const roomCode of Object.keys(rooms)) {
      ["messages", "typing", "liveReactions", "sounds", "drinkers", "kicked"].forEach(
        (key) => {
          updates[`rooms/${roomCode}/${key}`] = null;
        }
      );
      updates[`rooms/${roomCode}/revealed`] = false;
      updates[`rooms/${roomCode}/locked`] = false;

      // Reset votes for all users in room
      const roomData = rooms[roomCode];
      if (roomData.users) {
        for (const uid of Object.keys(roomData.users)) {
          updates[`rooms/${roomCode}/users/${uid}/vote`] = null;
        }
      }
    }

    updates["settings/lastCleanupDate"] = todayStr;
    await update(ref(db), updates);
    console.log(`[ScheduledCleanup] Cleaned all rooms at ${todayStr}`);
  } catch (err) {
    console.error("[ScheduledCleanup] Perform error:", err);
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
