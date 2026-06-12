import { db, auth, ref, get, signInAnonymously } from "./firebase";
import { state } from "./state";
import { roleSelect, roomSelect, adminRoomOption, adminRoleOption } from "./dom";
import { APP_VERSION, SUPER_ADMIN_NAME } from "./constants";
import { joinRoom } from "./room";

export function checkVersion(): void {
  const savedVersion = localStorage.getItem("scrum-poker-version");
  if (savedVersion !== APP_VERSION) {
    console.log("[Init] Version changed, clearing local session");
    localStorage.removeItem("scrum-poker-room");
    localStorage.setItem("scrum-poker-version", APP_VERSION);
  }
}

export async function initAuth(): Promise<void> {
  try {
    const result = await signInAnonymously(auth);
    state.currentUid = result.user.uid;
    console.log("[Auth] Signed in:", state.currentUid);
  } catch (err) {
    console.error("[Auth] Error:", err);
  }
}

export async function autoRejoinFromUrl(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  const savedUsername = localStorage.getItem("scrum-poker-username");
  const savedRole = localStorage.getItem("scrum-poker-role");
  if (!roomFromUrl || !savedUsername || !state.currentUid) return;

  // Show admin options if rejoining as super admin
  if (savedUsername === SUPER_ADMIN_NAME) {
    adminRoomOption.style.display = "";
    adminRoleOption.style.display = "";
  }

  // Block non-super-admin from rejoining admin room via URL
  if (roomFromUrl === "admin" && (savedUsername !== SUPER_ADMIN_NAME || savedRole !== "admin")) {
    console.log("[AutoJoin] Blocked: need admin889 + admin role to join admin room");
    window.history.replaceState(null, "", window.location.pathname);
    return;
  }

  console.log("[AutoJoin] From URL:", roomFromUrl);
  state.currentUser = { uid: state.currentUid, name: savedUsername };
  state.currentRole = savedRole || "dev";

  const options = roomSelect.options;
  for (let i = 0; i < options.length; i++) {
    if (options[i].value === roomFromUrl) {
      roomSelect.value = roomFromUrl;
      break;
    }
  }

  if (savedRole) roleSelect.value = savedRole;

  try {
    const roomRef = ref(db, `rooms/${roomFromUrl}`);
    const snap = await get(roomRef);
    if (snap.exists()) {
      await joinRoom(roomFromUrl, false);
    }
  } catch (err) {
    console.error("[AutoJoin] Error:", err);
  }
}
