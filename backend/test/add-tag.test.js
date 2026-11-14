// Integration tests — backend proxy กับ ClickUp API (req 18 ข้อ 8)
// รัน ClickUp API ปลอมเป็น HTTP server จริงบน 127.0.0.1 แล้วชี้ axios ของ app
// ไปที่มันผ่าน CLICKUP_API_BASE — แบบนี้ตรวจได้แม่นกว่า mock ฟังก์ชัน:
//   - URL encoding จริงใน path (req.url ที่ server รับยังเป็น raw "no%20need%20test")
//   - ลำดับ/method ของทุก request ที่หนังสือออกไป (กันลบ/แตะ tag อื่น)
//   - mapping HTTP error ของ ClickUp → ข้อความไทยของ route
// รัน: cd backend && npm test
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const TAG = "no need test";

// ── fixtures ที่แต่ละเคสปรับได้ ──────────────────────────────────────────
const fx = {
  task: null, // GET /task/{taskId} → การ์ดปัจจุบัน (space.id + tags)
  spaceTags: [], // GET /space/{spaceId}/tag → รายการ tag ของ space
  attachStatus: 200, // PUT .../tag/{name} (Add Tag To Task) → status ที่จะตอบ
  attachBody: {},
};
const calls = []; // ทุก request ที่ยิงเข้า mock: { method, url (raw), body }

// ── mock ClickUp API ────────────────────────────────────────────────────
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    calls.push({ method: req.method, url: req.url, body });
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    let m;
    if (req.method === "GET" && (m = req.url.match(/^\/task\/([^/?]+)$/))) {
      if (m[1] === "gone-task") return send(404, { err: "Task not found", ECODE: "TAS_011" });
      return send(200, fx.task);
    }
    if (req.method === "GET" && req.url.match(/^\/space\/([^/?]+)\/tag$/)) {
      return send(200, { tags: fx.spaceTags });
    }
    if (req.method === "POST" && req.url.match(/^\/space\/([^/?]+)\/tag$/)) {
      return send(200, {});
    }
    if (req.method === "PUT" && (m = req.url.match(/^\/task\/([^/?]+)\/tag\/(.+)$/))) {
      if (fx.attachStatus !== 200) return send(fx.attachStatus, fx.attachBody);
      return send(200, {});
    }
    // สำหรับเคส save-points
    if (req.method === "POST" && req.url.match(/^\/task\/([^/?]+)\/field\/([^/?]+)$/)) {
      return send(200, {});
    }
    if (req.method === "POST" && req.url.match(/^\/task\/([^/?]+)\/comment$/)) {
      return send(200, {});
    }
    // อย่างอื่นที่ไม่รู้จัก = fail ดัง ๆ (แปลว่า route ยิงอะไรผิดสังเกต)
    send(404, { err: `unexpected ${req.method} ${req.url}` });
  });
});

let appUrl;
let appServer;

// ── boot mock + app (env ต้องตั้งก่อน require ../app เพราะอ่านตอนโหลด) ──
before(async () => {
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  process.env.CLICKUP_API_BASE = `http://127.0.0.1:${mock.address().port}`;
  const app = require("../app");
  appServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => appServer.on("listening", resolve));
  appUrl = `http://127.0.0.1:${appServer.address().port}`;
});

// ปิดทั้งสอง server — ไม่งั้น event loop ค้างทำให้ node --test ไม่จบ
after(async () => {
  await Promise.all([
    new Promise((resolve) => mock.close(resolve)),
    new Promise((resolve) => appServer.close(resolve)),
  ]);
});

