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
import { SOUNDS } from "./constants";
import { SOUND_VOLUME, FEATURES } from "./config";
import { animateFloatingEmoji } from "./reactions";

let soundPickerOpen = false;
let soundListenerQuery: ReturnType<typeof ref> | null = null;

/** Audio cache — preloaded for instant playback */
const audioCache = new Map<string, HTMLAudioElement>();

/** Preload all sound files so first play is instant */
export function preloadSounds(): void {
  for (const s of SOUNDS) {
    if (!audioCache.has(s.file)) {
      const audio = new Audio(`/sounds/${s.file}`);
      audio.volume = SOUND_VOLUME;
      audio.preload = "auto";
      audioCache.set(s.file, audio);
    }
  }
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

/** Play a local audio file using preloaded cache */
export function playSound(file: string): void {
  const cached = audioCache.get(file);
  if (cached) {
    const audio = cached.cloneNode() as HTMLAudioElement;
    audio.volume = SOUND_VOLUME;
    audio.play().catch(() => {
      /* browser blocked autoplay — ignore */
    });
  } else {
    const audio = new Audio(`/sounds/${file}`);
    audio.volume = SOUND_VOLUME;
    audio.play().catch(() => {
      /* browser blocked autoplay — ignore */
    });
  }
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
      // Play sound unless muted and from another user (bypass for wheel etc.)
      const isOwn = data.senderUid === state.currentUid;
      if (isOwn || !isMuteOthers() || data.bypassMute) {
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
