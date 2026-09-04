import { db, ref, get, update, onValue, off } from "./firebase";
import type { FeaturePermissions } from "./types";
import {
  superAdminPanel,
  superAdminRoomTabs,
  superAdminPermissions,
  superAdminRoomName,
  superAdminToggles,
  qaToolPage,
} from "./dom";
import { showToast } from "./ui";
import { AUTO_UNLOCK_SECONDS } from "./config";
import { restoreQaToolHome } from "./qaTool";

/** Rooms that super admin can manage */
const MANAGED_ROOMS = [
  { code: "Kitsune", label: "🦊 Kitsune" },
  { code: "Phoenix", label: "🔥 Phoenix" },
  { code: "UXUI", label: "🎨 UX/UI" },
  { code: "Cold", label: "❄️ ห้องเย็น" },
  { code: "ColdJiab", label: "🧊 ห้องเย็นเจี๊ยบ" },
  { code: "TQM1", label: "🏢 TQM 1" },
  { code: "TQM2", label: "🏢 TQM 2" },
];

const FEATURE_KEYS: (keyof FeaturePermissions)[] = [
  "poker",
  "chat",
  "react",
  "sound",
  "wheel",
  "speakerRotate",
];

const FEATURE_LABELS: Record<keyof FeaturePermissions, string> = {
  poker: "🃏 Poker",
  chat: "💬 Chat",
  react: "😀 React",
  sound: "🔊 Sound",
  wheel: "🎡 Wheel",
  speakerRotate: "🎤 Speaker Rotate",
};

const FEATURE_ICONS: Record<keyof FeaturePermissions, string> = {
  poker: "🃏",
  chat: "💬",
  react: "😀",
  sound: "🔊",
  wheel: "🎡",
  speakerRotate: "🎤",
};

let selectedRoom: string | null = null;
/** Sentinel room code for the QA Tool tab (data conversion page, not a real room) */
const QA_TOOL_TAB = "__qa-tool__";
let permissionsListenerRef: ReturnType<typeof ref> | null = null;
let featuresListenerRef: ReturnType<typeof ref> | null = null;
let autoUnlockListenerRef: ReturnType<typeof ref> | null = null;
let renderScheduled = false;

/** Current feature state and permissions for the selected room */
let currentFeatures: FeaturePermissions = { poker: true, chat: true, react: true, sound: true, wheel: true, speakerRotate: true };
let currentPermissions: FeaturePermissions = { poker: true, chat: true, react: true, sound: true, wheel: true, speakerRotate: true };
let currentAutoUnlock: number = AUTO_UNLOCK_SECONDS;
let currentAutoUnlockEditable: boolean = true;

/** Schedule a single render — batches feature + permission updates in same tick */
function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  queueMicrotask(() => {
    renderScheduled = false;
    renderPermissionToggles();
  });
}

/** Initialize the super admin panel — called when joining admin room */
export function initSuperAdminPanel(): void {
  superAdminPanel.classList.remove("hidden");
  renderRoomTabs();
  restoreQaToolHome(); // QA tool page back in its home spot (in case of standalone mode)
  // Default to first room
  if (MANAGED_ROOMS.length > 0) {
    selectRoom(MANAGED_ROOMS[0].code);
  }
}

/** Destroy super admin panel — called when leaving admin room */
export function destroySuperAdminPanel(): void {
  superAdminPanel.classList.add("hidden");
  superAdminPanel.classList.remove("qa-wide");
  superAdminPermissions.classList.add("hidden");
  qaToolPage.classList.add("hidden");
  qaToolPage.classList.remove("qa-wide");
  superAdminRoomTabs.innerHTML = "";
  superAdminToggles.innerHTML = "";
  selectedRoom = null;
  if (permissionsListenerRef) {
    off(permissionsListenerRef);
    permissionsListenerRef = null;
  }
  if (featuresListenerRef) {
    off(featuresListenerRef);
    featuresListenerRef = null;
  }
  if (autoUnlockListenerRef) {
    off(autoUnlockListenerRef);
    autoUnlockListenerRef = null;
  }
}

/** Render room tab buttons */
function renderRoomTabs(): void {
  superAdminRoomTabs.innerHTML = "";
  for (const room of MANAGED_ROOMS) {
    const btn = document.createElement("button");
    btn.className = "super-admin-room-tab";
    btn.textContent = room.label;
    btn.dataset.room = room.code;
    btn.addEventListener("click", () => selectRoom(room.code));
    superAdminRoomTabs.appendChild(btn);
  }
  // QA Tool tab — data conversion page
  const qaBtn = document.createElement("button");
  qaBtn.className = "super-admin-room-tab";
  qaBtn.textContent = "🧪 QA Tool";
  qaBtn.dataset.room = QA_TOOL_TAB;
  qaBtn.addEventListener("click", () => selectQaTool());
  superAdminRoomTabs.appendChild(qaBtn);
}

