import { db, ref, get, update } from "./firebase";
import { state, isPO, isSuperAdmin } from "./state";
import {
  toastEl,
  settingsModal,
  settingsInput,
  landingPage,
  roomPage,
  btnToggleTheme,
  usernameInput,
  roleSelect,
  adminSettings,
  featurePoker,
  featureChat,
  featureReact,
  featureSound,
  featureWheel,
  featureSpeaker,
  cleanupTimeInput,
  btnBarChat,
  btnBarReact,
  reactPickerBar,
  btnBarSound,
  soundPickerBar,
  muteOthersSound,
  btnWheel,
  toggleLabelPoker,
  toggleLabelChat,
  toggleLabelReact,
  toggleLabelSound,
  toggleLabelWheel,
  toggleLabelSpeaker,
} from "./dom";
import { TOAST_DURATION_MS, AUTO_UNLOCK_SECONDS, FEATURES } from "./config";
import { DEFAULT_POKER_CARDS } from "./constants";
import { hasConfiguredCards } from "./utils";
import type { User, FeatureFlags, FeaturePermissions, ConfirmModalOptions, CardDef } from "./types";
import { forceCloseChat } from "./chat";
import { forceCloseWheel } from "./wheel";
import { loadFeaturePermissions } from "./admin";
import { renderSoundShortcutSlots } from "./sounds";

export function showPage(page: "landing" | "room"): void {
  landingPage.classList.remove("active");
  roomPage.classList.remove("active");
  if (page === "landing") landingPage.classList.add("active");
  else roomPage.classList.add("active");
}

let toastTimeout: ReturnType<typeof setTimeout>;
export function showToast(msg: string): void {
  clearTimeout(toastTimeout);
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  toastEl.classList.add("show");
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => toastEl.classList.add("hidden"), 300);
  }, TOAST_DURATION_MS);
}

export function loadTheme(): void {
  const saved = localStorage.getItem("scrum-poker-theme");
  if (saved === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    btnToggleTheme.textContent = "🌙";
  }
}

export function toggleTheme(): void {
  const isDark =
    document.documentElement.getAttribute("data-theme") !== "light";
  const next = isDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("scrum-poker-theme", next);
  btnToggleTheme.textContent = isDark ? "🌙" : "☀️";
}

export function loadUsername(): void {
  const saved = localStorage.getItem("scrum-poker-username");
  if (saved) usernameInput.value = saved;
  const savedRole = localStorage.getItem("scrum-poker-role");
  if (savedRole) roleSelect.value = savedRole;
}

export function saveUsername(name: string): void {
  localStorage.setItem("scrum-poker-username", name);
  localStorage.setItem("scrum-poker-role", roleSelect.value);
}

/** Apply admin permission to a feature toggle — disable + show badge if not allowed */
function applyPermissionToToggle(
  checkbox: HTMLInputElement,
  toggleLabel: HTMLElement,
  allowed: boolean
): void {
  const badge = toggleLabel.querySelector(".admin-only-badge");
  if (!allowed) {
    checkbox.disabled = true;
    toggleLabel.classList.add("disabled");
    badge?.classList.remove("hidden");
  } else {
    checkbox.disabled = false;
    toggleLabel.classList.remove("disabled");
    badge?.classList.add("hidden");
  }
}

/** Real-time: update settings modal checkboxes when permissions change from super admin */
export function updateSettingsPermissions(permissions: FeaturePermissions, autoUnlockEditable?: boolean): void {
  applyPermissionToToggle(featurePoker, toggleLabelPoker, permissions.poker);
  applyPermissionToToggle(featureChat, toggleLabelChat, permissions.chat);
  applyPermissionToToggle(featureReact, toggleLabelReact, permissions.react);
  applyPermissionToToggle(featureSound, toggleLabelSound, permissions.sound);
  applyPermissionToToggle(featureWheel, toggleLabelWheel, permissions.wheel);
  applyPermissionToToggle(featureSpeaker, toggleLabelSpeaker, permissions.speakerRotate);
  // Auto-unlock input: disable if super admin locked it
  if (autoUnlockEditable !== undefined) {
    settingsInput.disabled = !autoUnlockEditable;
    const autoUnlockGroup = document.getElementById("settings-auto-unlock-group");
    if (!autoUnlockEditable) {
      autoUnlockGroup?.classList.add("disabled");
    } else {
      autoUnlockGroup?.classList.remove("disabled");
    }
  }
}

