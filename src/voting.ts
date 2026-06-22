import { db, ref, set, get, update, remove, serverTimestamp, onValue } from "./firebase";
import { state, isPO } from "./state";
import type { User, RoomData, Role, GroupedUsers } from "./types";
import {
  cardsContainer,
  votingStatus,
  statusDot,
  statusText,
  btnReveal,
  btnReset,
  colTeam,
  colDev,
  colQa,
  colUx,
  participantCount,
} from "./dom";
import { CARDS } from "./constants";
import { AUTO_UNLOCK_SECONDS } from "./config";
import { showToast, showNotVotedModal, showConfirmModal } from "./ui";
import { sendSystemMessage } from "./chat";

let unlockCountdownId: ReturnType<typeof setInterval> | null = null;
let countdownRemaining = 0;
/** revealTime ของรอบที่ countdown ปัจจุบันกำลังนับให้อยู่ — null = ยังไม่ได้ตั้ง timer */
let countdownRevealTime: number | null = null;
let customPointInput: HTMLInputElement | null = null;

/** ผลต่าง (ms) ระหว่างเวลา server กับ client — serverTime = Date.now() + offset
 *  ใช้ sync เวลาคำนวณ countdown แก้ clock skew (เช่นเครื่อง client ช้า/เร็วกว่าจริง) */
let serverTimeOffset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
  serverTimeOffset = (snap.val() as number) || 0;
});

/** เวลา server โดยประมาณ (ms) = เวลา client + offset */
function nowServerMs(): number {
  return Date.now() + serverTimeOffset;
}

/** คำนวณวินาทีที่เหลือก่อน auto-unlock จาก server timestamp */
function remainingSeconds(
  revealTime: number | null,
  autoUnlockSeconds: number
): number {
  if (revealTime == null) return -1; // ห้องเก่าไม่มี field → สั่ง unlock เลย
  return Math.ceil(autoUnlockSeconds - (nowServerMs() - revealTime) / 1000);
}

/** สั่ง unlock ห้อง (เขียน locked:false) — ทุก client ทำได้, ค่าเดียวกันซ้ำไม่เป็นไร */
function unlockRoom(): void {
  if (state.currentRoom) {
    update(ref(db, `rooms/${state.currentRoom}`), { locked: false });
  }
}

// ===== Auto-unlock Timer =====
export function cancelUnlockTimer(): void {
  if (unlockCountdownId) {
    clearInterval(unlockCountdownId);
    unlockCountdownId = null;
  }
  countdownRemaining = 0;
  countdownRevealTime = null;
}

/**
 * เริ่ม countdown นับถอยหลังจากเวลาที่เหลือ (คำนวณจาก revealTime)
 * — ทุก client เรียกเองได้ ไม่ผูกกับเครื่อง PO ดังนั้น PO reload/leave แล้ว
 * ใครก็ยังนับต่อ/สั่ง unlock ได้ ห้องจะไม่ค้าง locked
 */
function startUnlockTimer(
  revealTime: number | null,
  autoUnlockSeconds: number
): void {
  cancelUnlockTimer();
  countdownRevealTime = revealTime;
  countdownRemaining = remainingSeconds(revealTime, autoUnlockSeconds);

  // หมดเวลาแล้ว (หรือห้องเก่าไม่มี revealTime) → unlock เลย ไม่ตั้ง timer
  if (countdownRemaining <= 0) {
    countdownRemaining = 0;
    updateCountdownDisplay();
    unlockRoom();
    return;
  }

  updateCountdownDisplay();
  unlockCountdownId = setInterval(() => {
    // คำนวณใหม่ทุก tick จาก server time (ใช้ offset ล่าสุด + ไม่ drift ถ้า tab ถูก throttle)
    countdownRemaining = remainingSeconds(revealTime, autoUnlockSeconds);
    if (countdownRemaining <= 0) {
      countdownRemaining = 0;
      cancelUnlockTimer();
      updateCountdownDisplay();
      unlockRoom();
      return;
    }
    updateCountdownDisplay();
  }, 1000);
}

