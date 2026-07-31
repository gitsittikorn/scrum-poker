export interface CardDef {
  value: string;
  /** Optional human-readable description shown under the point value on the card
   *  (e.g. "1 ชั่วโมง"). Empty string = show only the point value. */
  label: string;
}

export interface User {
  name: string;
  role: string;
  vote: string | null;
  online: boolean;
  lastSeen: number;
  /** true when the user clicked the Leave button (intentional exit).
   *  Record is kept for wheel/history; user is hidden from the poker
   *  participants list. Cleared on rejoin (set() replaces the whole object). */
  left?: boolean;
}

export interface FeatureFlags {
  poker: boolean;
  chat: boolean;
  react: boolean;
  sound: boolean;
  wheel: boolean;
  /** Speaker Rotate — ON: weighted random + โชว์ไมค์ count + ปุ่มล้าง. OFF: uniform random (ของเดิม) + ซ่อนหมด */
  speakerRotate: boolean;
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
  /** นับจำนวนครั้งที่แต่ละ uid ถูกสุ่มให้พูด (round-robin) — mirror แบบ wheelHistory, แยก node ที่ rooms/{roomId}/speakerCounts */
  speakerCounts?: Record<string, number>;
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
  /** Speaker Rotate — super admin คุมได้ว่าจะให้ PO เปิด/ปิดฟีเจอร์นี้ได้ไหม */
  speakerRotate: boolean;
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
