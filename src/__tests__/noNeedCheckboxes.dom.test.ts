// @vitest-environment happy-dom
// เทส req 13 (No Need Task — ซ่อนแถบเตือน) และ req 14 (No Need Test — บันทึก
// แบบตัด QA ออก + ติด tag) แบบ integration ผ่านโมดูล clickup/voting จริง
// mock เฉพาะ Firebase, ui/chat/sounds และ fetch ของ backend proxy
import { describe, it, expect, beforeEach, vi } from "vitest";
import html from "../index.html?raw";

const h = vi.hoisted(() => {
  // ข้อมูลห้องที่ firebase get จะคืน (แก้ต่อเคสได้) + response ของแต่ละ route
  const store: {
    room: import("../types").RoomData | null;
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
  get: vi.fn(async (r: { path: string }) => {
    if (!r.path.startsWith("rooms/Cold")) return { exists: () => false, val: () => null };
    // path ย่อย /users ต้องได้ users object — ไม่ใช่ทั้ง room
    if (r.path === "rooms/Cold/users")
      return { exists: () => true, val: () => h.store.room?.users ?? null };
    // path ย่อย /speakerCounts เช่นกัน (ใช้โดย roomReset.buildRoundResetUpdates)
    if (r.path === "rooms/Cold/speakerCounts")
      return { exists: () => true, val: () => h.store.room?.speakerCounts ?? null };
    return { exists: () => true, val: () => h.store.room };
  }),
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
  handleNoNeedTestToggle,
  handleNoNeedDevToggle,
  handleNoNeedUxToggle,
  handleHotFixToggle,
  renderTaskBanner,
  handleSaveToClickUp,
  handleClearClickUpTask,
  handleSetGroomMode,
} = await import("../clickup");
const { state } = await import("../state");
const { updateUI, handleReveal, handleVote, handleCustomVote, handleKick } = await import("../voting");
const { noNeedTaskCheckbox, noNeedTestCheckbox, noNeedDevCheckbox, noNeedUxCheckbox, noNeedToggles, btnSaveClickup, clickupTaskRow, clickupInputRow, clickupUrlInput, hotFixCheckbox, groomModeControls } = await import("../dom");
const { showToast, showNotVotedModal, showConfirmModal } = await import("../ui");
const { initInfoTips } = await import("../infoTips");
const { update: updateMock, set: setMock } = await import("../firebase");
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
  state.noNeedTest = false;
  state.noNeedDev = false;
  state.noNeedUx = false;
  state.hotFix = false;
  noNeedTaskCheckbox.checked = false;
  noNeedTestCheckbox.checked = false;
  noNeedTestCheckbox.disabled = true;
  noNeedDevCheckbox.checked = false;
  noNeedDevCheckbox.disabled = true;
  noNeedUxCheckbox.checked = false;
  noNeedUxCheckbox.disabled = true;
  clickupUrlInput.value = "";
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

  it("Hot Fix ใช้ได้เฉพาะเมื่อดึง task แล้ว — ไม่มี task = unchecked + disabled", () => {
    renderTaskBanner(null, "groom"); // ยังไม่ดึง task
    expect(hotFixCheckbox.disabled).toBe(true);
    expect(hotFixCheckbox.checked).toBe(false);
    renderTaskBanner(activeTask, "groom"); // ดึงสำเร็จ
    expect(hotFixCheckbox.disabled).toBe(false);
    hotFixCheckbox.checked = true; // จำลองผู้ใช้ติ๊กไว้
    renderTaskBanner(null, "groom"); // task ถูกล้าง
    expect(hotFixCheckbox.checked).toBe(false);
    expect(hotFixCheckbox.disabled).toBe(true);
  });

  it("No Need Dev / No Need UX/UI — ผูกกับ task เหมือน No Need Test (default unchecked + disabled)", () => {
    expect(noNeedDevCheckbox.checked).toBe(false);
    expect(noNeedDevCheckbox.disabled).toBe(true);
    expect(noNeedUxCheckbox.checked).toBe(false);
    expect(noNeedUxCheckbox.disabled).toBe(true);
    renderTaskBanner(activeTask, "groom"); // ดึงสำเร็จ → enabled
    expect(noNeedDevCheckbox.disabled).toBe(false);
    expect(noNeedUxCheckbox.disabled).toBe(false);
    noNeedDevCheckbox.checked = true;
    noNeedUxCheckbox.checked = true;
    renderTaskBanner(null, "groom"); // task ถูกล้าง → unchecked + disabled
    expect(noNeedDevCheckbox.checked).toBe(false);
    expect(noNeedDevCheckbox.disabled).toBe(true);
    expect(noNeedUxCheckbox.checked).toBe(false);
    expect(noNeedUxCheckbox.disabled).toBe(true);
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

describe("บันทึกทับ — modal ยืนยันเฉพาะเมื่อการ์ดเคยระบุ point จริง (0/null = ยังไม่เคยระบุ)", () => {
  it("ค่าเดิมว่าง (0 หรือ null): บันทึกเลย ไม่ขึ้น modal ไม่โชว์ '0 → x'", async () => {
    h.store.room = revealedRoom(false); // dev=3, qa=5
    h.store.responses["check-existing"] = { data: { dev: 0, qa: null } };

    await handleSaveToClickUp();

    expect(vi.mocked(showConfirmModal)).not.toHaveBeenCalled();
    const save = fetchCall("save-points");
    expect(save).toBeDefined();
    expect(save!.body.dev).toBe(3);
    expect(save!.body.qa).toBe(5);
  });

  it("เคยระบุไว้ (1): ขึ้น modal 'Dev: 1 → 3' และบันทึกจริงหลังกดยืนยัน", async () => {
    h.store.room = revealedRoom(false); // dev=3, qa=5
    h.store.responses["check-existing"] = { data: { dev: 1, qa: null } };

    await handleSaveToClickUp();

    const modal = vi.mocked(showConfirmModal).mock.calls[0]?.[0];
    expect(modal).toBeTruthy();
    expect(String(modal!.message)).toContain("Dev: 1 → 3");
    // QA ยังไม่เคยระบุ → ไม่ต้องขึ้นบรรทัด "QA: 0 → 5"
    expect(String(modal!.message)).not.toContain("QA:");
    expect(fetchCall("save-points")).toBeUndefined(); // ยังไม่บันทึกจนกดยืนยัน

    await (modal!.onConfirm as () => Promise<void>)();

    const save = fetchCall("save-points");
    expect(save).toBeDefined();
    expect(save!.body.dev).toBe(3);
    expect(save!.body.qa).toBe(5);
  });

  it("ผสม — Dev ยังว่างแต่ QA เคยระบุ: modal มีแต่บรรทัด QA ไม่มี 'Dev: 0 → 3'", async () => {
    h.store.room = revealedRoom(false); // dev=3, qa=5
    h.store.responses["check-existing"] = { data: { dev: null, qa: 5 } };

    await handleSaveToClickUp();

    const modal = vi.mocked(showConfirmModal).mock.calls[0]?.[0];
    expect(modal).toBeTruthy();
    expect(String(modal!.message)).toContain("QA: 5 → 5");
    expect(String(modal!.message)).not.toContain("Dev:");
    expect(fetchCall("save-points")).toBeUndefined(); // รอยืนยันก่อน
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

    noNeedTestCheckbox.checked = true; // ติ๊ก No Need Test (change handler เขียน flag ลง Firebase)
    // room tick ถัดมาเห็น flag จากห้อง (ใน app จริง latency compensation ทำให้ทันที)
    updateUI({ ...room, noNeedTest: true });
    expect(btnSaveClickup.disabled).toBe(false); // QA ไม่นับ readiness แล้ว
    expect(btnSaveClickup.textContent).toContain("Dev 3");
    expect(btnSaveClickup.textContent).toContain("QA no need test");
  });
});

describe("req 14 — No Need Test ล็อคการโหวตของ QA (guard ใน handleVote/handleCustomVote)", () => {
  /** ห้องมี task ยังไม่ reveal + สลับ noNeedTest — เครื่อง QA กดการ์ดต้องโดน guard
   *  (.disabled เป็นแค่ UI — คลิก/Enter ยังมุดเข้า handler ได้ ต้องกันที่ logic) */
  const qaRoom = (noNeedTest: boolean): RoomData => ({
    ...noTaskRoom(),
    noNeedTest,
    activeTask,
    users: {
      po1: user({ name: "Yam", role: "po" }),
      dev1: user({ name: "Tien", role: "dev" }),
      qa1: user({ name: "Run", role: "qa" }),
    },
  });

  it("QA กดการ์ด/custom ตอน noNeedTest — ไม่เขียน vote ลง DB + toast แจ้ง", async () => {
    state.currentRole = "qa";
    state.currentUid = "qa1";
    state.currentUser = { uid: "qa1", name: "Run", realName: "Run" };
    state.selectedCard = null;
    h.store.room = qaRoom(true);

    await handleVote("5");
    const input = Object.assign(document.createElement("input"), { value: "3" });
    await handleCustomVote(input);

    expect(setMock).not.toHaveBeenCalled(); // ไม่มีการเขียน vote ลง Firebase เลย
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("No Need Test"));
    expect(state.selectedCard).toBeNull(); // ไม่มี highlight การ์ดค้าง (ไม่ optimistic)
  });

  it("dev ในห้อง noNeedTest โหวตได้ปกติ · QA กลับมาโหวตได้เมื่อ uncheck", async () => {
    // dev ไม่โดน guard — ห้อง noNeedTest ก็ตาม
    state.currentRole = "dev";
    state.currentUid = "dev1";
    state.currentUser = { uid: "dev1", name: "Tien", realName: "Tien" };
    h.store.room = qaRoom(true);
    await handleVote("3");
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "rooms/Cold/users/dev1/vote" }),
      "3",
    );

    // uncheck → QA โหวตใหม่ได้ตาม req 14 (เขียน vote ปกติ)
    state.currentRole = "qa";
    state.currentUid = "qa1";
    state.currentUser = { uid: "qa1", name: "Run", realName: "Run" };
    h.store.room = qaRoom(false);
    await handleVote("5");
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "rooms/Cold/users/qa1/vote" }),
      "5",
    );
  });
});

