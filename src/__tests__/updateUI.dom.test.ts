// @vitest-environment happy-dom
// Integration test ระดับ DOM ของ updateUI/renderCards จริง (mock เฉพาะ Firebase +
// โมดูลที่ยิง network) — โหลด markup จาก index.html ตัวจริง แล้วค่อย dynamic import
// โมดูลที่ dom.ts มี side effect ตอนโหลด (import ปกติจะ evaluate ก่อน DOM พร้อม)
import { describe, it, expect, beforeEach, vi } from "vitest";
// ?raw = Vite raw import (type ประกาศโดย vite/client ใน vite-env.d.ts อยู่แล้ว)
import html from "../index.html?raw";

// ── mocks: Firebase + โมดูลที่ต้องยิง network ตอน import ──
// onValue เก็บ callback ตาม path เพื่อให้เทสดันค่า settings ได้ (จำลอง snapshot)
const h = vi.hoisted(() => {
  const onValueCallbacks = new Map<
    string,
    (snap: { val: () => unknown }) => void
  >();
  const fakeRef = (path: string) => ({ path });
  return { onValueCallbacks, fakeRef };
});

vi.mock("../firebase", () => ({
  db: {},
  ref: vi.fn((...parts: unknown[]) =>
    h.fakeRef(parts.filter((p) => typeof p === "string").join("/")),
  ),
  onValue: vi.fn((r: { path: string }, cb: (snap: { val: () => unknown }) => void) => {
    h.onValueCallbacks.set(r.path, cb);
  }),
  get: vi.fn(async () => ({ exists: () => false, val: () => null })),
  set: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  off: vi.fn(),
  push: vi.fn(() => ({ key: "push1" })),
  onDisconnect: vi.fn(() => ({ set: vi.fn(), remove: vi.fn(), cancel: vi.fn() })),
  serverTimestamp: vi.fn(() => 0),
  query: vi.fn((r: unknown) => r),
  orderByKey: vi.fn((r: unknown) => r),
  limitToLast: vi.fn((r: unknown) => r),
}));

vi.mock("../ui", () => ({
  showToast: vi.fn(),
  showNotVotedModal: vi.fn(),
  showConfirmModal: vi.fn(),
}));
vi.mock("../chat", () => ({ sendSystemMessage: vi.fn(async () => {}) }));
vi.mock("../sounds", () => ({ playSound: vi.fn(), sendSound: vi.fn() }));
vi.mock("../clickup", () => ({
  renderTaskBanner: vi.fn(),
  isSaveInFlight: vi.fn(() => false),
  onSaveStateChange: vi.fn(() => () => {}),
  updateTaskRequiredReminder: vi.fn(),
  isNoNeedTestChecked: vi.fn(() => false),
}));

// เตรียม DOM ก่อน import โมดูลที่อ่าน element ตอนโหลด (dom.ts)
// (ตัด <script> ทิ้ง — happy-dom จะพยายาม evaluate module script ตอน append)
document.body.innerHTML = html
  .match(/<body>([\s\S]*)<\/body>/)![1]
  .replace(/<script[\s\S]*?<\/script>/g, "");

const { updateUI, initPokerCardsListener } = await import("../voting");
const { state } = await import("../state");
const { isNoNeedTestChecked } = await import("../clickup");
import type { ActiveTask, RoomData, User } from "../types";

/** ดันค่า settings ผ่าน onValue callback ที่ mock เก็บไว้ (จำลอง Firebase tick) */
const emitSetting = (path: string, val: unknown): void => {
  const cb = h.onValueCallbacks.get(path);
  if (!cb) throw new Error(`no onValue listener on ${path}`);
  cb({ val: () => val });
};

const user = (over: Partial<User> & Pick<User, "name" | "role">): User => ({
  vote: null,
  online: true,
  lastSeen: 0,
  realName: null,
  ...over,
});

const taskFixture: ActiveTask = {
  taskId: "task-1",
  name: "Card A",
  url: "https://app.clickup.com/t/task-1",
  setBy: "Yam",
  timestamp: 0,
  historyKey: "hist-1",
};