const post = (path, body) =>
  fetch(appUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

beforeEach(() => {
  calls.length = 0;
  fx.task = { id: "t1", name: "Card ทดสอบ", space: { id: "sp1" }, tags: [], custom_fields: [] };
  fx.spaceTags = [{ name: TAG, id: "tag1" }];
  fx.attachStatus = 200;
  fx.attachBody = {};
});

const attachCalls = () => calls.filter((c) => c.method === "PUT" && /^\/task\/[^/]+\/tag\//.test(c.url));
const spaceCreateCalls = () => calls.filter((c) => c.method === "POST" && /^\/space\/[^/]+\/tag$/.test(c.url));
const fieldCalls = () => calls.filter((c) => /^\/task\/[^/]+\/field\//.test(c.url));

// ── req 18: POST /api/clickup/add-tag ───────────────────────────────────

test("เพิ่ม tag สำเร็จ: ตรวจ space tags → ใช้ tag เดิม (ไม่สร้างใหม่) → แนบให้ task ด้วย URL ที่ encode แล้ว", async () => {
  const r = await post("/api/clickup/add-tag", { taskId: "t1", tag: TAG });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, added: true });

  // ตรวจรายการ tags ของ space ของ task จริง (GET /space/sp1/tag — space id มาจากการ์ด)
  assert.ok(
    calls.some((c) => c.method === "GET" && c.url === "/space/sp1/tag"),
    "ต้อง GET /space/sp1/tag เพื่อค้นหา tag ที่มีอยู่",
  );
  // tag มีอยู่แล้ว → ห้ามสร้างซ้ำ
  assert.equal(spaceCreateCalls().length, 0, "ไม่ต้อง POST /space/sp1/tag เมื่อ tag มีอยู่แล้ว");
  // แนบ tag ให้ task 1 ครั้ง โดยช่องว่างถูก encode เป็น %20
  assert.deepEqual(
    attachCalls().map((c) => c.url),
    ["/task/t1/tag/no%20need%20test"],
  );
  // ไม่มีการลบ tag ของการ์ด (แนบด้วย PUT ครั้งเดียวตามด้านบน — ไม่มี DELETE)
  assert.ok(!calls.some((c) => c.method === "DELETE"));
});

test("task มี tag อยู่แล้ว (ตรงตัว) → ok ทันที ไม่เขียนอะไรลง ClickUp เลย (กัน tag ซ้ำ)", async () => {
  fx.task.tags = [{ name: TAG, tag_fg: "#fff", tag_bg: "#000" }];
  const r = await post("/api/clickup/add-tag", { taskId: "t1", tag: TAG });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, added: false, reason: "already-tagged" });
  assert.equal(attachCalls().length, 0);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "ต้องไม่มีการเขียนใด ๆ");
});

test("task มี tag ชื่อต่าง case → ถือว่ามีอยู่แล้ว (เทียบแบบ case-insensitive)", async () => {
  fx.task.tags = [{ name: "No Need Test" }];
  const r = await post("/api/clickup/add-tag", { taskId: "t1", tag: TAG });
  assert.deepEqual(r.data, { ok: true, added: false, reason: "already-tagged" });
  assert.equal(attachCalls().length, 0);
});

test("ไม่พบ tag ใน space → สร้าง tag ชื่อเดิมใน space ก่อน แล้วจึงแนบให้ task", async () => {
  fx.spaceTags = [];
  const r = await post("/api/clickup/add-tag", { taskId: "t1", tag: TAG });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, added: true });
  const creates = spaceCreateCalls();
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].body, { name: TAG }); // ชื่อเดิมไม่ถูกแปลง
  assert.deepEqual(
    attachCalls().map((c) => c.url),
    ["/task/t1/tag/no%20need%20test"],
  );
});

test("ClickUp ตอบ error ตอนแนบ tag → route ส่ง error ต่อ ไม่รายงานว่าสำเร็จ", async () => {
  fx.attachStatus = 400;
  fx.attachBody = { err: "Tag ไม่มีใน space" };
  const r = await post("/api/clickup/add-tag", { taskId: "t1", tag: TAG });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "Tag ไม่มีใน space");
  assert.equal(attachCalls().length, 1, "ลองแนบแล้ว 1 ครั้ง — ไม่ retry ซ้ำ");
});

test("task หายไป (404 จาก ClickUp) → error ภาษาไทย status 404", async () => {
  const r = await post("/api/clickup/add-tag", { taskId: "gone-task", tag: TAG });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, "ไม่พบ task นี้ใน ClickUp");
});

