// E2E: No Need Test + tag ClickUp + comment รูปแบบใหม่ (req 14.1, 18, 20)
//   ตรวจ flow จริงบนหน้าเว็บ: PO ติ๊ก No Need Test → บันทึก →
//     1. การ์ด ClickUp ติด tag "no need test"
//     2. QA Point field ไม่ถูกแตะ (null) — Dev Point บันทึกปกติ
//     3. comment รูปแบบใหม่: เส้นคั่นหัว/ท้าย + header + 📅 เวลาไทย + "QA: no need test"
//     4. QA โหวตไม่ตรงกันก็บันทึกได้ (No Need Test ตัด QA ออกจาก readiness)
//
// รัน: node e2e/no-need-test.e2e.mjs
//   ต้องมี: vite dev server :5173 + backend :3000 (โค้ดล่าสุด) + CLICKUP_API_TOKEN
//   ใช้ห้อง Cold + สร้างการ์ด ClickUp ทดสอบเอง แล้วลบคืนตอนจบ (self-cleaning)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
const ROOM = process.env.E2E_ROOM || "Cold";
const LIST_ID = "1100670000009686"; // CES Team → Kitsune Sprint (มี custom field Dev/QA Point + tag "no need test" ใน space)
const RULE = "━".repeat(20);
const HEADER = "🃏 SCRUM POKER | POINT UPDATE";
const TOKEN = readFileSync(join(ROOT, "backend", ".env"), "utf8")
  .match(/CLICKUP_API_TOKEN=(.+)/)?.[1]?.trim();

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
  let dev1 = null;
  let qa1 = null;
  let qa2 = null;
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
      body: JSON.stringify({ name: "[E2E-TEST] No Need Test tag — safe to delete" }),
    });
    testTask = { id: created.id, name: created.name, url: created.url };
    ok(`สร้างการ์ดทดสอบ: ${testTask.name} (${testTask.id})`);

    // ── pre-clean ห้อง + เข้า PO/dev/qa ──
    const pre = await joinAs(browser, { name: "E2E-Clean", role: "po", room: ROOM });
    await pre.page.click("#btn-delete-room");
    await pre.page.locator(".modal-overlay.active .btn-confirm-danger").click({ timeout: 5000 });
    await pre.page.waitForSelector("#landing-page.active", { timeout: 10000 });
    await pre.context.close();

    po = await joinAs(browser, { name: "E2E-Po", role: "po", room: ROOM });
    dev1 = await joinAs(browser, { name: "E2E-D1", role: "dev", room: ROOM });
    qa1 = await joinAs(browser, { name: "E2E-Q1", role: "qa", room: ROOM });
    qa2 = await joinAs(browser, { name: "E2E-Q2", role: "qa", room: ROOM });
    await po.page.waitForSelector(".participant-card[data-uid]", { timeout: 15000 });

    // ── PO ดึง task ──
    await po.page.fill("#clickup-url-input", testTask.url);
    await po.page.click("#btn-clickup-resolve");
    await po.page.waitForSelector("#clickup-task-display:not(.hidden)", { timeout: 20000 });
    ok("ดึง task สำเร็จ");

    // ── dev โหวตการ์ดแรก · QA 2 คนโหวตคนละค่า (ไม่ unanimous = ปกติบันทึกไม่ได้) ──
    const devVote = await dev1.page.$eval(
      ".poker-card:not(.custom-card)",
      (el) => el.dataset.value,
    );
    await dev1.page.click('.poker-card:not(.custom-card)');
    await qa1.page.click(".poker-card:not(.custom-card):not(.custom-input-card) >> nth=0");
    await qa2.page.click(".poker-card:not(.custom-card):not(.custom-input-card) >> nth=-1");
    const qaVote1 = await qa1.page.$eval(".poker-card.selected", (el) => el.dataset.value);
    const qaVote2 = await qa2.page.$eval(".poker-card.selected", (el) => el.dataset.value);
    if (qaVote1 === qaVote2) fail(`QA สองคนโหวตซ้ำ ${qaVote1} — เคสไม่ตรงเงื่อนไข`);
    await po.page.waitForFunction(
      () => document.querySelectorAll(".participant-card.voted").length >= 3,
      null,
      { timeout: 15000 },
    );
    ok(`dev โหวต ${devVote} · qa โหวต ${qaVote1}/${qaVote2} (ไม่ตรงกันโดยตั้งใจ)`);

    // ── Reveal ──
    await po.page.click("#btn-reveal");
    await po.page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent?.includes("revealed"),
      null,
      { timeout: 10000 },
    );
    ok("Reveal สำเร็จ");

    // ── ยังไม่ติ๊ก: ปุ่มบันทึกต้อง disabled (QA ไม่ตรงกัน) ──
    await po.page.waitForSelector("#btn-save-clickup", { timeout: 10000 });
    const disabledBefore = await po.page.$eval("#btn-save-clickup", (b) => b.disabled);
    if (disabledBefore) ok("ยังไม่ติ๊ก No Need Test: ปุ่มบันทึก disabled (QA ไม่ตรงกัน)");
    else fail("ปุ่มบันทึกควร disabled เมื่อ QA โหวตไม่ตรงกันและยังไม่ติ๊ก");

    // ── ติ๊ก No Need Test (enabled เพราะมี task ปัจจุบัน) ──
    const cb = po.page.locator("#no-need-test");
    await cb.waitFor({ state: "visible", timeout: 10000 });
    const enabled = await cb.isEnabled();
    if (enabled) ok("checkbox No Need Test enabled (มี task ปัจจุบัน)");
    else fail("checkbox No Need Test ควร enabled เมื่อมี task");
    await cb.check();
    const btnLabel = await po.page.$eval("#btn-save-clickup", (b) => b.textContent);
    if (btnLabel.includes("QA no need test")) ok(`ปุ่มเปลี่ยน label → "${btnLabel.trim()}"`);
    else fail(`label ปุ่มไม่มี "QA no need test" → "${btnLabel}"`);
    const enabledAfter = await po.page.$eval("#btn-save-clickup", (b) => !b.disabled);
    if (enabledAfter) ok("ติ๊กแล้ว: ปุ่มบันทึก enabled แม้ QA ไม่ตรงกัน");
    else fail("ปุ่มบันทึกยัง disabled หลังติ๊ก No Need Test");

    // ── บันทึก ──
    await po.page.click("#btn-save-clickup");
    await po.page.waitForSelector("#save-splash", { timeout: 30000 });
    ok("บันทึกสำเร็จ (splash แสดง)");

    // ── ตรวจผลบน ClickUp จริงผ่าน API ──
    // tag ถูกแนบหลัง splash โชว์ (best-effort ท้าย flow บันทึก) — poll รอสักครู่
    // กันอ่านการ์ดเร็วกว่าที่ ClickUp จะ reflect
    let task = null;
    let tagNames = [];
    for (let i = 0; i < 10; i++) {
      task = await cu(`/task/${testTask.id}`);
      tagNames = (task.tags ?? []).map((t) => t.name);
      if (tagNames.includes("no need test")) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (tagNames.includes("no need test")) ok('การ์ดติด tag "no need test" แล้ว ✅');
    else fail(`ไม่พบ tag บนการ์ด (รอ 10 วิแล้ว) → ${JSON.stringify(tagNames)}`);

    const fieldVal = (fname) => {
      const f = (task.custom_fields ?? []).find(
        (x) => x.name === fname || x.name?.toLowerCase() === fname.toLowerCase(),
      );
      return f?.value ?? null;
    };
    if (String(fieldVal("Dev Point Estimation (Original)")) === devVote) {
      ok(`Dev Point บนการ์ด = ${devVote} (บันทึกปกติ)`);
    } else {
      fail(`Dev Point = ${fieldVal("Dev Point Estimation (Original)")} ≠ ${devVote}`);
    }
    if (fieldVal("QA Point Estimation") === null) {
      ok("QA Point บนการ์ด = null (ไม่ถูกแตะ — ไม่มีการเขียนทับ)");
    } else {
      fail(`QA Point ถูกเขียนเป็น ${fieldVal("QA Point Estimation")} (ต้องไม่แตะ)`);
    }

    const comments = await cu(`/task/${testTask.id}/comment`);
    const latest = (comments.comments ?? []).at(-1);
    if (!latest) fail("ไม่พบ comment บนการ์ด");
    else {
      const text = latest.comment_text ?? "";
      const lines = text.split("\n");
      console.log("    comment ที่ได้:\n" + lines.map((l) => "      | " + l).join("\n"));
      if (lines[0] === RULE && lines[lines.length - 1] === RULE) ok("req 20: เส้นคั่นหัว/ท้ายครบ");
      else fail("req 20: เส้นคั่นหัว/ท้ายไม่ครบ");
      if (lines[1] === HEADER) ok("req 20: header 🃏 SCRUM POKER | POINT UPDATE");
      else fail(`req 20: header ผิด → "${lines[1]}"`);
      if (/^📅 \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(lines[2] ?? "")) {
        ok(`req 20: timestamp เวลาไทย → ${lines[2]}`);
      } else {
        fail(`req 20: timestamp ผิดรูปแบบ → "${lines[2] ?? ""}"`);
      }
      if (text.includes("QA: no need test")) ok('req 14.3/20: comment มี "QA: no need test"');
      else fail("comment ไม่มี QA: no need test");
      if (lines[lines.length - 2] === testTask.name) {
        ok("req 20: ชื่อการ์ดท้ายสุดก่อนเส้นคั่นปิด");
      } else {
        fail(`ชื่อการ์ดตำแหน่งผิด → "${lines[lines.length - 2]}"`);
      }
      if (text.includes(`Dev: ${devVote}`)) ok(`comment มี Dev: ${devVote}`);
    }

    // ── reset หลังบันทึกสำเร็จ (req 14.4: checkbox กลับ disabled) ──
    await po.page.waitForFunction(
      () => document.getElementById("clickup-task-row")?.classList.contains("hidden"),
      null,
      { timeout: 10000 },
    );
    const cbAfter = await po.page.$eval("#no-need-test", (c) => ({ checked: c.checked, disabled: c.disabled }));
    if (!cbAfter.checked && cbAfter.disabled) ok("req 14.4: บันทึกจบรอบ → checkbox unchecked + disabled");
    else fail(`req 14.4: checkbox หลังบันทึก = ${JSON.stringify(cbAfter)}`);

    const pageErrors = [...po.pageErrors, ...dev1.pageErrors, ...qa1.pageErrors, ...qa2.pageErrors];
    if (pageErrors.length === 0) ok("ไม่มี page error ระหว่าง flow");
    else pageErrors.forEach((e) => fail(`pageerror: ${e}`));
  } catch (e) {
    fail(`exception: ${e.message}`);
  } finally {
    await cleanupRoom();
    await cleanupTask();
    await browser.close();
  }

  console.log(failures === 0 ? "\n=== E2E ผ่านทั้งหมด ===" : `\n=== E2E พบ ${failures} ข้อผิดพลาด ===`);
  process.exit(failures === 0 ? 0 : 1);
})();
