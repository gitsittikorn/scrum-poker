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
import type { RoomData, User, FeatureFlags, FeaturePermissions } from "./types";
import { roleSelect, roomSelect, roomCodeDisplay, userBadge } from "./dom";
import { AUTO_UNLOCK_SECONDS, FEATURES } from "./config";
import { APP_VERSION, SUPER_ADMIN_NAME } from "./constants";
import { escapeHtml } from "./utils";
import { showPage, showToast, saveUsername, applyFeatureFlags, closeSettings, updateSettingsPermissions, updateSettingsFeatureState } from "./ui";
import { initChat, destroyChat, sendSystemMessage } from "./chat";
import { updateUI, cancelUnlockTimer } from "./voting";
import { destroyWheel, initWheelManual } from "./wheel";
import { initSuperAdminPanel, destroySuperAdminPanel } from "./admin";

let roomListenerRef: ReturnType<typeof ref> | null = null;
let forceRefreshRef: ReturnType<typeof ref> | null = null;
let permissionsListenerRef: ReturnType<typeof ref> | null = null;

/** Track previous feature flags to detect changes */
let prevFeatures: FeatureFlags = {
  poker: true,
  chat: true,
  react: true,
  sound: true,
  wheel: true,
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

  // Block non-super-admin from joining admin room
  if (roomCode === "admin" && (username !== SUPER_ADMIN_NAME || roleSelect.value !== "admin")) {
    showToast("🛡️ ต้องใช้ชื่อและ Role admin เท่านั้น");
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

  const typingPresenceRef = ref(
    db,
    `rooms/${roomCode}/typing/${state.currentUser!.uid}`
  );
  onDisconnect(typingPresenceRef).remove();

  const role = roleSelect.value;
  const roleIcon =
    role === "dev"
      ? "👨‍💻"
      : role === "qa"
        ? "🐛"
        : role === "ux"
          ? "🎨"
          : role === "admin"
            ? "🛡️"
            : "📋";
  const roleName =
    role === "dev"
      ? "Dev"
      : role === "qa"
        ? "QA"
        : role === "ux"
          ? "UX/UI"
          : role === "admin"
            ? "Admin"
            : "PO";
  userBadge.className = `user-badge ${role === "admin" ? "admin" : role}`;
  userBadge.innerHTML = `${roleIcon} ${escapeHtml(state.currentUser!.name)} <span class="user-role">(${roleName})</span>`;

  // Reset prevFeatures before listening
  prevFeatures = { poker: true, chat: true, react: true, sound: true, wheel: true };

  showPage("room");
  applyFeatureFlags(); // Apply role-based visibility (e.g. delete button for PO)

  // Super admin: only if name + role + room all match
  state.isSuperAdmin = roomCode === "admin" && state.currentUser?.name === SUPER_ADMIN_NAME && state.currentRole === "admin";
  if (state.isSuperAdmin) {
    initSuperAdminPanel();
    // Hide poker UI — admin room only shows super admin panel
    const votingStatus = document.querySelector(".voting-status");
    const votingSection = document.querySelector(".voting-section");
    const adminControls = document.querySelector(".admin-controls");
    const participantsSection = document.querySelector(".participants-section");
    votingStatus?.classList.add("hidden");
    votingSection?.classList.add("hidden");
    adminControls?.classList.add("hidden");
    participantsSection?.classList.add("hidden");
    // Bottom bar: hide center buttons, hide delete room, show only leave on the right
    const bottomBar = document.getElementById("bottom-bar");
    const bottomBarCenter = document.querySelector(".bottom-bar-center");
    const deleteWrapper = document.getElementById("delete-room-wrapper");
    bottomBar?.classList.remove("hidden");
    bottomBarCenter?.classList.add("hidden");
    if (deleteWrapper) deleteWrapper.style.display = "none";
  }

  // Wheel room: standalone wheel with manual entries only
  state.isWheelRoom = roomCode === "Wheel";
  if (state.isWheelRoom) {
    initWheelRoom();
  }

  listenRoom();
  if (!state.isSuperAdmin) listenPermissions(); // Admin room doesn't need PO permission listener
  initChat(); // isReinit = false → sets joinedAt
  sendSystemMessage(`${state.currentUser!.name} เข้าร่วมแล้ว`);
}

/** Initialize standalone Wheel room — move wheel DOM into main content area */
function initWheelRoom(): void {
  // Hide poker UI
  const votingStatus = document.querySelector(".voting-status");
  const votingSection = document.querySelector(".voting-section");
  const adminControls = document.querySelector(".admin-controls");
  const participantsSection = document.querySelector(".participants-section");
  const resultSection = document.getElementById("result-section");
  votingStatus?.classList.add("hidden");
  votingSection?.classList.add("hidden");
  adminControls?.classList.add("hidden");
  participantsSection?.classList.add("hidden");
  resultSection?.classList.add("hidden");

  // Show React, Sound, Chat on bottom bar — hide only Wheel button + delete room
  const deleteWrapper = document.getElementById("delete-room-wrapper");
  const btnWheel = document.getElementById("btn-wheel");
  btnWheel?.classList.add("hidden");
  if (deleteWrapper) deleteWrapper.style.display = "none";

  // Move wheel panel contents into main content section
  const wheelRoomSection = document.getElementById("wheel-room-section");
  const wheelPanel = document.getElementById("wheel-panel");
  const wheelHeader = wheelPanel?.querySelector(".wheel-header");
  const wheelBody = wheelPanel?.querySelector(".wheel-body");
  if (wheelRoomSection && wheelHeader && wheelBody) {
    wheelRoomSection.appendChild(wheelHeader);
    wheelRoomSection.appendChild(wheelBody);
    wheelRoomSection.classList.remove("hidden");

    // Wrap controls + entries into a right sidebar div
    const sidebar = document.createElement("div");
    sidebar.className = "wheel-room-sidebar";
    const children = Array.from(wheelBody.children);
    for (const child of children) {
      if ((child as HTMLElement).id === "wheel-canvas-container") continue;
      if ((child as HTMLElement).classList?.contains("wheel-pointer")) continue;
      sidebar.appendChild(child);
    }
    wheelBody.appendChild(sidebar);
  }
  // Hide the slide-in panel shell
  wheelPanel?.classList.add("hidden");

  // Hide close button (wheel is main content, no need to close)
  const btnWheelClose = document.getElementById("btn-wheel-close");
  btnWheelClose?.classList.add("hidden");

  // Init wheel in manual-only mode (no Firebase member fetch)
  initWheelManual();
}

/** Destroy standalone Wheel room — move DOM back and restore UI */
function destroyWheelRoom(): void {
  const wheelRoomSection = document.getElementById("wheel-room-section");
  const wheelPanel = document.getElementById("wheel-panel");

  // Unwrap sidebar: move children back to wheel-body before moving DOM
  const sidebar = wheelRoomSection?.querySelector(".wheel-room-sidebar");
  const wheelBody = wheelRoomSection?.querySelector(".wheel-body");
  if (sidebar && wheelBody) {
    const children = Array.from(sidebar.children);
    for (const child of children) {
      wheelBody.appendChild(child);
    }
    sidebar.remove();
  }

  // Move wheel DOM back to the aside panel
  const wheelHeader = wheelRoomSection?.querySelector(".wheel-header");
  if (wheelPanel && wheelHeader && wheelBody) {
    wheelPanel.insertBefore(wheelBody, wheelPanel.querySelector(".wheel-resize-handle")?.nextSibling || null);
    wheelPanel.insertBefore(wheelHeader, wheelPanel.firstChild);
  }
  wheelRoomSection?.classList.add("hidden");
  wheelPanel?.classList.remove("hidden");

  // Restore close button
  const btnWheelClose = document.getElementById("btn-wheel-close");
  btnWheelClose?.classList.remove("hidden");

  // Restore hidden sections
  document.querySelector(".voting-status")?.classList.remove("hidden");
  document.querySelector(".voting-section")?.classList.remove("hidden");
  document.querySelector(".admin-controls")?.classList.remove("hidden");
  document.querySelector(".participants-section")?.classList.remove("hidden");
  document.getElementById("result-section")?.classList.remove("hidden");
  const bottomBarCenter = document.querySelector(".bottom-bar-center");
  bottomBarCenter?.classList.remove("hidden");
  const btnWheel = document.getElementById("btn-wheel");
  btnWheel?.classList.remove("hidden");
  const deleteWrapper = document.getElementById("delete-room-wrapper");
  if (deleteWrapper) deleteWrapper.style.display = "";
}

/** Cancel onDisconnect handlers for the given room — prevents stale writes after leaving */
function cancelOnDisconnect(roomCode: string, uid: string): void {
  try {
    onDisconnect(ref(db, `rooms/${roomCode}/users/${uid}/online`)).cancel();
    onDisconnect(ref(db, `rooms/${roomCode}/typing/${uid}`)).cancel();
  } catch {
    // cancel() can throw if the handler was already removed — ignore
  }
}

export function handleLeave(skipMessage = false): void {
  if (!state.currentRoom || !state.currentUser) return;
  const leavingName = state.currentUser.name;
  const roomCode = state.currentRoom;
  const uid = state.currentUser.uid;
  const role = state.currentRole;
  cancelUnlockTimer();
  cancelOnDisconnect(roomCode, uid);
  if (!skipMessage) sendSystemMessage(`${leavingName} ออกจากห้อง`);
  destroyChat();
  if (state.isWheelRoom) destroyWheelRoom();
  destroyWheel();
  // Clean up any lingering not-voted modal
  document.getElementById("not-voted-modal")?.remove();
  if (state.isSuperAdmin) destroySuperAdminPanel();
  state.isSuperAdmin = false;
  state.isWheelRoom = false;
  // Restore bottom bar center that was hidden in admin room
  const bottomBarCenter = document.querySelector(".bottom-bar-center");
  bottomBarCenter?.classList.remove("hidden");
  // Restore sections hidden in admin room
  document.querySelector(".voting-status")?.classList.remove("hidden");
  document.querySelector(".voting-section")?.classList.remove("hidden");
  document.querySelector(".admin-controls")?.classList.remove("hidden");
  document.querySelector(".participants-section")?.classList.remove("hidden");
  if (roomListenerRef) {
    off(roomListenerRef);
    roomListenerRef = null;
  }
  if (permissionsListenerRef) {
    off(permissionsListenerRef);
    permissionsListenerRef = null;
  }
  localStorage.removeItem("scrum-poker-room");
  state.currentRoom = null;
  state.currentUser = null;
  state.selectedCard = null;
  state.activeCard = null;
  showPage("landing");
  window.history.replaceState(null, "", window.location.pathname);

  // Set offline and clear vote — keep user record for wheel/history
  // Skip when deleting room (room already removed, no need to write)
  if (!skipMessage) {
    set(ref(db, `rooms/${roomCode}/users/${uid}`), {
      name: leavingName,
      role: role,
      vote: null,
      online: false,
      lastSeen: serverTimestamp(),
    })
      .then(() => cleanupIfRoomEmpty(roomCode))
      .catch(console.error);
  }
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
      handleLeave(true);
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
          wheel: data.features.wheel ?? true,
        }
      : { poker: true, chat: true, react: true, sound: true, wheel: true };

    const featuresChanged =
      prevFeatures.poker !== newFeatures.poker ||
      prevFeatures.chat !== newFeatures.chat ||
      prevFeatures.react !== newFeatures.react ||
      prevFeatures.sound !== newFeatures.sound ||
      prevFeatures.wheel !== newFeatures.wheel;

    // Only re-init listeners when chat/react/sound flags changed (not poker/wheel)
    const listenersChanged =
      prevFeatures.chat !== newFeatures.chat ||
      prevFeatures.react !== newFeatures.react ||
      prevFeatures.sound !== newFeatures.sound;

    if (featuresChanged) {
      FEATURES.poker = newFeatures.poker;
      FEATURES.chat = newFeatures.chat;
      FEATURES.react = newFeatures.react;
      FEATURES.sound = newFeatures.sound;
      FEATURES.wheel = newFeatures.wheel;
      prevFeatures = { ...newFeatures };
      // Re-init chat/react/sound listeners only when those flags changed
      // isReinit = true → shows all messages (joinedAt = 0)
      if (listenersChanged && state.currentRoom) initChat(true);
      applyFeatureFlags();
    }

    // Always update settings modal if open (features + auto-unlock)
    updateSettingsFeatureState(newFeatures, data.autoUnlockSeconds);

    updateUI(data);
  });
}

