import { db, ref, get } from "./firebase";
import { state } from "./state";
import {
  wheelCanvas,
  wheelCanvasContainer,
  wheelWinnerDisplay,
  wheelMemberList,
  wheelAddInput,
  wheelPanel,
  wheelEntryCount,
  wheelDuplicateSelect,
  wheelRemoveWinnerToggle,
  btnWheelSpin,
} from "./dom";
import { sendSound, playSound } from "./sounds";
import { spawnFirework, showToast } from "./ui";
import { escapeHtml } from "./utils";
import type { User } from "./types";

// ── Default entries for Wheel room ────────────────────────────────
const WHEEL_ROOM_DEFAULTS = [
  "Big", "May", "Cing", "Tein", "Toon", "Pun", "Por", "Meaw",
  "Max", "Nuji", "Prince", "Yam", "Run", "Toey", "Flouk", "Pou",
  "Puy", "A", "Pond", "Nub", "Char", "Poom",
];

const WHEEL_TEAMS: Record<string, string[]> = {
  "Kitsune": ["Big", "May", "Tein", "Toon", "Pun", "Por", "Toey"],
  "Phoenix": ["Run", "Flouk", "Pou", "Puy", "A", "Pond", "Nub", "Char"],
  "Monkey King": ["Cing", "Meaw", "Max", "Prince", "Nuji", "Yam", "Poom"],
  "All": [...WHEEL_ROOM_DEFAULTS],
  "Team": ["UX/UI", "Kitsune", "Phoenix", "Monkey King"],
};

// ── State ──────────────────────────────────────────────────────────
let originalMembers: string[] = [];
let wheelEntries: string[] = [];
let duplicateCount = 1;
let selectedWinner: string | null = null;
let isOpen = false;
let isSpinning = false;
let removeWinner = false;
let includePO = false;
let currentRotation = 0;
let animFrameId: number | null = null;
let hasInitialized = false;

// AbortController for cleanup of event listeners
let eventAbort: AbortController | null = null;

// Winner modal refs — guard against stacking + clean listener removal
let winnerModalEl: HTMLElement | null = null;
let winnerModalKeyHandler: ((e: KeyboardEvent) => void) | null = null;

// ── Constants ──────────────────────────────────────────────────────
const WHEEL_COLORS = [
  "#00d4ff", "#a855f7", "#ec4899", "#f59e0b", "#22c55e",
  "#ef4444", "#3b82f6", "#8b5cf6", "#14b8a6", "#f97316",
  "#06b6d4", "#d946ef", "#84cc16", "#e11d48", "#6366f1",
];
const SPIN_DURATION_MS = 5000;
const SPIN_TOTAL_ROTATIONS = 6;
const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

// ── Firebase ───────────────────────────────────────────────────────
async function fetchMembers(): Promise<string[]> {
  if (!state.currentRoom) return [];
  const snap = await get(ref(db, `rooms/${state.currentRoom}/users`));
  if (!snap.exists()) return [];
  const users = snap.val() as Record<string, User>;
  return Object.values(users)
    .filter((u) => includePO || u.role !== "po")
    .map((u) => u.name);
}

// ── Local persistence (per room + user) ─────────────────────────────
// Lets PO leave and come back on the same browser without losing their
// customized wheel entries. Scoped by room + uid so it never leaks across
// rooms or people sharing a browser.
function wheelStorageKey(): string | null {
  if (!state.currentRoom || !state.currentUser) return null;
  return `scrum-poker-wheel-${state.currentRoom}-${state.currentUser.uid}`;
}

function saveWheelState(): void {
  const key = wheelStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ entries: wheelEntries, duplicate: duplicateCount }),
    );
  } catch {
    // Ignore quota / serialization errors — persistence is best-effort.
  }
}

interface SavedWheelState {
  entries: string[];
  duplicate: number;
}

function loadWheelState(): SavedWheelState | null {
  const key = wheelStorageKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.entries)) return null;
    return {
      entries: parsed.entries as string[],
      duplicate: typeof parsed.duplicate === "number" ? parsed.duplicate : 1,
    };
  } catch {
    return null;
  }
}

