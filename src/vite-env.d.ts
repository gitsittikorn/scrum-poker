/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend URL (ClickUp proxy) — e.g. http://localhost:3000 · ไม่ถูก define = undefined
   *  (โค้ดมี fallback เป็น "" = same-origin อยู่แล้ว) */
  readonly VITE_BACKEND_URL?: string;
  /** AES-256-CBC key as HEX (64 chars = 32 bytes) — used by EncryptHelper (QA Tool) · secret ใส่ใน .env */
  readonly ENCRYPTO_KEY?: string;
  /** AES-256-CBC IV as HEX (32 chars = 16 bytes) — used by EncryptHelper (QA Tool) · secret ใส่ใน .env */
  readonly ENCRYPTO_IV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// ── req 15 — type สำหรับ import backend/links.js (CJS ธรรมดา ไม่มี .d.ts)
// ใช้ใน unit test (src/__tests__/taskLinks.dedup.test.ts) — logic จริงอยู่ที่
// backend/links.js เป็น single source of truth ของ dedup
declare module "*/backend/links.js" {
  export interface ExtractedLink {
    type: string;
    url: string;
  }
  /** ดึงลิงก์จาก markdown description ของการ์ด ClickUp */
  export function extractLinks(rawMarkdown: string): ExtractedLink[];
  /** จำแนกประเภทไฟล์จาก metadata ของ attachment */
  export function classifyAttachment(att: unknown): ExtractedLink | null;
  /** รวมลิงก์ description + attachments แบบไม่ซ้ำ (dedupe ด้วย id/URL key) */
  export function taskLinks(task: unknown): ExtractedLink[];
  /** key ระบุไฟล์ของ URL (host+path + เฉพาะ query ที่ระบุไฟล์) */
  export function urlFileKey(u: string): string;
}
