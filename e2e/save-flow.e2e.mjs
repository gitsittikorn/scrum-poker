// E2E: Save-to-ClickUp flow ครบวงจร (req 3 · 5 · 8 · 11)
//   req 5  reset ห้องหลังบันทึกสำเร็จ (โหวต/task/URL หายทุก client แบบ real-time)
//   req 3  History Modal แสดง realName ของ PO (ชื่อเดียวกับที่ส่งไป comment)
//   req 8  comment ไม่มี prefix "Role - "
//   req 11 ชื่อการ์ดอยู่บรรทัดสุดท้ายของ comment
//
// รัน: node e2e/save-flow.e2e.mjs
//   ต้องมี: vite dev server :5173 + backend :3000 + CLICKUP_API_TOKEN ใน backend/.env
//   ใช้ห้อง Cold + สร้างการ์ด ClickUp ทดสอบเอง แล้วลบคืนตอนจบ (self-cleaning)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
const ROOM = process.env.E2E_ROOM || "Cold";
const LIST_ID = process.env.E2E_LIST_ID || "1100670000009686"; // CES Team → Kitsune Sprint (การ์ดมี custom field Dev/QA Point)
const TOKEN = readFileSync(join(ROOT, "backend", ".env"), "utf8")
  .match(/CLICKUP_API_TOKEN="?([^"\r\n]+)"?/)?.[1]?.trim();

let failures = 0;
const fail = (m) => { console.log("FAIL:", m); failures++; };
const ok = (m) => console.log("PASS:", m);

if (!TOKEN) {
  console.error("ไม่พบ CLICKUP_API_TOKEN ใน backend/.env — ดู backend/.env.example");
  process.exit(1);
}

