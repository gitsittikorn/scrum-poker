import {
  db,
  auth,
  ref,
  set,
  get,
  remove,
  update,
  onValue,
  onDisconnect,
  serverTimestamp,
  signInAnonymously,
  onAuthStateChanged,
} from "./firebase";

// ===== Types =====
interface CardDef {
  value: string;
  label: string;
}

interface User {
  name: string;
  role: string;
  vote: string | null;
  online: boolean;
  lastSeen: number;
}

interface RoomData {
  createdAt: number;
  revealed: boolean;
  locked: boolean;
  autoUnlockSeconds: number;
  revealTime: number;
  users: Record<string, User>;
}

interface CurrentUser {
  uid: string;
  name: string;
}

// ===== Constants =====
const CARDS: CardDef[] = [
  { value: "0", label: "Free" },
  { value: "0.1", label: "24 นาที" },
  { value: "0.3", label: "1 ชั่วโมง" },
  { value: "0.5", label: "2 ชั่วโมง" },
  { value: "1", label: "4 ชั่วโมง" },
  { value: "2", label: "1 วัน" },
  { value: "3", label: "1.5 วัน" },
  { value: "4", label: "2 วัน" },
  { value: "5", label: "2.5 วัน" },
  { value: "8", label: "4 วัน" },
  { value: "13", label: "ผีหลอก" },
  { value: "21", label: "เสร็จกันยา" },
];

const TOAST_DURATION = 3000;
const APP_VERSION = "2025-05-09-v2";
const DEFAULT_AUTO_UNLOCK_SECONDS = 20;

// ===== State =====
let currentRoom: string | null = null;
let currentUser: CurrentUser | null = null;
let currentUid: string | null = null;
let selectedCard: string | null = null;
let currentRole: string | null = null;
let unlockCountdownId: ReturnType<typeof setInterval> | null = null;
let countdownRemaining = 0;
const isPO = (): boolean => currentRole === "po";

// ===== DOM Elements =====
const $ = (id: string): HTMLElement => document.getElementById(id)!;

const landingPage = $("landing-page");
const roomPage = $("room-page");
const usernameInput = $("username-input") as HTMLInputElement;
const roleSelect = $("role-select") as HTMLSelectElement;
const roomSelect = $("room-select") as HTMLSelectElement;
const btnJoinRoom = $("btn-join-room") as HTMLButtonElement;
const btnLeave = $("btn-leave") as HTMLButtonElement;
const btnHome = $("btn-home") as HTMLButtonElement;
const btnCopyLink = $("btn-copy-link") as HTMLButtonElement;
const btnToggleTheme = $("btn-toggle-theme") as HTMLButtonElement;
const roomCodeDisplay = $("room-code-display");
const userBadge = $("user-badge");
const cardsContainer = $("cards-container");
let customPointInput: HTMLInputElement;
let btnCustomVote: HTMLButtonElement;
const votingStatus = $("voting-status");
const statusDot = votingStatus.querySelector(".status-dot")!;
const statusText = votingStatus.querySelector(".status-text")!;
const btnReveal = $("btn-reveal") as HTMLButtonElement;
const btnReset = $("btn-reset") as HTMLButtonElement;
const btnDeleteRoom = $("btn-delete-room") as HTMLButtonElement;
const participantCount = $("participant-count");
const colTeam = $("col-team");
const colDev = $("col-dev");
const colQa = $("col-qa");
const colUx = $("col-ux");
const resultSection = $("result-section");
const resultSummary = $("result-summary");
const toastEl = $("toast");
const btnSettings = $("btn-settings") as HTMLButtonElement;
const settingsModal = $("settings-modal") as HTMLElement;
const settingsInput = $("settings-auto-unlock") as HTMLInputElement;
const btnSettingsSave = $("btn-settings-save") as HTMLButtonElement;
const btnSettingsClose = $("btn-settings-close") as HTMLButtonElement;

// ===== Init =====
function init(): void {
  checkVersion();
  loadUsername();
  loadTheme();
  loadSettings();
  renderCards();
  bindEvents();
  checkUrlRoom();
  btnJoinRoom.disabled = true;
  btnJoinRoom.textContent = "กำลังเชื่อมต่อ...";
  initAuth().then(() => {
    btnJoinRoom.disabled = false;
    btnJoinRoom.textContent = "เข้าร่วมห้อง";
    autoRejoinFromUrl();
  });
}

