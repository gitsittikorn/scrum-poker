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
import { SOUND_VOLUME } from "./config";

let soundPickerOpen = false;
let soundListenerQuery: ReturnType<typeof ref> | null = null;

/** Render sound picker buttons */
export function renderSoundPicker(): void {
  soundPickerBar.innerHTML = SOUNDS.map(
    (s) =>
      `<button class="sound-item" data-file="${s.file}" title="${s.label}">${s.emoji} <small>${s.label}</small></button>`
  ).join("");
}

/** Toggle sound picker bar */
export function toggleSoundPicker(): void {
  soundPickerOpen = !soundPickerOpen;
  soundPickerBar.classList.toggle("hidden", !soundPickerOpen);
}

/** Play a local audio file */
export function playSound(file: string): void {
  const audio = new Audio(`/sounds/${file}`);
  audio.volume = SOUND_VOLUME;
  audio.play().catch(() => {
    /* browser blocked autoplay — ignore */
  });
}

/** Send sound event to Firebase so everyone hears it */
export async function sendSound(file: string): Promise<void> {
  if (!state.currentRoom || !state.currentUser) return;
  await set(push(ref(db, `rooms/${state.currentRoom}/sounds`)), {
    file,
    senderName: state.currentUser.name,
    senderUid: state.currentUser.uid,
    timestamp: serverTimestamp(),
  });
}

/** Listen for sound events from Firebase (called from initChat / joinRoom) */
export function initSoundListener(): void {
  destroySoundListener();
  if (!state.currentRoom) return;

  const soundsRef = ref(db, `rooms/${state.currentRoom}/sounds`);
  soundListenerQuery = soundsRef;

  onChildAdded(soundsRef, (snap) => {
    const data = snap.val();
    if (data) {
      playSound(data.file);
      const key = snap.key;
      setTimeout(() => {
        if (state.currentRoom && key) {
          remove(ref(db, `rooms/${state.currentRoom}/sounds/${key}`));
        }
      }, 5000);
    }
  });
}

/** Clean up sound listener (called from destroyChat / handleLeave) */
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