/** Listen to admin/featurePermissions for the current room — updates settings modal reactively */
function listenPermissions(): void {
  if (permissionsListenerRef) {
    off(permissionsListenerRef);
    permissionsListenerRef = null;
  }
  if (!state.currentRoom) return;
  permissionsListenerRef = ref(db, `admin/featurePermissions/${state.currentRoom}`);
  onValue(permissionsListenerRef, (snap) => {
    const permissions: FeaturePermissions = snap.exists()
      ? {
          poker: snap.val().poker ?? true,
          chat: snap.val().chat ?? true,
          react: snap.val().react ?? true,
          sound: snap.val().sound ?? true,
          wheel: snap.val().wheel ?? true,
        }
      : { poker: true, chat: true, react: true, sound: true, wheel: true };
    const autoUnlockEditable = snap.exists() ? (snap.val().autoUnlockEditable ?? true) : true;
    updateSettingsPermissions(permissions, autoUnlockEditable);
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

// ===== Force Refresh (via Firebase RTDB) =====

/** Listen for force refresh version — reload all clients when changed */
export function listenForceRefresh(): void {
  destroyForceRefreshListener();
  forceRefreshRef = ref(db, "settings/forceRefreshVersion");
  onValue(forceRefreshRef, (snap) => {
    const remoteVersion = snap.val() as string | null;
    if (remoteVersion && remoteVersion !== APP_VERSION) {
      console.log(`[ForceRefresh] Remote=${remoteVersion}, Local=${APP_VERSION} — reloading`);
      location.reload();
    }
  });
}

/** Write current APP_VERSION to Firebase so old clients trigger force refresh */
export function writeForceRefreshVersion(): void {
  set(ref(db, "settings/forceRefreshVersion"), APP_VERSION);
}

/** Clean up force refresh listener */
function destroyForceRefreshListener(): void {
  if (forceRefreshRef) {
    off(forceRefreshRef);
    forceRefreshRef = null;
  }
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