function updateCountdownDisplay(): void {
  // แสดง countdown ในปุ่ม Unlock/Revote (ทุกคนเห็น) — focus ง่ายกว่าแถบสถานะ
  if (countdownRemaining > 0) {
    const revoteBtn = document.getElementById("btn-revote");
    if (revoteBtn) {
      revoteBtn.textContent = isPO()
        ? `🔓 Unlock · auto ${countdownRemaining}s`
        : `🔓 Auto-unlock in ${countdownRemaining}s`;
    }
  }
}

// ===== Cards =====
export function renderCards(): void {
  cardsContainer.innerHTML = "";
  CARDS.forEach((card, i) => {
    if (i === 7) {
      const br = document.createElement("div");
      br.className = "cards-break";
      cardsContainer.appendChild(br);
    }
    const el = document.createElement("div");
    el.className = "poker-card";
    el.dataset.value = card.value;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", `โหวต ${card.value} — ${card.label}`);
    el.innerHTML = `
      <span class="card-value">${card.value}</span>
      <span class="card-label">${card.label}</span>
    `;
    el.addEventListener("click", () => handleVote(card.value));
    // activeCard = the card currently focused (keyboard nav). Distinct from
    // selectedCard (voted). Sets state + .active class for the focus-ring style.
    el.addEventListener("focus", () => {
      if (el.classList.contains("disabled")) return;
      state.activeCard = card.value;
      el.classList.add("active");
    });
    el.addEventListener("blur", () => {
      if (state.activeCard === card.value) state.activeCard = null;
      el.classList.remove("active");
    });
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleVote(card.value);
      }
    });
    cardsContainer.appendChild(el);
  });

  const customCard = document.createElement("div");
  customCard.className = "poker-card custom-card";
  customCard.innerHTML = `
    <input type="number" id="custom-point-input" placeholder="..." min="0" step="0.01">
    <span class="card-label">Custom<br>( Enter )</span>
  `;
  cardsContainer.appendChild(customCard);

  customPointInput = document.getElementById(
    "custom-point-input"
  ) as HTMLInputElement;

  customPointInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") handleCustomVote();
  });
  // จำกัดทศนิยมไม่เกิน 2 ตำแหน่งจริงๆ — กัน paste/IME (number input ไม่สน maxlength)
  customPointInput.addEventListener("input", () => {
    const v = customPointInput!.value;
    const m = v.match(/^\d*\.?\d{0,2}/);
    if (m && m[0] !== v) customPointInput!.value = m[0];
  });
  customPointInput.addEventListener("click", (e: Event) => {
    e.stopPropagation();
  });
  customCard.addEventListener("click", () => customPointInput?.focus());
}

// ===== Voting Actions =====
export async function handleVote(value: string): Promise<void> {
  if (!state.currentRoom || !state.currentUser) return;

  const roomSnap = await get(ref(db, `rooms/${state.currentRoom}`));
  if (roomSnap.exists() && (roomSnap.val() as RoomData).locked) {
    showToast("Voting is locked");
    return;
  }

  state.selectedCard = value;
  document.querySelectorAll(".poker-card").forEach((el) => {
    el.classList.toggle(
      "selected",
      (el as HTMLElement).dataset.value === value
    );
  });
  if (customPointInput) customPointInput.value = "";

  await set(
    ref(db, `rooms/${state.currentRoom}/users/${state.currentUser.uid}/vote`),
    value
  );
}

export async function handleCustomVote(): Promise<void> {
  if (!customPointInput) return;
  const value = customPointInput.value.trim();
  if (!value || !state.currentRoom || !state.currentUser) return;

  // ทศนิยมไม่เกิน 2 ตำแหน่ง + ตัวเลขบวกเท่านั้น — รับทั้ง "0.5" และ ".5"
  if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(value)) {
    showToast("ระบุตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง");
    return;
  }

  const roomSnap = await get(ref(db, `rooms/${state.currentRoom}`));
  if (roomSnap.exists() && (roomSnap.val() as RoomData).locked) {
    showToast("Voting is locked");
    return;
  }

  state.selectedCard = value;
  document.querySelectorAll(".poker-card").forEach((el) => {
    el.classList.remove("selected");
  });

  await set(
    ref(db, `rooms/${state.currentRoom}/users/${state.currentUser.uid}/vote`),
    value
  );
  if (customPointInput) customPointInput.value = "";
  showToast("Voted: " + value);
}

