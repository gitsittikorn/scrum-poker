export interface CardDef {
  value: string;
  /** Optional human-readable description shown under the point value on the card
   *  (e.g. "1 ชั่วโมง"). Empty string = show only the point value. */
  label: string;
}

export interface User {
  name: string;
  /** ชื่อจริงที่เลือกจาก member list (super admin tab Member) — ใช้ใน ClickUp + ห้อง Wheel
   *  null = ห้องที่ไม่บังคับ (Wheel/TQM) หรือข้อมูลเก่า → fallback เป็น name */
  realName?: string | null;
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
  /** ClickUp banner — PO วางลิงก์ task บนหัวห้อง + ปุ่มบันทึกเฉลี่ย Dev/QA ลงการ์ด */
  clickup: boolean;
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
  /** ClickUp task ที่ PO เลือกไว้ตอนนี้ — null = ยังไม่เลือก (real-time ทุกคนเห็น) */
  activeTask?: ActiveTask | null;
  /** โหมด session — "groom" (default): บันทึก field + comment, "pre": pre-groom ของ lead บันทึก comment อย่างเดียว */
  groomMode?: GroomMode;
}

/** โหมดการ groom ของห้อง — PO สลับเองผ่าน toggle บน banner ClickUp */
export type GroomMode = "groom" | "pre";

/** รายการประวัติการดึง task — push ที่ rooms/{roomId}/taskHistory/{pushId}
 *  (push key เรียงตามเวลา → ลำดับ ASC อัตโนมัติ) */
export interface TaskHistoryEntry {
  taskId: string;
  name: string;
  customId?: string | null;
  url: string;
  links?: TaskLink[];
  /** ชื่อคนที่กดดึง (ปกติคือ PO) */
  resolvedBy: string;
  resolvedAt: number;
  /** เวลาที่บันทึกลง ClickUp สำเร็จ (groom/pre) — ใช้คำนวณ duration, null = ยังไม่บันทึก */
  savedAt?: number | null;
  /** โหมดของรอบนั้น (จดตอนบันทึกสำเร็จ) — undefined = รายการเก่าก่อนมีการจด point */
  groomMode?: GroomMode | null;
  /** point ที่บันทึกลง ClickUp ของรอบนี้ (โหมด groom = เลขเดียว) · null = ไม่มีค่า
   *  ใช้รวมยอดในหน้า history — นับเฉพาะรอบล่าสุดของแต่ละการ์ด */
  dev?: number | null;
  qa?: number | null;
  /** ช่วง pre-groom เช่น "1-3" (โหมด pre) — แสดงใน history แต่ไม่เข้ายอดรวม */
  devRange?: string | null;
  qaRange?: string | null;
}

/** ลิงก์ที่ parse จาก description ของการ์ด ClickUp — แสดงเป็น icon ข้างชื่อ task
 *  brand (figma/sheets/docs/slides/drive/miro/github/clickup) = โลโก้สี
 *  ไฟล์ (image/pdf/file) + link = icon เส้นโทน theme */
export interface TaskLink {
  type:
    | "figma"
    | "sheets"
    | "docs"
    | "slides"
    | "drive"
    | "miro"
    | "github"
    | "clickup"
    | "image"
    | "pdf"
    | "file"
    | "link";
  url: string;
}

export interface ActiveTask {
  taskId: string;
  name: string;
  url: string;
  customId?: string | null;
  /** ชื่อคนที่ตั้ง task (ปกติคือ PO) */
  setBy: string;
  timestamp: number;
  /** ลิงก์จาก description (Figma/Sheets/Docs/generic) — snapshot ตอนกดดึง Task, สูงสุด 6 อัน */
  links?: TaskLink[];
  /** push key ของรายการ taskHistory รอบนี้ — ใช้ตอนบันทึก ClickUp เพื่อจดเวลา savedAt */
  historyKey?: string;
}

export interface CurrentUser {
  uid: string;
  name: string;
  /** ชื่อจริงจาก member list — เขียนลง users/{uid}.realName ตอน join */
  realName?: string | null;
}

/** รายชื่อสมาชิกถาวร (super admin tab Member) — เก็บที่ members/{pushId}
 *  อยู่นอก rooms/ → ไม่โดนลบตอนเคลียร์ข้อมูลทั้งหมด / scheduled cleanup
 *  "mk" = ทีม Monkey King — ไม่ใช่ role จริง ใช้เฉพาะ grouping ในห้อง Wheel
 *  (คนหนึ่งคนอยู่ได้ทั้งคอลัมน์ role และคอลัมน์ Monkey King) */
export type MemberRole = "po" | "dev" | "qa" | "ux" | "mk";

export interface Member {
  name: string;
  role: MemberRole;
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
  /** ClickUp — super admin คุมได้ว่าจะให้ PO เปิด/ปิดฟีเจอร์นี้ได้ไหม */
  clickup: boolean;
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