// default มี task อยู่แล้ว (สภาพปกติตอนโหวต) — เคส "ยังไม่มี task" ส่ง { activeTask: undefined } ทับ
const room = (users: Record<string, User>, over: Partial<RoomData> = {}): RoomData => ({
  createdAt: 0,
  revealed: false,
  locked: false,
  autoUnlockSeconds: 30,
  activeTask: taskFixture,
  users,
  ...over,
});

const me = { uid: "dev1", name: "Tien", realName: "Tien" };
const po = user({ name: "Yam", role: "po" });
const dev2 = user({ name: "Cing", role: "dev" });

const cardOf = (uid: string): HTMLElement | null =>
  document.querySelector(`.participant-card[data-uid="${uid}"]`);

beforeEach(() => {
  state.currentRole = "dev";
  state.currentUid = me.uid;
  state.currentUser = me;
  state.selectedCard = null;
  vi.mocked(isNoNeedTestChecked).mockImplementation(() => false);
});

describe("req 2 — Last voter animation (เหลือคนสุดท้ายที่ยังไม่โหวต)", () => {
  it("เหลือคนเดียว = การ์ดคนนั้นได้ class + label 'เพื่อนสมาชิกรอคุณอยู่'", () => {
    updateUI(
      room({
        po,
        dev1: user({ name: "Tien", role: "dev", vote: "3" }), // โหวตแล้ว
        dev2, // ยังไม่โหวต → last voter
      }),
    );
    const c2 = cardOf("dev2")!;
    expect(c2.classList.contains("last-voter")).toBe(true);
    expect(c2.querySelector(".last-voter-label")?.textContent).toContain(
      "เพื่อนสมาชิกรอคุณอยู่",
    );
    // คนอื่นไม่โดน
    expect(cardOf("dev1")!.classList.contains("last-voter")).toBe(false);
  });

  it("diff-update: โหวตแล้ว label หายทันทีโดยไม่สร้างการ์ดใหม่", () => {
    updateUI(room({ po, dev1: user({ name: "Tien", role: "dev", vote: "3" }), dev2 }));
    const before = cardOf("dev2")!;
    updateUI(
      room({
        po,
        dev1: user({ name: "Tien", role: "dev", vote: "3" }),
        dev2: user({ name: "Cing", role: "dev", vote: "5" }), // โหวตแล้ว
      }),
    );
    const after = cardOf("dev2")!;
    expect(after).toBe(before); // node เดิม (diff-based ไม่ recreate)
    expect(after.classList.contains("last-voter")).toBe(false);
    expect(after.querySelector(".last-voter-label")).toBeNull();
  });

  it("คนที่สามเข้ามา (ยังไม่โหวต 2 คน) = เลิกเตือนทั้งห้อง", () => {
    updateUI(room({ po, dev1: user({ name: "Tien", role: "dev", vote: "3" }), dev2 }));
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(true);

    const dev3 = user({ name: "Toon", role: "dev" });
    updateUI(room({ po, dev1: user({ name: "Tien", role: "dev", vote: "3" }), dev2, dev3 }));
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(false);
    expect(cardOf("dev3")!.classList.contains("last-voter")).toBe(false);
  });

  it("คนออกจากห้อง (left) ไม่ถูกนับ — ไม่เตือนผิดคน", () => {
    const dev3 = user({ name: "Toon", role: "dev", left: true });
    // dev2 ยังไม่โหวต + dev3 ออกแล้ว (ไม่นับ) → dev2 คือคนสุดท้ายจริง
    updateUI(room({ po, dev1: user({ name: "Tien", role: "dev", vote: "3" }), dev2, dev3 }));
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(true);
    expect(cardOf("dev3")).toBeNull(); // left ถูกกรองออกจากลิสต์
  });

  it("ตอน reveal (locked) ไม่แสดงแม้ยังมีคนไม่โหวต", () => {
    updateUI(
      room(
        { po, dev1: user({ name: "Tien", role: "dev", vote: "3" }), dev2 },
        { locked: true, revealed: true },
      ),
    );
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(false);
  });
});

