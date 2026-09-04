import { defineConfig } from "vite";

export default defineConfig({
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
});
