/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend URL (ClickUp proxy) — e.g. http://localhost:3000 */
  readonly VITE_BACKEND_URL: string;
  /** AES-256-CBC key as HEX (64 chars = 32 bytes) — used by EncryptHelper (QA Tool) */
  readonly ENCRYPTO_KEY: string;
  /** AES-256-CBC IV as HEX (32 chars = 16 bytes) — used by EncryptHelper (QA Tool) */
  readonly ENCRYPTO_IV: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
