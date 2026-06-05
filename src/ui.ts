import { db, ref, get, update } from "./firebase";
import { state } from "./state";
import {
  toastEl,
  settingsModal,
  settingsInput,
  landingPage,
  roomPage,
  btnToggleTheme,
  usernameInput,
  roleSelect,
} from "./dom";
import { TOAST_DURATION_MS, AUTO_UNLOCK_SECONDS } from "./config";

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
  const snap = await get(ref(db, `rooms/${state.currentRoom}/autoUnlockSeconds`));
  settingsInput.value = String(
    snap.exists() ? snap.val() : AUTO_UNLOCK_SECONDS
  );
  settingsModal.classList.add("active");
}

export function closeSettings(): void {
  settingsModal.classList.remove("active");
}

export async function saveSettings(): Promise<void> {
  const val = parseInt(settingsInput.value, 10);
  if (val >= 5 && state.currentRoom) {
    await update(ref(db, `rooms/${state.currentRoom}`), {
      autoUnlockSeconds: val,
    });
    settingsModal.classList.remove("active");
    showToast(`Auto-unlock set to ${val}s`);
  } else {
    showToast("Minimum 5 seconds");
  }
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
