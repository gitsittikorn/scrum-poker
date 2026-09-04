// Headless smoke test for the ClickUp banner in the scrum-poker room page.
// Run from backend/: node clickup-smoke.js   (vite dev server must be up on :5173)
// Drives the real app: join room Cold as PO → resolve the real test task →
// verify banner text → clear task → leave. Prints console/page errors at the end.
const path = require("path");
const { chromium } = require("playwright-core");

const EXE = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1200", "chrome-win64", "chrome.exe");
const TASK_URL = "https://app.clickup.com/t/9018499665/86eq6n0wa";
const TASK_NAME = "Update Value from API";

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  const fail = (msg) => {
    console.log("FAIL:", msg);
    process.exitCode = 1;
  };
  try {
    await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#landing-page.active", { timeout: 15000 });
    console.log("landing OK");

    await page.fill("#username-input", "ClaudeTest");
    await page.selectOption("#role-select", "po");
    await page.selectOption("#room-select", "Cold");
    await page.click("#btn-join-room");
    await page.waitForSelector("#room-page.active", { timeout: 20000 });
    console.log("joined room Cold as PO");

    // PO must see the banner + input row
    await page.waitForSelector("#clickup-banner", { timeout: 10000 });
    const bannerVisible = await page.isVisible("#clickup-banner");
    const inputVisible = await page.isVisible("#clickup-input-row");
    console.log("banner visible:", bannerVisible, "| input row visible:", inputVisible);
    if (!bannerVisible || !inputVisible) fail("banner/input not visible for PO");

    // Resolve the real task through the backend
    await page.fill("#clickup-url-input", TASK_URL);
    await page.click("#btn-clickup-resolve");
    await page.waitForSelector("#clickup-task-display:not(.hidden)", { timeout: 20000 });
    const name = await page.textContent("#clickup-task-name");
    console.log("resolved task name:", name);
    if (!name || !name.includes(TASK_NAME)) fail("task name mismatch: " + name);

    await page.screenshot({ path: "C:/tmp/clickup-smoke-room.png" });

    // Clear the task
    await page.click("#btn-clickup-clear");
    await page.waitForFunction(
      () => document.getElementById("clickup-task-display")?.classList.contains("hidden"),
      { timeout: 10000 }
    );
    console.log("task cleared OK");

    // Leave the room (confirm modal)
    await page.click("#btn-leave");
    const confirm = page.locator(".modal-overlay.active button", { hasText: "ออก" }).first();
    try {
      await confirm.click({ timeout: 3000 });
      console.log("left room");
    } catch {
      console.log("leave confirm not found (offline cleanup will handle)");
    }
  } catch (e) {
    fail(e.message);
    await page.screenshot({ path: "C:/tmp/clickup-smoke-fail.png" }).catch(() => {});
  }
  console.log("console errors:", errors.length ? JSON.stringify(errors, null, 2) : "none");
  await browser.close();
})();