function checkVersion(): void {
  const savedVersion = localStorage.getItem("scrum-poker-version");
  if (savedVersion !== APP_VERSION) {
    console.log("[Init] Version changed, clearing local session");
    localStorage.removeItem("scrum-poker-room");
    localStorage.setItem("scrum-poker-version", APP_VERSION);
  }
}

function loadUsername(): void {
  const saved = localStorage.getItem("scrum-poker-username");
  if (saved) usernameInput.value = saved;
  const savedRole = localStorage.getItem("scrum-poker-role");
  if (savedRole) roleSelect.value = savedRole;
}

function saveUsername(name: string): void {
  localStorage.setItem("scrum-poker-username", name);
  localStorage.setItem("scrum-poker-role", roleSelect.value);
}

function loadTheme(): void {
  const saved = localStorage.getItem("scrum-poker-theme");
  if (saved === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    btnToggleTheme.textContent = "🌙";
  }
  // default is dark (set in HTML)
}

function loadSettings(): void {
  // auto-unlock timeout is stored per-room in Firebase, not localStorage
}

function toggleTheme(): void {
  const isDark =
    document.documentElement.getAttribute("data-theme") !== "light";
  const next = isDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("scrum-poker-theme", next);
  btnToggleTheme.textContent = isDark ? "🌙" : "☀️";
}

function checkUrlRoom(): void {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) {
    const options = roomSelect.options;
    for (let i = 0; i < options.length; i++) {
      if (options[i].value === room) {
        roomSelect.value = room;
        break;
      }
    }
  }
}

async function initAuth(): Promise<void> {
  try {
    const result = await signInAnonymously(auth);
    currentUid = result.user.uid;
    console.log("[Auth] Signed in:", currentUid);
  } catch (err) {
    console.error("[Auth] Error:", err);
  }
}

async function autoRejoinFromUrl(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  const savedUsername = localStorage.getItem("scrum-poker-username");
  const savedRole = localStorage.getItem("scrum-poker-role");
  if (!roomFromUrl || !savedUsername || !currentUid) return;

  console.log("[AutoJoin] From URL:", roomFromUrl);
  currentUser = { uid: currentUid, name: savedUsername };

  const options = roomSelect.options;
  for (let i = 0; i < options.length; i++) {
    if (options[i].value === roomFromUrl) {
      roomSelect.value = roomFromUrl;
      break;
    }
  }

  try {
    const roomRef = ref(db, `rooms/${roomFromUrl}`);
    const snap = await get(roomRef);
    if (snap.exists()) {
      await joinRoom(roomFromUrl, false);
    }
  } catch (err) {
    console.error("[AutoJoin] Error:", err);
  }
}

// ===== Events =====
function bindEvents(): void {
  btnJoinRoom.addEventListener("click", handleJoinRoom);
  btnLeave.addEventListener("click", handleLeave);
  btnHome.addEventListener("click", handleLeave);
  btnCopyLink.addEventListener("click", handleCopyLink);
  btnToggleTheme.addEventListener("click", toggleTheme);
  btnSettings.addEventListener("click", async () => {
    if (!currentRoom) return;
    const snap = await get(ref(db, `rooms/${currentRoom}/autoUnlockSeconds`));
    settingsInput.value = String(snap.exists() ? snap.val() : DEFAULT_AUTO_UNLOCK_SECONDS);
    settingsModal.classList.add("active");
  });
  btnSettingsClose.addEventListener("click", () => {
    settingsModal.classList.remove("active");
  });
  btnSettingsSave.addEventListener("click", async () => {
    const val = parseInt(settingsInput.value, 10);
    if (val >= 5 && currentRoom) {
      await update(ref(db, `rooms/${currentRoom}`), { autoUnlockSeconds: val });
      settingsModal.classList.remove("active");
      showToast(`Auto-unlock set to ${val}s`);
    } else {
      showToast("Minimum 5 seconds");
    }
  });
  settingsInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") btnSettingsSave.click();
  });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove("active");
  });
  btnReveal.addEventListener("click", handleReveal);
  btnReset.addEventListener("click", handleReset);
  btnDeleteRoom.addEventListener("click", () => {
    if (confirm("ต้องการลบห้องทั้งหมด? ทุกคนจะถูกออกจากห้อง")) {
      handleDeleteRoom();
    }
  });

  usernameInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") roomSelect.focus();
  });

  window.addEventListener("beforeunload", () => {
    if (!currentRoom || !currentUser) return;
    set(
      ref(db, `rooms/${currentRoom}/users/${currentUser.uid}/online`),
      false
    );
  });
}