describe("เคลียร์ task ✕ = reset ข้อมูลรอบโหวตทันที (handleClearClickUpTask)", () => {
  it("ล้าง task + noNeedTest/noNeedDev/noNeedUx/hotFix + โหวตทุกคน + revealed/locked กลับค่าว่าง ใน update เดียว (atomic)", async () => {
    h.store.room = { ...revealedRoom(true), noNeedTest: true, noNeedDev: true, noNeedUx: true, hotFix: true };

    await handleClearClickUpTask();

    expect(updateMock).toHaveBeenCalledTimes(1); // atomic — update เดียวเท่านั้น
    const [, payload] = vi.mocked(updateMock).mock.calls[0];
    expect(payload).toMatchObject({
      activeTask: null,
      noNeedTest: false,
      noNeedDev: false,
      noNeedUx: false,
      hotFix: false,
      revealed: false,
      locked: false,
      revealTime: null,
      drinkers: null,
      "users/dev1/vote": null,
      "users/qa1/vote": null,
      "users/qa2/vote": null,
    });
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(expect.stringContaining("reset รอบโหวต"));
  });

  it("speakerCounts: ทุกคนที่โหวตเคยพูดแล้ว → ล้างด้วย · ยังไม่ครบ → คงไว้ (anti-streak)", async () => {
    // ทุกคนพูดครบ → จบรอบ ล้างตัวนับพูด
    h.store.room = { ...revealedRoom(false), speakerCounts: { dev1: 1, qa1: 1, qa2: 1 } };
    await handleClearClickUpTask();
    expect(vi.mocked(updateMock).mock.calls[0][1]).toMatchObject({ speakerCounts: null });

    // qa ยังไม่เคยพูด → กลางรอบ คงตัวนับไว้
    vi.clearAllMocks();
    h.store.room = { ...revealedRoom(false), speakerCounts: { dev1: 1 } };
    await handleClearClickUpTask();
    expect(vi.mocked(updateMock).mock.calls[0][1]).not.toHaveProperty("speakerCounts");
  });

  it("ไม่มี users ในห้อง (ห้องว่าง) — ยังเคลียร์ task ได้ ไม่พัง", async () => {
    h.store.room = { ...noTaskRoom(), activeTask };
    await handleClearClickUpTask();
    const [, payload] = vi.mocked(updateMock).mock.calls[0];
    expect(payload).toMatchObject({ activeTask: null, noNeedTest: false, hotFix: false });
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(expect.stringContaining("เคลียร์ task"));
  });
});

