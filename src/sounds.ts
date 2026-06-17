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
import { soundPickerBar } from "./dom";
import { SOUNDS, APP_VERSION } from "./constants";
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

/** Preload + decode every sound on room join so the first play is instant and complete. */
export async function preloadSounds(): Promise<void> {
  getAudioContext();
  cleanOldSoundCaches().catch(() => {});
  await Promise.all(SOUNDS.map((s) => loadBuffer(s.file)));
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