const cu = async (path, init = {}) => {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: TOKEN,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`ClickUp ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
};

/** สร้าง page ใหม่ + เข้าห้องในฐานะ role ที่กำหนด (แยก context = แยก anonymous uid) */
async function joinAs(browser, { name, role, room }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/?room=${room}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#landing-page.active", { timeout: 15000 });
  await page.fill("#username-input", name);
  await page.selectOption("#role-select", role);
  await page.selectOption("#room-select", room);
  await page.waitForFunction(
    () => {
      const sel = document.getElementById("realname-select");
      return !!sel && [...sel.options].some((o) => o.value !== "");
    },
    null,
    { timeout: 15000 },
  );
  const names = await page.$$eval(
    "#realname-select option",
    (os) => os.map((o) => o.value).filter(Boolean),
  );
  await page.selectOption("#realname-select", names[0]);
  await page.click("#btn-join-room");
  await page.waitForSelector("#room-page.active", { timeout: 20000 });
  return { context, page, pageErrors, realName: names[0] };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let po = null;
  let testTask = null;

  const cleanupRoom = async () => {
    if (!po?.page) return;
    try {
      if (await po.page.$("#room-page.active")) {
        await po.page.click("#btn-delete-room");
        await po.page.locator(".modal-overlay.active .btn-confirm-danger").click({ timeout: 5000 });
        await po.page.waitForSelector("#landing-page.active", { timeout: 10000 });
        console.log("cleanup: ล้างห้อง Cold เรียบร้อย");
      }
    } catch (e) {
      console.log("cleanup skipped:", e.message);
    }
  };
  const cleanupTask = async () => {
    if (!testTask) return;
    try {
      await cu(`/task/${testTask.id}`, { method: "DELETE" });
      console.log("cleanup: ลบการ์ดทดสอบ ClickUp แล้ว");
    } catch (e) {
      console.log("cleanup task skipped:", e.message);
    }
  };

  try {
    // ── สร้างการ์ดทดสอบบน ClickUp (จะลบตอนจบ) ──
    const created = await cu(`/list/${LIST_ID}/task`, {
      method: "POST",
      body: JSON.stringify({ name: "[E2E-TEST] Scrum Poker save flow — safe to delete" }),
    });
    testTask = { id: created.id, name: created.name, url: created.url };
    ok(`สร้างการ์ดทดสอบ: ${testTask.name} (${testTask.id})`);

    // ── pre-clean ห้อง + เข้า PO/dev 2 คน ──
    const pre = await joinAs(browser, { name: "E2E-Clean", role: "po", room: ROOM });
    await pre.page.click("#btn-delete-room");
    await pre.page.locator(".modal-overlay.active .btn-confirm-danger").click({ timeout: 5000 });
    await pre.page.waitForSelector("#landing-page.active", { timeout: 10000 });
    await pre.context.close();

    po = await joinAs(browser, { name: "E2E-Po", role: "po", room: ROOM });
    const dev1 = await joinAs(browser, { name: "E2E-D1", role: "dev", room: ROOM });
    const dev2 = await joinAs(browser, { name: "E2E-D2", role: "dev", room: ROOM });
    await po.page.waitForSelector(".participant-card[data-uid]", { timeout: 15000 });

    // ── PO ดึง task ──
    await po.page.fill("#clickup-url-input", testTask.url);
    await po.page.click("#btn-clickup-resolve");
    await po.page.waitForSelector("#clickup-task-display:not(.hidden)", { timeout: 20000 });
    const taskShown = await po.page.textContent("#clickup-task-name");
    if (taskShown === testTask.name) ok(`ดึง task สำเร็จ: "${taskShown}"`);
    else fail(`ชื่อ task ไม่ตรง: "${taskShown}" ≠ "${testTask.name}"`);
    // req 1: ดึงการ์ดแล้ว → แถบ "ยังไม่ได้เลือกการ์ด" ต้องหายทันที
    await po.page.waitForFunction(
      () => document.getElementById("task-required-reminder")?.classList.contains("hidden"),
      null,
      { timeout: 10000 },
    );
    ok('req 1: PO ดึงการ์ดแล้ว — แถบ "ยังไม่ได้เลือกการ์ด" หายทันที');

    // ── dev ทั้งสองโหวตการ์ดใบแรกเหมือนกัน (unanimous) ──
    const voteValue = await dev1.page.$eval(
      ".poker-card:not(.custom-card)",
      (el) => el.dataset.value,
    );
    await dev1.page.click('.poker-card:not(.custom-card)');
    await dev2.page.click('.poker-card:not(.custom-card)');
    await po.page.waitForFunction(
      () => document.querySelectorAll(".participant-card.voted").length >= 2,
      null,
      { timeout: 15000 },
    );
    ok(`dev โหวตครบ (point ${voteValue})`);

    // ── Reveal ──
    await po.page.click("#btn-reveal");
    await po.page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent?.includes("revealed"),
      null,
      { timeout: 10000 },
    );
    ok("Reveal สำเร็จ");

    // ── บันทึก ClickUp (การ์ดใหม่ = ไม่มี modal ทับค่าเดิม) ──
    await po.page.waitForSelector("#btn-save-clickup:not([style*='none']):not(:disabled)", { timeout: 10000 });
    await po.page.click("#btn-save-clickup");
    await po.page.waitForSelector("#save-splash", { timeout: 30000 });
    ok("บันทึกสำเร็จ (splash แสดง)");

    // ── req 5: reset หลังบันทึกสำเร็จ ──
    // ทุกหน้า: การ์ด .voted หายทั้งหมด (โหวตถูกล้างสำหรับทุกคนทุก role)
    for (const [tag, p] of [["PO", po.page], ["dev1", dev1.page], ["dev2", dev2.page]]) {
      await p.waitForFunction(
        () => document.querySelectorAll(".participant-card.voted").length === 0,
        null,
        { timeout: 15000 },
      );
      ok(`req 5: ${tag} เห็นโหวตทุกคนถูกล้าง (ไม่มีการ์ด .voted เหลือ)`);
    }
    await po.page.waitForFunction(
      () => document.getElementById("clickup-task-row")?.classList.contains("hidden"),
      null,
      { timeout: 10000 },
    );
    ok("req 5: task row หายจากหน้าจอ (activeTask ถูกเคลียร์)");
    const urlLeft = await po.page.inputValue("#clickup-url-input");
    if (urlLeft === "") ok("req 5: URL ในช่อง input ถูกเคลียร์");
    else fail(`req 5: URL ค้างใน input → "${urlLeft}"`);

    // ── req 3: History Modal แสดง realName ของ PO ──
    await po.page.click("#btn-task-history");
    await po.page.waitForSelector(".task-history-row .task-history-po", { timeout: 10000 });
    const poCell = await po.page.textContent(".task-history-row .task-history-po");
    if (poCell === po.realName) ok(`req 3: History แสดง realName ของ PO → "${poCell}"`);
    else fail(`req 3: History PO = "${poCell}" แต่ realName คือ "${po.realName}"`);
    await po.page.locator("#task-history-modal .btn-icon").click();
    await dev1.context.close();
    await dev2.context.close();

    // ── req 8/11: ตรวจ comment บนการ์ดจริงผ่าน API ──
    const comments = await cu(`/task/${testTask.id}/comment`);
    const latest = (comments.comments ?? []).at(-1);
    if (!latest) fail("req 8/11: ไม่พบ comment บนการ์ด");
    else {
      const text = latest.comment_text ?? "";
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!text.includes("Role - ")) ok('req 8: comment ไม่มี prefix "Role - "');
      else fail(`req 8: comment ยังมี "Role - " → ${JSON.stringify(text)}`);
      // req 20 — เส้นคั่นปิดเป็นบรรทัดสุดท้าย และชื่อการ์ดอยู่บรรทัดก่อนเส้นคั่น
      if (lines[0] === "━".repeat(20) && lines[lines.length - 1] === "━".repeat(20)) {
        ok("req 20: comment มีเส้นคั่นหัว/ท้าย");
      } else {
        fail(`req 20: เส้นคั่นหัว/ท้ายไม่ครบ → ${JSON.stringify(text)}`);
      }
      if (lines[1] === "SCRUM POKER | POINT UPDATE") {
        ok("req 20: มี header SCRUM POKER | POINT UPDATE");
      } else {
        fail(`req 20: header ผิด = "${lines[1]}"`);
      }
      if (lines[lines.length - 2] === `📌 การ์ด: ${testTask.name}`) {
        ok(`req 11 + 20: ชื่อการ์ด (มี title) อยู่ท้ายสุดก่อนเส้นคั่นปิด`);
      } else {
        fail(`req 11: บรรทัดก่อนเส้นคั่น = "${lines[lines.length - 2]}" ≠ "📌 การ์ด: ${testTask.name}"`);
      }
      console.log("    comment ที่ได้:\n" + lines.map((l) => "      | " + l).join("\n"));
    }

    // ── point ขึ้นการ์ดจริง ──
    const task = await cu(`/task/${testTask.id}`);
    const fieldVal = (fname) => {
      const f = (task.custom_fields ?? []).find(
        (x) => x.name === fname || x.name?.toLowerCase() === fname.toLowerCase(),
      );
      return f?.value ?? null;
    };
    const devPoint = fieldVal("Dev Point Estimation (Original)");
    if (String(devPoint) === String(parseFloat(voteValue))) {
      ok(`point Dev บนการ์ด = ${devPoint} (ตรงกับที่โหวต)`);
    } else {
      fail(`point Dev บนการ์ด = ${devPoint} ≠ โหวต ${voteValue}`);
    }

    const allErrors = [...po.pageErrors, ...dev1.pageErrors, ...dev2.pageErrors];
    if (allErrors.length === 0) ok("ไม่มี pageerror ระหว่างทดสอบ");
    else fail(`pageerror: ${JSON.stringify(allErrors, null, 2)}`);

    await cleanupRoom();
    await cleanupTask();
    testTask = null;
  } catch (e) {
    fail(e.message);
    await cleanupRoom();
    await cleanupTask();
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\nE2E save-flow: ALL PASS ✅" : `\nE2E save-flow: ${failures} FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