// ── URL ในช่อง input เคลียร์บน "ทุกเครื่อง" เมื่อการ์ดจบวงจร (แจ้งเมื่อ PO พบว่า
//    deputy เคลียร์ task แล้ว URL ยังค้างบนจอ PO — เดิมเคลียร์เฉพาะเครื่องผู้กด) ──

describe("เคลียร์ URL ค้างในช่อง input บนทุกเครื่องเมื่อ task ถูกล้าง/สลับการ์ด (renderTaskBanner)", () => {
  it("deputy บันทึกจบรอบ/กด ✕ (tick ส่ง task:null) → URL การ์ดเก่าบนเครื่อง PO ถูกเคลียร์", () => {
    renderTaskBanner(activeTask, "groom"); // PO เคย resolve การ์ดนี้ — URL ค้างในช่อง (behavior เดิม)
    clickupUrlInput.value = activeTask.url;
    renderTaskBanner(null, "groom"); // เครื่องอื่นเคลียร์ task — tick ถึงเครื่อง PO
    expect(clickupUrlInput.value).toBe("");
  });

  it("URL ที่พิมพ์ URL ของการ์ดอื่นไว้ — ไม่ถูกเคลียร์ (รอดึงการ์ดใหม่ต่อ)", () => {
    renderTaskBanner(activeTask, "groom");
    clickupUrlInput.value = "https://app.clickup.com/t/task-999";
    renderTaskBanner(null, "groom");
    expect(clickupUrlInput.value).toBe("https://app.clickup.com/t/task-999");
  });

  it("URL พิมพ์ค้างกลางคัน (ยังไม่ใช่การ์ดเดิมแบบเต็ม) — ไม่ถูกเคลียร์", () => {
    renderTaskBanner(activeTask, "groom");
    clickupUrlInput.value = "https://app.click"; // เริ่มพิมพ์การ์ดใหม่อยู่
    renderTaskBanner(null, "groom");
    expect(clickupUrlInput.value).toBe("https://app.click");
  });

  it("re-resolve การ์ดเดิม (taskId เดิม ชื่อใหม่) — คง URL ไว้ให้กดรีเฟรชซ้ำได้ตามเดิม", () => {
    renderTaskBanner(activeTask, "groom");
    clickupUrlInput.value = activeTask.url;
    renderTaskBanner({ ...activeTask, name: "Card A (edited)" }, "groom");
    expect(clickupUrlInput.value).toBe(activeTask.url);
  });

  it("สลับไปการ์ดอื่น (taskId ต่าง) — URL ของการ์ดเก่าที่ค้างถูกเคลียร์ แต่ของคนดึงการ์ดใหม่ไม่โดนแตะ", () => {
    renderTaskBanner(activeTask, "groom");
    // เครื่อง PO ยังมี URL การ์ดเก่าค้าง
    clickupUrlInput.value = activeTask.url;
    // deputy ดึงการ์ดใหม่บนเครื่องเขา → tick ส่งการ์ดใหม่มาถึงเครื่อง PO
    renderTaskBanner({ ...activeTask, taskId: "task-2", url: "https://app.clickup.com/t/task-2" }, "groom");
    expect(clickupUrlInput.value).toBe("");
  });

  it("แบบใส่ taskId ตรง ๆ แทน URL เต็ม — ก็ถูกเคลียร์เมื่อการ์ดจบ", () => {
    renderTaskBanner(activeTask, "groom");
    clickupUrlInput.value = "task-1";
    renderTaskBanner(null, "groom");
    expect(clickupUrlInput.value).toBe("");
  });
});