/** Apply saved state to the module vars. Returns true if a restore happened. */
function restoreWheelState(): boolean {
  const saved = loadWheelState();
  if (!saved || saved.entries.length === 0) return false;
  wheelEntries = [...saved.entries];
  duplicateCount = saved.duplicate;
  originalMembers = [...new Set(saved.entries)];
  return true;
}

/** Remove every cached wheel entry (across all rooms/users) — called on version bump. */
export function clearAllWheelCache(): void {
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("scrum-poker-wheel-")) stale.push(key);
  }
  stale.forEach((k) => localStorage.removeItem(k));
}

// ── Canvas Rendering ───────────────────────────────────────────────
function drawWheel(rotation: number): void {
  const canvas = wheelCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const size = state.isWheelRoom ? 600 : 400;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  if (!state.isWheelRoom) {
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  } else {
    canvas.style.width = '';
    canvas.style.height = '';
  }
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 4;

  // Reset transform and clear (no canvas resize — avoids flicker)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  if (wheelEntries.length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#1e1e38";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = '16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Add members to spin", cx, cy);
    return;
  }

  const n = wheelEntries.length;
  const arcSize = (Math.PI * 2) / n;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  for (let i = 0; i < n; i++) {
    const startAngle = i * arcSize;
    const endAngle = (i + 1) * arcSize;
    const midAngle = startAngle + arcSize / 2;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.rotate(midAngle);
    const textRadius = radius * 0.58;
    const base = state.isWheelRoom ? 1.35 : 1;
    // fontSize/maxChars สูตรลื่นตามจำนวนช่อง — รองรับตั้งแต่ 1 ยง่ 50+ คน
    const fontSize = Math.round(base * Math.max(8, Math.min(26, 60 / Math.max(n, 2) + 6)));
    ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let name = wheelEntries[i];
    const maxChars = Math.max(3, Math.min(14, Math.floor(60 / n + 4)));
    if (name.length > maxChars) name = name.slice(0, maxChars - 1) + "…";
    // Modern text: dark text + white glow shadow for depth
    ctx.shadowColor = "rgba(255,255,255,0.7)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    // White outline for readability on any color
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeText(name, textRadius, 0);
    // Dark fill on top
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillText(name, textRadius, 0);
    ctx.restore();
  }

  // Center circle
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

// ── Winner Calculation ─────────────────────────────────────────────
function calculateWinnerIndex(rotation: number): number {
  if (wheelEntries.length === 0) return -1;
  const n = wheelEntries.length;
  const arcSize = (Math.PI * 2) / n;
  const TWO_PI = Math.PI * 2;
  const normalizedRotation = ((rotation % TWO_PI) + TWO_PI) % TWO_PI;
  // pointer อยู่ด้านบน = 1.5π (270°); มุมใน wheel space = 1.5π − rotation
  const pointerAngle = ((Math.PI * 1.5 - normalizedRotation) % TWO_PI + TWO_PI) % TWO_PI;
  const index = Math.floor(pointerAngle / arcSize);
  return ((index % n) + n) % n;
}

// ── Spin Logic ─────────────────────────────────────────────────────
let spinWinnerIndex = -1;
let lastTickSegment = -1;

