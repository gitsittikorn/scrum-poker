import type { CardDef } from "./types";

export const CARDS: CardDef[] = [
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

export const SUPER_ADMIN_NAME = "admin889";

export const APP_VERSION = "2026-06-22-v3";

export const EMOJIS = [
  "😀", "😂", "🤣", "😊", "😅", "😎", "🤔", "😏", "🙄", "🥳", "🤩", "😤",
  "👍", "👎", "👊", "🤝", "👏", "✌️", "🤞", "👋",
  "❤️", "🔥", "💯", "⭐", "🎯", "✅", "❌", "🚀", "💡", "🏆", "🎉", "⚡",
  "👀", "🫡", "💪", "🤦", "🤷", "🙈", "💀", "🤖",
];

export interface SoundDef {
  file: string;
  label: string;
  emoji: string;
}

export const SOUNDS: SoundDef[] = [
  { file: "OMG.mp3", label: "OMG", emoji: "😱" },
  { file: "เกิดอะไรขึ้น.mp3", label: "เกิดอะไรขึ้น", emoji: "🤨" },
  { file: "แกไม่รอดแน่.mp3", label: "แกไม่รอด", emoji: "☠️" },
  { file: "ของขึ้น.mp3", label: "ของขึ้น", emoji: "🚀" },
  { file: "ของดี.mp3", label: "ของดี", emoji: "👍" },
  { file: "คิดได้อย่างไร.mp3", label: "คิดได้อย่างไร", emoji: "🤯" },
  { file: "จ้ะเอ๋.mp3", label: "จ้ะเอ๋", emoji: "👶" },
  { file: "เช็ดกระจก.mp3", label: "เช็ดกระจก", emoji: "🪟" },
  { file: "เด็กๆ.mp3", label: "เด็กๆ", emoji: "👶" },
  { file: "ตบมุข 1.mp3", label: "ตบมุข 1", emoji: "👋" },
  { file: "ตบมุข 2.mp3", label: "ตบมุข 2", emoji: "🤚" },
  { file: "ต่อเน็ต.mp3", label: "ต่อเน็ต", emoji: "🌐" },
  { file: "ทางของพี่.mp3", label: "ทางของพี่", emoji: "😎" },
  { file: "บุฟเฟ่.mp3", label: "บุฟเฟ่", emoji: "🍽️" },
  { file: "เบรกมุข.mp3", label: "เบรกมุข", emoji: "🛑" },
  { file: "ปรบมือ.mp3", label: "ปรบมือ", emoji: "👏" },
  { file: "ผิดอะไร.mp3", label: "ผิดอะไร", emoji: "❓" },
  { file: "มีกลิ่น.mp3", label: "มีกลิ่น", emoji: "👃" },
  { file: "มีอีกไหม.mp3", label: "มีอีกไหม", emoji: "👂" },
  { file: "ร่างกาย.mp3", label: "ร่างกาย", emoji: "💪" },
  { file: "เศร้า.mp3", label: "เศร้า", emoji: "😢" },
  { file: "เสียงอยู่ไส.mp3", label: "เสียงอยู่ไส", emoji: "🔊" },
  { file: "เสียงอยู่ไส 2.mp3", label: "เสียงอยู่ไส 2", emoji: "📢" },
  { file: "อย่าๆๆ.mp3", label: "อย่าๆๆ", emoji: "🙅" },
  { file: "อยากทำงาน.mp3", label: "อยากทำงาน", emoji: "💼" },
  { file: "อย่ามั่ว.mp3", label: "อย่ามั่ว", emoji: "🚫" },
  { file: "อย่าเสี่ยง.mp3", label: "อย่าเสี่ยง", emoji: "⚠️" },
  { file: "อยู่ไม่ไหว.mp3", label: "อยู่ไม่ไหว", emoji: "😩" },
  { file: "ไอ้สัส.mp3", label: "ไอ้สัส", emoji: "🤬" },
];