// ── req 16: สิทธิ์การเห็น/ใช้งาน — PO + Dev Cing (deputy) เท่านั้น ───────────

describe("req 16 — Permission & Visibility (เห็นเฉพาะ PO + Dev Cing)", () => {
  it("PO เห็น checkbox ทั้งหมดและใช้งานได้", () => {
    renderTaskBanner(activeTask, "groom");
    expect(noNeedToggles.classList.contains("hidden")).toBe(false);
    expect(noNeedTaskCheckbox.disabled).toBe(false);
    expect(noNeedTestCheckbox.disabled).toBe(false); // มี task → enabled
    expect(noNeedDevCheckbox.disabled).toBe(false);
    expect(noNeedUxCheckbox.disabled).toBe(false);
  });

  it("Dev Cing (deputy — realName จาก member list ตาม PO_DEPUTY_REAL_NAMES) เห็นและใช้ได้ + ดึงการ์ดได้เหมือน PO", () => {
    state.currentRole = "dev";
    state.currentUid = "cing-browser";
    state.currentUser = { uid: "cing-browser", name: "ซิน", realName: "Cing" };
    renderTaskBanner(activeTask, "groom");
    expect(noNeedToggles.classList.contains("hidden")).toBe(false);
    expect(noNeedTestCheckbox.disabled).toBe(false);
    // input row ดึงการ์ดเห็นด้วย (เดิม PO เท่านั้น — deputy ดึงไม่ได้)
    expect(clickupInputRow.classList.contains("hidden")).toBe(false);
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
      expect(clickupInputRow.classList.contains("hidden")).toBe(true); // ดึงการ์ดไม่ได้
      expect(noNeedTestCheckbox.disabled).toBe(true); // แม้มี task ก็ใช้ไม่ได้
      expect(noNeedDevCheckbox.disabled).toBe(true);
      expect(noNeedUxCheckbox.disabled).toBe(true);
      // แก้ DOM มือ (devtools) → tick ถัดไปต้องถูก force รีเซ็ต
      noNeedTestCheckbox.checked = true;
      noNeedDevCheckbox.checked = true;
      noNeedUxCheckbox.checked = true;
      renderTaskBanner(activeTask, "groom");
      expect(noNeedTestCheckbox.checked).toBe(false);
      expect(noNeedDevCheckbox.checked).toBe(false);
      expect(noNeedUxCheckbox.checked).toBe(false);
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
  dev:
    "ใช้สำหรับ Task ที่ไม่ต้องการ point จากฝั่ง Dev เมื่อติ๊กระบบจะเคลียร์ point ของ Dev ทุกคนและไม่บังคับให้ Dev โหวตในรอบนี้ โดยไม่บันทึก Dev Point ลง Custom Field (Comment ระบุ 'Dev: no need dev' แทนคะแนน Dev) และไม่เพิ่ม Tag ใน ClickUp",
  ux:
    "ใช้สำหรับ Task ที่ไม่ต้องการ point จากฝั่ง UX/UI เมื่อติ๊กระบบจะเคลียร์ point ของ UX/UI ทุกคนและไม่บังคับให้ UX/UI โหวตในรอบนี้ และไม่เพิ่ม Tag ใน ClickUp",
  hotfix:
    "ใช้กับ Task ที่เป็น Hot Fix — เมื่อบันทึก Point ระบบจะเพิ่ม Tag 'hot fix' ใน ClickUp เลือกอย่างเดียวหรือร่วมกับ No Need Test ก็ได้",
} as const;

/** ลำดับ checkbox ใน DOM: Groom ไม่มี Task(1) · No Need Test(2) · No Need Dev(3) · No Need UX/UI(4) · Hot Fix(5) */
const TIP_ORDER: { key: keyof typeof TIP_TEXTS; nth: number }[] = [
  { key: "task", nth: 1 },
  { key: "test", nth: 2 },
  { key: "dev", nth: 3 },
  { key: "ux", nth: 4 },
  { key: "hotfix", nth: 5 },
];

const tipBtn = (which: "task" | "test" | "dev" | "ux" | "hotfix"): HTMLButtonElement =>
  noNeedToggles.querySelector(`.no-need-toggle:nth-child(${TIP_ORDER.find((t) => t.key === which)!.nth}) .info-tip`) as HTMLButtonElement;

describe("req 19 — Tooltip ⓘ อธิบาย Groom ไม่มี Task / No Need Test / No Need Dev / No Need UX/UI / Hot Fix", () => {
  it("มีไอคอน info ครบทั้งห้า checkbox พร้อมข้อความ tooltip ตาม requirement ภาษาไทย", () => {
    const btns = noNeedToggles.querySelectorAll(".info-tip");
    expect(btns).toHaveLength(5);
    const bubbles = noNeedToggles.querySelectorAll(".info-tip-bubble");
    TIP_ORDER.forEach(({ key, nth }) => {
      expect(bubbles[nth - 1].textContent).toBe(TIP_TEXTS[key]);
    });
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

// ── No Need Test toggle: sync ทั้งห้อง + เคลียร์ point QA ทันทีที่ติ๊ก ──────

describe("No Need Test toggle — sync ทั้งห้อง (rooms/{roomId}/noNeedTest) + เคลียร์ point QA", () => {
  const toggleCall = () =>
    vi.mocked(updateMock).mock.calls.find(
      ([, p]) => p != null && typeof p === "object" && "noNeedTest" in (p as object),
    );

  it("ติ๊ก → เขียน noNeedTest:true + เคลียร์ vote เฉพาะ QA (dev/PO ไม่ถูกแตะ)", async () => {
    // qa1 โหวต "5" อยู่ → ต้องถูกเคลียร์ · dev1 โหวต "3" → ไม่แตะ
    h.store.room = revealedRoom();
    await handleNoNeedTestToggle(true);
    const call = toggleCall();
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.noNeedTest).toBe(true);
    expect(payload["users/qa1/vote"]).toBeNull();
    expect(payload["users/qa2/vote"]).toBeNull();
    expect(payload["users/dev1/vote"]).toBeUndefined();
  });

  it("uncheck → เขียน noNeedTest:false เท่านั้น (ไม่แตะโหวตใคร)", async () => {
    await handleNoNeedTestToggle(false);
    const call = toggleCall();
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ noNeedTest: false });
  });

  it("คนที่ไม่มีสิทธิ์ (QA ทั่วไป) เรียกตรง ๆ → ไม่เขียนอะไรลง Firebase", async () => {
    state.currentRole = "qa";
    state.currentUid = "qa9";
    state.currentUser = { uid: "qa9", name: "ใครก็ได้", realName: "คนอื่น" };
    await handleNoNeedTestToggle(true);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ── No Need Dev / No Need UX/UI: เหมือน No Need Test แต่ไม่ติด tag ใน ClickUp ──

/** ห้อง reveal มี task + dev 2 คนโหวตไม่ตรงกัน (3/8) + qa ตรงกัน (5) + ux โหวตแล้ว */
const revealedRoomDevSplit = (): RoomData => ({
  ...revealedRoom(false),
  users: {
    ...revealedRoom(false).users,
    dev2: user({ name: "Bell", realName: "Bell", role: "dev", vote: "8" }),
    ux1: user({ name: "Fai", realName: "Fai", role: "ux", vote: "2" }),
  },
});

describe("No Need Dev toggle — sync ทั้งห้อง + เคลียร์ point เฉพาะ Dev", () => {
  const toggleCall = () =>
    vi.mocked(updateMock).mock.calls.find(
      ([, p]) => p != null && typeof p === "object" && "noNeedDev" in (p as object),
    );

  it("ติ๊ก → เขียน noNeedDev:true + เคลียร์ vote เฉพาะ Dev (qa/ux/PO ไม่ถูกแตะ)", async () => {
    h.store.room = revealedRoomDevSplit(); // dev1=3, dev2=8, qa=5, ux=2
    await handleNoNeedDevToggle(true);
    const call = toggleCall();
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.noNeedDev).toBe(true);
    expect(payload["users/dev1/vote"]).toBeNull();
    expect(payload["users/dev2/vote"]).toBeNull();
    expect(payload["users/qa1/vote"]).toBeUndefined();
    expect(payload["users/ux1/vote"]).toBeUndefined();
  });

  it("uncheck → เขียน noNeedDev:false เท่านั้น (ไม่แตะโหวตใคร)", async () => {
    await handleNoNeedDevToggle(false);
    expect(toggleCall()![1]).toEqual({ noNeedDev: false });
  });

  it("คนที่ไม่มีสิทธิ์ (dev ทั่วไป) เรียกตรง ๆ → ไม่เขียนอะไรลง Firebase", async () => {
    state.currentRole = "dev";
    state.currentUid = "dev9";
    state.currentUser = { uid: "dev9", name: "ใครก็ได้", realName: "คนอื่น" };
    await handleNoNeedDevToggle(true);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("No Need UX/UI toggle — sync ทั้งห้อง + เคลียร์ point เฉพาะ UX/UI", () => {
  const toggleCall = () =>
    vi.mocked(updateMock).mock.calls.find(
      ([, p]) => p != null && typeof p === "object" && "noNeedUx" in (p as object),
    );

  it("ติ๊ก → เขียน noNeedUx:true + เคลียร์ vote เฉพาะ UX/UI (dev/qa ไม่ถูกแตะ)", async () => {
    h.store.room = revealedRoomDevSplit();
    await handleNoNeedUxToggle(true);
    const call = toggleCall();
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.noNeedUx).toBe(true);
    expect(payload["users/ux1/vote"]).toBeNull();
    expect(payload["users/dev1/vote"]).toBeUndefined();
    expect(payload["users/qa1/vote"]).toBeUndefined();
  });

  it("uncheck → เขียน noNeedUx:false เท่านั้น", async () => {
    await handleNoNeedUxToggle(false);
    expect(toggleCall()![1]).toEqual({ noNeedUx: false });
  });
});

describe("บันทึก ClickUp แบบ No Need Dev — ไม่ส่ง Dev field, comment 'Dev: no need dev', ไม่ติด tag", () => {
  it("checked + dev โหวตไม่ตรงกัน: บันทึก QA ได้ + dev เป็น null + ไม่มี add-tag เลย + reset noNeedDev", async () => {
    h.store.room = revealedRoomDevSplit(); // dev 3/8 ไม่ตรง — No Need Dev ตัด Dev ออก
    noNeedDevCheckbox.disabled = false;
    noNeedDevCheckbox.checked = true;

    await handleSaveToClickUp();

    const save = fetchCall("save-points");
    expect(save).toBeDefined();
    expect(save!.body.dev).toBeNull(); // ไม่บันทึก/ไม่ทับ Dev field
    expect(save!.body.qa).toBe(5); // QA บันทึกตามปกติ
    expect(String(save!.body.comment)).toContain("Dev: no need dev");
    expect(String(save!.body.comment)).toContain("QA: 5");
    // ความต่างจาก No Need Test: ไม่ติด tag ใด ๆ ใน ClickUp
    expect(fetchCall("add-tag")).toBeUndefined();
    // reset รอบโหวต — noNeedDev กลับ false พร้อม task
    const reset = resetUpdateCall();
    expect(reset).toBeTruthy();
    expect((reset![1] as Record<string, unknown>).noNeedDev).toBe(false);
    expect((reset![1] as Record<string, unknown>).noNeedUx).toBe(false);
  });

  it("ทั้ง No Need Dev + No Need Test ติ๊กอยู่ → ไม่มีค่าเหลือให้บันทึก (dev=null, qa=null) → toast เตือน", async () => {
    h.store.room = revealedRoomDevSplit();
    noNeedDevCheckbox.disabled = false;
    noNeedDevCheckbox.checked = true;
    noNeedTestCheckbox.disabled = false;
    noNeedTestCheckbox.checked = true;

    await handleSaveToClickUp();

    expect(fetchCall("save-points")).toBeUndefined();
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(expect.stringContaining("ไม่มีโหวตจาก Dev/QA"));
  });

  it("Hot Fix ร่วมกับ No Need Dev → ติดแค่ tag 'hot fix' (ฝั่ง Dev ยังไม่ติด tag)", async () => {
    h.store.room = revealedRoomDevSplit();
    noNeedDevCheckbox.disabled = false;
    noNeedDevCheckbox.checked = true;
    state.hotFix = true;
    await handleSaveToClickUp();
    const tags = h.calls.fetch.filter((c) => c.path.includes("add-tag")).map((c) => c.body.tag);
    expect(tags).toEqual(["hot fix"]);
  });
});

describe("ปุ่มบันทึก + Reveal + guard โหวต ของ No Need Dev / No Need UX/UI", () => {
  /** ห้องมี task ยังไม่ reveal — dev 2 คนโหวตต่างกัน qa/ux ยังไม่ใส่ */
  const votingRoomDevSplit = (flags: Partial<RoomData>): RoomData => ({
    ...noTaskRoom(),
    activeTask,
    ...flags,
    users: {
      po1: user({ name: "Yam", role: "po" }),
      dev1: user({ name: "Tien", role: "dev", vote: "3" }),
      dev2: user({ name: "Bell", role: "dev", vote: "8" }),
      qa1: user({ name: "Run", role: "qa" }), // ยังไม่ใส่
      ux1: user({ name: "Fai", role: "ux" }), // ยังไม่ใส่
    },
  });

  it("dev โหวตไม่ตรงกัน: ปุ่ม disabled · ติ๊ก No Need Dev → enabled + label 'Dev no need dev'", () => {
    // qa โหวตแล้ว (ตรงกันคนเดียว) — เหลือ dev 3/8 เป็นอุปสรรคเดียว
    const room = {
      ...votingRoomDevSplit({}),
      revealed: true,
      locked: true,
      users: { ...votingRoomDevSplit({}).users, qa1: user({ name: "Run", role: "qa", vote: "5" }) },
    };
    updateUI(room);
    expect(btnSaveClickup.disabled).toBe(true); // dev 3/8 ไม่ตรง
    noNeedDevCheckbox.disabled = false;
    noNeedDevCheckbox.checked = true;
    updateUI({ ...room, noNeedDev: true });
    expect(btnSaveClickup.disabled).toBe(false); // Dev ไม่นับ readiness แล้ว
    expect(btnSaveClickup.textContent).toContain("Dev no need dev");
    expect(btnSaveClickup.textContent).toContain("QA 5");
  });

  it("No Need Dev + No Need Test + No Need UX/UI ครบ → reveal ผ่านแม้ dev/qa/ux ยังไม่โหวต", async () => {
    h.store.room = votingRoomDevSplit({ noNeedDev: true, noNeedTest: true, noNeedUx: true });
    await handleReveal();
    expect(vi.mocked(showNotVotedModal)).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalled();
  });

  it("ไม่ได้ติ๊กอะไร → modal เตือนครบทั้ง Run และ Fai (พฤติกรรมเดิม)", async () => {
    h.store.room = votingRoomDevSplit({});
    await handleReveal();
    expect(vi.mocked(showNotVotedModal)).toHaveBeenCalledWith(expect.stringContaining("Run"));
  });

  it("dev กดการ์ดตอน noNeedDev — ไม่เขียน vote + toast · ux กดตอน noNeedUx — เหมือนกัน", async () => {
    // dev โดน guard ของ noNeedDev
    state.currentRole = "dev";
    state.currentUid = "dev1";
    state.currentUser = { uid: "dev1", name: "Tien", realName: "Tien" };
    state.selectedCard = null;
    h.store.room = votingRoomDevSplit({ noNeedDev: true });
    await handleVote("3");
    expect(setMock).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("No Need Dev"));

    // ux โดน guard ของ noNeedUx
    state.currentRole = "ux";
    state.currentUid = "ux1";
    state.currentUser = { uid: "ux1", name: "Fai", realName: "Fai" };
    h.store.room = votingRoomDevSplit({ noNeedUx: true });
    const input = Object.assign(document.createElement("input"), { value: "2" });
    await handleCustomVote(input);
    expect(setMock).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("No Need UX/UI"));

    // qa ไม่โดน guard ของ noNeedDev (คนละ role)
    state.currentRole = "qa";
    state.currentUid = "qa1";
    state.currentUser = { uid: "qa1", name: "Run", realName: "Run" };
    h.store.room = votingRoomDevSplit({ noNeedDev: true });
    await handleVote("5");
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});

// ── Hot Fix: checkbox อิสระ — เลือกอย่างเดียวหรือร่วมกับ No Need Test ก็ได้ ──

describe("Hot Fix — sync ทั้งห้อง + ติด tag 'hot fix' ตอนบันทึก (ร่วมกับ No Need Test ได้)", () => {
  const tagCalls = () =>
    h.calls.fetch.filter((c) => c.path.includes("add-tag")).map((c) => c.body.tag as string);

  it("toggle Hot Fix → เขียน hotFix ลงห้องเท่านั้น (ไม่แตะ noNeedTest/โหวต)", async () => {
    await handleHotFixToggle(true);
    const call = vi.mocked(updateMock).mock.calls.find(
      ([, p]) => p != null && typeof p === "object" && "hotFix" in (p as object),
    );
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ hotFix: true });
  });

  it("Hot Fix อย่างเดียว + บันทึก → ติดแค่ tag 'hot fix'", async () => {
    h.store.room = revealedRoom(false); // QA ตรงกัน 5/5 บันทึกได้ปกติ
    noNeedTestCheckbox.disabled = false;
    noNeedTestCheckbox.checked = false;
    state.hotFix = true;
    await handleSaveToClickUp();
    expect(tagCalls()).toEqual(["hot fix"]);
  });

  it("ทั้ง No Need Test + Hot Fix + บันทึก → ติด 2 tags ('no need test' แล้ว 'hot fix')", async () => {
    h.store.room = revealedRoom(true); // QA ไม่ตรง 5/8 — No Need Test ตัด QA ออกจึงบันทึกได้
    noNeedTestCheckbox.disabled = false;
    noNeedTestCheckbox.checked = true;
    state.hotFix = true;
    await handleSaveToClickUp();
    expect(tagCalls()).toEqual(["no need test", "hot fix"]);
  });

  it("ไม่เลือกอะไรเลย + บันทึก → ไม่มีการติด tag", async () => {
    h.store.room = revealedRoom(false);
    noNeedTestCheckbox.disabled = false;
    noNeedTestCheckbox.checked = false;
    await handleSaveToClickUp();
    expect(tagCalls()).toEqual([]);
  });
});

// ── Reveal + No Need Test: QA ไม่ต้องใส่ point = ไม่ถูก modal เตือน ────────

describe("Reveal กับ No Need Test — modal เตือนคนยังไม่โหวตต้องข้าม QA", () => {
  /** ห้องโหวตกลางคัน: dev โหวตแล้ว QA ยังไม่ใส่ (จะ reveal ได้เมื่อไม่ต้องนับ QA) */
  const votingRoom = (noNeedTest: boolean): RoomData => ({
    createdAt: 0,
    revealed: false,
    locked: false,
    autoUnlockSeconds: 30,
    activeTask,
    noNeedTest,
    users: {
      po1: user({ name: "Yam", realName: "Yam", role: "po" }),
      dev1: user({ name: "Tien", realName: "Tien", role: "dev", vote: "3" }),
      qa1: user({ name: "Run", realName: "Run", role: "qa", vote: null }), // QA ยังไม่ใส่
    },
  });

  it("No Need Test เปิด + QA ยังไม่โหวต → reveal ผ่าน ไม่เด้ง modal", async () => {
    h.store.room = votingRoom(true);
    await handleReveal();
    expect(vi.mocked(showNotVotedModal)).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalled(); // เขียน reveal จริง
  });

  it("ไม่ได้เปิด No Need Test + QA ยังไม่โหวต → ยังเด้ง modal ตามพฤติกรรมเดิม", async () => {
    h.store.room = votingRoom(false);
    await handleReveal();
    expect(vi.mocked(showNotVotedModal)).toHaveBeenCalledWith("Run");
  });
});

describe("Dev Cing (deputy) — handler Reveal/เตะ ทำงานจริงเหมือน PO", () => {
  /** ห้องโหวตครบทุกคน (deputy ต้องโหวตด้วยเพราะเป็น dev) — พร้อม reveal ได้ */
  const allVotedRoom = (): RoomData => ({
    createdAt: 0,
    revealed: false,
    locked: false,
    autoUnlockSeconds: 30,
    activeTask,
    users: {
      po1: user({ name: "Yam", realName: "Yam", role: "po" }),
      dev2: user({ name: "Cing", realName: "Cing", role: "dev", vote: "3" }),
      qa1: user({ name: "Run", realName: "Run", role: "qa", vote: "5" }),
    },
  });

  /** ตั้งตัวตนของเครื่องนี้ก่อนเรียก handler */
  const asViewer = (uid: string, name: string, realName: string): void => {
    state.currentRole = "dev";
    state.currentUid = uid;
    state.currentUser = { uid, name, realName };
  };

  it("deputy reveal ได้ — เขียน revealed จริงลงห้อง", async () => {
    asViewer("dev2", "Cing", "Cing");
    h.store.room = allVotedRoom();

    await handleReveal();

    expect(vi.mocked(showNotVotedModal)).not.toHaveBeenCalled();
    const calls = vi.mocked(updateMock).mock.calls;
    const payload = calls[calls.length - 1]?.[1] as Record<string, unknown> | undefined;
    expect(payload?.revealed).toBe(true);
  });

  it("deputy เตะคนอื่นออกจากห้องได้ — เขียน kicked flag จริง", async () => {
    asViewer("dev2", "Cing", "Cing");
    h.store.room = allVotedRoom();

    await handleKick("qa1", "Run");

    const calls = vi.mocked(updateMock).mock.calls;
    const payload = calls[calls.length - 1]?.[1] as Record<string, unknown> | undefined;
    expect(payload?.["kicked/qa1"]).toBe(true);
    expect(payload?.["users/qa1/left"]).toBe(true);
  });

  it("dev ทั่วไป เรียก Reveal/เตะ ตรง ๆ — guard กันไว้ ไม่เขียนอะไรลง Firebase", async () => {
    asViewer("dev3", "Bell", "Bell");
    h.store.room = allVotedRoom();

    await handleReveal();
    await handleKick("qa1", "Run");

    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("Dev Cing (deputy) — โหมด Groom/Pre-Groom เหมือน PO (toggle + handler)", () => {
  /** ห้องมี task อยู่ — เงื่อนไขที่แถวโหมดแสดง */
  const taskRoom = (): RoomData => ({
    createdAt: 0,
    revealed: false,
    locked: false,
    autoUnlockSeconds: 30,
    activeTask,
    users: {
      po1: user({ name: "Yam", realName: "Yam", role: "po" }),
      dev2: user({ name: "Cing", realName: "Cing", role: "dev" }),
      dev3: user({ name: "Bell", realName: "Bell", role: "dev" }),
    },
  });

  const asViewer = (uid: string, name: string, realName: string): void => {
    state.currentRole = "dev";
    state.currentUid = uid;
    state.currentUser = { uid, name, realName };
  };

  it("deputy เห็น toggle โหมด (ไม่ถูกซ่อน) + สลับโหมดได้ — เขียน groomMode ลงห้องจริง", async () => {
    asViewer("dev2", "Cing", "Cing");
    updateUI(taskRoom());

    expect(groomModeControls.classList.contains("hidden")).toBe(false);

    await handleSetGroomMode("pre");
    const calls = vi.mocked(updateMock).mock.calls;
    const payload = calls[calls.length - 1]?.[1] as Record<string, unknown> | undefined;
    expect(payload?.groomMode).toBe("pre");
  });

  it("dev ทั่วไป: toggle ถูกซ่อน + เรียกสลับโหมดตรง ๆ — guard กันไว้ ไม่เขียนอะไร", async () => {
    asViewer("dev3", "Bell", "Bell");
    updateUI(taskRoom());

    expect(groomModeControls.classList.contains("hidden")).toBe(true);

    await handleSetGroomMode("pre");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
