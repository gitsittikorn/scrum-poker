// E2E: ฟีเจอร์ใหม่ 12 ข้อ (ส่วนที่ทดสอบได้โดยไม่ต้องพึ่ง backend/ClickUp token)
// req 1 card-draw reminder · req 2 last-voter · req 4 wheel outside-click ·
// req 6 task-required reminder · req 12 wording
//
// รัน: node e2e/features.e2e.mjs   (ต้องรัน vite dev server ไว้ที่ :5173 ก่อน —
//   pnpm dev  หรือ npx vite --host --port 5173 --strictPort)
// ใช้ห้อง Cold (ห้องทดสอบตาม CLAUDE.md) — จบแล้วล้างห้องกลับสะอาด
// req 5 (reset หลังบันทึก) กับ req 3/8/9/11 (ฝั่ง ClickUp) ต้องมี backend + token
// ดูได้ที่ backend/clickup-smoke.js
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
const ROOM = process.env.E2E_ROOM || "Cold";

let failures = 0;
const fail = (msg) => {
  console.log("FAIL:", msg);
  failures++;
};
const ok = (msg) => console.log("PASS:", msg);

/** สร้าง page ใหม่ + เข้าห้องในฐานะ role ที่กำหนด (แยก context = แยก anonymous uid)
 *  realName = บังคับเลือกชื่อจริงเฉพาะเจาะจง (เช่น "Cing") · ไม่ระบุ = ตัวแรกของ role */