/** Show the QA Tool page — hides room permissions and detaches room listeners */
function selectQaTool(): void {
  selectedRoom = null;
  if (permissionsListenerRef) {
    off(permissionsListenerRef);
    permissionsListenerRef = null;
  }
  if (featuresListenerRef) {
    off(featuresListenerRef);
    featuresListenerRef = null;
  }
  if (autoUnlockListenerRef) {
    off(autoUnlockListenerRef);
    autoUnlockListenerRef = null;
  }
  superAdminRoomTabs.querySelectorAll(".super-admin-room-tab").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    el.classList.toggle("active", el.dataset.room === QA_TOOL_TAB);
  });
  superAdminPermissions.classList.add("hidden");
  qaToolPage.classList.remove("hidden");
  // Widen panel + tool page for the long tool rows
  superAdminPanel.classList.add("qa-wide");
  qaToolPage.classList.add("qa-wide");
}

/** Select a room and load its permissions */
function selectRoom(roomCode: string): void {
  selectedRoom = roomCode;
  // Update active tab
  superAdminRoomTabs.querySelectorAll(".super-admin-room-tab").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    el.classList.toggle("active", el.dataset.room === roomCode);
  });
  // Show room name
  const room = MANAGED_ROOMS.find((r) => r.code === roomCode);
  superAdminRoomName.textContent = room ? room.label : roomCode;
  superAdminPermissions.classList.remove("hidden");
  qaToolPage.classList.add("hidden");
  superAdminPanel.classList.remove("qa-wide");
  qaToolPage.classList.remove("qa-wide");
  // Listen for both feature state and permissions
  listenFeatureState(roomCode);
  listenPermissions(roomCode);
}

/** Listen to the room's feature flags + auto-unlock (shallow paths only, avoids downloading messages/users) */
function listenFeatureState(roomCode: string): void {
  if (featuresListenerRef) {
    off(featuresListenerRef);
    featuresListenerRef = null;
  }
  // Listen to features and autoUnlockSeconds separately to avoid downloading all messages/users
  const featuresRef = ref(db, `rooms/${roomCode}/features`);
  const autoUnlockRef = ref(db, `rooms/${roomCode}/autoUnlockSeconds`);

  onValue(featuresRef, (snap) => {
    currentFeatures = snap.exists()
      ? {
          poker: snap.val().poker ?? true,
          chat: snap.val().chat ?? true,
          react: snap.val().react ?? true,
          sound: snap.val().sound ?? true,
          wheel: snap.val().wheel ?? true,
          speakerRotate: snap.val().speakerRotate ?? true,
        }
      : { poker: true, chat: true, react: true, sound: true, wheel: true, speakerRotate: true };
    scheduleRender();
  });

  onValue(autoUnlockRef, (snap) => {
    currentAutoUnlock = snap.exists() ? snap.val() : AUTO_UNLOCK_SECONDS;
    scheduleRender();
  });

  // Store refs for cleanup
  featuresListenerRef = featuresRef;
  autoUnlockListenerRef = autoUnlockRef;
}

/** Listen to feature permissions for a room (PO can edit) */
function listenPermissions(roomCode: string): void {
  if (permissionsListenerRef) {
    off(permissionsListenerRef);
    permissionsListenerRef = null;
  }
  permissionsListenerRef = ref(db, `admin/featurePermissions/${roomCode}`);
  onValue(permissionsListenerRef, (snap) => {
    currentPermissions = snap.exists()
      ? {
          poker: snap.val().poker ?? true,
          chat: snap.val().chat ?? true,
          react: snap.val().react ?? true,
          sound: snap.val().sound ?? true,
          wheel: snap.val().wheel ?? true,
          speakerRotate: snap.val().speakerRotate ?? true,
        }
      : { poker: true, chat: true, react: true, sound: true, wheel: true, speakerRotate: true };
    currentAutoUnlockEditable = snap.exists()
      ? (snap.val().autoUnlockEditable ?? true)
      : true;
    scheduleRender();
  });
}

