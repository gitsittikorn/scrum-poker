import { EncryptHelper } from "./encryptHelper";
import { utf8ToBase64, base64ToUtf8 } from "./utils";
import { showToast } from "./ui";

/** Shared EncryptHelper instance — built once from env (ENCRYPTO_KEY / ENCRYPTO_IV) */
let encryptHelper: EncryptHelper | null = null;
/** Constructor error message (bad env) — kept to show on click instead of at init */
let helperError: string | null = null;
/** Buttons are static in index.html — bind once even if admin room is rejoined */
let bound = false;

/** One QA tool row: input box → encrypt button → output box → copy button */
interface QaToolConfig {
  inputId: string;
  outputId: string;
  encryptBtnId: string;
  copyBtnId: string;
  /** Transform a single non-empty input line → one output line */
  transform: (line: string) => Promise<string>;
}

/** AES-encrypt one line with the shared helper */
async function aesEncryptLine(line: string): Promise<string> {
  if (!encryptHelper) {
    throw new Error(helperError ?? "EncryptHelper not ready");
  }
  return encryptHelper.encrypt(line);
}

const QA_TOOLS: QaToolConfig[] = [
  {
    // moment: AES-256-CBC → HEX (compatible with the Node crypto implementation)
    inputId: "qa-input-moment",
    outputId: "qa-output-moment",
    encryptBtnId: "btn-qa-encrypt-moment",
    copyBtnId: "btn-qa-copy-moment",
    transform: aesEncryptLine,
  },
  {
    // nmw (order ID / sale ID): order ID → Base64
    inputId: "qa-input-nmw-encode",
    outputId: "qa-output-nmw-encode",
    encryptBtnId: "btn-qa-encode-nmw",
    copyBtnId: "btn-qa-copy-nmw-encode",
    transform: (line) => Promise.resolve(utf8ToBase64(line)),
  },
  {
    // nmw (order ID / sale ID): Base64 → order ID
    inputId: "qa-input-nmw-decode",
    outputId: "qa-output-nmw-decode",
    encryptBtnId: "btn-qa-decode-nmw",
    copyBtnId: "btn-qa-copy-nmw-decode",
    transform: (line) => Promise.resolve(base64ToUtf8(line)),
  },
];

/** Initialize the QA Tool page — called from initSuperAdminPanel() in admin.ts */
export function initQaTool(): void {
  if (bound) return;

  try {
    encryptHelper = new EncryptHelper();
  } catch (err) {
    // Keep the page usable — surface the config error when a button is clicked
    helperError = (err as Error).message;
  }

  for (const tool of QA_TOOLS) {
    const input = document.getElementById(tool.inputId) as HTMLTextAreaElement | null;
    const output = document.getElementById(tool.outputId) as HTMLTextAreaElement | null;
    const encryptBtn = document.getElementById(tool.encryptBtnId);
    const copyBtn = document.getElementById(tool.copyBtnId);
    if (!input || !output || !encryptBtn || !copyBtn) continue;

    encryptBtn.addEventListener("click", () => void handleEncrypt(tool, input, output));
    copyBtn.addEventListener("click", () => void handleCopy(output));
  }
  bound = true;
}

/** Transform each non-empty line of the input through the tool's transform */
async function handleEncrypt(
  tool: QaToolConfig,
  input: HTMLTextAreaElement,
  output: HTMLTextAreaElement
): Promise<void> {
  const text = input.value;
  if (!text.trim()) {
    showToast("⚠️ วางข้อมูลก่อน");
    return;
  }
  try {
    const lines = text.split(/\r?\n/);
    let count = 0;
    const outLines: string[] = [];
    for (const line of lines) {
      const value = line.trim();
      if (!value) {
        outLines.push("");
        continue;
      }
      outLines.push(await tool.transform(value));
      count++;
    }
    output.value = outLines.join("\n");
    showToast(`✅ เข้ารหัสแล้ว ${count} รายการ`);
  } catch (err) {
    showToast(`❌ ${(err as Error).message}`);
  }
}

/** Copy the tool output to clipboard */
async function handleCopy(output: HTMLTextAreaElement): Promise<void> {
  if (!output.value.trim()) {
    showToast("⚠️ ยังไม่มีข้อมูลให้คัดลอก — กดเข้ารหัสก่อน");
    return;
  }
  try {
    await navigator.clipboard.writeText(output.value);
    showToast("📋 คัดลอกแล้ว");
  } catch (err) {
    showToast(`❌ คัดลอกไม่สำเร็จ: ${(err as Error).message}`);
  }
}

/* ── Standalone mode (?qa=1) ─────────────────────────────────────────────
 * The QA tool page normally lives inside the room page (right after the
 * super admin panel). In standalone mode the node is re-hosted under #app
 * so it renders even though landing/room pages are hidden. */

/** Home position of #qa-tool-page inside the room page — for restoring after standalone */
let homeParent: HTMLElement | null = null;
let homeNext: Node | null = null;

/** True when the app was opened with ?qa=1 (standalone QA tool, no login) */
export function isQaStandaloneUrl(): boolean {
  return new URLSearchParams(window.location.search).get("qa") === "1";
}

/** Show the QA tool as a standalone page (?qa=1) — no login, no Firebase */
export function initQaStandalone(): void {
  const page = document.getElementById("qa-tool-page");
  const app = document.getElementById("app");
  if (!page || !app) return;

  // Remember home position, then host the page at #app level so it shows
  // outside the (hidden) room page
  if (!homeParent) {
    homeParent = page.parentElement;
    homeNext = page.nextSibling;
  }
  app.appendChild(page);

  document.getElementById("landing-page")?.classList.add("hidden");
  document.getElementById("room-page")?.classList.add("hidden");
  page.classList.remove("hidden");
  page.classList.add("qa-standalone");
  document.getElementById("qa-back-link")?.classList.remove("hidden");
}

/** Put #qa-tool-page back to its home position in the room page (no-op if already there) */
export function restoreQaToolHome(): void {
  const page = document.getElementById("qa-tool-page");
  if (!page || !homeParent) return;
  homeParent.insertBefore(page, homeNext ?? null);
}
