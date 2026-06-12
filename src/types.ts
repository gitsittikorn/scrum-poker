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
  revealTime: number;
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
