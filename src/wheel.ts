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
  wheelAutoShuffleToggle,
  btnWheelSpin,
} from "./dom";
import { playSound } from "./sounds";
import { spawnFirework, showToast } from "./ui";
import { escapeHtml } from "./utils";
import type { User } from "./types";

// ── State ──────────────────────────────────────────────────────────
let originalMembers: string[] = [];
let wheelEntries: string[] = [];
let duplicateCount = 1;
let selectedWinner: string | null = null;
let isOpen = false;
let isSpinning = false;
let removeWinner = false;
let autoShuffle = true;
let spinHistory: string[] = [];
let currentRotation = 0;
let animFrameId: number | null = null;
let hasInitialized = false;

// AbortController for cleanup of event listeners
let eventAbort: AbortController | null = null;

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
  return Object.values(users).map((u) => u.name);
}

// ── Canvas Rendering ───────────────────────────────────────────────
function drawWheel(rotation: number): void {
  const canvas = wheelCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const size = 360;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
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
    const fontSize = n <= 3 ? 22 : n <= 5 ? 20 : n <= 8 ? 17 : n <= 12 ? 15 : n <= 18 ? 13 : 11;
    ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let name = wheelEntries[i];
    const maxChars = n <= 3 ? 16 : n <= 6 ? 12 : n <= 10 ? 9 : 7;
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
  let normalizedRotation = rotation % (Math.PI * 2);
  if (normalizedRotation < 0) normalizedRotation += Math.PI * 2;
  let pointerAngle = (Math.PI * 2.5 - normalizedRotation) % (Math.PI * 2);
  const index = Math.floor(pointerAngle / arcSize);
  return ((index % n) + n) % n;
}

// ── Spin Logic ─────────────────────────────────────────────────────
let spinWinnerIndex = -1;
let lastTickSegment = -1;

function spin(): void {
  if (isSpinning || wheelEntries.length === 0) return;

  isSpinning = true;
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");
  btnWheelSpin.disabled = true;

  if (autoShuffle) shuffleEntries();

  spinWinnerIndex = Math.floor(Math.random() * wheelEntries.length);
  const n = wheelEntries.length;
  const arcSize = (Math.PI * 2) / n;

  const winnerMid = spinWinnerIndex * arcSize + arcSize / 2;
  const targetOffset = (Math.PI * 2.5 - winnerMid) % (Math.PI * 2);
  const extraRotations = SPIN_TOTAL_ROTATIONS * Math.PI * 2;
  const targetRotation = currentRotation + extraRotations + targetOffset + (Math.random() * arcSize * 0.6 - arcSize * 0.3);

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

  playSound("แกไม่รอดแน่.mp3");
  spawnFirework(wheelCanvasContainer);
  spinHistory.push(winner);
  showToast(`🎡 ผู้ถูกสุ่ม: ${winner}`);

  if (removeWinner) {
    const idx = wheelEntries.indexOf(winner);
    if (idx !== -1) {
      wheelEntries.splice(idx, 1);
      drawWheel(currentRotation);
      renderMemberList();
    }
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
  wheelEntries = [];
  currentRotation = 0;
  drawWheel(0);
  renderMemberList();
}

function addEntry(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  wheelEntries.push(trimmed);
  drawWheel(currentRotation);
  renderMemberList();
}

function removeEntry(index: number): void {
  if (isSpinning) return;
  wheelEntries.splice(index, 1);
  drawWheel(currentRotation);
  renderMemberList();
}

function editEntry(index: number, newName: string): void {
  if (isSpinning) return;
  const trimmed = newName.trim();
  if (!trimmed) return;
  wheelEntries[index] = trimmed;
  drawWheel(currentRotation);
  renderMemberList();
}

/** Restart — fetch fresh members from Firebase */
async function restartEntries(): Promise<void> {
  originalMembers = await fetchMembers();
  duplicateCount = 1;
  wheelDuplicateSelect.value = "1";
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");
  currentRotation = 0;
  rebuildWheelEntries();
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
    drawWheel(0);
    renderMemberList();
  }, { signal });

  // Toggles
  wheelRemoveWinnerToggle.addEventListener("change", () => {
    removeWinner = wheelRemoveWinnerToggle.checked;
    const sw = wheelRemoveWinnerToggle.nextElementSibling;
    if (sw) sw.setAttribute("aria-checked", String(removeWinner));
  }, { signal });

  wheelAutoShuffleToggle.addEventListener("change", () => {
    autoShuffle = wheelAutoShuffleToggle.checked;
    const sw = wheelAutoShuffleToggle.nextElementSibling;
    if (sw) sw.setAttribute("aria-checked", String(autoShuffle));
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
  forceCloseWheel();
  originalMembers = [];
  wheelEntries = [];
  spinHistory = [];
  currentRotation = 0;
  isSpinning = false;
  selectedWinner = null;
  hasInitialized = false;
}

async function initWheel(): Promise<void> {
  originalMembers = await fetchMembers();
  duplicateCount = 1;
  wheelDuplicateSelect.value = "1";
  removeWinner = true;
  wheelRemoveWinnerToggle.checked = true;
  const removeSw = wheelRemoveWinnerToggle.nextElementSibling;
  if (removeSw) removeSw.setAttribute("aria-checked", "true");
  autoShuffle = true;
  selectedWinner = null;
  wheelWinnerDisplay.classList.add("hidden");
  currentRotation = 0;
  rebuildWheelEntries();
  drawWheel(0);
  renderMemberList();
  setupEventDelegation();
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
