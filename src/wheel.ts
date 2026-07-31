import { db, ref, get, onValue, query, limitToLast, push, remove, off } from "./firebase";
import { state } from "./state";
import {
  wheelCanvas,
  wheelCanvasContainer,
  wheelWinnerDisplay,
  wheelMemberList,
  wheelAddInput,
  wheelPanel,
  wheelEntryCount,
  wheelHistoryList,
  wheelHistoryCount,
  wheelDuplicateSelect,
  wheelRemoveWinnerToggle,
  btnWheelSpin,
} from "./dom";
import { WHEEL_HISTORY_LIMIT } from "./config";
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
  "Team": ["UX/UI", "Kitsune", "Phoenix", "Monkey King", "RISA"],
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
// Currently-selected team preset (Wheel room only) — persisted so the dropdown
// stays in sync with restored entries across re-entry (Bug 2).
let currentTeam = "All";

// AbortController for cleanup of event listeners
let eventAbort: AbortController | null = null;

// ── Spin History (shared via Firebase RTDB) ────────────────────────
// Stores the query so we can off() it on destroy (prevents listener stacking,
// same pattern as chat.ts chatListenerQuery). historyEntries mirrors the last
// snapshot so the ↩️ re-add handler can resolve an id → name.
let historyListenerQuery: ReturnType<typeof query> | null = null;
let historyEntries: { id: string; name: string }[] = [];

// ── Member listener (poker rooms) — keeps wheel names fresh ─────────
// onValue on rooms/{room}/users so renamed/rejoined members update the wheel
// in real time (Bug 1). Detached in destroyWheel to prevent stacking.
let memberListenerQuery: ReturnType<typeof ref> | null = null;

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
// Anti-streak weighting: each past win (in shared wheelHistory) multiplies that
// name's pick weight by this factor; everyone else's share rises on renormalize.
// History is capped at WHEEL_HISTORY_LIMIT, so weights drift back to equal over time.
const WHEEL_WEIGHT_DECAY = 0.7;

// ── Firebase ───────────────────────────────────────────────────────
/** Extract member names from a users snapshot, honoring the Include-PO toggle. */
function namesFromUsers(users: Record<string, User>): string[] {
  return Object.values(users)
    .filter((u) => includePO || u.role !== "po")
    .map((u) => u.name);
}

async function fetchMembers(): Promise<string[]> {
  if (!state.currentRoom) return [];
  const snap = await get(ref(db, `rooms/${state.currentRoom}/users`));
  if (!snap.exists()) return [];
  return namesFromUsers(snap.val() as Record<string, User>);
}

// ── Local persistence (per room + user) ─────────────────────────────
// Scoped by room + uid so cache never leaks across rooms or browsers.
//
// Poker rooms store a `memberFingerprint` (a hash of the room's member names)
// so on return we can detect whether the member set changed (rename/join/leave).
// If it matches, we restore PO's customizations (duplicate count, manual adds);
// if it differs, we fetch fresh members so renamed users show their current name.
//
// Wheel room is ephemeral: resetWheelRoomOnLeave() wipes the cache + shared
// history on leave, so re-entry always starts from defaults. The restore path
// here only matters for a mid-session page refresh / tab reopen.
let memberFingerprint: string | null = null;

/** Stable hash of a member-name set (order-independent). */
function fingerprintOf(names: string[]): string {
  return [...names].sort().join("|");
}

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
      JSON.stringify({
        entries: wheelEntries,
        duplicate: duplicateCount,
        team: currentTeam,
        memberFingerprint: memberFingerprint ?? undefined,
      }),
    );
  } catch {
    // Ignore quota / serialization errors — persistence is best-effort.
  }
}

