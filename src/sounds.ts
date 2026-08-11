import {
  db,
  ref,
  push,
  set,
  remove,
  serverTimestamp,
  onChildAdded,
  off,
} from "./firebase";
import { state } from "./state";
import { soundPickerBar, shortcutContent, shortcutEnabledToggle } from "./dom";
import { SOUNDS, APP_VERSION, NOTIFICATION_SOUNDS } from "./constants";
import { SOUND_VOLUME, FEATURES } from "./config";
import { animateFloatingEmoji } from "./reactions";

let soundPickerOpen = false;
let soundListenerQuery: ReturnType<typeof ref> | null = null;

// ===== Web Audio: play from pre-decoded AudioBuffers for instant, complete playback =====
let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();

/**
 * Cache namespace tied to APP_VERSION. Adding a new sound is automatic (new URL → fetched
 * fresh); replacing a file refreshes on the next version bump. Old namespaces are cleaned up
 * so the cache never serves stale bytes or accumulates orphans.
 */
const SOUND_CACHE = `sounds-${APP_VERSION}`;

/** Lazily create + resume the AudioContext (browsers suspend it until a user gesture). */
function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Fetch a sound as an ArrayBuffer via the Cache API (persistent local copy). */
async function fetchSoundArrayBuffer(file: string): Promise<ArrayBuffer> {
  const cache = await caches.open(SOUND_CACHE);
  const url = `/sounds/${file}`;
  let response = await cache.match(url);
  if (!response || !response.ok) {
    response = await fetch(url);
    if (response.ok) {
      // Persist a clone so later loads are instant + work offline
      cache.put(url, response.clone()).catch(() => {});
    }
  }
  return response.arrayBuffer();
}

/** Fetch + decode a sound into an AudioBuffer (kept in memory after first load). */
async function loadBuffer(file: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(file);
  if (cached) return cached;
  try {
    const data = await fetchSoundArrayBuffer(file);
    // decodeAudioData works while the context is suspended, so preload can run pre-gesture
    const buffer = await getAudioContext().decodeAudioData(data);
    bufferCache.set(file, buffer);
    return buffer;
  } catch (err) {
    console.error(`[Sound] decode failed: ${file}`, err);
    return null;
  }
}

/** Delete sound caches from previous app versions (prevents stale/orphan caches). */
async function cleanOldSoundCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((k) => k.startsWith("sounds-") && k !== SOUND_CACHE)
      .map((k) => caches.delete(k))
  );
}

/** Preload + decode every sound on room join so the first play is instant and complete.
 *  Includes NOTIFICATION_SOUNDS (in.mp3/out.mp3) so join/leave cues are instant too —
 *  these never appear in the picker, but share the same buffer cache. */
export async function preloadSounds(): Promise<void> {
  getAudioContext();
  cleanOldSoundCaches().catch(() => {});
  await Promise.all([
    ...SOUNDS.map((s) => loadBuffer(s.file)),
    ...NOTIFICATION_SOUNDS.map((f) => loadBuffer(f)),
  ]);
}

/** Render sound picker buttons */
export function renderSoundPicker(): void {
  soundPickerBar.innerHTML = SOUNDS.map(
    (s) =>
      `<button class="sound-item" data-file="${s.file}" data-emoji="${s.emoji}" title="${s.label}">${s.emoji} <small>${s.label}</small></button>`,
  ).join("");
}

/** Toggle sound picker bar */
export function toggleSoundPicker(): void {
  soundPickerOpen = !soundPickerOpen;
  soundPickerBar.classList.toggle("hidden", !soundPickerOpen);
}

/** Check if user has muted sounds from others */
export function isMuteOthers(): boolean {
  return localStorage.getItem("scrum-poker-mute-others") === "true";
}

/** Play a sound instantly from its pre-decoded AudioBuffer.
 *  Falls back to an <audio> element if decoding ever fails. */