function spin(): void {
  if (isSpinning) return;

  // ปิด modal ค้างจากการสุ่มครั้งก่อน — ถ้าเปิด removeWinner จะลบผู้ชนะออกจากกงล้อด้วย
  closeWinnerModal();

  if (wheelEntries.length === 0) return;

  isSpinning = true;
  btnWheelSpin.disabled = true;

  shuffleEntries(); // Always shuffle

  spinWinnerIndex = Math.floor(Math.random() * wheelEntries.length);
  const n = wheelEntries.length;
  const arcSize = (Math.PI * 2) / n;
  const TWO_PI = Math.PI * 2;

  const winnerMid = spinWinnerIndex * arcSize + arcSize / 2;
  // มุมสุดท้าย (mod 2π) ที่ต้องการให้ pointer ชี้กลาง segment ผู้ชนะ
  const desiredFinalMod = ((Math.PI * 1.5 - winnerMid) % TWO_PI + TWO_PI) % TWO_PI;
  // คำนึง currentRotation ค้างจากการหมุนก่อนหน้า ไม่เช่นนั้น pointer จะค่อยๆ เลื่อนออกจากผู้ชนะ
  const currentMod = ((currentRotation % TWO_PI) + TWO_PI) % TWO_PI;
  const delta = ((desiredFinalMod - currentMod) % TWO_PI + TWO_PI) % TWO_PI;
  const extraRotations = SPIN_TOTAL_ROTATIONS * TWO_PI;
  // jitter ±0.3*arcSize — pointer ยังอยู่ในช่อง (ขอบ ±0.5*arcSize) แต่ไม่ตรงกลางเสมอ
  const jitter = Math.random() * arcSize * 0.6 - arcSize * 0.3;
  const targetRotation = currentRotation + extraRotations + delta + jitter;

  const startTime = performance.now();
  const startRotation = currentRotation;
  lastTickSegment = calculateWinnerIndex(currentRotation);

  animateSpin(startTime, startRotation, targetRotation);
}

function animateSpin(
  startTime: number,
  startRotation: number,
  targetRotation: number,
): void {
  const elapsed = performance.now() - startTime;
  const progress = Math.min(elapsed / SPIN_DURATION_MS, 1);
  const eased = EASE_OUT_CUBIC(progress);

  currentRotation = startRotation + (targetRotation - startRotation) * eased;
  drawWheel(currentRotation);

  const currSegment = calculateWinnerIndex(currentRotation);
  if (currSegment !== lastTickSegment && progress < 0.95) {
    playTickSound();
    lastTickSegment = currSegment;
  }

  if (progress < 1) {
    animFrameId = requestAnimationFrame(() =>
      animateSpin(startTime, startRotation, targetRotation),
    );
  } else {
    onSpinComplete();
  }
}

function onSpinComplete(): void {
  isSpinning = false;
  btnWheelSpin.disabled = false;

  const winner = wheelEntries[spinWinnerIndex];
  if (!winner) return;

  selectedWinner = winner;
  wheelWinnerDisplay.textContent = `🎉 ${winner}`;
  wheelWinnerDisplay.classList.remove("hidden");

  // Play locally immediately (the spin click unlocks audio); send to others with bypassMute
  playSound("แกไม่รอดแน่.mp3");
  sendSound("แกไม่รอดแน่.mp3", true);
  spawnFirework(wheelCanvasContainer);
  showToast(`🎡 ผู้ถูกสุ่ม: ${winner}`);

  // เปิด modal แสดงผู้ถูกสุ่ม — ปิด modal แล้วลบ/ไม่ลบตาม toggle removeWinner
  showWinnerModal(winner);
}

// ── Winner Modal ───────────────────────────────────────────────────
/** แสดง modal รายชื่อผู้ถูกสุ่ม — ปิด modal แล้วลบ/ไม่ลบผู้ถูกสุ่มตาม toggle removeWinner */
function showWinnerModal(winner: string): void {
  closeWinnerModal(); // never stack

  const overlay = document.createElement("div");
  overlay.id = "wheel-winner-modal";
  overlay.className = "modal-overlay active";

  const content = document.createElement("div");
  content.className = "modal-content wheel-winner-modal-content";

  const header = document.createElement("div");
  header.className = "modal-header";
  const h2 = document.createElement("h2");
  h2.textContent = "🎉 ผู้ถูกสุ่ม";
  header.appendChild(h2);

  const body = document.createElement("div");
  body.className = "modal-body wheel-winner-body";

  const hero = document.createElement("div");
  hero.className = "wheel-winner-hero";
  hero.textContent = winner;
  body.appendChild(hero);

  const note = document.createElement("div");
  note.className = "wheel-winner-note";
  note.textContent = removeWinner
    ? "🔒 โหมดลบผู้ถูกสุ่มเปิดอยู่ — กดปิดแล้วจะนำชื่อนี้ออกจากกงล้อ"
    : "🔓 โหมดลบผู้ถูกสุ่มปิดอยู่ — กดปิดแล้วยังคงชื่อนี้ไว้ในกงล้อ";
  body.appendChild(note);

  const actions = document.createElement("div");
  actions.className = "confirm-modal-actions";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-primary";
  closeBtn.textContent = "ปิด";
  actions.appendChild(closeBtn);

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(actions);
  overlay.appendChild(content);

  winnerModalKeyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeWinnerModal();
    }
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeWinnerModal();
  });
  closeBtn.addEventListener("click", closeWinnerModal);
  document.addEventListener("keydown", winnerModalKeyHandler);

  const mount = document.getElementById("app") || document.body;
  mount.appendChild(overlay);
  winnerModalEl = overlay;

  closeBtn.focus();
}

