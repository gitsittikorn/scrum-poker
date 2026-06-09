import { db, ref, set, get, update, remove } from "./firebase";
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
  resultSection,
  resultSummary,
  participantCount,
} from "./dom";
import { CARDS } from "./constants";
import { AUTO_UNLOCK_SECONDS } from "./config";
import { showToast, showNotVotedModal } from "./ui";
import { sendSystemMessage } from "./chat";

let unlockCountdownId: ReturnType<typeof setInterval> | null = null;
let countdownRemaining = 0;
let customPointInput: HTMLInputElement | null = null;

// ===== Auto-unlock Timer =====
export function cancelUnlockTimer(): void {
  if (unlockCountdownId) {
    clearInterval(unlockCountdownId);
    unlockCountdownId = null;
  }
  countdownRemaining = 0;
  const el = document.getElementById("countdown-text");
  if (el) el.remove();
}

function startUnlockTimer(seconds: number): void {
  cancelUnlockTimer();
  countdownRemaining = seconds;
  updateCountdownDisplay();

  unlockCountdownId = setInterval(() => {
    countdownRemaining--;
    if (countdownRemaining <= 0) {
      cancelUnlockTimer();
      countdownRemaining = 0;
      updateCountdownDisplay();
      if (state.currentRoom) {
        update(ref(db, `rooms/${state.currentRoom}`), { locked: false });
      }
      return;
    }
    updateCountdownDisplay();
  }, 1000);
}

function updateCountdownDisplay(): void {
  const revoteBtn = document.getElementById("btn-revote");
  if (!revoteBtn) return;
  let el = document.getElementById("countdown-text");
  if (!el) {
    el = document.createElement("div");
    el.id = "countdown-text";
    el.className = "countdown-text";
    revoteBtn.parentNode!.insertBefore(el, revoteBtn.nextSibling);
  }
  el.textContent = `Auto-unlock in ${countdownRemaining}s`;
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
    el.innerHTML = `
      <span class="card-value">${card.value}</span>
      <span class="card-label">${card.label}</span>
    `;
    el.addEventListener("click", () => handleVote(card.value));
    cardsContainer.appendChild(el);
  });

  const customCard = document.createElement("div");
  customCard.className = "poker-card custom-card";
  customCard.innerHTML = `
    <input type="number" id="custom-point-input" placeholder="..." min="0" step="0.5" maxlength="5">
    <span class="card-label">Custom<br>( Enter )</span>
  `;
  cardsContainer.appendChild(customCard);

  customPointInput = document.getElementById(
    "custom-point-input"
  ) as HTMLInputElement;

  customPointInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") handleCustomVote();
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
  await update(ref(db, `rooms/${state.currentRoom}`), {
    [`kicked/${targetUid}`]: true,
    [`users/${targetUid}`]: null,
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

  // Check if all online non-PO users have voted
  const notVoted = userList.filter(
    ([, user]) => user.online !== false && user.role !== "po" && user.vote == null
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
    Object.entries(users).forEach(([uid, user]) => {
      if (user.online === false) {
        updates[`users/${uid}`] = null;
      } else {
        updates[`users/${uid}/vote`] = null;
      }
    });
    updates["revealed"] = false;
    updates["locked"] = false;
    updates["drinkers"] = null; // Firebase field kept as "drinkers"
    await update(ref(db, `rooms/${state.currentRoom}`), updates);
  }

  state.selectedCard = null;
  document
    .querySelectorAll(".poker-card")
    .forEach((el) => el.classList.remove("selected"));
  if (customPointInput) customPointInput.value = "";
  showToast("Reset + offline users removed");
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
    if (isPO()) addRevoteButton();
    if (isPO() && !unlockCountdownId)
      startUnlockTimer(
        roomData.autoUnlockSeconds || AUTO_UNLOCK_SECONDS
      );
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

  type RoleKey = "po" | "dev" | "qa" | "ux";
  const roleIcons: Record<RoleKey, string> = {
    po: "📋",
    dev: "👨‍💻",
    qa: "🐛",
    ux: "🎨",
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
      const kickBtn = document.createElement("button");
      kickBtn.className = "btn-kick";
      kickBtn.title = "เตะออกจากห้อง";
      kickBtn.textContent = "🥾";
      kickBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(`เตะ ${user.name} ออกจากห้อง?`)) {
          handleKick(uid, user.name);
        }
      });
      card.appendChild(kickBtn);
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

  if (revealed) {
    showResults(userList);
  } else {
    resultSection.classList.add("hidden");
  }
}