export async function playSound(file: string): Promise<void> {
  // Resume the AudioContext synchronously so it unlocks within the caller's click gesture
  // (Safari/strict browsers require resume() in the gesture call stack, not after an await).
  getAudioContext();
  const buffer = await loadBuffer(file);
  if (!buffer) {
    try {
      const fallback = new Audio(`/sounds/${file}`);
      fallback.volume = SOUND_VOLUME;
      fallback.play().catch(() => {});
    } catch {
      /* ignore */
    }
    return;
  }
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = SOUND_VOLUME;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

/** Send sound event to Firebase so everyone hears it */
export async function sendSound(file: string, bypassMute = false): Promise<void> {
  if (!FEATURES.sound) return;
  if (!state.currentRoom || !state.currentUser) return;
  await set(push(ref(db, `rooms/${state.currentRoom}/sounds`)), {
    file,
    senderName: state.currentUser.name,
    senderUid: state.currentUser.uid,
    bypassMute,
    timestamp: serverTimestamp(),
  });
}

/** Listen for sound events from Firebase */
export function initSoundListener(): void {
  destroySoundListener();
  if (!state.currentRoom) return;

  // Preload sounds on first room join so playback is instant
  preloadSounds();

  const soundsRef = ref(db, `rooms/${state.currentRoom}/sounds`);
  soundListenerQuery = soundsRef;

  onChildAdded(soundsRef, (snap) => {
    const data = snap.val();
    if (data) {
      // Play OTHER users' sounds only — our own sound already plays locally on press
      // (so it's instant, not gated by the Firebase round-trip). Respect mute; wheel bypasses it.
      const isOwn = data.senderUid === state.currentUid;
      if (!isOwn && (!isMuteOthers() || data.bypassMute)) {
        playSound(data.file);
      }
      // Show floating emoji for other users' sounds
      if (!isOwn) {
        const emoji = getSoundEmoji(data.file);
        animateFloatingEmoji(emoji, data.senderName);
      }
      const key = snap.key;
      setTimeout(() => {
        if (state.currentRoom && key) {
          remove(ref(db, `rooms/${state.currentRoom}/sounds/${key}`));
        }
      }, 5000);
    }
  });
}

/** Clean up sound listener */
export function destroySoundListener(): void {
  if (soundListenerQuery) {
    off(soundListenerQuery);
    soundListenerQuery = null;
  }
}

/** Close sound picker when clicking outside */
export function handleSoundPickerOutsideClick(target: HTMLElement): void {
  if (
    soundPickerOpen &&
    !target.closest(".sound-picker-bar") &&
    !target.closest("#btn-bar-sound")
  ) {
    soundPickerBar.classList.add("hidden");
    soundPickerOpen = false;
  }
}

/** Look up the emoji for a sound file */
function getSoundEmoji(file: string): string {
  const sound = SOUNDS.find((s) => s.file === file);
  return sound ? sound.emoji : "🔊";
}

// ===== Keyboard shortcuts for sounds (per-user, 4 slots, stored in localStorage) =====
const SOUND_SHORTCUTS_KEY = "scrum-poker-sound-shortcuts";
const SOUND_SHORTCUTS_ENABLED_KEY = "scrum-poker-sound-shortcuts-enabled";
const MAX_SOUND_SHORTCUTS = 4;

/** Default shortcuts applied on first use (before the user customizes anything). */
const DEFAULT_SOUND_SHORTCUTS: SoundShortcut[] = [
  { combo: "f1", label: "F1", file: "ปรบมือ.mp3" },
  { combo: "f2", label: "F2", file: "ตบมุข 1.mp3" },
  { combo: "f3", label: "F3", file: "ตบมุข 2.mp3" },
  { combo: "f4", label: "F4", file: "บุฟเฟ่.mp3" },
];

export interface SoundShortcut {
  /** Normalized id from e.code + modifiers, e.g. "alt+digit1" */
  combo: string;
  /** Human-readable label, e.g. "Alt+1" */
  label: string;
  /** Sound file (from SOUNDS) */
  file: string;
}

/** A single keypress combo built from a KeyboardEvent. Returns null for modifier-only presses. */
function buildCombo(e: KeyboardEvent): { combo: string; label: string } | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  if (!e.code) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  const keyLabel = codeToLabel(e.code);
  const label = [...mods, keyLabel].join("+");
  const combo = [...mods.map((m) => m.toLowerCase()), e.code.toLowerCase()].join("+");
  return { combo, label };
}