describe("req ใหม่ — Last voter นับแยกตาม role (ไม่รวมกัน)", () => {
  it("dev เหลือคนเดียวถูกเตือน แม้ QA ยังไม่โหวตค้างอยู่ — และ QA เหลือคนเดียวก็ถูกเตือนของกลุ่มตัวเอง", () => {
    updateUI(
      room({
        po,
        dev1: user({ name: "Tien", role: "dev", vote: "3" }), // โหวตแล้ว
        dev2, // last dev — ต้องเตือนแม้ QA ค้างโหวต
        qa1: user({ name: "Run", role: "qa" }), // last qa — เตือนของกลุ่ม QA ด้วย
      }),
    );
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(true);
    expect(
      cardOf("dev2")!.querySelector(".last-voter-label")?.textContent,
    ).toContain("เพื่อนสมาชิกรอคุณอยู่");
    expect(cardOf("qa1")!.classList.contains("last-voter")).toBe(true);
    expect(cardOf("dev1")!.classList.contains("last-voter")).toBe(false); // โหวตแล้วไม่โดน
  });

  it("dev ค้าง 2 คน = ไม่เตือน dev ใด ๆ แม้ QA เหลือคนเดียว (นับแยก role)", () => {
    updateUI(
      room({
        po,
        dev1: user({ name: "Tien", role: "dev" }), // dev ค้าง 2 คน → ไม่มี last dev
        dev2,
        qa1: user({ name: "Run", role: "qa" }),
      }),
    );
    expect(cardOf("dev1")!.classList.contains("last-voter")).toBe(false);
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(false);
    expect(cardOf("qa1")!.classList.contains("last-voter")).toBe(true); // QA นับของตัวเอง
  });

  it("No Need Test ทำงาน → QA ไม่ต้องโหวต = ไม่ถูกเตือน แม้เป็น QA คนเดียวที่ค้าง (dev ยังเตือนตามปกติ)", () => {
    vi.mocked(isNoNeedTestChecked).mockImplementation(() => true);
    updateUI(
      room({
        po,
        dev1: user({ name: "Tien", role: "dev", vote: "3" }),
        dev2,
        qa1: user({ name: "Run", role: "qa" }), // QA ค้างคนเดียว แต่ไม่ต้องโหวตแล้ว
      }),
    );
    expect(cardOf("qa1")!.classList.contains("last-voter")).toBe(false);
    expect(cardOf("qa1")!.querySelector(".last-voter-label")).toBeNull();
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(true);
  });

  it("UX มี last voter ของกลุ่มตัวเองเหมือนกัน (ไม่ถูก dev/QA บังคับ)", () => {
    updateUI(
      room({
        po,
        dev1: user({ name: "Tien", role: "dev", vote: "3" }),
        dev2,
        qa1: user({ name: "Run", role: "qa", vote: "5" }),
        ux1: user({ name: "Ploy", role: "ux" }), // last ux
        ux2: user({ name: "Fon", role: "ux" }), // ux ค้าง 2 คน → ไม่มี last ux
      }),
    );
    expect(cardOf("ux1")!.classList.contains("last-voter")).toBe(false);
    expect(cardOf("ux2")!.classList.contains("last-voter")).toBe(false);
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(true); // dev นับของตัวเอง
  });
});

