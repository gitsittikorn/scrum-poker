// @vitest-environment happy-dom
// เทส req 13 (No Need Task — ซ่อนแถบเตือน) และ req 14 (No Need Test — บันทึก
// แบบตัด QA ออก + ติด tag) แบบ integration ผ่านโมดูล clickup/voting จริง
// mock เฉพาะ Firebase, ui/chat/sounds และ fetch ของ backend proxy
import { describe, it, expect, beforeEach, vi } from "vitest";
import html from "../index.html?raw";

const h = vi.hoisted(() => {
  // ข้อมูลห้องที่ firebase get จะคืน (แก้ต่อเคสได้) + response ของแต่ละ route
  const store: {
    room: unknown;
    responses: Record<string, { data: unknown; status?: number }>;
  } = {
    room: null,
    responses: {},
  };
  const calls = { fetch: [] as { path: string; body: Record<string, unknown> }[] };
  return { store, calls };
});

vi.mock("../firebase", () => ({
  db: {},
  ref: vi.fn((...parts: unknown[]) => ({
    path: parts.filter((p) => typeof p === "string").join("/"),
  })),
  onValue: vi.fn(),
  get: vi.fn(async (r: { path: string }) =>
    r.path === "rooms/Cold"
      ? { exists: () => true, val: () => h.store.room }
      : { exists: () => false, val: () => null },
  ),
  set: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  off: vi.fn(),
  push: vi.fn(() => ({ key: "push1" })),
  onDisconnect: vi.fn(() => ({ set: vi.fn(), remove: vi.fn(), cancel: vi.fn() })),
  serverTimestamp: vi.fn(() => 0),
  query: vi.fn((r: unknown) => r),
  orderByKey: vi.fn((r: unknown) => r),
}));

vi.mock("../ui", () => ({
  showToast: vi.fn(),
  showNotVotedModal: vi.fn(),
  showConfirmModal: vi.fn(),
  showSaveSplash: vi.fn(),
  showWakeNotice: vi.fn(),
}));
vi.mock("../chat", () => ({ sendSystemMessage: vi.fn(async () => {}) }));
vi.mock("../sounds", () => ({ playSound: vi.fn(), sendSound: vi.fn() }));

// โหลด markup จริงก่อน import โมดูลที่อ่าน element ตอนโหลด (dom.ts)
document.body.innerHTML = html
  .match(/<body>([\s\S]*)<\/body>/)![1]
  .replace(/<script[\s\S]*?<\/script>/g, "");

// stub fetch ที่ clickup.ts ใช้คุยกับ backend — route ตาม path + เก็บทุก call
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    h.calls.fetch.push({ path, body });
    for (const key of Object.keys(h.store.responses)) {
      if (!path.includes(`/api/clickup/${key}`)) continue;
      const r = h.store.responses[key];
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.data };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }),
);

const {
  updateTaskRequiredReminder,
  setNoNeedTask,
  renderTaskBanner,
  handleSaveToClickUp,
} = await import("../clickup");
const { state } = await import("../state");
const { updateUI } = await import("../voting");
const { noNeedTaskCheckbox, noNeedTestCheckbox, noNeedToggles, btnSaveClickup, clickupTaskRow } = await import("../dom");
const { showToast } = await import("../ui");
const { initInfoTips } = await import("../infoTips");
const { update: updateMock } = await import("../firebase");
import type { ActiveTask, RoomData, User } from "../types";

const ROOM = "Cold";
const reminderEl = document.getElementById("task-required-reminder")!;
const scrollSpy = vi.fn();
reminderEl.scrollIntoView = scrollSpy;

const user = (over: Partial<User> & Pick<User, "name" | "role">): User => ({
  vote: null,
  online: true,
  lastSeen: 0,
  realName: null,
  ...over,
});

const activeTask: ActiveTask = {
  taskId: "task-1",
  name: "Card A",
  url: "https://app.clickup.com/t/task-1",
  setBy: "Yam",
  timestamp: 0,
  historyKey: "hist-1",
};

/** ห้องไม่มี task ไม่ reveal — สภาพที่แถบเตือนต้องแสดงต่อ admin ของห้อง */
const noTaskRoom = (): RoomData => ({
  createdAt: 0,
  revealed: false,
  locked: false,
  autoUnlockSeconds: 30,
  users: { po1: user({ name: "Yam", realName: "Yam", role: "po" }) },
});