/** ปิด modal ผู้ถูกสุ่ม — ถ้า removeWinner จะลบผู้ชนะออกจากกงล้อ */
function closeWinnerModal(): void {
  if (!winnerModalEl) return;

  // toggle on → remove winner from wheel (ทำตอนปิด modal ตามที่ผู้ใช้ต้องการ)
  if (removeWinner && selectedWinner) {
    const idx = wheelEntries.indexOf(selectedWinner);
    if (idx !== -1) {
      wheelEntries.splice(idx, 1);
      saveWheelState();
      drawWheel(currentRotation);
      renderMemberList();
    }
  }
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");

  removeWinnerModalEl();
}

/** ลบ modal DOM + keydown listener โดยไม่ลบผู้ชนะ (ใช้ตอน reset/clear/destroy) */
function removeWinnerModalEl(): void {
  if (winnerModalKeyHandler) {
    document.removeEventListener("keydown", winnerModalKeyHandler);
    winnerModalKeyHandler = null;
  }
  if (winnerModalEl) {
    winnerModalEl.remove();
    winnerModalEl = null;
  }
}

// ── Tick Sound (Web Audio API) ─────────────────────────────────────
let audioCtx: AudioContext | null = null;

function playTickSound(): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 800 + Math.random() * 400;
    gain.gain.value = 0.06;
    osc.start();
    osc.stop(audioCtx.currentTime + 0.025);
  } catch {
    // ignore
  }
}

// ── Entry Management ───────────────────────────────────────────────
function rebuildWheelEntries(): void {
  wheelEntries = [];
  for (let i = 0; i < duplicateCount; i++) {
    wheelEntries.push(...originalMembers);
  }
  wheelEntryCount.textContent = String(wheelEntries.length);
}

function shuffleEntries(): void {
  for (let i = wheelEntries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wheelEntries[i], wheelEntries[j]] = [wheelEntries[j], wheelEntries[i]];
  }
  drawWheel(currentRotation);
  renderMemberList();
}

function clearEntries(): void {
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");
  removeWinnerModalEl();
  wheelEntries = [];
  currentRotation = 0;
  saveWheelState();
  drawWheel(0);
  renderMemberList();
}

function addEntry(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  wheelEntries.push(trimmed);
  saveWheelState();
  drawWheel(currentRotation);
  renderMemberList();
}

function removeEntry(index: number): void {
  if (isSpinning) return;
  wheelEntries.splice(index, 1);
  saveWheelState();
  drawWheel(currentRotation);
  renderMemberList();
}

function editEntry(index: number, newName: string): void {
  if (isSpinning) return;
  const trimmed = newName.trim();
  if (!trimmed) return;
  wheelEntries[index] = trimmed;
  saveWheelState();
  drawWheel(currentRotation);
  renderMemberList();
}

/** Restart — fetch fresh members from Firebase (or reset to defaults if Wheel room) */
async function restartEntries(): Promise<void> {
  originalMembers = state.isWheelRoom ? [...WHEEL_ROOM_DEFAULTS] : await fetchMembers();
  duplicateCount = 1;
  wheelDuplicateSelect.value = "1";
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");
  removeWinnerModalEl();
  currentRotation = 0;
  rebuildWheelEntries();
  saveWheelState(); // persist the freshly fetched entries (overwrites any customization)
  drawWheel(0);
  renderMemberList();
}