/** Render permission toggles for the selected room */
function renderPermissionToggles(): void {
  if (!selectedRoom) return;
  superAdminToggles.innerHTML = "";

  for (const key of FEATURE_KEYS) {
    const enabled = currentFeatures[key];
    const editable = currentPermissions[key];

    // Feature row container
    const row = document.createElement("div");
    row.className = "super-admin-feature-row";

    // Feature icon (large)
    const featureIcon = document.createElement("span");
    featureIcon.className = "super-admin-feature-icon";
    featureIcon.textContent = FEATURE_ICONS[key];

    // Feature label
    const featureLabel = document.createElement("span");
    featureLabel.className = "super-admin-feature-label";
    featureLabel.textContent = FEATURE_LABELS[key].slice(FEATURE_ICONS[key].length).trim();

    // Toggle 1: Feature ON/OFF (writes to rooms/{room}/features)
    const toggle1Label = document.createElement("label");
    toggle1Label.className = "toggle-label super-admin-toggle";

    const text1 = document.createElement("span");
    text1.className = "toggle-text";
    text1.textContent = "เปิดใช้";

    const checkbox1 = document.createElement("input");
    checkbox1.type = "checkbox";
    checkbox1.checked = enabled;
    checkbox1.setAttribute("aria-label", `Enable ${key}`);
    checkbox1.addEventListener("change", () => {
      handleFeatureStateChange(key, checkbox1.checked);
    });

    const switch1 = document.createElement("span");
    switch1.className = "toggle-switch";
    switch1.setAttribute("role", "switch");
    switch1.setAttribute("aria-checked", String(enabled));
    checkbox1.addEventListener("change", () => {
      switch1.setAttribute("aria-checked", String(checkbox1.checked));
    });

    toggle1Label.appendChild(text1);
    toggle1Label.appendChild(checkbox1);
    toggle1Label.appendChild(switch1);

    // Toggle 2: PO can edit (writes to admin/featurePermissions)
    const toggle2Label = document.createElement("label");
    toggle2Label.className = "toggle-label super-admin-toggle";

    const text2 = document.createElement("span");
    text2.className = "toggle-text";
    text2.textContent = "PO can edit";

    const checkbox2 = document.createElement("input");
    checkbox2.type = "checkbox";
    checkbox2.checked = editable;
    checkbox2.setAttribute("aria-label", `Allow PO to edit ${key}`);
    checkbox2.addEventListener("change", () => {
      handlePermissionChange(key, checkbox2.checked);
    });

    const switch2 = document.createElement("span");
    switch2.className = "toggle-switch";
    switch2.setAttribute("role", "switch");
    switch2.setAttribute("aria-checked", String(editable));
    checkbox2.addEventListener("change", () => {
      switch2.setAttribute("aria-checked", String(checkbox2.checked));
    });

    // Badge: show when PO cannot edit
    const badge = document.createElement("span");
    badge.className = "admin-only-badge" + (editable ? " hidden" : "");
    badge.textContent = "🔒 admin only";

    toggle2Label.appendChild(text2);
    toggle2Label.appendChild(checkbox2);
    toggle2Label.appendChild(switch2);
    toggle2Label.appendChild(badge);

    row.appendChild(featureIcon);
    row.appendChild(featureLabel);
    row.appendChild(toggle1Label);
    row.appendChild(toggle2Label);

    superAdminToggles.appendChild(row);
  }

  // ── Auto-unlock row ──
  const autoRow = document.createElement("div");
  autoRow.className = "super-admin-feature-row";

  const autoIcon = document.createElement("span");
  autoIcon.className = "super-admin-feature-icon";
  autoIcon.textContent = "⏱️";

  const autoLabel = document.createElement("span");
  autoLabel.className = "super-admin-feature-label";
  autoLabel.textContent = "Auto-unlock (วินาที)";

  // Auto-unlock value input
  const autoInput = document.createElement("input");
  autoInput.type = "number";
  autoInput.min = "5";
  autoInput.max = "300";
  autoInput.step = "5";
  autoInput.value = String(currentAutoUnlock);
  autoInput.className = "super-admin-input";
  autoInput.setAttribute("aria-label", "Auto-unlock seconds");
  autoInput.addEventListener("change", () => {
    handleAutoUnlockChange(parseInt(autoInput.value, 10));
  });

  // PO can edit auto-unlock toggle
  const autoToggleLabel = document.createElement("label");
  autoToggleLabel.className = "toggle-label super-admin-toggle";

  const autoText = document.createElement("span");
  autoText.className = "toggle-text";
  autoText.textContent = "PO can edit";

  const autoCheckbox = document.createElement("input");
  autoCheckbox.type = "checkbox";
  autoCheckbox.checked = currentAutoUnlockEditable;
  autoCheckbox.setAttribute("aria-label", "Allow PO to edit auto-unlock");
  autoCheckbox.addEventListener("change", () => {
    handleAutoUnlockPermissionChange(autoCheckbox.checked);
  });

  const autoSwitch = document.createElement("span");
  autoSwitch.className = "toggle-switch";
  autoSwitch.setAttribute("role", "switch");
  autoSwitch.setAttribute("aria-checked", String(currentAutoUnlockEditable));
  autoCheckbox.addEventListener("change", () => {
    autoSwitch.setAttribute("aria-checked", String(autoCheckbox.checked));
  });

  const autoBadge = document.createElement("span");
  autoBadge.className = "admin-only-badge" + (currentAutoUnlockEditable ? " hidden" : "");
  autoBadge.textContent = "🔒 admin only";

  autoToggleLabel.appendChild(autoText);
  autoToggleLabel.appendChild(autoCheckbox);
  autoToggleLabel.appendChild(autoSwitch);
  autoToggleLabel.appendChild(autoBadge);

  autoRow.appendChild(autoIcon);
  autoRow.appendChild(autoLabel);
  autoRow.appendChild(autoInput);
  autoRow.appendChild(autoToggleLabel);

  superAdminToggles.appendChild(autoRow);

  // Hint
  const hint = document.createElement("small");
  hint.className = "form-hint";
  hint.textContent = "เปลี่ยนแปลงจะบันทึกอัตโนมัติทันที — PO ในห้องจะเห็นผลทันที";
  superAdminToggles.appendChild(hint);
}

