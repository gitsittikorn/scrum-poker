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

export const APP_VERSION = "2025-05-09-v2";

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
  { file: "จ้ะเอ๋.mp3", label: "จ้ะเอ๋", emoji: "👶" },
  { file: "ตบมุข 1.mp3", label: "ตบมุข 1", emoji: "👋" },
  { file: "ตบมุข 2.mp3", label: "ตบมุข 2", emoji: "🤚" },
  { file: "เบรกมุข.mp3", label: "เบรกมุข", emoji: "🛑" },
  { file: "อย่าๆๆ.mp3", label: "อย่าๆๆ", emoji: "🙅" },
  { file: "เศร้า.mp3", label: "เศร้า", emoji: "😢" },
  { file: "แกไม่รอดแน่.mp3", label: "แกไม่รอด", emoji: "☠️" },
  { file: "เช็ดกระจก.mp3", label: "เช็ดกระจก", emoji: "🪟" },
  { file: "เกิดอะไรขึ้น.mp3", label: "เกิดอะไรขึ้น", emoji: "🤨" },
  { file: "มีอีกไหม.mp3", label: "มีอีกไหม", emoji: "👂" },
  { file: "ทางของพี่.mp3", label: "ทางของพี่", emoji: "😎" },
  { file: "net tot.mp3", label: "เน็ตตอ", emoji: "🌐" },
];