// ── Rendering ──────────────────────────────────────────────────────
function renderMemberList(): void {
  wheelEntryCount.textContent = String(wheelEntries.length);

  if (wheelEntries.length === 0) {
    wheelMemberList.innerHTML = '<small class="form-hint">ยังไม่มีรายการ</small>';
    return;
  }

  wheelMemberList.innerHTML = wheelEntries
    .map(
      (name, i) => `
    <div class="wheel-entry" data-index="${i}">
      <span class="wheel-entry-name">${escapeHtml(name)}</span>
      <button class="wheel-entry-btn edit" data-action="edit" data-index="${i}" title="แก้ไข">✏️</button>
      <button class="wheel-entry-btn delete" data-action="delete" data-index="${i}" title="ลบ">✕</button>
    </div>`,
    )
    .join("");
}

// ── Event Handling (with AbortController for cleanup) ──────────────
function setupEventDelegation(): void {
  // Abort previous listeners if any
  if (eventAbort) eventAbort.abort();
  eventAbort = new AbortController();
  const { signal } = eventAbort;

  wheelMemberList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const index = Number(target.dataset.index);
    if (isNaN(index)) return;

    if (action === "delete") {
      removeEntry(index);
    } else if (action === "edit") {
      const entry = target.closest(".wheel-entry") as HTMLElement;
      if (!entry) return;
      const nameSpan = entry.querySelector(".wheel-entry-name") as HTMLElement;
      if (!nameSpan) return;
      const currentName = wheelEntries[index];
      const input = document.createElement("input");
      input.type = "text";
      input.className = "wheel-entry-input";
      input.value = currentName;
      input.maxLength = 15;
      nameSpan.replaceWith(input);
      input.focus();
      input.select();

      const save = () => {
        editEntry(index, input.value);
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") save();
        if (ev.key === "Escape") renderMemberList();
      });
    }
  }, { signal });

  // Duplicate select — rebuild from unique current entries
  wheelDuplicateSelect.addEventListener("change", () => {
    const newCount = Number(wheelDuplicateSelect.value);
    const uniqueNames = [...new Set(wheelEntries)];
    duplicateCount = newCount;
    wheelEntries = [];
    for (let i = 0; i < duplicateCount; i++) {
      wheelEntries.push(...uniqueNames);
    }
    currentRotation = 0;
    saveWheelState();
    drawWheel(0);
    renderMemberList();
  }, { signal });

  // Toggles
  wheelRemoveWinnerToggle.addEventListener("change", () => {
    removeWinner = wheelRemoveWinnerToggle.checked;
    const sw = wheelRemoveWinnerToggle.nextElementSibling;
    if (sw) sw.setAttribute("aria-checked", String(removeWinner));
  }, { signal });

  // Include PO toggle — rebuild wheel entries on change
  let includePoSeq = 0;
  const includePoToggle = document.getElementById("wheel-include-po") as HTMLInputElement;
  includePoToggle?.addEventListener("change", async () => {
    includePO = includePoToggle.checked;
    const sw = includePoToggle.nextElementSibling;
    if (sw) sw.setAttribute("aria-checked", String(includePO));
    // Guard against rapid toggling — only latest request applies
    const seq = ++includePoSeq;
    const members = await fetchMembers();
    if (seq !== includePoSeq) return; // Stale result, discard
    originalMembers = members;
    rebuildWheelEntries();
    saveWheelState();
    drawWheel(currentRotation);
    renderMemberList();
  }, { signal });

  // Team select — switch entry group (Wheel room only)
  const teamSelect = document.getElementById("wheel-team-select") as HTMLSelectElement;
  teamSelect?.addEventListener("change", () => {
    const team = teamSelect.value;
    const members = WHEEL_TEAMS[team] || WHEEL_ROOM_DEFAULTS;
    originalMembers = [...members];
    duplicateCount = 1;
    wheelDuplicateSelect.value = "1";
    selectedWinner = null;
    wheelWinnerDisplay.classList.add("hidden");
    currentRotation = 0;
    rebuildWheelEntries();
    saveWheelState();
    drawWheel(0);
    renderMemberList();
  }, { signal });

  // Resize handle
  const resizeHandle = wheelPanel.querySelector(".wheel-resize-handle") as HTMLElement;
  if (resizeHandle) {
    let isDragging = false;
    resizeHandle.addEventListener("mousedown", (e) => {
      isDragging = true;
      resizeHandle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    }, { signal });
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const clamped = Math.max(320, Math.min(800, e.clientX));
      wheelPanel.style.width = `${clamped}px`;
      drawWheel(currentRotation);
    }, { signal });
    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      resizeHandle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }, { signal });
  }
}