/** ห้อง reveal แล้วมี task + โหวต — สภาพที่กดบันทึก ClickUp ได้
 *  qaSplit = true → QA โหวตไม่ตรงกัน (5/8) ปกติจะบันทึกไม่ได้ */
const revealedRoom = (qaSplit = false): RoomData => ({
  createdAt: 0,
  revealed: true,
  locked: true,
  autoUnlockSeconds: 30,
  users: {
    po1: user({ name: "Yam", realName: "Yam", role: "po" }),
    dev1: user({ name: "Tien", realName: "Tien", role: "dev", vote: "3" }),
    qa1: user({ name: "Run", realName: "Run", role: "qa", vote: "5" }),
    qa2: user({ name: "Ploy", realName: "Ploy", role: "qa", vote: qaSplit ? "8" : "5" }),
  },
  activeTask,
});

const defaultResponses = (): Record<string, { data: unknown; status?: number }> => ({
  "check-existing": { data: { dev: null, qa: null } },
  "save-points": {
    data: { dev: { ok: true, field: "Dev Point Estimation (Original)" }, comment: { ok: true } },
  },
  "add-tag": { data: { ok: true, added: true } },
});

/** ค้นหา call ของ fetch ตาม route */
const fetchCall = (route: string) => h.calls.fetch.find((c) => c.path.includes(route));

/** การ reset หลังบันทึกสำเร็จ = update ที่ payload มี activeTask:null (ล้าง task) */
const resetUpdateCall = () =>
  vi.mocked(updateMock).mock.calls.find(
    ([, payload]) => payload != null && typeof payload === "object" && "activeTask" in (payload as object),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.fetch.length = 0;
  h.store.room = null;
  h.store.responses = defaultResponses();
  state.currentRoom = ROOM;
  state.currentRole = "po";
  state.currentUid = "po1";
  state.currentUser = { uid: "po1", name: "Yam", realName: "Yam" };
  state.noNeedTask = false;
  noNeedTaskCheckbox.checked = false;
  noNeedTestCheckbox.checked = false;
  noNeedTestCheckbox.disabled = true;
  // reset ธง episode การ scroll ใน clickup.ts (เรียกด้วยสถานะไม่ active สักครั้ง)
  updateTaskRequiredReminder(revealedRoom());
});

// ── req 13: No Need Task ─────────────────────────────────────────────────

describe("req 13 — No Need Task (ซ่อนแถบเตือนให้ดึง task)", () => {
  it("default unchecked: admin ของห้องยังเห็นแถบเตือน + scroll ครั้งเดียวต่อ episode", () => {
    expect(noNeedTaskCheckbox.checked).toBe(false); // default ตาม requirement
    updateTaskRequiredReminder(noTaskRoom());
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    updateTaskRequiredReminder(noTaskRoom()); // tick ถัดไป
    expect(scrollSpy).toHaveBeenCalledTimes(1); // ไม่ scroll ซ้ำทุก tick
  });

  it("check → ซ่อนทันที ไม่ scroll ไม่ pulse และ tick ถัดไปยังซ่อน", () => {
    updateTaskRequiredReminder(noTaskRoom());
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    setNoNeedTask(true);
    // ซ่อนทันทีที่ check — ไม่ต้องรอ room tick
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    updateTaskRequiredReminder(noTaskRoom());
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1); // ไม่มี auto scroll เพิ่มหลัง check
  });

  it("check ไม่ลบ task ที่ดึงมาแล้ว — เขียนเฉพาะ field noNeedTask ลงห้อง (sync ทั้งห้อง)", () => {
    setNoNeedTask(true);
    renderTaskBanner(activeTask, "groom");
    // task row ยังแสดงตามปกติ — ข้อมูล task ไม่ถูกแตะ
    expect(clickupTaskRow.classList.contains("hidden")).toBe(false);
    // sync ทั้งห้อง: payload มี noNeedTask เป็น key เดียว — ไม่แตะ task/โหวต
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "rooms/Cold" }),
      { noNeedTask: true },
    );
  });

  it("uncheck → กลับไปเตือนตามเงื่อนไขเดิม (episode ใหม่ scroll ได้อีก)", () => {
    updateTaskRequiredReminder(noTaskRoom()); // episode แรก: แสดง + scroll #1
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    setNoNeedTask(true);
    updateTaskRequiredReminder(noTaskRoom()); // ซ่อนไว้
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    setNoNeedTask(false);
    updateTaskRequiredReminder(noTaskRoom()); // กลับมาเตือน = episode ใหม่
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    expect(scrollSpy).toHaveBeenCalledTimes(2); // episode ใหม่ = scroll ได้อีกครั้ง
  });
});