// ===== Room Management =====
async function handleJoinRoom(): Promise<void> {
  const username = usernameInput.value.trim();
  const roomCode = roomSelect.value;
  if (!username) {
    showToast("Please enter your name");
    usernameInput.focus();
    return;
  }
  if (!roomCode) {
    showToast("Please select a room");
    roomSelect.focus();
    return;
  }
  if (!currentUid) {
    return;
  }

  saveUsername(username);
  localStorage.setItem("scrum-poker-room", roomCode);
  const role = roleSelect.value;
  currentUser = { uid: currentUid, name: username };

  try {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const snap = await get(roomRef);
    if (!snap.exists()) {
      await set(roomRef, {
        createdAt: serverTimestamp(),
        revealed: false,
        locked: false,
        autoUnlockSeconds: DEFAULT_AUTO_UNLOCK_SECONDS,
      });
    }
    await joinRoom(roomCode, true);
    window.history.replaceState(null, "", `?room=${roomCode}`);
  } catch (err) {
    console.error("[Join] Error:", err);
    showToast("Failed to join room — check Firebase config");
  }
}

async function joinRoom(
  roomCode: string,
  clearVote: boolean = true
): Promise<void> {
  currentRoom = roomCode;
  currentRole = roleSelect.value;
  const selectedOption = roomSelect.options[roomSelect.selectedIndex];
  roomCodeDisplay.textContent = selectedOption ? selectedOption.text : roomCode;

  let existingVote: string | null = null;
  if (!clearVote) {
    const existingSnap = await get(
      ref(db, `rooms/${roomCode}/users/${currentUser!.uid}`)
    );
    if (existingSnap.exists()) {
      existingVote = existingSnap.val().vote ?? null;
    }
  }
  selectedCard = clearVote ? null : existingVote;

  const userRef = ref(db, `rooms/${roomCode}/users/${currentUser!.uid}`);
  await set(userRef, {
    name: currentUser!.name,
    role: roleSelect.value,
    vote: clearVote ? null : existingVote,
    online: true,
    lastSeen: serverTimestamp(),
  });

  const presenceRef = ref(
    db,
    `rooms/${roomCode}/users/${currentUser!.uid}/online`
  );
  await onDisconnect(presenceRef).set(false);

  // Show user badge
  const role = roleSelect.value;
  const roleIcon = role === "dev" ? "👨‍💻" : role === "qa" ? "🐛" : role === "ux" ? "🎨" : "📋";
  const roleName = role === "dev" ? "Dev" : role === "qa" ? "QA" : role === "ux" ? "UX/UI" : "PO";
  userBadge.className = `user-badge ${role}`;
  userBadge.innerHTML = `${roleIcon} ${escapeHtml(currentUser!.name)} <span class="user-role">(${roleName})</span>`;

  showPage("room");
  listenRoom();
}