/** Real-time: update settings modal when feature state changes from super admin or PO */
export function updateSettingsFeatureState(features: FeatureFlags, autoUnlockSeconds?: number): void {
  featurePoker.checked = features.poker;
  featureChat.checked = features.chat;
  featureReact.checked = features.react;
  featureSound.checked = features.sound;
  featureWheel.checked = features.wheel;
  featureSpeaker.checked = features.speakerRotate;
  // Update auto-unlock input if value provided — but NOT while the modal is open,
  // because PO may be editing it (openSettings loads the value on open already).
  // Without this guard, every room tick overwrites the in-progress edit → "didn't save".
  if (autoUnlockSeconds !== undefined && !settingsModal.classList.contains("active")) {
    settingsInput.value = String(autoUnlockSeconds);
  }
  // Update user settings visibility based on sound feature
  const userSettings = document.getElementById("user-settings");
  if (userSettings) {
    userSettings.classList.toggle("hidden", !FEATURES.sound);
  }
}

/** Fill the super-admin poker-cards config form (10 slots = 2 rows × 5).
 *  `cards` null/empty → seed with DEFAULT_POKER_CARDS. Excess entries beyond 10
 *  slots are dropped; missing slots left blank (empty point → card hidden). */
export function fillPokerCardsForm(cards: CardDef[] | null): void {
  const container = document.getElementById("poker-cards-config");
  if (!container) return;
  const slots = Array.from(container.querySelectorAll<HTMLElement>(".pc-slot"));
  // If every stored slot is empty (admin cleared all), show the default seed so
  // the form matches what poker renders.
  const source = hasConfiguredCards(cards)
    ? (cards as CardDef[]).slice(0, slots.length)
    : DEFAULT_POKER_CARDS;
  slots.forEach((slot, i) => {
    const point = slot.querySelector<HTMLInputElement>(".pc-point");
    const desc = slot.querySelector<HTMLInputElement>(".pc-desc");
    const card = source[i];
    if (point) point.value = card ? card.value : "";
    if (desc) desc.value = card ? card.label : "";
  });
}

/** Toggle the super-admin poker save button: disabled when no slot carries a
 *  point value. Prevents saving an all-empty config (which would wipe the live
 *  cards) — the existing DB config stays in effect until a non-empty one is saved. */
export function refreshPokerSaveButton(): void {
  const container = document.getElementById("poker-cards-config");
  const saveBtn = document.getElementById("btn-super-admin-save-cards") as HTMLButtonElement | null;
  if (!container || !saveBtn) return;
  const anyPoints = Array.from(container.querySelectorAll<HTMLInputElement>(".pc-point"))
    .some((i) => i.value.trim() !== "");
  // The custom card counts as a usable card too — allow saving a custom-only config.
  const customOn = (document.getElementById("poker-custom-enabled") as HTMLInputElement | null)?.checked ?? false;
  saveBtn.disabled = !(anyPoints || customOn);
}

/** True ขณะ openSettings กำลังโหลดค่าจาก DB — กัน PO กด save ก่อนค่าโหลดเสร็จ
 *  (ค่า default ใน HTML checkbox/input อาจทับค่าจริง → flip feature state) */
let settingsLoading = false;
/** Generation counter — กัน re-entrancy: open→close→open เร็วๆ ทำให้ finally ของรอบเก่า
 *  ไป reset loading ของรอบใหม่ก่อนเวลา  เช็ค gen ใน finally ให้เคลียร์เฉพาะรอบล่าสุด */
let settingsLoadGen = 0;