// ── req 14: No Need Test ─────────────────────────────────────────────────

describe("req 14 — No Need Test (สถานะ checkbox ผูกกับ task ปัจจุบัน)", () => {
  it("default: unchecked + disabled (ยังไม่ดึง task)", () => {
    expect(noNeedTestCheckbox.checked).toBe(false);
    expect(noNeedTestCheckbox.disabled).toBe(true);
  });

  it("ดึง task สำเร็จ (มี activeTask) → enabled · task ถูกล้าง → unchecked + disabled", () => {
    renderTaskBanner(activeTask, "groom");
    expect(noNeedTestCheckbox.disabled).toBe(false);
    noNeedTestCheckbox.checked = true; // จำลองผู้ใช้ติ๊กไว้
    renderTaskBanner(null, "groom"); // task ถูกล้าง (PO กด ✕ / reset หลังบันทึกสำเร็จ)
    expect(noNeedTestCheckbox.checked).toBe(false);
    expect(noNeedTestCheckbox.disabled).toBe(true);
  });
});

describe("req 14 — บันทึก ClickUp แบบ No Need Test (flow จริงผ่าน handleSaveToClickUp)", () => {
  it("checked + สำเร็จ: ไม่ส่ง QA field (null), comment 'QA: no need test', ติด tag, reset ห้อง", async () => {
    // QA โหวตไม่ตรงกัน (5/8) แต่ No Need Test ตัด QA ออก → ต้องบันทึก Dev ได้
    h.store.room = revealedRoom(true);
    noNeedTestCheckbox.disabled = false;
    noNeedTestCheckbox.checked = true;

    await handleSaveToClickUp();

    const save = fetchCall("save-points");
    expect(save).toBeDefined();
    expect(save!.body.qa).toBeNull(); // req 14.2 — ไม่บันทึก/ไม่ทับ QA field
    expect(save!.body.dev).toBe(3); // role อื่นบันทึกตามปกติ
    expect(String(save!.body.comment)).toContain("QA: no need test"); // req 14.3
    expect(String(save!.body.comment)).toContain("Dev: 3");
    expect(String(save!.body.comment)).toContain("Card A"); // ชื่อการ์ดอยู่ใน comment
    // req 20 — ชื่อการ์ดเป็นเนื้อหาบรรทัดสุดท้าย ก่อนเส้นคั่นปิด + มี header ใหม่
    const lines = String(save!.body.comment).trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe("━".repeat(20));
    expect(lines[lines.length - 2]).toBe("📌 การ์ด: Card A");
    expect(lines[1]).toBe("SCRUM POKER | POINT UPDATE");

    const tag = fetchCall("add-tag"); // req 14.1 — ติด tag บนการ์ด
    expect(tag).toBeDefined();
    expect(tag!.body.tag).toBe("no need test");
    expect(tag!.body.taskId).toBe("task-1");

    // reset รอบโหวต (ล้างโหวต + task) หลังบันทึกสำเร็จ
    const reset = resetUpdateCall();
    expect(reset).toBeTruthy();
    expect((reset![1] as Record<string, unknown>).activeTask).toBeNull();

    // room tick ถัดไป (task ถูกล้างไปแล้ว) → checkbox reset ตาม req 14.4
    renderTaskBanner(null, "groom");
    expect(noNeedTestCheckbox.checked).toBe(false);
    expect(noNeedTestCheckbox.disabled).toBe(true);
  });

  it("checked + บันทึกล้มเหลว: toast แจ้ง, ไม่ติด tag, ไม่ reset, checkbox คงสถานะไว้", async () => {
    h.store.room = revealedRoom(false);
    h.store.responses["save-points"] = { status: 500, data: { error: "ClickUp ล่ม" } };
    noNeedTestCheckbox.disabled = false;
    noNeedTestCheckbox.checked = true;

    await handleSaveToClickUp();

    expect(vi.mocked(showToast)).toHaveBeenCalledWith(expect.stringContaining("❌"));
    expect(fetchCall("add-tag")).toBeUndefined(); // ไม่ติด tag เมื่อไม่สำเร็จ
    expect(resetUpdateCall()).toBeUndefined(); // ไม่ reset ห้อง
    // req 14.4 — คงสถานะ checkbox ไว้ให้ลองบันทึกใหม่
    expect(noNeedTestCheckbox.checked).toBe(true);
    expect(noNeedTestCheckbox.disabled).toBe(false);
  });

  it("unchecked (ใช้งานปกติ): บันทึก QA ลง field ตามเดิม และไม่ติด tag", async () => {
    h.store.room = revealedRoom(false); // QA ตรงกัน 5/5
    noNeedTestCheckbox.disabled = false;
    noNeedTestCheckbox.checked = false;

    await handleSaveToClickUp();

    const save = fetchCall("save-points");
    expect(save!.body.qa).toBe(5); // QA ถูกบันทึกปกติ
    expect(String(save!.body.comment)).toContain("QA: 5");
    expect(String(save!.body.comment)).not.toContain("no need test");
    expect(fetchCall("add-tag")).toBeUndefined(); // ไม่มี tag เมื่อไม่ได้ติ๊ก
  });
});

