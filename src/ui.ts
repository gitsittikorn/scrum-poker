import { db, ref, get, update } from "./firebase";
import { state, isPO } from "./state";
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
  cleanupTimeInput,
  btnBarChat,
  btnBarReact,
  reactPickerBar,
  btnBarSound,
  soundPickerBar,
  muteOthersSound,
  btnWheel,
} from "./dom";
import { TOAST_DURATION_MS, AUTO_UNLOCK_SECONDS, FEATURES } from "./config";
import type { User } from "./types";
import { forceCloseChat } from "./chat";
import { forceCloseWheel } from "./wheel";

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

export async function openSettings(): Promise<void> {
  if (!state.currentRoom) return;

  // Save button — visible to PO only
  const saveBtn = document.getElementById("btn-settings-save")!;
  const closeLink = document.getElementById("settings-close-link")!;
  if (isPO()) {
    saveBtn.classList.remove("hidden");
    closeLink.classList.add("hidden");
  } else {
    saveBtn.classList.add("hidden");
    closeLink.classList.remove("hidden");
  }

  // Auto-unlock timeout — visible to PO only
  const autoUnlockGroup = document.getElementById("settings-auto-unlock-group")!;
  if (isPO()) {
    autoUnlockGroup.classList.remove("hidden");
    const snap = await get(ref(db, `rooms/${state.currentRoom}/autoUnlockSeconds`));
    settingsInput.value = String(
      snap.exists() ? snap.val() : AUTO_UNLOCK_SECONDS
    );
  } else {
    autoUnlockGroup.classList.add("hidden");
  }

  // User settings — visible to all roles
  muteOthersSound.checked = localStorage.getItem("scrum-poker-mute-others") === "true";
  const sw = muteOthersSound.nextElementSibling;
  if (sw) sw.setAttribute("aria-checked", String(muteOthersSound.checked));

  // Admin section — visible to all PO
  if (isPO()) {
    adminSettings.classList.remove("hidden");

    // Load feature flags from Firebase
    const featuresSnap = await get(ref(db, `rooms/${state.currentRoom}/features`));
    if (featuresSnap.exists()) {
      const f = featuresSnap.val();
      featurePoker.checked = f.poker ?? true;
      featureChat.checked = f.chat ?? true;
      featureReact.checked = f.react ?? true;
      featureSound.checked = f.sound ?? true;
      featureWheel.checked = f.wheel ?? true;
    } else {
      featurePoker.checked = true;
      featureChat.checked = true;
      featureReact.checked = true;
      featureSound.checked = true;
      featureWheel.checked = true;
    }

    // Load cleanup time from global settings
    const cleanupSnap = await get(ref(db, `settings/cleanupTime`));
    cleanupTimeInput.value = cleanupSnap.exists() ? cleanupSnap.val() : "19:00";
  } else {
    adminSettings.classList.add("hidden");
  }

  settingsModal.classList.add("active");
}

export function closeSettings(): void {
  settingsModal.classList.remove("active");
}

export async function saveSettings(): Promise<void> {
  if (!state.currentRoom) return;

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
    updates["features"] = {
      poker: featurePoker.checked,
      chat: featureChat.checked,
      react: featureReact.checked,
      sound: featureSound.checked,
      wheel: featureWheel.checked,
    };

    // Save cleanup time to global settings
    const cleanupTime = cleanupTimeInput.value;
    if (cleanupTime) {
      await update(ref(db, `settings`), { cleanupTime });
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