test("validation: ไม่ระบุ taskId หรือ tag → 400 โดยไม่ยิงอะไรเข้า ClickUp", async () => {
  assert.equal((await post("/api/clickup/add-tag", { tag: TAG })).status, 400);
  assert.equal((await post("/api/clickup/add-tag", { taskId: "t1" })).status, 400);
  assert.equal(calls.length, 0);
});

test("validation: ชื่อ tag ยาวเกิน 60 ตัวอักษร → 400 (กันสร้าง tag ขยะใน space)", async () => {
  const r = await post("/api/clickup/add-tag", { taskId: "t1", tag: "x".repeat(61) });
  assert.equal(r.status, 400);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

// ── req 18 ข้อ 5-6: สัญญาของ save-points เมื่อ No Need Test ติ๊ก/ไม่ติ๊ก ──

const pointFields = () => [
  { id: "f-dev", name: "Dev Point Estimation (Original)", type: "numeric", value: null },
  { id: "f-qa", name: "QA Point Estimation", type: "numeric", value: null },
];

test("save-points แบบ qa=null (No Need Test ติ๊กอยู่) → เขียนเฉพาะ field ของ Dev + คอมเม้น ไม่แตะ QA field เลย", async () => {
  fx.task.custom_fields = pointFields();
  const r = await post("/api/clickup/save-points", { taskId: "t1", dev: 3, qa: null, comment: "คอมเม้น" });
  assert.equal(r.status, 200);
  assert.equal(r.data.dev.ok, true);
  assert.equal(r.data.qa, undefined, "ไม่มีผลลัพธ์ฝั่ง QA เพราะไม่ได้เขียน");
  const fields = fieldCalls();
  assert.deepEqual(
    fields.map((c) => c.url),
    ["/task/t1/field/f-dev"],
    "ต้องเขียนเฉพาะ field ของ Dev",
  );
  assert.deepEqual(fields[0].body, { value: 3 });
  assert.ok(calls.some((c) => c.method === "POST" && c.url === "/task/t1/comment"));
});

test("save-points แบบมีค่า qa (checkbox ไม่ได้ติ๊ก) → เขียน field ทั้ง Dev + QA ตาม flow ปกติ", async () => {
  fx.task.custom_fields = pointFields();
  const r = await post("/api/clickup/save-points", { taskId: "t1", dev: 3, qa: 5, comment: "คอมเม้น" });
  assert.equal(r.status, 200);
  assert.deepEqual(
    fieldCalls()
      .map((c) => c.url)
      .sort(),
    ["/task/t1/field/f-dev", "/task/t1/field/f-qa"],
  );
});

test("save-points: dev=null และ qa=null พร้อมกัน → 400 ไม่มีค่าให้บันทึก (กันเขียนเปล่า ๆ)", async () => {
  const r = await post("/api/clickup/save-points", { taskId: "t1", dev: null, qa: null });
  assert.equal(r.status, 400);
  assert.equal(fieldCalls().length, 0);
});

test("save-points: point ติดลบ หรือเกิน 9999 → 400 ไม่เขียนลงการ์ด", async () => {
  assert.equal((await post("/api/clickup/save-points", { taskId: "t1", dev: -5, qa: null })).status, 400);
  assert.equal((await post("/api/clickup/save-points", { taskId: "t1", dev: null, qa: 1e7 })).status, 400);
  assert.equal(fieldCalls().length, 0);
});

test("save-points / post-comment: comment ยาวเกิน 20,000 ตัวอักษร → 400", async () => {
  const long = "x".repeat(20001);
  assert.equal(
    (await post("/api/clickup/save-points", { taskId: "t1", dev: 3, qa: null, comment: long })).status,
    400,
  );
  assert.equal((await post("/api/clickup/post-comment", { taskId: "t1", comment: long })).status, 400);
  assert.equal(fieldCalls().length, 0);
});