/** Disable ปุ่ม save ทั้งหมดใน modal ตอนกำลังโหลด (ใช้สไตล์ .btn:disabled ที่มีอยู่แล้ว) */
function setSettingsLoading(loading: boolean): void {
  settingsLoading = loading;
  for (const id of [
    "btn-settings-save",
    "btn-super-admin-save-cleanup",
    "btn-super-admin-save-cards",
  ]) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = loading;
  }
}

export async function openSettings(): Promise<void> {
  if (!state.currentRoom) return;

  // Super admin (admin room) — show DB Report, cleanup time, clear all, README
  if (isSuperAdmin()) {
    document.getElementById("btn-settings-save")!.classList.add("hidden");
    document.getElementById("settings-auto-unlock-group")?.classList.add("hidden");
    document.getElementById("user-settings")?.classList.add("hidden");
    adminSettings.classList.add("hidden");
    document.getElementById("super-admin-settings")?.classList.remove("hidden");

    // เปิด modal ทันทีหลังตั้ง section visibility — ข้อมูลโหลด async ทีหลัง
    // (กัน race ที่ modal โผล่ช้าจนคลิกไปตกบน backdrop → modal ปิดเอง)
    settingsModal.classList.add("active");
    const gen = ++settingsLoadGen;
    setSettingsLoading(true);
    try {
      const [cleanupSnap, cardsSnap, customSnap] = await Promise.all([
        get(ref(db, `settings/cleanupTime`)),
        get(ref(db, "settings/pokerCards")),
        get(ref(db, "settings/pokerCustomCard")),
      ]);
      cleanupTimeInput.value = cleanupSnap.exists() ? cleanupSnap.val() : "19:00";
      fillPokerCardsForm(
        cardsSnap.exists() && Array.isArray(cardsSnap.val()) ? cardsSnap.val() : null
      );
      refreshPokerSaveButton();
      const customToggle = document.getElementById("poker-custom-enabled") as HTMLInputElement | null;
      if (customToggle) customToggle.checked = !!customSnap.val();
    } finally {
      if (gen === settingsLoadGen) setSettingsLoading(false);
    }
    return;
  }

  document.getElementById("super-admin-settings")?.classList.add("hidden");

  // Sync section visibility ตาม role/feature ก่อน — แล้วค่อยเปิด modal (ไม่ flash section ผิด)
  document.getElementById("btn-settings-save")!.classList.toggle("hidden", !isPO());
  document.getElementById("settings-auto-unlock-group")!.classList.toggle("hidden", !isPO());

  const userSettings = document.getElementById("user-settings")!;
  userSettings.classList.toggle("hidden", !FEATURES.sound);
  if (FEATURES.sound) {
    muteOthersSound.checked = localStorage.getItem("scrum-poker-mute-others") === "true";
    const sw = muteOthersSound.nextElementSibling;
    if (sw) sw.setAttribute("aria-checked", String(muteOthersSound.checked));
    renderSoundShortcutSlots();
  }

  adminSettings.classList.toggle("hidden", !isPO());

  // เปิด modal ทันทีหลังตั้ง section visibility — ข้อมูลโหลด async ทีหลัง
  settingsModal.classList.add("active");
  const gen = ++settingsLoadGen;
  setSettingsLoading(true);
  try {
    // Async: โหลดค่า PO-only fields แบบ parallel (1 round-trip แทน 4 sequential)
    if (isPO()) {
      const [autoSnap, featuresSnap, cleanupSnap, permissions] = await Promise.all([
        get(ref(db, `rooms/${state.currentRoom}/autoUnlockSeconds`)),
        get(ref(db, `rooms/${state.currentRoom}/features`)),
        get(ref(db, `settings/cleanupTime`)),
        loadFeaturePermissions(state.currentRoom!),
      ]);
      // อย่าเขียนทับถ้า PO กำลังแก้อยู่แล้ว (กัน race: async load มาถึงช้ากว่าการพิมพ์)
      if (document.activeElement !== settingsInput) {
        settingsInput.value = String(
          autoSnap.exists() ? autoSnap.val() : AUTO_UNLOCK_SECONDS
        );
      }
      if (featuresSnap.exists()) {
        const f = featuresSnap.val();
        featurePoker.checked = f.poker ?? true;
        featureChat.checked = f.chat ?? true;
        featureReact.checked = f.react ?? true;
        featureSound.checked = f.sound ?? true;
        featureWheel.checked = f.wheel ?? true;
        featureSpeaker.checked = f.speakerRotate ?? true;
      } else {
        featurePoker.checked = true;
        featureChat.checked = true;
        featureReact.checked = true;
        featureSound.checked = true;
        featureWheel.checked = true;
        featureSpeaker.checked = true;
      }
      applyPermissionToToggle(featurePoker, toggleLabelPoker, permissions.poker);
      applyPermissionToToggle(featureChat, toggleLabelChat, permissions.chat);
      applyPermissionToToggle(featureReact, toggleLabelReact, permissions.react);
      applyPermissionToToggle(featureSound, toggleLabelSound, permissions.sound);
      applyPermissionToToggle(featureWheel, toggleLabelWheel, permissions.wheel);
      applyPermissionToToggle(featureSpeaker, toggleLabelSpeaker, permissions.speakerRotate);
      cleanupTimeInput.value = cleanupSnap.exists() ? cleanupSnap.val() : "19:00";
    }
  } finally {
    if (gen === settingsLoadGen) setSettingsLoading(false);
  }
}