// ===== Kick User (PO only) =====
export async function handleKick(targetUid: string, targetName: string): Promise<void> {
  if (!state.currentRoom || !isPO()) return;
  // Mark offline + left (instead of removing the record) so the user stays
  // in the Wheel for history. `kicked` flag still lets the client detect it
  // and leave the room. On rejoin, joinRoom() clears both flags.
  await update(ref(db, `rooms/${state.currentRoom}`), {
    [`kicked/${targetUid}`]: true,
    [`users/${targetUid}/online`]: false,
    [`users/${targetUid}/left`]: true,
    [`users/${targetUid}/vote`]: null,
  });
  sendSystemMessage(`🥾 ${targetName} ถูกเตะออกจากห้อง`);
  showToast(`เตะ ${targetName} ออกจากห้องแล้ว`);
}

export async function handleReveal(): Promise<void> {
  if (!state.currentRoom || !isPO()) return;
  const usersSnap = await get(ref(db, `rooms/${state.currentRoom}/users`));
  if (!usersSnap.exists()) return;

  const users = usersSnap.val() as Record<string, User>;
  const userList = Object.entries(users);

  // Check if all non-PO users who haven't intentionally left have voted.
  // Offline users (tab close/unload) still count — they remain in the room
  // and PO can kick them if they don't come back.
  const notVoted = userList.filter(
    ([, user]) =>
      user.role !== "po" && user.left !== true && user.vote == null,
  );
  if (notVoted.length > 0) {
    const names = notVoted.map(([, u]) => u.name).join(", ");
    showNotVotedModal(names);
    return;
  }

  // All voted — proceed with reveal
  const grouped = groupUsers(userList);
  const speakers: Record<string, boolean> = {};
  const speakerSet = pickSpeakers(grouped);
  speakerSet.forEach((uid) => {
    speakers[uid] = true;
  });

  await update(ref(db, `rooms/${state.currentRoom}`), {
    revealed: true,
    locked: true,
    revealTime: serverTimestamp(), // เก็บเวลาตอน reveal เพื่อคำนวณ auto-unlock ที่เหลือ
    drinkers: speakers, // Firebase field kept as "drinkers" for backward compat
  });
}

export async function handleReset(): Promise<void> {
  if (!state.currentRoom || !isPO()) return;
  cancelUnlockTimer();

  const usersSnap = await get(ref(db, `rooms/${state.currentRoom}/users`));
  if (usersSnap.exists()) {
    const updates: Record<string, unknown> = {};
    const users = usersSnap.val() as Record<string, User>;
    Object.entries(users).forEach(([uid]) => {
      updates[`users/${uid}/vote`] = null;
    });
    updates["revealed"] = false;
    updates["locked"] = false;
    updates["revealTime"] = null;
    updates["drinkers"] = null; // Firebase field kept as "drinkers"
    await update(ref(db, `rooms/${state.currentRoom}`), updates);
  }

  state.selectedCard = null;
  document
    .querySelectorAll(".poker-card")
    .forEach((el) => el.classList.remove("selected"));
  if (customPointInput) customPointInput.value = "";
  showToast("Reset complete");
}

// ===== Grouping & Speaker Picker =====
function getGroup(user: User): Role {
  if (user.role === "dev") return "dev";
  if (user.role === "qa") return "qa";
  if (user.role === "ux") return "ux";
  return "team";
}

const sortByPoint = (a: [string, User], b: [string, User]): number => {
  const parse = (v: string | null): number => {
    if (v == null) return Infinity;
    const n = parseFloat(v);
    return isNaN(n) ? Infinity : n;
  };
  return parse(a[1].vote) - parse(b[1].vote);
};

function groupUsers(userList: [string, User][]): GroupedUsers {
  const grouped: GroupedUsers = {
    team: [],
    dev: [],
    qa: [],
    ux: [],
  };
  userList.forEach((entry) => {
    // Skip users who intentionally left via the Leave button (record kept
    // for wheel/history). Offline users (tab close/unload) stay visible
    // in the list with an offline dot — they're still part of the session.
    if (entry[1].left === true) return;
    grouped[getGroup(entry[1])].push(entry);
  });
  grouped.team.sort(sortByPoint);
  grouped.dev.sort(sortByPoint);
  grouped.qa.sort(sortByPoint);
  grouped.ux.sort(sortByPoint);
  return grouped;
}