// ===== Auto-unlock Timer =====
function cancelUnlockTimer(): void {
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
      if (currentRoom) {
        update(ref(db, `rooms/${currentRoom}`), { locked: false });
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

function handleLeave(): void {
  if (!currentRoom || !currentUser) return;
  cancelUnlockTimer();
  remove(ref(db, `rooms/${currentRoom}/users/${currentUser.uid}`));
  localStorage.removeItem("scrum-poker-room");
  currentRoom = null;
  currentUser = null;
  selectedCard = null;
  showPage("landing");
  window.history.replaceState(null, "", window.location.pathname);
}

function handleCopyLink(): void {
  if (!currentRoom) return;
  const url = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
  navigator.clipboard.writeText(url).then(() => showToast("Link copied!"));
}

// ===== Realtime Listeners =====
function listenRoom(): void {
  const roomStateRef = ref(db, `rooms/${currentRoom}`);
  onValue(roomStateRef, (snap) => {
    if (!snap.exists()) {
      showToast("Room closed");
      handleLeave();
      return;
    }
    updateUI(snap.val() as RoomData);
  });
}

// ===== Voting =====
function renderCards(): void {
  cardsContainer.innerHTML = "";
  CARDS.forEach((card, i) => {
    // Line break after "3" (index 6)
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

  // Custom input as last card
  const customCard = document.createElement("div");
  customCard.className = "poker-card custom-card";
  customCard.innerHTML = `
    <input type="number" id="custom-point-input" placeholder="..." min="0" step="0.5">
    <span class="card-label">Custom<br>( Enter )</span>
  `;
  cardsContainer.appendChild(customCard);

  customPointInput = document.getElementById("custom-point-input") as HTMLInputElement;
  btnCustomVote = document.getElementById("btn-custom-vote") as HTMLButtonElement;

  customPointInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") handleCustomVote();
  });
  customPointInput.addEventListener("click", (e: Event) => {
    e.stopPropagation();
  });
  customCard.addEventListener("click", () => customPointInput.focus());
}

async function handleVote(value: string): Promise<void> {
  if (!currentRoom || !currentUser) return;

  const roomSnap = await get(ref(db, `rooms/${currentRoom}`));
  if (roomSnap.exists() && (roomSnap.val() as RoomData).locked) {
    showToast("Voting is locked");
    return;
  }

  selectedCard = value;
  document.querySelectorAll(".poker-card").forEach((el) => {
    el.classList.toggle(
      "selected",
      (el as HTMLElement).dataset.value === value
    );
  });
  customPointInput.value = "";

  await set(
    ref(db, `rooms/${currentRoom}/users/${currentUser.uid}/vote`),
    value
  );
}

async function handleCustomVote(): Promise<void> {
  const value = customPointInput.value.trim();
  if (!value || !currentRoom || !currentUser) return;

  const roomSnap = await get(ref(db, `rooms/${currentRoom}`));
  if (roomSnap.exists() && (roomSnap.val() as RoomData).locked) {
    showToast("Voting is locked");
    return;
  }

  selectedCard = value;
  document.querySelectorAll(".poker-card").forEach((el) => {
    el.classList.remove("selected");
  });

  await set(
    ref(db, `rooms/${currentRoom}/users/${currentUser.uid}/vote`),
    value
  );
  customPointInput.value = "";
  showToast("Voted: " + value);
}

async function handleReveal(): Promise<void> {
  if (!currentRoom || !isPO()) return;
  await update(ref(db, `rooms/${currentRoom}`), {
    revealed: true,
    locked: true,
  });
}

async function handleReset(): Promise<void> {
  if (!currentRoom || !isPO()) return;
  cancelUnlockTimer();

  const usersSnap = await get(ref(db, `rooms/${currentRoom}/users`));
  if (usersSnap.exists()) {
    const updates: Record<string, unknown> = {};
    const users = usersSnap.val() as Record<string, User>;
    Object.entries(users).forEach(([uid, user]) => {
      if (user.online === false) {
        // Remove offline users
        updates[`users/${uid}`] = null;
      } else {
        // Clear votes for online users
        updates[`users/${uid}/vote`] = null;
      }
    });
    updates["revealed"] = false;
    updates["locked"] = false;
    await update(ref(db, `rooms/${currentRoom}`), updates);
  }

  selectedCard = null;
  document
    .querySelectorAll(".poker-card")
    .forEach((el) => el.classList.remove("selected"));
  customPointInput.value = "";
  showToast("Reset + offline users removed");
}

async function handleDeleteRoom(): Promise<void> {
  if (!currentRoom) return;
  await remove(ref(db, `rooms/${currentRoom}`));
  handleLeave();
  showToast("Room deleted");
}

// ===== Grouping Helper =====
type Role = "team" | "dev" | "qa" | "ux";

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

interface GroupedUsers {
  team: [string, User][];
  dev: [string, User][];
  qa: [string, User][];
  ux: [string, User][];
}

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

// ===== UI Updates =====
function updateUI(roomData: RoomData): void {
  const users = roomData.users || {};
  const revealed = roomData.revealed || false;
  const locked = roomData.locked || false;
  const userList = Object.entries(users);

  // Admin controls — only PO can reveal/reset/delete/unlock
  const adminVisible = isPO() ? "" : "none";
  btnReveal.style.display = adminVisible;
  btnReset.style.display = adminVisible;
  btnDeleteRoom.style.display = adminVisible;

  // Voting status
  if (locked && revealed) {
    statusDot.className = "status-dot locked";
    statusText.textContent = "Voting locked — Results revealed";
    if (isPO()) btnReveal.style.display = "none";
    if (isPO()) addRevoteButton();
    if (isPO() && !unlockCountdownId) startUnlockTimer(roomData.autoUnlockSeconds || DEFAULT_AUTO_UNLOCK_SECONDS);
  } else if (locked) {
    statusDot.className = "status-dot locked";
    statusText.textContent = "Voting locked";
    if (isPO()) btnReveal.style.display = "none";
  } else {
    cancelUnlockTimer();
    const hasVoted = currentUser && users[currentUser.uid]?.vote !== null;
    statusDot.className = hasVoted ? "status-dot voted" : "status-dot";
    statusText.textContent = hasVoted
      ? "Voted! You can change your vote"
      : "Select your estimate";
    const existing = document.getElementById("btn-revote");
    if (existing) existing.remove();
  }

  // Cards + custom input disabled state
  const disableVoting = locked;
  document.querySelectorAll(".poker-card").forEach((el) => {
    el.classList.toggle("disabled", disableVoting);
  });
  if (customPointInput) {
    customPointInput.disabled = disableVoting;
  }

  // Highlight my current vote
  if (currentUser && users[currentUser.uid]) {
    const myVote = users[currentUser.uid].vote;
    selectedCard = myVote;
    document.querySelectorAll(".poker-card").forEach((el) => {
      el.classList.toggle(
        "selected",
        (el as HTMLElement).dataset.value === myVote
      );
    });
  }

  // Participants — diff-based update to avoid flickering
  const grouped = groupUsers(userList);
  participantCount.textContent = String(userList.length);

  type RoleKey = "po" | "dev" | "qa" | "ux";
  const roleIcons: Record<RoleKey, string> = {
    po: "📋",
    dev: "👨‍💻",
    qa: "🐛",
    ux: "🎨",
  };

  const updateVoteSpan = (span: HTMLElement, user: User, role: RoleKey) => {
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
    card.className = "participant-card slide-in" + (user.vote ? " voted" : "");
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
    card.appendChild(statusDot);
    return card;
  };

  const renderGroup = (list: [string, User][], container: HTMLElement, role: RoleKey) => {
    const existingCards = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>(".participant-card").forEach((el) => {
      existingCards.set(el.dataset.uid!, el);
    });

    const seenUids = new Set<string>();
    list.forEach(([uid, user]) => {
      seenUids.add(uid);
      const existing = existingCards.get(uid);

      if (existing) {
        const newClass = "participant-card" + (user.vote ? " voted" : "");
        if (existing.className !== newClass) existing.className = newClass;

        const voteSpan = existing.querySelector<HTMLElement>("span.participant-vote");
        if (voteSpan) updateVoteSpan(voteSpan, user, role);

        const statusDot = existing.querySelector<HTMLElement>(".participant-status");
        const isOnline = user.online !== false;
        const newStatusClass = "participant-status " + (isOnline ? "online" : "offline");
        if (statusDot && statusDot.className !== newStatusClass) statusDot.className = newStatusClass;
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
  const visibleCount = (hasPo ? 1 : 0) + (hasDev ? 1 : 0) + (hasQa ? 1 : 0) + (hasUx ? 1 : 0);
  colContainers.className = `participants-columns col-${visibleCount}`;
  (colTeam.closest(".participant-col") as HTMLElement).style.display = hasPo ? "" : "none";
  (colDev.closest(".participant-col") as HTMLElement).style.display = hasDev ? "" : "none";
  (colQa.closest(".participant-col") as HTMLElement).style.display = hasQa ? "" : "none";
  (colUx.closest(".participant-col") as HTMLElement).style.display = hasUx ? "" : "none";

  // Result section
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
    if (!currentRoom || !isPO()) return;
    cancelUnlockTimer();
    await update(ref(db, `rooms/${currentRoom}`), {
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

  const calcAvg = (list: [string, User][]): { avg: number; count: number } => {
    const nums = list
      .filter(([, u]) => u.vote != null)
      .map(([, u]) => parseFloat(u.vote!))
      .filter((n) => !isNaN(n));
    if (nums.length === 0) return { avg: 0, count: 0 };
    return {
      avg: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10,
      count: nums.length,
    };
  };

  const po = calcAvg(grouped.team);
  const dev = calcAvg(grouped.dev);
  const qa = calcAvg(grouped.qa);
  const ux = calcAvg(grouped.ux);

  const calcConsensus = (list: [string, User][], role: string): { match: boolean; msg: string } => {
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

// ===== Helpers =====
function showPage(page: "landing" | "room"): void {
  landingPage.classList.remove("active");
  roomPage.classList.remove("active");
  if (page === "landing") landingPage.classList.add("active");
  else roomPage.classList.add("active");
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

let toastTimeout: ReturnType<typeof setTimeout>;
function showToast(msg: string): void {
  clearTimeout(toastTimeout);
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  toastEl.classList.add("show");
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => toastEl.classList.add("hidden"), 300);
  }, TOAST_DURATION);
}

// ===== Start =====
document.addEventListener("DOMContentLoaded", init);