describe("req 14 — ปุ่มบันทึก (renderSaveButton ผ่าน updateUI)", () => {
  it("QA ไม่ตรงกัน: ปกติปุ่ม disabled · ติ๊ก No Need Test → ปุ่ม enabled + label 'QA no need test'", () => {
    const room = revealedRoom(true); // QA 5/8 ไม่ตรงกัน
    noNeedTestCheckbox.disabled = true; // ยังไม่มี task ใน DOM state เดิม
    updateUI({ ...room, activeTask: undefined }); // ไม่มี task → ปุ่มซ่อน, checkbox disabled
    expect(btnSaveClickup.style.display).toBe("none");

    updateUI(room); // มี task → ปุ่มโชว์ + checkbox enabled อัตโนมัติ
    expect(btnSaveClickup.style.display).toBe("");
    expect(noNeedTestCheckbox.disabled).toBe(false);
    expect(btnSaveClickup.disabled).toBe(true); // QA ไม่ตรง → ปกติต้องรอ

    noNeedTestCheckbox.checked = true; // ติ๊ก No Need Test
    updateUI(room);
    expect(btnSaveClickup.disabled).toBe(false); // QA ไม่นับ readiness แล้ว
    expect(btnSaveClickup.textContent).toContain("Dev 3");
    expect(btnSaveClickup.textContent).toContain("QA no need test");
  });
});

// ── req 16: สิทธิ์การเห็น/ใช้งาน — PO + Dev Cing (deputy) เท่านั้น ───────────

describe("req 16 — Permission & Visibility (เห็นเฉพาะ PO + Dev Cing)", () => {
  it("PO เห็น checkbox ทั้งสองและใช้งานได้", () => {
    renderTaskBanner(activeTask, "groom");
    expect(noNeedToggles.classList.contains("hidden")).toBe(false);
    expect(noNeedTaskCheckbox.disabled).toBe(false);
    expect(noNeedTestCheckbox.disabled).toBe(false); // มี task → enabled
  });

  it("Dev Cing (deputy — realName จาก member list ตาม PO_DEPUTY_REAL_NAMES) เห็นและใช้ได้", () => {
    state.currentRole = "dev";
    state.currentUid = "cing-browser";
    state.currentUser = { uid: "cing-browser", name: "ซิน", realName: "Cing" };
    renderTaskBanner(activeTask, "groom");
    expect(noNeedToggles.classList.contains("hidden")).toBe(false);
    expect(noNeedTestCheckbox.disabled).toBe(false);
    setNoNeedTask(true); // deputy ใช้ได้ — ไม่โดน guard ตีตก
    expect(state.noNeedTask).toBe(true);
  });

  it("Dev/QA/UX ทั่วไปไม่เห็น checkbox และเปลี่ยนสถานะไม่ได้ (แม้ display name จะชื่อ Cing)", () => {
    for (const role of ["dev", "qa", "ux"]) {
      state.currentRole = role;
      state.currentUid = `user-${role}`;
      // display name หลอกเป็น "Cing" แต่ realName (identity จาก member list) เป็นคนอื่น — ต้องไม่ผ่าน
      state.currentUser = { uid: `user-${role}`, name: "Cing", realName: "คนอื่น" };
      renderTaskBanner(activeTask, "groom");
      expect(noNeedToggles.classList.contains("hidden")).toBe(true); // ไม่เห็น
      expect(noNeedTestCheckbox.disabled).toBe(true); // แม้มี task ก็ใช้ไม่ได้
      // แก้ DOM มือ (devtools) → tick ถัดไปต้องถูก force รีเซ็ต
      noNeedTestCheckbox.checked = true;
      renderTaskBanner(activeTask, "groom");
      expect(noNeedTestCheckbox.checked).toBe(false);
      // เรียกตรง ๆ ผ่าน console — guard ต้องกันไว้ ไม่แตะ state
      setNoNeedTask(true);
      expect(state.noNeedTask).toBe(false);
    }
  });
});