/** Randomly pick the min-voter and max-voter per role group — they must explain their estimate. */
function pickSpeakers(grouped: GroupedUsers): Set<string> {
  const speakers = new Set<string>();
  const pickOne = (pool: [string, User][]) =>
    pool[Math.floor(Math.random() * pool.length)];
  const processGroup = (list: [string, User][]) => {
    const voted = list.filter(([, u]) => u.vote != null);
    const nums = voted
      .map(([, u]) => parseFloat(u.vote!))
      .filter((n) => !isNaN(n));
    if (nums.length <= 1) return;
    const allSame = nums.every((v) => v === nums[0]);
    if (allSame) return;
    const minVal = Math.min(...nums);
    const maxVal = Math.max(...nums);
    const minVoters = voted.filter(([, u]) => parseFloat(u.vote!) === minVal);
    const maxVoters = voted.filter(([, u]) => parseFloat(u.vote!) === maxVal);
    speakers.add(pickOne(minVoters)[0]);
    speakers.add(pickOne(maxVoters)[0]);
  };
  processGroup(grouped.team);
  processGroup(grouped.dev);
  processGroup(grouped.qa);
  processGroup(grouped.ux);
  return speakers;
}

// ===== UI Update =====
export function updateUI(roomData: RoomData): void {
  const users = roomData.users || {};
  const revealed = roomData.revealed || false;
  const locked = roomData.locked || false;
  const userList = Object.entries(users);

  const adminVisible = isPO() ? "" : "none";
  btnReveal.style.display = adminVisible;
  btnReset.style.display = adminVisible;
  const btnDeleteRoom = document.getElementById("btn-delete-room") as HTMLButtonElement;
  if (btnDeleteRoom) btnDeleteRoom.style.display = adminVisible;

  if (locked && revealed) {
    statusDot.className = "status-dot locked";
    statusText.textContent = "Voting locked — Results revealed";
    if (isPO()) btnReveal.style.display = "none";
    // ทุกคนเห็นปุ่ม Unlock (แสดง countdown) — แต่กดได้เฉพาะ PO
    addRevoteButton();
    const revealTime = roomData.revealTime ?? null;
    // ทุกคนรัน countdown (ไม่ใช่แค่ PO) — restart เมื่อ revealTime เปลี่ยน
    if (countdownRevealTime !== revealTime) {
      startUnlockTimer(
        revealTime,
        roomData.autoUnlockSeconds || AUTO_UNLOCK_SECONDS
      );
    } else if (countdownRemaining > 0) {
      // timer เดิมยังนับอยู่ — refresh statusText ให้แสดง countdown
      updateCountdownDisplay();
    }
  } else if (locked) {
    statusDot.className = "status-dot locked";
    statusText.textContent = "Voting locked";
    if (isPO()) btnReveal.style.display = "none";
  } else {
    cancelUnlockTimer();
    const hasVoted =
      state.currentUser && users[state.currentUser.uid]?.vote !== null;
    statusDot.className = hasVoted ? "status-dot voted" : "status-dot";
    statusText.textContent = hasVoted
      ? "Voted! You can change your vote"
      : "Select your estimate";
    const existing = document.getElementById("btn-revote");
    if (existing) existing.remove();
  }

  const disableVoting = locked;
  document.querySelectorAll(".poker-card").forEach((el) => {
    el.classList.toggle("disabled", disableVoting);
  });
  if (customPointInput) {
    customPointInput.disabled = disableVoting;
  }

  if (state.currentUser && users[state.currentUser.uid]) {
    const myVote = users[state.currentUser.uid].vote;
    state.selectedCard = myVote;
    document.querySelectorAll(".poker-card").forEach((el) => {
      el.classList.toggle(
        "selected",
        (el as HTMLElement).dataset.value === myVote
      );
    });
  }

  // Participants — diff-based update
  const grouped = groupUsers(userList);
  const speakers = new Set<string>(
    roomData.drinkers ? Object.keys(roomData.drinkers) : []
  );
  participantCount.textContent = String(userList.length);

  type RoleKey = "po" | "dev" | "qa" | "ux" | "admin";
  const roleIcons: Record<RoleKey, string> = {
    po: "📋",
    dev: "👨‍💻",
    qa: "🐛",
    ux: "🎨",
    admin: "🛡️",
  };

  const updateVoteSpan = (
    span: HTMLElement,
    user: User,
    role: RoleKey
  ) => {
    if (revealed && user.vote) {
      span.className = `participant-vote revealed ${role}`;
      span.textContent = user.vote;
    } else if (user.vote) {
      span.className = "participant-vote voted-icon";
      span.textContent = "Voted ✅";
    } else {
      span.className = "participant-vote estimating-icon";
      span.textContent = "⏳ Estimating...";
    }
  };

  /** Build the kick button — opens the reusable confirm modal on click. */
  const buildKickButton = (uid: string, user: User): HTMLElement => {
    const kickBtn = document.createElement("button");
    kickBtn.type = "button";
    kickBtn.className = "btn-kick";
    kickBtn.title = "เตะออกจากห้อง";
    kickBtn.setAttribute("aria-label", "เตะออกจากห้อง");
    kickBtn.textContent = "🥾";
    kickBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Read the current name from the DOM so a rejoin under a new name is reflected immediately
      const card = kickBtn.closest(".participant-card");
      const nameEl = card?.querySelector<HTMLElement>(".participant-name");
      const name = nameEl?.textContent || user.name || "Unknown";
      showConfirmModal({
        title: "เตะออกจากห้อง?",
        message: `จะเตะ ${name} ออกจากห้องทันที`,
        confirmText: "เตะ",
        onConfirm: () => handleKick(uid, name),
      });
    });
    return kickBtn;
  };

  const createCard = (uid: string, user: User, role: RoleKey): HTMLElement => {
    const isOnline = user.online !== false;
    const card = document.createElement("div");
    card.className =
      "participant-card slide-in" + (user.vote ? " voted" : "");
    card.dataset.uid = uid;

    const avatar = document.createElement("div");
    avatar.className = `participant-avatar ${role}`;
    avatar.textContent = roleIcons[role];

    const info = document.createElement("div");
    info.className = "participant-info";

    const nameEl = document.createElement("div");
    nameEl.className = "participant-name";
    nameEl.textContent = user.name || "Unknown";

    const voteSpan = document.createElement("span");
    updateVoteSpan(voteSpan, user, role);

    const statusDot = document.createElement("div");
    statusDot.className = `participant-status ${isOnline ? "online" : "offline"}`;

    info.appendChild(nameEl);
    info.appendChild(voteSpan);
    card.appendChild(avatar);
    card.appendChild(info);
    if (speakers.has(uid)) {
      const speakerLabel = document.createElement("div");
      speakerLabel.className =
        "speaker-label" + (locked ? " speaker-pulse" : "");
      speakerLabel.textContent = "📢 พูดเลยลูก";
      card.appendChild(speakerLabel);
    }
    if (isPO() && uid !== state.currentUid) {
      card.appendChild(buildKickButton(uid, user));
    }
    card.appendChild(statusDot);
    return card;
  };

  const renderGroup = (
    list: [string, User][],
    container: HTMLElement,
    role: RoleKey
  ) => {
    const existingCards = new Map<string, HTMLElement>();
    container
      .querySelectorAll<HTMLElement>(".participant-card")
      .forEach((el) => {
        existingCards.set(el.dataset.uid!, el);
      });

    const seenUids = new Set<string>();
    list.forEach(([uid, user]) => {
      seenUids.add(uid);
      const existing = existingCards.get(uid);

      if (existing) {
        const newClass = "participant-card" + (user.vote ? " voted" : "");
        if (existing.className !== newClass) existing.className = newClass;

        // Sync name (handles rejoin with a new name under the same uid)
        const nameEl = existing.querySelector<HTMLElement>(".participant-name");
        const newName = user.name || "Unknown";
        if (nameEl && nameEl.textContent !== newName) {
          nameEl.textContent = newName;
        }

        const voteSpan = existing.querySelector<HTMLElement>(
          "span.participant-vote"
        );
        if (voteSpan) updateVoteSpan(voteSpan, user, role);

        const statusDotEl = existing.querySelector<HTMLElement>(
          ".participant-status"
        );
        const isOnline = user.online !== false;
        const newStatusClass =
          "participant-status " + (isOnline ? "online" : "offline");
        if (statusDotEl && statusDotEl.className !== newStatusClass)
          statusDotEl.className = newStatusClass;

        const speakerLabel = existing.querySelector<HTMLElement>(
          ".speaker-label"
        );
        if (speakers.has(uid)) {
          if (!speakerLabel) {
            const label = document.createElement("div");
            label.className =
              "speaker-label" + (locked ? " speaker-pulse" : "");
            label.textContent = "📢 พูดเลยลูก";
            existing.insertBefore(
              label,
              existing.querySelector(".participant-status")
            );
          } else {
            speakerLabel.classList.toggle("speaker-pulse", locked);
          }
        } else if (speakerLabel) {
          speakerLabel.remove();
        }

        // Sync kick button: add/remove based on whether the current viewer is PO.
        // The confirm modal reads the name from the DOM at click time, so there's
        // no inline text to keep in sync here.
        const kickBtn = existing.querySelector<HTMLElement>(".btn-kick");
        const shouldHaveKick = isPO() && uid !== state.currentUid;
        if (shouldHaveKick && !kickBtn) {
          const btn = buildKickButton(uid, user);
          if (statusDotEl) existing.insertBefore(btn, statusDotEl);
          else existing.appendChild(btn);
        } else if (!shouldHaveKick && kickBtn) {
          kickBtn.remove();
        }
      } else {
        container.appendChild(createCard(uid, user, role));
      }
    });

    existingCards.forEach((el, uid) => {
      if (!seenUids.has(uid)) el.remove();
    });
  };

  renderGroup(grouped.team, colTeam, "po");
  renderGroup(grouped.dev, colDev, "dev");
  renderGroup(grouped.qa, colQa, "qa");
  renderGroup(grouped.ux, colUx, "ux");

  // Hide empty columns
  const colContainers = document.querySelector(".participants-columns")!;
  const hasPo = grouped.team.length > 0;
  const hasDev = grouped.dev.length > 0;
  const hasQa = grouped.qa.length > 0;
  const hasUx = grouped.ux.length > 0;
  const visibleCount =
    (hasPo ? 1 : 0) + (hasDev ? 1 : 0) + (hasQa ? 1 : 0) + (hasUx ? 1 : 0);
  colContainers.className = `participants-columns col-${visibleCount}`;
  (colTeam.closest(".participant-col") as HTMLElement).style.display = hasPo
    ? ""
    : "none";
  (colDev.closest(".participant-col") as HTMLElement).style.display = hasDev
    ? ""
    : "none";
  (colQa.closest(".participant-col") as HTMLElement).style.display = hasQa
    ? ""
    : "none";
  (colUx.closest(".participant-col") as HTMLElement).style.display = hasUx
    ? ""
    : "none";

  // (section ค่าเฉลี่ยถูกลบออกแล้ว — เหลือแค่การ์ดผู้เข้าร่วม + speaker picker)
}

function addRevoteButton(): void {
  const existing = document.getElementById("btn-revote");
  if (existing) return;

  const canUnlock = isPO();
  const revoteBtn = document.createElement("button");
  revoteBtn.id = "btn-revote";
  revoteBtn.className = "btn btn-revote";
  revoteBtn.textContent = canUnlock
    ? "🔓 Unlock · auto…"
    : "🔓 Auto-unlock…";
  // non-PO เห็น countdown ในปุ่มเหมือนกัน แต่กดไม่ได้ (disabled)
  if (!canUnlock) revoteBtn.disabled = true;
  revoteBtn.addEventListener("click", async () => {
    if (!state.currentRoom || !isPO()) return;
    cancelUnlockTimer();
    await update(ref(db, `rooms/${state.currentRoom}`), {
      revealed: false,
      locked: false,
      revealTime: null,
    });
    revoteBtn.remove();
    btnReveal.style.display = "";
  });
  btnReveal.parentNode!.appendChild(revoteBtn);
}
