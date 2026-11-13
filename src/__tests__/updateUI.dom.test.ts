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
import type { RoomData, User } from "../types";

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

const room = (users: Record<string, User>, over: Partial<RoomData> = {}): RoomData => ({
  createdAt: 0,
  revealed: false,
  locked: false,
  autoUnlockSeconds: 30,
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
