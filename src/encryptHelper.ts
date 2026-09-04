/**
 * AES-256-CBC encrypt/decrypt helper — browser counterpart of Node's
 * `crypto.createCipheriv("aes-256-cbc", ...)` built on the Web Crypto API
 * (`crypto.subtle`, built into every browser — no new dependency).
 *
 * Wire-compatible with the Node implementation: same algorithm + PKCS#7
 * padding, KEY/IV as HEX strings, ciphertext in/out as HEX strings.
 *
 * KEY/IV default to `ENCRYPTO_KEY` / `ENCRYPTO_IV` from `.env`
 * (exposed to client code via `envPrefix` in vite.config.ts).
 *
 * Note: Web Crypto is Promise-based, so encrypt/decrypt are `async`
 * (unlike the synchronous Node `crypto` version).
 */

/** Node-style algorithm name → Web Crypto algorithm name */
const WEB_CRYPTO_ALGORITHMS: Record<string, string> = {
  "aes-256-cbc": "AES-CBC",
};

/** HEX string → bytes. Throws on odd length or non-hex characters. */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** bytes → lowercase HEX string */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class EncryptHelper {
  private readonly algorithm: string;
  private readonly keyBytes: Uint8Array<ArrayBuffer>;
  private readonly ivBytes: Uint8Array<ArrayBuffer>;
  /** Lazily-imported CryptoKey — importKey is async, cached after first use */
  private cryptoKey: Promise<CryptoKey> | null = null;

  constructor(key?: string, iv?: string, algorithm: string = "aes-256-cbc") {
    const webCryptoAlgorithm = WEB_CRYPTO_ALGORITHMS[algorithm];
    if (!webCryptoAlgorithm) {
      throw new Error(`Unsupported algorithm: ${algorithm} (only aes-256-cbc is supported)`);
    }
    this.algorithm = webCryptoAlgorithm;

    const keyHex = key || import.meta.env.ENCRYPTO_KEY;
    const ivHex = iv || import.meta.env.ENCRYPTO_IV;

    if (!keyHex) {
      throw new Error("ENCRYPTO_KEY is required");
    }
    if (!ivHex) {
      throw new Error("ENCRYPTO_IV is required");
    }

    let keyBytes: Uint8Array<ArrayBuffer>;
    let ivBytes: Uint8Array<ArrayBuffer>;
    try {
      keyBytes = hexToBytes(keyHex);
    } catch {
      throw new Error("ENCRYPTO_KEY must be a valid hex string");
    }
    try {
      ivBytes = hexToBytes(ivHex);
    } catch {
      throw new Error("ENCRYPTO_IV must be a valid hex string");
    }

    if (keyBytes.length !== 32) {
      throw new Error("ENCRYPTO_KEY must be 32 bytes for aes-256-cbc");
    }
    if (ivBytes.length !== 16) {
      throw new Error("ENCRYPTO_IV must be 16 bytes for aes-256-cbc");
    }

    this.keyBytes = keyBytes;
    this.ivBytes = ivBytes;
  }

  /** Import the raw key once and cache the promise */
  private getKey(): Promise<CryptoKey> {
    if (!this.cryptoKey) {
      this.cryptoKey = crypto.subtle.importKey(
        "raw",
        this.keyBytes,
        { name: this.algorithm },
        false,
        ["encrypt", "decrypt"]
      );
    }
    return this.cryptoKey;
  }

  /** Encrypt plaintext → HEX ciphertext. Empty/null/undefined input is returned as-is. */
  async encrypt(text: string): Promise<string> {
    if (!text) return text;
    try {
      const key = await this.getKey();
      const encrypted = await crypto.subtle.encrypt(
        { name: this.algorithm, iv: this.ivBytes },
        key,
        new TextEncoder().encode(String(text))
      );
      return bytesToHex(new Uint8Array(encrypted));
    } catch (error) {
      throw new Error(`Encrypt failed: ${(error as Error).message}`);
    }
  }

  /** Decrypt HEX ciphertext → plaintext. Empty/null/undefined input is returned as-is. */
  async decrypt(text: string): Promise<string> {
    if (!text) return text;
    try {
      const key = await this.getKey();
      const decrypted = await crypto.subtle.decrypt(
        { name: this.algorithm, iv: this.ivBytes },
        key,
        hexToBytes(String(text))
      );
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      throw new Error(`Decrypt failed: ${(error as Error).message}`);
    }
  }
}

export default EncryptHelper;
