export const $ = (id: string): HTMLElement => document.getElementById(id)!;

export const landingPage = $("landing-page");
export const roomPage = $("room-page");
export const usernameInput = $("username-input") as HTMLInputElement;
export const roleSelect = $("role-select") as HTMLSelectElement;
export const roomSelect = $("room-select") as HTMLSelectElement;
export const btnJoinRoom = $("btn-join-room") as HTMLButtonElement;
export const btnLeave = $("btn-leave") as HTMLButtonElement;
export const btnHome = $("btn-home") as HTMLButtonElement;
export const btnCopyLink = $("btn-copy-link") as HTMLButtonElement;
export const btnToggleTheme = $("btn-toggle-theme") as HTMLButtonElement;
export const roomCodeDisplay = $("room-code-display");
export const userBadge = $("user-badge");
export const cardsContainer = $("cards-container");
export const votingStatus = $("voting-status");
export const statusDot = votingStatus.querySelector(".status-dot")!;
export const statusText = votingStatus.querySelector(".status-text")!;
export const btnReveal = $("btn-reveal") as HTMLButtonElement;
export const btnReset = $("btn-reset") as HTMLButtonElement;
export const btnDeleteRoom = $("btn-delete-room") as HTMLButtonElement;
export const participantCount = $("participant-count");
export const colTeam = $("col-team");
export const colDev = $("col-dev");
export const colQa = $("col-qa");
export const colUx = $("col-ux");
export const resultSection = $("result-section");
export const resultSummary = $("result-summary");
export const toastEl = $("toast");
export const btnSettings = $("btn-settings") as HTMLButtonElement;
export const settingsModal = $("settings-modal") as HTMLElement;
export const settingsInput = $("settings-auto-unlock") as HTMLInputElement;
export const btnSettingsSave = $("btn-settings-save") as HTMLButtonElement;
export const btnSettingsClose = $("btn-settings-close") as HTMLButtonElement;
export const roomBanner = $("room-banner");
export const chatPanel = $("chat-panel");
export const chatMessages = $("chat-messages");
export const chatInput = $("chat-input") as HTMLInputElement;
export const btnChatSend = $("btn-chat-send") as HTMLButtonElement;
export const btnChatClose = $("btn-chat-close") as HTMLButtonElement;
export const chatUnreadBadge = $("bar-chat-unread");
export const chatTyping = $("chat-typing");
export const chatReplyBar = $("chat-reply-bar");
export const replyToName = $("reply-to-name");
export const replyToText = $("reply-to-text");
export const btnCancelReply = $("btn-cancel-reply") as HTMLButtonElement;
export const btnEmoji = $("btn-emoji") as HTMLButtonElement;
export const emojiPicker = $("emoji-picker");
export const floatingReactions = $("floating-reactions");
export const btnBarChat = $("btn-bar-chat") as HTMLButtonElement;
export const btnBarReact = $("btn-bar-react") as HTMLButtonElement;
export const reactPickerBar = $("react-picker-bar");
export const btnBarSound = $("btn-bar-sound") as HTMLButtonElement;
export const soundPickerBar = $("sound-picker-bar");

// Admin settings
export const adminSettings = $("admin-settings");
export const featurePoker = $("feature-poker") as HTMLInputElement;
export const featureChat = $("feature-chat") as HTMLInputElement;
export const featureReact = $("feature-react") as HTMLInputElement;
export const featureSound = $("feature-sound") as HTMLInputElement;
export const featureWheel = $("feature-wheel") as HTMLInputElement;
export const cleanupTimeInput = $("cleanup-time") as HTMLInputElement;

// User settings
export const userSettings = $("user-settings");
export const muteOthersSound = $("mute-others-sound") as HTMLInputElement;

// DB Report
export const btnDbReport = $("btn-db-report") as HTMLButtonElement;
export const dbReportModal = $("db-report-modal") as HTMLElement;
export const btnDbReportClose = $("btn-db-report-close") as HTMLButtonElement;

// Wheel
export const btnWheel = $("btn-wheel") as HTMLButtonElement;
export const wheelPanel = $("wheel-panel");
export const btnWheelClose = $("btn-wheel-close") as HTMLButtonElement;
export const wheelCanvas = $("wheel-canvas") as HTMLCanvasElement;
export const wheelCanvasContainer = $("wheel-canvas-container");
export const wheelWinnerDisplay = $("wheel-winner-display");
export const wheelMemberList = $("wheel-member-list");
export const wheelAddInput = $("wheel-add-input") as HTMLInputElement;
export const btnWheelAdd = $("btn-wheel-add") as HTMLButtonElement;
export const btnWheelSpin = $("btn-wheel-spin") as HTMLButtonElement;
export const btnWheelShuffle = $("btn-wheel-shuffle") as HTMLButtonElement;
export const btnWheelReset = $("btn-wheel-reset") as HTMLButtonElement;
export const btnWheelClear = $("btn-wheel-clear") as HTMLButtonElement;
export const wheelDuplicateSelect = $("wheel-duplicate-select") as HTMLSelectElement;
export const wheelRemoveWinnerToggle = $("wheel-remove-winner") as HTMLInputElement;
export const wheelAutoShuffleToggle = $("wheel-auto-shuffle") as HTMLInputElement;
export const wheelEntryCount = $("wheel-entry-count");