/** Friendly label for a KeyboardEvent.code value. */
function codeToLabel(code: string): string {
  if (!code) return "?";
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Key")) return code.slice(3);
  const arrows: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  if (code in arrows) return arrows[code];
  if (code === "Space") return "Space";
  if (code === "Escape") return "Esc";
  return code;
}

/** Read the 4 shortcut slots from localStorage (malformed/missing → all empty). */
function loadSoundShortcuts(): (SoundShortcut | null)[] {
  const empty = (): (SoundShortcut | null)[] =>
    Array.from({ length: MAX_SOUND_SHORTCUTS }, () => null);
  try {
    const raw = localStorage.getItem(SOUND_SHORTCUTS_KEY);
    if (!raw) return DEFAULT_SOUND_SHORTCUTS.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return empty();
    const slots = parsed.slice(0, MAX_SOUND_SHORTCUTS);
    while (slots.length < MAX_SOUND_SHORTCUTS) slots.push(null);
    return slots.map((s) =>
      s && typeof s.combo === "string" && typeof s.file === "string"
        ? { combo: s.combo, label: typeof s.label === "string" ? s.label : "", file: s.file }
        : null,
    );
  } catch {
    return empty();
  }
}

function saveSoundShortcuts(slots: (SoundShortcut | null)[]): void {
  localStorage.setItem(SOUND_SHORTCUTS_KEY, JSON.stringify(slots));
}

/** Master switch for ALL sound shortcuts — defaults to ON when never set. */
function isShortcutsEnabled(): boolean {
  const raw = localStorage.getItem(SOUND_SHORTCUTS_ENABLED_KEY);
  return raw === null ? true : raw === "true";
}

export function setShortcutsEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_SHORTCUTS_ENABLED_KEY, String(enabled));
}

/** True when the focused element is something the user types/selects in. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

/** Play a sound the same way the sound-bar click does (local + broadcast + floating emoji). */
export function triggerSound(file: string): void {
  if (!FEATURES.sound) return;
  if (!state.currentRoom || !state.currentUser) return;
  playSound(file);
  animateFloatingEmoji(getSoundEmoji(file), state.currentUser.name);
  sendSound(file);
}

let shortcutListenerBound = false;

/** Attach the global keydown listener once (called from app init). */
export function registerSoundShortcuts(): void {
  if (shortcutListenerBound) return;
  shortcutListenerBound = true;
  document.addEventListener("keydown", handleShortcutKeydown);
}

function handleShortcutKeydown(e: KeyboardEvent): void {
  if (!FEATURES.sound) return;
  if (!isShortcutsEnabled()) return;
  if (!state.currentRoom) return;
  // Never fire while a modal is open (settings/confirm/warning/wheel) or while typing
  if (document.querySelector(".modal-overlay.active")) return;
  if (isTypingTarget(document.activeElement)) return;

  const combo = buildCombo(e);
  if (!combo) return;
  const match = loadSoundShortcuts().find((s) => s !== null && s.combo === combo.combo);
  if (match) {
    e.preventDefault();
    triggerSound(match.file);
  }
}

// ----- Settings modal: render / capture / edit the 4 slots -----

let captureCtx: { slot: number; onDuplicate: (() => void) | null } | null = null;

