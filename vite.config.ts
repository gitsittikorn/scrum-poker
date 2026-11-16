import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // โฟลเดอร์ของ vite.config.ts = root ของ repo (ที่ .env* อยู่จริง) — ไม่ผูกกับ cwd
  const envRoot = fileURLToPath(new URL(".", import.meta.url));
  const env = loadEnv(mode, envRoot, ["VITE_", "ENCRYPTO_"]);

  // ตรวจ ENV ตอน production build — เตือนอย่างเดียว ไม่ fail build
  // (CI ต้อง build ผ่านได้โดยไม่มี secret เช่น ENCRYPTO_*)
  if (mode === "production") {
    const missing: string[] = [];
    if (env.VITE_BACKEND_URL === undefined) missing.push("VITE_BACKEND_URL");
    if (!env.ENCRYPTO_KEY) missing.push("ENCRYPTO_KEY");
    if (!env.ENCRYPTO_IV) missing.push("ENCRYPTO_IV");
    if (missing.length > 0) {
      console.warn(
        `\n⚠️  production build โดยไม่มี ENV: ${missing.join(", ")}` +
          `\n   - VITE_BACKEND_URL ขาด → frontend จะยิง same-origin (/api/**)` +
          `\n   - ENCRYPTO_* ขาด → ปุ่ม AES ใน QA Tool ใช้ไม่ได้ (ดู .env.example)\n`,
      );
    }
  }

  return {
    root: "src",
    // `.env` lives at the repo root — envDir defaults to `root` (src/), which
    // would skip it entirely. Point it one level up so ENCRYPTO_* / VITE_* load.
    envDir: "..",
    publicDir: "../public",
    // ENCRYPTO_ prefix exposes ENCRYPTO_KEY / ENCRYPTO_IV from root `.env`
    // to client code (import.meta.env) for the QA Tool encrypt/decrypt page.
    envPrefix: ["VITE_", "ENCRYPTO_"],
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
  };
});