export function closeSettings(): void {
  settingsModal.classList.remove("active");
}

export async function saveSettings(): Promise<void> {
  if (!state.currentRoom) return;
  // กันกด save ก่อน DB โหลดเสร็จ (ค่าใน form ยังเป็น default → จะทับค่าจริง)
  if (settingsLoading) {
    showToast("⏳ กำลังโหลดค่า รอสักครู่");
    return;
  }

  const updates: Record<string, unknown> = {};

  // Auto-unlock — only save if PO
  if (isPO()) {
    const val = parseInt(settingsInput.value, 10);
    if (val < 5 || val > 300) {
      showToast("ค่าต้องอยู่ระหว่าง 5-300 วินาที");
      return;
    }
    updates.autoUnlockSeconds = val;
  }

  // Save admin settings if PO
  if (isPO()) {
    // Only save features that PO is allowed to control (not disabled by admin)
    const features: Record<string, boolean> = {};
    if (!featurePoker.disabled) features.poker = featurePoker.checked;
    if (!featureChat.disabled) features.chat = featureChat.checked;
    if (!featureReact.disabled) features.react = featureReact.checked;
    if (!featureSound.disabled) features.sound = featureSound.checked;
    if (!featureWheel.disabled) features.wheel = featureWheel.checked;
    if (!featureSpeaker.disabled) features.speakerRotate = featureSpeaker.checked;
    if (Object.keys(features).length > 0) {
      updates["features"] = features;
    }
  }

  await update(ref(db, `rooms/${state.currentRoom}`), updates);
  settingsModal.classList.remove("active");
  showToast("Settings saved");
}