/** Populate the 4 shortcut rows in the settings modal from localStorage. */
export function renderSoundShortcutSlots(): void {
  const container = shortcutContent;
  if (!container) return;
  // Master on/off toggle state
  shortcutEnabledToggle.checked = isShortcutsEnabled();
  const masterSw = shortcutEnabledToggle.nextElementSibling;
  if (masterSw) masterSw.setAttribute("aria-checked", String(shortcutEnabledToggle.checked));

  const slots = loadSoundShortcuts();
  for (let i = 0; i < MAX_SOUND_SHORTCUTS; i++) {
    const row = container.querySelector<HTMLElement>(
      `.sound-shortcut-row[data-slot="${i}"]`,
    );
    if (!row) continue;
    const keyBtn = row.querySelector<HTMLButtonElement>(".btn-shortcut-key");
    const sel = row.querySelector<HTMLSelectElement>(".select-shortcut-sound");
    if (keyBtn) {
      keyBtn.textContent = slots[i]?.label || "กดคีย์...";
      keyBtn.classList.toggle("is-set", !!slots[i]?.combo);
      keyBtn.classList.remove("capturing");
    }
    if (sel) {
      if (sel.options.length === 0) {
        sel.add(new Option("-- เลือกเสียง --", ""));
        for (const s of SOUNDS) {
          sel.add(new Option(`${s.emoji} ${s.label}`, s.file));
        }
      }
      sel.value = slots[i]?.file ?? "";
    }
  }
}

/** Start listening for the next keypress to assign it to a slot. */
export function startKeyCapture(slot: number, onDuplicate?: () => void): void {
  cancelKeyCapture();
  captureCtx = { slot, onDuplicate: onDuplicate ?? null };
  const row = shortcutContent?.querySelector<HTMLElement>(
    `.sound-shortcut-row[data-slot="${slot}"]`,
  );
  const keyBtn = row?.querySelector<HTMLButtonElement>(".btn-shortcut-key");
  if (keyBtn) {
    keyBtn.textContent = "กดคีย์เลย...";
    keyBtn.classList.add("capturing");
  }
  document.addEventListener("keydown", onCaptureKey, true);
}

/** Stop an in-progress capture and restore the button text from storage. */
export function cancelKeyCapture(): void {
  if (!captureCtx) return;
  captureCtx = null;
  document.removeEventListener("keydown", onCaptureKey, true);
  renderSoundShortcutSlots();
}

function onCaptureKey(e: KeyboardEvent): void {
  // Consume the key during capture so nothing else (incl. the global shortcut) reacts
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!captureCtx) return;
  if (e.key === "Escape") {
    cancelKeyCapture();
    return;
  }
  const combo = buildCombo(e);
  if (!combo) return; // modifier-only — keep listening for the real key
  const { slot, onDuplicate } = captureCtx;
  const slots = loadSoundShortcuts();
  if (slots.some((s, idx) => s !== null && s.combo === combo.combo && idx !== slot)) {
    captureCtx = null;
    document.removeEventListener("keydown", onCaptureKey, true);
    renderSoundShortcutSlots();
    onDuplicate?.();
    return;
  }
  const existing = slots[slot];
  slots[slot] = { combo: combo.combo, label: combo.label, file: existing?.file ?? "" };
  saveSoundShortcuts(slots);
  captureCtx = null;
  document.removeEventListener("keydown", onCaptureKey, true);
  renderSoundShortcutSlots();
}

/** Change the sound file for a slot (keeps an existing key; saved immediately). */
export function setShortcutSound(slot: number, file: string): void {
  const slots = loadSoundShortcuts();
  const existing = slots[slot];
  slots[slot] = existing
    ? { ...existing, file }
    : { combo: "", label: "", file };
  saveSoundShortcuts(slots);
}

/** Clear a slot entirely (key + sound). */
export function clearShortcut(slot: number): void {
  const slots = loadSoundShortcuts();
  slots[slot] = null;
  saveSoundShortcuts(slots);
  if (captureCtx?.slot === slot) cancelKeyCapture();
  renderSoundShortcutSlots();
}