/** Save auto-unlock value change to Firebase */
async function handleAutoUnlockChange(seconds: number): Promise<void> {
  if (!selectedRoom) return;
  const val = Math.max(5, Math.min(300, isNaN(seconds) ? AUTO_UNLOCK_SECONDS : seconds));
  try {
    await update(ref(db, `rooms/${selectedRoom}`), { autoUnlockSeconds: val });
    showToast(`⏱️ Auto-unlock: ${val} วินาที`);
  } catch (err) {
    console.error("[SuperAdmin] Error saving auto-unlock:", err);
    showToast("❌ บันทึกไม่สำเร็จ");
  }
}

/** Save auto-unlock permission (PO can edit) to Firebase */
async function handleAutoUnlockPermissionChange(allowed: boolean): Promise<void> {
  if (!selectedRoom) return;
  try {
    await update(ref(db, `admin/featurePermissions/${selectedRoom}`), {
      autoUnlockEditable: allowed,
    });
    showToast(
      allowed
        ? `✅ PO สามารถแก้ไข Auto-unlock ได้`
        : `🔒 ล็อค Auto-unlock — admin only`
    );
  } catch (err) {
    console.error("[SuperAdmin] Error saving auto-unlock permission:", err);
    showToast("❌ บันทึกไม่สำเร็จ");
  }
}

/** Save feature state change to Firebase */
async function handleFeatureStateChange(
  feature: keyof FeaturePermissions,
  enabled: boolean
): Promise<void> {
  if (!selectedRoom) return;
  try {
    await update(ref(db, `rooms/${selectedRoom}/features`), {
      [feature]: enabled,
    });
    showToast(
      enabled
        ? `✅ เปิดใช้ ${FEATURE_LABELS[feature]}`
        : `❌ ปิด ${FEATURE_LABELS[feature]}`
    );
  } catch (err) {
    console.error("[SuperAdmin] Error saving feature state:", err);
    showToast("❌ บันทึกไม่สำเร็จ");
  }
}

/** Save permission change (PO can edit) to Firebase */
async function handlePermissionChange(
  feature: keyof FeaturePermissions,
  allowed: boolean
): Promise<void> {
  if (!selectedRoom) return;
  try {
    await update(ref(db, `admin/featurePermissions/${selectedRoom}`), {
      [feature]: allowed,
    });
    showToast(
      allowed
        ? `✅ PO สามารถแก้ไข ${FEATURE_LABELS[feature]} ได้`
        : `🔒 ล็อค ${FEATURE_LABELS[feature]} — admin only`
    );
  } catch (err) {
    console.error("[SuperAdmin] Error saving permissions:", err);
    showToast("❌ บันทึกไม่สำเร็จ");
  }
}

/**
 * Load feature permissions for a room (used by settings modal in ui.ts).
 * Returns true if PO is allowed to control the feature, false = admin only.
 * Absent = all allowed (backward compat).
 */
export async function loadFeaturePermissions(
  roomCode: string
): Promise<FeaturePermissions> {
  try {
    const snap = await get(ref(db, `admin/featurePermissions/${roomCode}`));
    if (snap.exists()) {
      const val = snap.val();
      return {
        poker: val.poker ?? true,
        chat: val.chat ?? true,
        react: val.react ?? true,
        sound: val.sound ?? true,
        wheel: val.wheel ?? true,
        speakerRotate: val.speakerRotate ?? true,
      };
    }
  } catch (err) {
    console.error("[SuperAdmin] Error loading permissions:", err);
  }
  return { poker: true, chat: true, react: true, sound: true, wheel: true, speakerRotate: true };
}