interface SavedWheelState {
  entries: string[];
  duplicate: number;
  team?: string;
  memberFingerprint?: string;
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
      team: typeof parsed.team === "string" ? parsed.team : undefined,
      memberFingerprint:
        typeof parsed.memberFingerprint === "string" ? parsed.memberFingerprint : undefined,
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
  currentTeam = saved.team ?? "All";
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

// ── Spin History (shared via Firebase RTDB) ────────────────────────
// Records everyone who gets picked, in order, visible to all users in the room
// in real time. Mirrors the chat listener pattern (store query → off on destroy).

/** Start listening to the room's wheelHistory (last 50). Safe to call repeatedly. */
function startHistoryListener(): void {
  stopHistoryListener(); // never stack
  if (!state.currentRoom) return;
  historyListenerQuery = query(
    ref(db, `rooms/${state.currentRoom}/wheelHistory`),
    limitToLast(WHEEL_HISTORY_LIMIT),
  );
  onValue(historyListenerQuery, (snap) => {
    historyEntries = [];
    snap.forEach((child) => {
      const v = child.val();
      if (v && typeof v.name === "string") {
        historyEntries.push({ id: child.key!, name: v.name });
      }
    });
    // push() keys are ordered oldest→newest, so this already yields "newest at bottom"
    renderHistory();
  });
}

/** Detach the history listener and clear local cache (called on destroy/re-init). */
function stopHistoryListener(): void {
  if (historyListenerQuery) {
    off(historyListenerQuery);
    historyListenerQuery = null;
  }
  historyEntries = [];
}

/** Render the history list + count badge, scrolling to the newest (bottom). */
function renderHistory(): void {
  wheelHistoryCount.textContent = String(historyEntries.length);

  if (historyEntries.length === 0) {
    wheelHistoryList.innerHTML = '<small class="form-hint">ยังไม่มีประวัติ</small>';
    return;
  }

  wheelHistoryList.innerHTML = historyEntries
    .map(
      (h, i) => `
    <div class="wheel-history-row" data-id="${escapeHtml(h.id)}">
      <span class="wheel-history-idx">${i + 1}</span>
      <span class="wheel-history-name">${escapeHtml(h.name)}</span>
      <button class="wheel-entry-btn" data-action="readd" data-id="${escapeHtml(h.id)}" title="เพิ่มกลับเข้ากงล้อ">↩️</button>
    </div>`,
    )
    .join("");

  requestAnimationFrame(() => {
    wheelHistoryList.scrollTop = wheelHistoryList.scrollHeight;
  });
}

/** Record a winner to the shared history (best-effort). */
function recordHistory(winner: string): void {
  if (!state.currentRoom) return;
  push(ref(db, `rooms/${state.currentRoom}/wheelHistory`), { name: winner }).catch(
    () => {
      // best-effort — network errors shouldn't break the spin UX
    },
  );
  pruneHistory();
}

/** Delete history entries older than WHEEL_HISTORY_LIMIT so the DB doesn't grow unbounded.
 *  limitToLast() only hides old rows from the client; it doesn't delete them server-side. */
async function pruneHistory(): Promise<void> {
  if (!state.currentRoom) return;
  try {
    const snap = await get(ref(db, `rooms/${state.currentRoom}/wheelHistory`));
    if (!snap.exists()) return;
    const keys = Object.keys(snap.val() as Record<string, unknown>).sort(); // oldest→newest
    if (keys.length <= WHEEL_HISTORY_LIMIT) return;
    const toRemove = keys.slice(0, keys.length - WHEEL_HISTORY_LIMIT);
    await Promise.all(
      toRemove.map((k) =>
        remove(ref(db, `rooms/${state.currentRoom}/wheelHistory/${k}`)),
      ),
    );
  } catch {
    // ignore — pruning is best-effort
  }
}

/** Wipe the shared spin history for the current room (best-effort). The
 *  onValue history listener re-renders the empty list automatically. */
function clearHistory(): void {
  if (!state.currentRoom) return;
  remove(ref(db, `rooms/${state.currentRoom}/wheelHistory`)).catch(() => {});
}

/** Wheel room is ephemeral (req 4-5): on leave, wipe this browser's cached wheel
 *  state + the shared spin history so re-entry always starts from defaults
 *  (team "All", default entries, no history). */
export function resetWheelRoomOnLeave(): void {
  clearHistory();
  const key = wheelStorageKey();
  if (key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore quota / serialization errors
    }
  }
}

// ── Member listener (poker rooms) — live-refresh wheel names ────────
/** Attach onValue on room users; rebuild the wheel when the member-name set changes
 *  (rename/join/leave). Skipped in Wheel room (team-based, no FB members to track).
 *  Safe against PO customizations: the fingerprint only covers names, so votes /
 *  online / lastSeen writes and manual add / remove-winner never trigger a rebuild. */
function startMemberListener(): void {
  stopMemberListener();
  if (!state.currentRoom || state.isWheelRoom) return;
  memberListenerQuery = ref(db, `rooms/${state.currentRoom}/users`);
  onValue(memberListenerQuery, (snap) => {
    if (!snap.exists() || isSpinning) return;
    const names = namesFromUsers(snap.val() as Record<string, User>);
    const fp = fingerprintOf(names);
    if (fp === memberFingerprint) return; // names unchanged — nothing to do
    memberFingerprint = fp;
    originalMembers = names;
    rebuildWheelEntries(); // preserves duplicateCount
    drawWheel(currentRotation);
    renderMemberList();
    saveWheelState();
  });
}