async function joinAs(browser, { name, role, room, realName }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/?room=${room}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#landing-page.active", { timeout: 15000 });
  await page.fill("#username-input", name);
  await page.selectOption("#role-select", role);
  await page.selectOption("#room-select", room);
  // รอ member list จาก Firebase เติม dropdown ชื่อจริง (สูงสุด 15 วิ)
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
  const pick = realName ?? names[0];
  if (!names.includes(pick)) {
    throw new Error(`realName "${pick}" ไม่อยู่ในลิสต์ role ${role} (มี: ${names.join(", ")})`);
  }
  await page.selectOption("#realname-select", pick);
  await page.click("#btn-join-room");
  await page.waitForSelector("#room-page.active", { timeout: 20000 });
  return { context, page, pageErrors, realName: pick };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let po = null;
  /** cleanup: PO ล้างห้อง (ทุกคนโดนเตะออก ข้อมูลห้องถูกลบ) — best-effort */
  const cleanupRoom = async () => {
    if (!po?.page) return;
    try {
      if (await po.page.$("#room-page.active")) {
        const btn = await po.page.$("#btn-delete-room");
        if (btn && (await btn.isVisible())) {
          await btn.click();
          await po.page.locator(".modal-overlay.active .btn-confirm-danger").click({ timeout: 5000 });
          await po.page.waitForSelector("#landing-page.active", { timeout: 10000 });
          console.log("cleanup: ล้างห้อง Cold เรียบร้อย");
        }
      }
    } catch (e) {
      console.log("cleanup skipped:", e.message);
    }
  };
  try {
    // ── pre-cleanup: ล้างห้องก่อนเริ่ม กันผู้ใช้ค้างจากรอบทดสอบก่อนหน้า
    //   (ผู้ใช้ offline ยังนับเป็น pending voter ตาม design → ต้องเริ่มจากห้องว่างจริง ๆ)
    const pre = await joinAs(browser, { name: "E2E-Clean", role: "po", room: ROOM });
    await pre.page.click("#btn-delete-room");
    await pre.page.locator(".modal-overlay.active .btn-confirm-danger").click({ timeout: 5000 });
    await pre.page.waitForSelector("#landing-page.active", { timeout: 10000 });
    await pre.context.close();
    ok("pre-cleanup: ล้างห้องก่อนเริ่ม");

    // ── req 12: wording หน้าแรก (ตรวจกับหน้า PO รอบ pre-cleanup ก่อนปิด —
    //   label แสดงหลังเลือกห้อง REAL_NAME + role ≠ admin ซึ่ง joinAs ทำให้แล้ว) ──
    po = await joinAs(browser, { name: "E2E-Po", role: "po", room: ROOM });
    const label = await po.page.textContent("#realname-group label");
    if (label && label.includes("ชื่อที่แสดงใน comment ClickUp")) ok("req 12: label หน้าแรกเปลี่ยนแล้ว");
    else fail(`req 12: label ยังเป็นข้อความเดิม → "${label}"`);
    // (joinAs ใช้ label เดิมไม่ได้ — เข้าห้องไปแล้ว ตรวจ wording กับ dev1 ต่อเลย)

    // ── เข้า dev 2 คน + Dev Cing (deputy) ──
    const dev1 = await joinAs(browser, { name: "E2E-D1", role: "dev", room: ROOM });
    const dev2 = await joinAs(browser, { name: "E2E-D2", role: "dev", room: ROOM });
    const cing = await joinAs(browser, { name: "E2E-Cing", role: "dev", room: ROOM, realName: "Cing" });

    // รอการ์ดของทุกคนโผล่ใน PO (real-time)
    await po.page.waitForSelector('.participant-card[data-uid]', { timeout: 15000 });

    // ── req 1: "ยังไม่ได้เลือกการ์ด" — เฉพาะ admin ของห้อง (PO + Dev Cing) ──
    // ห้องยังไม่มี task → PO และ Cing เห็นแถบเตือนทันที
    for (const [tag, p] of [["PO", po.page], ["Cing", cing.page]]) {
      await p.waitForSelector("#task-required-reminder:not(.hidden)", { timeout: 10000 });
      const text = await p.textContent("#task-required-reminder");
      if (text && text.includes("ยังไม่ได้เลือกการ์ด")) ok(`req 1: ${tag} เห็น "ยังไม่ได้เลือกการ์ด" (ยังไม่มี task)`);
      else fail(`req 1: ${tag} ข้อความเตือนผิด → "${text}"`);
    }
    // สมาชิกทั่วไปไม่เห็นแถบเตือน + ไม่มี card-draw element แล้ว
    await dev1.page.waitForTimeout(800);
    const devReminder = await dev1.page.$("#task-required-reminder:not(.hidden)");
    if (!devReminder) ok("req 1: dev ทั่วไปไม่เห็นแถบเตือน");
    else fail("req 1: dev ทั่วไปไม่ควรเห็นแถบเตือน");
    const drawEl = await dev1.page.$("#card-draw-reminder");
    if (!drawEl) ok("req 1: ไม่มี card-draw reminder บนหน้าสมาชิกแล้ว");
    else fail("req 1: card-draw-reminder ยังค้างใน DOM");

    // ── req 2 (ก่อนโหวต — ยังมีหลายคนไม่โหวต = ไม่เตือน) ──
    await dev1.page.waitForTimeout(1200); // ให้ room tick ไปรอบหนึ่ง
    const earlyLastVoter = await po.page.$(".participant-card.last-voter");
    if (!earlyLastVoter) ok("req 2: ยังเหลือหลายคน = ยังไม่เตือนใคร");
    else fail("req 2: เตือนทั้งที่ยังเหลือหลายคน");

    // Task gate: ห้องยังไม่มี task → การ์ดถูกล็อค — PO ติ๊ก "Groom ไม่มี Task"
    // ชั่วคราวเพื่อปลดล็อคการ์ดให้โหวตได้ (จะ untick คืนก่อน req 6)
    await po.page.click("#no-need-task");
    for (const p of [dev1.page, cing.page]) {
      await p.waitForFunction(
        () => !document.querySelector(".poker-card")?.classList.contains("disabled"),
        null,
        { timeout: 10000 },
      );
    }

    // dev1 + Cing โหวต → เหลือ dev2 คนเดียว = last voter
    await dev1.page.click('.poker-card:not(.custom-card)');
    await cing.page.click('.poker-card:not(.custom-card)');

    // ทุกหน้าต้องเห็นป้าย "เพื่อนสมาชิกรอคุณอยู่" ที่การ์ดคนที่ยังไม่โหวต (dev2)
    for (const [tag, p] of [["PO", po.page], ["dev1", dev1.page], ["dev2", dev2.page]]) {
      await p.waitForSelector(".participant-card.last-voter .last-voter-label", { timeout: 10000 });
      const text = await p.textContent(".participant-card.last-voter .last-voter-label");
      if (text && text.includes("เพื่อนสมาชิกรอคุณอยู่")) ok(`req 2: ${tag} เห็นแจ้งเตือนคนสุดท้าย`);
      else fail(`req 2: ${tag} เห็น label แต่ข้อความผิด → "${text}"`);
    }

    // dev2 โหวต → แจ้งเตือนหยุดทันทีทุกหน้า
    await dev2.page.waitForFunction(
      () => !document.querySelector(".poker-card")?.classList.contains("disabled"),
      null,
      { timeout: 10000 },
    );
    await dev2.page.click('.poker-card:not(.custom-card)');
    for (const [tag, p] of [["PO", po.page], ["dev1", dev1.page]]) {
      await p.waitForSelector(".participant-card.last-voter", { state: "detached", timeout: 10000 });
      ok(`req 2: ${tag} เห็นแจ้งเตือนหยุดหลัง dev2 โหวต`);
    }

    // untick "Groom ไม่มี Task" คืน — req 6 ต้องการ reminder ทำงานตอนไม่มี task
    await po.page.click("#no-need-task");
    await po.page.waitForTimeout(1200); // รอ flag sync ทั้งห้อง

    // ── req 4: wheel outside click ──
    await po.page.click("#btn-wheel");
    await po.page.waitForSelector("#wheel-panel.open", { timeout: 10000 });
    ok("req 4: เปิด wheel ได้");
    // คลิกใน panel → ไม่ปิด
    await po.page.click("#wheel-member-list", { position: { x: 10, y: 10 } }).catch(() => {});
    await po.page.waitForTimeout(400);
    if (await po.page.$("#wheel-panel.open")) ok("req 4: คลิกใน panel ไม่ปิด");
    else fail("req 4: คลิกใน panel แล้วปิดเอง (ผิด)");
    // Escape → ปิด
    await po.page.keyboard.press("Escape");
    await po.page.waitForFunction(
      () => !document.getElementById("wheel-panel")?.classList.contains("open"),
      null,
      { timeout: 5000 },
    );
    ok("req 4: Escape ปิด wheel");
    // เปิดใหม่ → คลิกนอก panel (พื้นที่เนื้อหาหลัก) → ปิด
    await po.page.click("#btn-wheel");
    await po.page.waitForSelector("#wheel-panel.open", { timeout: 10000 });
    // คลิกนอก panel ด้วยพิกัดฝั่งขวาของจอ — panel สไลด์ออกจากซ้ายกว้าง 640px
    // บังทั้ง .section-title / .room-info / คอลัมน์ซ้ายทั้งหมด (จุดคลิกเดิมโดนบัง)
    await po.page.mouse.click(1000, 400);
    await po.page.waitForFunction(
      () => !document.getElementById("wheel-panel")?.classList.contains("open"),
      null,
      { timeout: 5000 },
    );
    ok("req 4: คลิกนอก panel ปิด wheel อัตโนมัติ");

    // ── req 6: task-required reminder (มีคนโหวตแต่ไม่มี task → เตือน PO + Dev Cing) ──
    const clearBtn = await po.page.$("#btn-clickup-clear:not(.hidden)");
    if (clearBtn) {
      await clearBtn.click();
      await po.page.waitForTimeout(1500); // รอ activeTask:null sync
    }
    await po.page.fill("#clickup-url-input", "");
    for (const [tag, p] of [["PO", po.page], ["Cing", cing.page]]) {
      await p.waitForSelector("#task-required-reminder:not(.hidden)", { timeout: 10000 });
      const reminderText = await p.textContent("#task-required-reminder");
      if (reminderText && reminderText.includes("กรุณาดึง Task จาก ClickUp")) {
        ok(`req 6: ${tag} เห็นแจ้งเตือน 'กรุณาดึง Task ก่อน' เมื่อมีคนโหวตแต่ยังไม่มี task`);
      } else {
        fail(`req 6: ${tag} ข้อความแจ้งเตือนผิด → "${reminderText}"`);
      }
    }
    // dev ทั่วไปไม่ต้องเห็น (banner ถูกซ่อนตอนไม่มี task)
    const devReminder2 = await dev1.page.$("#task-required-reminder:not(.hidden)");
    if (!devReminder2) ok("req 6: dev ทั่วไปไม่เห็นแถบเตือน (admin-only)");
    else fail("req 6: dev ทั่วไปไม่ควรเห็นแถบเตือนนี้");

    // ── pageerror รวม ──
    const allErrors = [...po.pageErrors, ...dev1.pageErrors, ...dev2.pageErrors, ...cing.pageErrors];
    if (allErrors.length === 0) ok("ไม่มี pageerror ระหว่างทดสอบ");
    else fail(`pageerror: ${JSON.stringify(allErrors, null, 2)}`);

    // ── cleanup ──
    await cleanupRoom();
  } catch (e) {
    fail(e.message);
    await cleanupRoom();
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\nE2E: ALL PASS ✅" : `\nE2E: ${failures} FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