/** Show/hide UI based on feature flags — toggles classes on AND off */
export function applyFeatureFlags(): void {
  // Poker
  const votingStatus = document.querySelector(".voting-status");
  const votingSection = document.querySelector(".voting-section");
  const adminControls = document.querySelector(".admin-controls");
  votingStatus?.classList.toggle("hidden", !FEATURES.poker);
  votingSection?.classList.toggle("hidden", !FEATURES.poker);
  adminControls?.classList.toggle("hidden", !FEATURES.poker);

  // Chat
  btnBarChat.classList.toggle("hidden", !FEATURES.chat);
  if (!FEATURES.chat) {
    forceCloseChat(); // Reset chatOpen boolean + close panel
  }

  // React
  btnBarReact.classList.toggle("hidden", !FEATURES.react);
  reactPickerBar.classList.add("hidden");
  const floatingEl = document.getElementById("floating-reactions");
  floatingEl?.classList.toggle("hidden", !FEATURES.react && !FEATURES.sound);

  // Sound
  btnBarSound.classList.toggle("hidden", !FEATURES.sound);
  soundPickerBar.classList.add("hidden");

  // Wheel
  btnWheel.classList.toggle("hidden", !FEATURES.wheel);
  if (!FEATURES.wheel) forceCloseWheel();

  // Bottom bar — hide entirely if all features off
  const bottomBar = document.getElementById("bottom-bar");
  const anyFeature = FEATURES.chat || FEATURES.react || FEATURES.sound || FEATURES.wheel;
  bottomBar?.classList.toggle("hidden", !anyFeature);

  // Delete room button — PO only
  const deleteWrapper = document.getElementById("delete-room-wrapper");
  if (deleteWrapper) deleteWrapper.style.display = isPO() ? "" : "none";
  // Clear speaker-counts button — PO only (rotation logic is always on, so always available to PO)
  const speakerClearWrapper = document.getElementById("speaker-clear-wrapper");
  if (speakerClearWrapper) speakerClearWrapper.style.display = (isPO() && FEATURES.speakerRotate) ? "" : "none";
}

export async function openDbReport(): Promise<void> {
  const container = document.getElementById("db-report-inline");
  if (!container) return;

  try {
    const [roomsSnap, settingsSnap] = await Promise.all([
      get(ref(db, "rooms")),
      get(ref(db, "settings")),
    ]);

    let totalRooms = 0;
    let totalUsers = 0;
    let onlineUsers = 0;
    let totalMessages = 0;

    const roomsData = roomsSnap.exists() ? roomsSnap.val() as Record<string, any> : {};

    for (const [, room] of Object.entries(roomsData)) {
      totalRooms++;
      if (room.users) {
        const users = Object.values(room.users) as User[];
        totalUsers += users.length;
        onlineUsers += users.filter(u => u.online !== false).length;
      }
      if (room.messages) {
        totalMessages += Object.keys(room.messages).length;
      }
    }

    // Estimate data size
    const roomsJson = JSON.stringify(roomsData);
    const settingsJson = settingsSnap.exists() ? JSON.stringify(settingsSnap.val()) : "{}";
    const totalSizeBytes = new Blob([roomsJson + settingsJson]).size;
    const sizeKB = (totalSizeBytes / 1024).toFixed(1);
    const sizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(3);

    // Spark plan: 1 GB stored data limit
    const limitMB = 1024;
    const percentUsed = ((totalSizeBytes / (limitMB * 1024 * 1024)) * 100).toFixed(4);

    container.innerHTML = `
      <div class="report-row"><span>📦 ห้องทั้งหมด</span><span class="report-value">${totalRooms} ห้อง</span></div>
      <div class="report-row"><span>👥 ผู้ใช้ทั้งหมด</span><span class="report-value">${totalUsers} คน <small>(${onlineUsers} online)</small></span></div>
      <div class="report-row"><span>💬 ข้อความแชท</span><span class="report-value">${totalMessages} ข้อความ</span></div>
      <div class="report-divider"></div>
      <div class="report-row"><span>💾 ขนาดข้อมูล</span><span class="report-value">${sizeMB} MB (${sizeKB} KB)</span></div>
      <div class="report-row"><span>📊 ใช้จาก 1 GB <small>(Spark plan)</small></span><span class="report-value">${percentUsed}%</span></div>
      <div class="report-bar"><div class="report-bar-fill" style="width:${Math.max(0.5, parseFloat(percentUsed))}%"></div></div>
      <div class="report-divider"></div>
      <a href="https://console.firebase.google.com/project/_/usage" target="_blank" class="settings-link">📋 ดู Monthly Usage ที่ Firebase Console</a>
    `;
  } catch (err) {
    container.innerHTML = `<small style="color:var(--danger)">❌ โหลดข้อมูลไม่สำเร็จ</small>`;
    console.error("[DB Report] Error:", err);
  }
}

