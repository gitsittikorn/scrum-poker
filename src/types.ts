export interface CardDef {
  value: string;
  label: string;
}

export interface User {
  name: string;
  role: string;
  vote: string | null;
  online: boolean;
  lastSeen: number;
}

export interface FeatureFlags {
  poker: boolean;
  chat: boolean;
  react: boolean;
  sound: boolean;
  wheel: boolean;
}

export interface RoomData {
  createdAt: number;
  revealed: boolean;
  locked: boolean;
  autoUnlockSeconds: number;
  /** Server timestamp ตอน PO reveal — ใช้คำนวณเวลา auto-unlock ที่เหลือ (resilient ต่อ reload/leave) */
  revealTime?: number;
  users: Record<string, User>;
  /** Firebase field kept as "drinkers" for backward compat; conceptually = speakers who must explain */
  drinkers?: Record<string, boolean>;
  /** Per-room feature flags — absent means all enabled */
  features?: FeatureFlags;
  /** UIDs of users kicked from this room — cleared on rejoin or room cleanup */
  kicked?: Record<string, boolean>;
}

export interface CurrentUser {
  uid: string;
  name: string;
}

export interface ChatMessage {
  text: string;
  senderName: string;
  senderUid: string;
  senderRole: string;
  type: "user" | "system";
  timestamp: number;
  replyTo?: { msgId?: string; senderName: string; text: string } | null;
  reactions?: Record<string, Record<string, string>> | null;
}

export interface FeaturePermissions {
  poker: boolean;
  chat: boolean;
  react: boolean;
  sound: boolean;
  wheel: boolean;
}

export type Role = "team" | "dev" | "qa" | "ux";

export interface GroupedUsers {
  team: [string, User][];
  dev: [string, User][];
  qa: [string, User][];
  ux: [string, User][];
}

/** Options for the reusable confirm / warning modal (see showConfirmModal in ui.ts) */
export interface ConfirmModalOptions {
  title: string;
  message: string;
  /** Confirm button label (default "ยืนยัน") */
  confirmText?: string;
  /** Cancel button label (default "ยกเลิก") */
  cancelText?: string;
  /** true = destructive styling (red confirm button + ⚠️ header). Default false. */
  danger?: boolean;
  /** Called when the user confirms */
  onConfirm?: () => void | Promise<void>;
}