/** Detach the member listener (called on destroy/re-init). */
function stopMemberListener(): void {
  if (memberListenerQuery) {
    off(memberListenerQuery);
    memberListenerQuery = null;
  }
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

/** Weight for one entry: DECAY^(times this name won, per shared history). */
function entryWeight(name: string): number {
  let wins = 0;
  for (const h of historyEntries) if (h.name === name) wins++;
  return Math.pow(WHEEL_WEIGHT_DECAY, wins);
}

/** Weighted random pick over wheelEntries — past winners are less likely. */
function pickWeightedIndex(): number {
  const weights = wheelEntries.map(entryWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return wheelEntries.length - 1; // float rounding edge
}

function spin(): void {
  if (isSpinning) return;

  // ปิด modal ค้างจากการสุ่มครั้งก่อน — ถ้าเปิด removeWinner จะลบผู้ชนะออกจากกงล้อด้วย
  closeWinnerModal();

  if (wheelEntries.length === 0) return;

  isSpinning = true;
  btnWheelSpin.disabled = true;

  shuffleEntries(); // Always shuffle

  spinWinnerIndex = pickWeightedIndex();
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

  // Record to shared history so everyone sees the pick order in real time
  recordHistory(winner);

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
  // Also wipe the shared spin history for this room
  if (state.currentRoom) {
    remove(ref(db, `rooms/${state.currentRoom}/wheelHistory`)).catch(() => {});
  }
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

/** Restart — fetch fresh members from Firebase (or reset to the currently-selected team in Wheel room) */
async function restartEntries(): Promise<void> {
  if (state.isWheelRoom) {
    const teamSelect = document.getElementById("wheel-team-select") as HTMLSelectElement;
    const team = teamSelect?.value || "All";
    currentTeam = team;
    originalMembers = [...(WHEEL_TEAMS[team] || WHEEL_ROOM_DEFAULTS)];
    memberFingerprint = null; // Wheel room has no Firebase members to fingerprint
  } else {
    originalMembers = await fetchMembers();
    memberFingerprint = fingerprintOf(originalMembers);
  }
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

  // History row ↩️ — re-add that name back into the wheel entries
  wheelHistoryList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.action !== "readd") return;
    const id = target.dataset.id;
    const entry = historyEntries.find((h) => h.id === id);
    if (entry) addEntry(entry.name);
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
    memberFingerprint = fingerprintOf(members);
    rebuildWheelEntries();
    saveWheelState();
    drawWheel(currentRotation);
    renderMemberList();
  }, { signal });

  // Team select — switch entry group (Wheel room only)
  const teamSelect = document.getElementById("wheel-team-select") as HTMLSelectElement;
  teamSelect?.addEventListener("change", () => {
    const team = teamSelect.value;
    currentTeam = team;
    if (state.isWheelRoom) clearHistory(); // เปลี่ยนทีม → ล้างประวัติเสมอ (Wheel room เท่านั้น)
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
  stopHistoryListener();
  stopMemberListener();
  // Abort all event listeners
  if (eventAbort) {
    eventAbort.abort();
    eventAbort = null;
  }
  removeWinnerModalEl();
  forceCloseWheel();
  originalMembers = [];
  wheelEntries = [];
  memberFingerprint = null;
  currentTeam = "All";
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
  // Always fetch current members so renamed/changed users show their new name.
  // We only restore PO's customization (duplicate count, manual adds) when the
  // room's member set is unchanged since the last visit (matched by fingerprint).
  const freshMembers = await fetchMembers();
  memberFingerprint = fingerprintOf(freshMembers);
  const saved = loadWheelState();
  if (saved && saved.entries.length > 0 && saved.memberFingerprint === memberFingerprint) {
    // Member set unchanged → keep PO's customized entries
    wheelEntries = [...saved.entries];
    duplicateCount = saved.duplicate;
    originalMembers = [...new Set(saved.entries)];
  } else {
    // Members changed (rename/join/leave) or first visit → start from current members
    originalMembers = freshMembers;
    duplicateCount = saved?.duplicate ?? 1;
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
  startHistoryListener();
  renderHistory();
  startMemberListener(); // poker rooms only — live-refresh on rename/join/leave (Bug 1)
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
  if (teamSelect) teamSelect.value = currentTeam; // restored by restoreWheelState() (or "All")
  startHistoryListener();
  renderHistory();
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