export function showNotVotedModal(names: string): void {
  // Remove any existing not-voted modal
  const existing = document.getElementById("not-voted-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "not-voted-modal";
  overlay.className = "modal-overlay active";

  const content = document.createElement("div");
  content.className = "modal-content";

  const header = document.createElement("div");
  header.className = "modal-header";
  const h2 = document.createElement("h2");
  h2.textContent = "🃏 รอคนกด point";
  header.appendChild(h2);

  const body = document.createElement("div");
  body.className = "modal-body";
  const p = document.createElement("p");
  p.className = "not-voted-text";
  p.appendChild(document.createTextNode("เชิญ "));
  const strong = document.createElement("strong");
  strong.textContent = names;
  p.appendChild(strong);
  p.appendChild(document.createTextNode(" กด point ด้วย"));
  body.appendChild(p);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-primary";
  closeBtn.style.width = "100%";
  closeBtn.textContent = "ปิด";
  closeBtn.addEventListener("click", () => overlay.remove());

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(closeBtn);
  overlay.appendChild(content);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById("app")!.appendChild(overlay);
}

/**
 * Reusable confirm / warning modal — two buttons (confirm + cancel).
 * Set `danger: true` (or use showWarningModal) for destructive actions: red confirm
 * button, ⚠️ in the header, and the cancel button is focused first to avoid accidents.
 * Closes on overlay click or Escape. <button>s handle Enter/Space natively.
 */
export function showConfirmModal(opts: ConfirmModalOptions): void {
  const {
    title,
    message,
    confirmText = "ยืนยัน",
    cancelText = "ยกเลิก",
    danger = false,
    onConfirm,
  } = opts;

  // Never stack modals — remove any existing confirm modal first
  const existing = document.getElementById("confirm-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "confirm-modal";
  overlay.className = "modal-overlay active" + (danger ? " modal-danger" : "");

  const content = document.createElement("div");
  content.className = "modal-content confirm-modal-content";

  const header = document.createElement("div");
  header.className = "modal-header";
  const h2 = document.createElement("h2");
  h2.textContent = (danger ? "⚠️ " : "") + title;
  header.appendChild(h2);

  const body = document.createElement("div");
  body.className = "modal-body";
  const p = document.createElement("p");
  p.className = "confirm-modal-text";
  p.style.whiteSpace = "pre-line"; // honor newlines in message
  p.textContent = message;
  body.appendChild(p);

  const actions = document.createElement("div");
  actions.className = "confirm-modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-confirm-cancel";
  cancelBtn.textContent = cancelText;

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn " + (danger ? "btn-confirm-danger" : "btn-primary");
  confirmBtn.textContent = confirmText;

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(actions);
  overlay.appendChild(content);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const finish = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    void Promise.resolve(onConfirm?.());
  };

  cancelBtn.addEventListener("click", close);
  confirmBtn.addEventListener("click", finish);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  const mount = document.getElementById("app") || document.body;
  mount.appendChild(overlay);

  // Focus the safer button first: cancel for destructive actions, confirm otherwise
  (danger ? cancelBtn : confirmBtn).focus();
}

/** Warning modal — destructive variant of showConfirmModal (red, ⚠️ header). */
export function showWarningModal(opts: Omit<ConfirmModalOptions, "danger">): void {
  showConfirmModal({ ...opts, danger: true });
}

export function spawnFirework(container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const colors = ["#00d4ff", "#a855f7", "#ec4899", "#f59e0b", "#22c55e"];

  for (let i = 0; i < 24; i++) {
    const p = document.createElement("div");
    p.className = "firework-particle";
    const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.3;
    const dist = 40 + Math.random() * 60;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - Math.abs(Math.sin(angle)) * 30;
    p.style.setProperty("--dx", `${dx}px`);
    p.style.setProperty("--dy", `${dy}px`);
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.background = colors[i % colors.length];
    container.appendChild(p);
    p.addEventListener("animationend", () => p.remove());
  }
}