function addRevoteButton(): void {
  const existing = document.getElementById("btn-revote");
  if (existing) return;

  const revoteBtn = document.createElement("button");
  revoteBtn.id = "btn-revote";
  revoteBtn.className = "btn btn-revote";
  revoteBtn.textContent = "🔓 Unlock for Revote";
  revoteBtn.addEventListener("click", async () => {
    if (!state.currentRoom || !isPO()) return;
    cancelUnlockTimer();
    await update(ref(db, `rooms/${state.currentRoom}`), {
      revealed: false,
      locked: false,
    });
    revoteBtn.remove();
    btnReveal.style.display = "";
  });
  btnReveal.parentNode!.appendChild(revoteBtn);
}

function showResults(userList: [string, User][]): void {
  resultSection.classList.remove("hidden");

  const grouped = groupUsers(userList);

  const calcAvg = (
    list: [string, User][]
  ): { avg: number; count: number } => {
    const nums = list
      .filter(([, u]) => u.vote != null)
      .map(([, u]) => parseFloat(u.vote!))
      .filter((n) => !isNaN(n));
    if (nums.length === 0) return { avg: 0, count: 0 };
    return {
      avg:
        Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10,
      count: nums.length,
    };
  };

  const po = calcAvg(grouped.team);
  const dev = calcAvg(grouped.dev);
  const qa = calcAvg(grouped.qa);
  const ux = calcAvg(grouped.ux);

  const calcConsensus = (
    list: [string, User][],
    role: string
  ): { match: boolean; msg: string } => {
    const nums = list
      .filter(([, u]) => u.vote != null)
      .map(([, u]) => parseFloat(u.vote!))
      .filter((n) => !isNaN(n));
    if (nums.length === 0) return { match: true, msg: "" };
    if (list.length === 1) {
      const name = list[0][1].name || "Unknown";
      return { match: true, msg: `${name} รับจบ สวยๆ` };
    }
    const allSame = nums.every((v) => v === nums[0]);
    if (allSame) return { match: true, msg: `${role} จิตใจตรงกัน` };
    return { match: false, msg: `${role} คุยกันหน่อย` };
  };

  const poResult = calcConsensus(grouped.team, "PO");
  const devResult = calcConsensus(grouped.dev, "Dev");
  const qaResult = calcConsensus(grouped.qa, "QA");
  const uxResult = calcConsensus(grouped.ux, "UX/UI");

  const consensusClass = (r: { match: boolean; msg: string }) =>
    r.msg ? (r.match ? "yes" : "no") : "";

  const newHtml = `
    <div class="avg-columns col-${(po.count > 0 ? 1 : 0) + (dev.count > 0 ? 1 : 0) + (qa.count > 0 ? 1 : 0) + (ux.count > 0 ? 1 : 0)}">
      ${po.count > 0 ? `<div class="avg-col">
        <div class="avg-value po">${po.avg}</div>
        <div class="avg-label po">PO</div>
        <div class="consensus-role ${consensusClass(poResult)}">${poResult.msg || "—"}</div>
      </div>` : ""}
      ${dev.count > 0 ? `<div class="avg-col">
        <div class="avg-value dev">${dev.avg}</div>
        <div class="avg-label dev">Dev</div>
        <div class="consensus-role ${consensusClass(devResult)}">${devResult.msg || "—"}</div>
      </div>` : ""}
      ${qa.count > 0 ? `<div class="avg-col">
        <div class="avg-value qa">${qa.avg}</div>
        <div class="avg-label qa">QA</div>
        <div class="consensus-role ${consensusClass(qaResult)}">${qaResult.msg || "—"}</div>
      </div>` : ""}
      ${ux.count > 0 ? `<div class="avg-col">
        <div class="avg-value ux">${ux.avg}</div>
        <div class="avg-label ux">UX/UI</div>
        <div class="consensus-role ${consensusClass(uxResult)}">${uxResult.msg || "—"}</div>
      </div>` : ""}
    </div>
  `;
  if (resultSummary.innerHTML !== newHtml) resultSummary.innerHTML = newHtml;
}