// ── Public API ─────────────────────────────────────────────────────
export function toggleWheel(): void {
  if (state.isWheelRoom) return; // Wheel is already the main content
  isOpen = !isOpen;
  wheelPanel.classList.toggle("open", isOpen);
  if (isOpen && !hasInitialized) {
    hasInitialized = true;
    initWheel();
  } else if (isOpen) {
    drawWheel(currentRotation);
    renderMemberList();
  }
}

export function forceCloseWheel(): void {
  isOpen = false;
  wheelPanel.classList.remove("open");
}

export function destroyWheel(): void {
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  // Abort all event listeners
  if (eventAbort) {
    eventAbort.abort();
    eventAbort = null;
  }
  removeWinnerModalEl();
  forceCloseWheel();
  originalMembers = [];
  wheelEntries = [];
  currentRotation = 0;
  isSpinning = false;
  selectedWinner = null;
  hasInitialized = false;
  // Close AudioContext
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  // Hide team dropdown
  const teamGroup = document.getElementById("wheel-team-group");
  if (teamGroup) teamGroup.style.display = "none";
  // Restore include-PO toggle
  const includePoToggle = document.getElementById("wheel-include-po");
  if (includePoToggle) {
    const label = includePoToggle.closest(".toggle-label");
    if (label) label.classList.remove("hidden");
  }
}

async function initWheel(): Promise<void> {
  // Restore previously customized entries (same browser) before fetching defaults
  if (!restoreWheelState()) {
    originalMembers = await fetchMembers();
    duplicateCount = 1;
    rebuildWheelEntries();
  }
  wheelDuplicateSelect.value = String(duplicateCount);
  removeWinner = true;
  wheelRemoveWinnerToggle.checked = true;
  const removeSw = wheelRemoveWinnerToggle.nextElementSibling;
  if (removeSw) removeSw.setAttribute("aria-checked", "true");
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");
  currentRotation = 0;
  drawWheel(0);
  renderMemberList();
  setupEventDelegation();
}

/** Initialize wheel for standalone Wheel room — manual entries only, no Firebase fetch */
export function initWheelManual(): void {
  if (!restoreWheelState()) {
    originalMembers = [...WHEEL_ROOM_DEFAULTS];
    duplicateCount = 1;
    rebuildWheelEntries();
  }
  wheelDuplicateSelect.value = String(duplicateCount);
  removeWinner = true;
  wheelRemoveWinnerToggle.checked = true;
  const removeSw = wheelRemoveWinnerToggle.nextElementSibling;
  if (removeSw) removeSw.setAttribute("aria-checked", "true");
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");
  currentRotation = 0;
  isOpen = true;
  hasInitialized = true;
  drawWheel(0);
  renderMemberList();
  setupEventDelegation();
  // Hide "Include PO" toggle — no Firebase members in Wheel room
  const includePoToggle = document.getElementById("wheel-include-po");
  if (includePoToggle) {
    const label = includePoToggle.closest(".toggle-label");
    if (label) label.classList.add("hidden");
  }
  // Show team dropdown in Wheel room
  const teamGroup = document.getElementById("wheel-team-group");
  if (teamGroup) teamGroup.style.display = "";
  const teamSelect = document.getElementById("wheel-team-select") as HTMLSelectElement;
  if (teamSelect) teamSelect.value = "All";
}

// Export control functions for app.ts to bind
export function handleSpin(): void {
  spin();
}

export function handleShuffle(): void {
  if (isSpinning) return;
  shuffleEntries();
}

export function handleReset(): void {
  if (isSpinning) return;
  restartEntries();
}

export function handleClear(): void {
  if (isSpinning) return;
  clearEntries();
}

export function handleAddEntry(): void {
  if (isSpinning) return;
  addEntry(wheelAddInput.value);
  wheelAddInput.value = "";
  wheelAddInput.focus();
}