// ── req 19: Tooltip ⓘ อธิบายการทำงานของ checkbox ทั้งสอง ────────────────────
// bind ครั้งเดียวทั้งไฟล์ (เรียกซ้ำ = listener ซ้อน toggle ย้อนกลับทันที)
initInfoTips();

const TIP_TEXTS = {
  task:
    "ใช้สำหรับการโหวตประเมิน Point โดยไม่จำเป็นต้องดึง Task จาก ClickUp ระบบจะซ่อนการแจ้งเตือนให้ดึง Task ให้ทุกคนในห้อง และสามารถดำเนินการโหวตได้ตามปกติ โดยไม่มีการบันทึก Point ไปยัง ClickUp Task",
  test:
    "ใช้สำหรับ Task ที่ไม่จำเป็นต้องให้ QA ทดสอบ เมื่อบันทึก Point ระบบจะเพิ่ม Tag 'no need test' ใน ClickUp โดยไม่อัปเดต QA Point ใน Custom Field และระบุ 'QA: no need test' ใน Comment แทนคะแนน QA",
} as const;

const tipBtn = (which: "task" | "test"): HTMLButtonElement =>
  noNeedToggles.querySelector(
    `.no-need-toggle:nth-child(${which === "task" ? 1 : 2}) .info-tip`,
  ) as HTMLButtonElement;