describe("Task gate — ล็อคการ์ดก่อน PO ดึง task (ยังไม่ได้ติ๊ก Groom ไม่มี Task)", () => {
  const firstCard = () => document.querySelector(".poker-card") as HTMLElement;
  const statusRow = () => document.getElementById("voting-status")!;

  beforeEach(() => {
    initPokerCardsListener();
    emitSetting("settings/pokerCards", null); // render การ์ดชุด default ให้มี .poker-card
  });

  it("ไม่มี task → การ์ด disabled + แถบสถานะขึ้น 'ยังไม่ได้ดึงการ์ด'", () => {
    updateUI(room({ po, dev1: user({ name: "Tien", role: "dev" }) }, { activeTask: undefined }));
    expect(firstCard().classList.contains("disabled")).toBe(true);
    expect(statusRow().style.display).not.toBe("none");
    expect(statusRow().querySelector(".status-text")!.textContent).toContain("ยังไม่ได้ดึงการ์ด");
  });

  it("PO ดึง task มาแล้ว (room tick ใหม่) → ปลดล็อค + ซ่อนแถบสถานะ (ไม่มี 'Select your estimate' แล้ว)", () => {
    updateUI(room({ po, dev1: user({ name: "Tien", role: "dev" }) }, { activeTask: undefined }));
    expect(firstCard().classList.contains("disabled")).toBe(true);

    updateUI(room({ po, dev1: user({ name: "Tien", role: "dev" }) })); // fixture default มี task
    expect(firstCard().classList.contains("disabled")).toBe(false);
    expect(statusRow().style.display).toBe("none");
  });

  it("ติ๊ก Groom ไม่มี Task (noNeedTask=true) → ไม่ล็อค โหวตได้ทันทีแม้ไม่มี task", () => {
    updateUI(
      room({ po, dev1: user({ name: "Tien", role: "dev" }) }, { activeTask: undefined, noNeedTask: true }),
    );
    expect(firstCard().classList.contains("disabled")).toBe(false);
    expect(statusRow().style.display).toBe("none");
  });

  it("gate ล็อคอยู่ → ไม่ nudge 'เพื่อนสมาชิกรอคุณอยู่' ใครเลย (กันเตือนก่อนมี task)", () => {
    updateUI(
      room(
        {
          po,
          dev1: user({ name: "Tien", role: "dev", vote: "3" }),
          dev2,
          qa1: user({ name: "Run", role: "qa" }),
        },
        { activeTask: undefined },
      ),
    );
    expect(cardOf("dev2")!.classList.contains("last-voter")).toBe(false);
    expect(cardOf("qa1")!.classList.contains("last-voter")).toBe(false);
  });
});

describe("req 10 — Custom point card description (จาก super admin settings)", () => {
  it("แสดงคำอธิบายที่ตั้งไว้ และอัปเดต real-time เมื่อแก้ค่า", () => {
    initPokerCardsListener(); // แนบ listener settings/pokerCustomCard(Desc)
    emitSetting("settings/pokerCustomCard", true);
    emitSetting("settings/pokerCustomCardDesc", "ประมาณเอง");

    let custom = document.querySelector(".poker-card.custom-card");
    expect(custom).not.toBeNull();
    expect(custom!.querySelector(".card-label")!.innerHTML).toContain("ประมาณเอง");

    // super admin เปลี่ยนคำอธิบาย → render ใหม่ทันที
    emitSetting("settings/pokerCustomCardDesc", "ชั่วโมงโดยประมาณ");
    custom = document.querySelector(".poker-card.custom-card");
    expect(custom!.querySelector(".card-label")!.innerHTML).toContain("ชั่วโมงโดยประมาณ");
  });

  it("ไม่มี description = กลับไปใช้ default 'Custom (Enter)' โดย UI ไม่พัง", () => {
    initPokerCardsListener();
    emitSetting("settings/pokerCustomCard", true);
    emitSetting("settings/pokerCustomCardDesc", "");
    const custom = document.querySelector(".poker-card.custom-card");
    expect(custom).not.toBeNull();
    expect(custom!.querySelector(".card-label")!.innerHTML).toContain("Custom<br>(Enter)");
    expect(custom!.querySelector<HTMLInputElement>(".custom-point-input")).not.toBeNull();
  });
});

describe("renderCards — การ์ดปกติยังคงทำงานหลังปรับ custom card", () => {
  it("render การ์ดจาก default seed ได้ (ไม่มี config ใน DB = ใช้ DEFAULT_POKER_CARDS)", () => {
    initPokerCardsListener();
    emitSetting("settings/pokerCards", null);
    const cards = document.querySelectorAll(".poker-card:not(.custom-card)");
    expect(cards.length).toBeGreaterThan(0);
    expect((cards[0] as HTMLElement).dataset.value).toBe("0.5");
  });
});