describe("req 19 — Tooltip ⓘ อธิบาย No Need Task / No Need Test", () => {
  it("มีไอคอน info ครบทั้งสอง checkbox พร้อมข้อความ tooltip ตาม requirement ภาษาไทย", () => {
    const btns = noNeedToggles.querySelectorAll(".info-tip");
    expect(btns).toHaveLength(2);
    const bubbles = noNeedToggles.querySelectorAll(".info-tip-bubble");
    expect(bubbles[0].textContent).toBe(TIP_TEXTS.task);
    expect(bubbles[1].textContent).toBe(TIP_TEXTS.test);
    // tooltip เป็นส่วนหนึ่งของ toggle → ซ่อน/แสดงตามสิทธิ์ admin ของห้อง (req 19 ข้อ 7)
    state.currentRole = "qa";
    state.currentUid = "qa9";
    state.currentUser = { uid: "qa9", name: "ใครก็ได้", realName: "คนอื่น" };
    renderTaskBanner(activeTask, "groom");
    expect(noNeedToggles.classList.contains("hidden")).toBe(true);
    state.currentRole = "po"; // คืนค่าเดิมให้เคสถัด ๆ
  });

  it("แตะ/คลิกไอคอน = เปิด tooltip (aria-expanded) แม้ No Need Test ยัง disabled (req 19 ข้อ 8)", () => {
    renderTaskBanner(null, "groom"); // ยังไม่มี task → checkbox unchecked + disabled
    expect(noNeedTestCheckbox.disabled).toBe(true);
    const btn = tipBtn("test");
    btn.click();
    expect(btn.classList.contains("open")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    btn.click(); // แตะซ้ำ = ปิด
    expect(btn.classList.contains("open")).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("คลิกที่อื่น = ปิด tooltip เปิดค้างไว้ (mobile)", () => {
    const btn = tipBtn("task");
    btn.click();
    expect(btn.classList.contains("open")).toBe(true);
    document.body.click(); // แตะนอกไอคอน
    expect(btn.classList.contains("open")).toBe(false);
  });

  it("Esc ปิด tooltip (keyboard access)", () => {
    const btn = tipBtn("test");
    btn.click();
    expect(btn.classList.contains("open")).toBe(true);
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(btn.classList.contains("open")).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});

// ── req 17: toggle หลายรอบ — แถบเตือนต้องกลับมาทันทีโดยไม่ต้องรอ room tick ──

describe("req 17 — Warning กลับมาหลัง uncheck (ห้องนิ่ง ไม่มี room tick ใหม่)", () => {
  it("check → uncheck สลับหลายรอบ: ซ่อน/แสดงทันทีทุกครั้ง ไม่ต้อง refresh", () => {
    updateTaskRequiredReminder(noTaskRoom()); // tick เดียว จากนั้น "ห้องนิ่ง"
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    setNoNeedTask(true);
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    // bug เดิม: uncheck แล้วค้างซ่อนจนกว่าจะมีคนโหวต/ขยับห้อง (ไม่มี tick มา render ใหม่)
    setNoNeedTask(false);
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    setNoNeedTask(true);
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    setNoNeedTask(false);
    expect(reminderEl.classList.contains("hidden")).toBe(false);
  });

  it("uncheck แล้ว auto scroll กลับมาทำงานตามเงื่อนไขเดิม (episode ใหม่)", () => {
    updateTaskRequiredReminder(noTaskRoom());
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    setNoNeedTask(true); // ซ่อน — ไม่ scroll เพิ่ม
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    setNoNeedTask(false); // กลับมาแสดง = episode ใหม่ → scroll อีกครั้ง
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("มี task แล้วไม่แสดงแถบไม่ว่า checkbox จะอยู่สถานะใด", () => {
    updateTaskRequiredReminder({ ...noTaskRoom(), activeTask });
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    setNoNeedTask(true);
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    setNoNeedTask(false);
    expect(reminderEl.classList.contains("hidden")).toBe(true);
  });

  it("toggle หลายรอบ — เขียนเฉพาะ noNeedTask ทุกครั้ง ไม่แตะ field อื่นในห้อง", () => {
    updateTaskRequiredReminder(noTaskRoom());
    setNoNeedTask(true);
    setNoNeedTask(false);
    setNoNeedTask(true);
    // 3 ครั้ง = 3 writes ที่มี "แค่" noNeedTask เป็น key — โหวต/task ไม่ถูกแตะ
    const payloads = vi.mocked(updateMock).mock.calls.map((c) => c[1]);
    expect(payloads).toEqual([{ noNeedTask: true }, { noNeedTask: false }, { noNeedTask: true }]);
  });
});

// ── sync ทั้งห้อง: noNeedTask อยู่ที่ rooms/{roomId}/noNeedTask (แทน pref รายเครื่อง) ──

describe("sync ทั้งห้อง — แถบเตือน/checkbox ตามค่าจาก Firebase ไม่ใช่เครื่องตัวเอง", () => {
  it("อีก admin ติ๊ก (room tick ส่ง noNeedTask=true) → เครื่องเราแถบหาย + checkbox ติ๊กตาม แม้ไม่ได้กดเอง", () => {
    updateTaskRequiredReminder(noTaskRoom());
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    expect(noNeedTaskCheckbox.checked).toBe(false);

    updateTaskRequiredReminder({ ...noTaskRoom(), noNeedTask: true }); // tick จาก Firebase
    expect(reminderEl.classList.contains("hidden")).toBe(true);
    expect(noNeedTaskCheckbox.checked).toBe(true); // checkbox sync ตาม
    expect(state.noNeedTask).toBe(true);
  });

  it("uncheck จากอีกเครื่อง → tick ถัดไปทุกเครื่องกลับมาเตือน + checkbox คืน", () => {
    updateTaskRequiredReminder({ ...noTaskRoom(), noNeedTask: true });
    updateTaskRequiredReminder({ ...noTaskRoom(), noNeedTask: false });
    expect(reminderEl.classList.contains("hidden")).toBe(false);
    expect(noNeedTaskCheckbox.checked).toBe(false);
  });

  it("เครื่อง deputy (เช่น Dev Cing) ได้ผลเหมือนกัน — เพราะอ่านจากค่าห้องไม่ใช่เครื่องผู้ติ๊ก", () => {
    state.currentRole = "dev";
    state.currentUid = "cing-browser";
    state.currentUser = { uid: "cing-browser", name: "ซิน", realName: "Cing" };
    updateTaskRequiredReminder({ ...noTaskRoom(), noNeedTask: true });
    expect(reminderEl.classList.contains("hidden")).toBe(true); // deputy ก็หายแถบ
    expect(noNeedTaskCheckbox.checked).toBe(true);
  });
});
