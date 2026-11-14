import { describe, it, expect, beforeEach } from "vitest";
import { state, isPO, isRoomAdmin } from "../state";
import { PO_DEPUTY_REAL_NAMES, PO_DEPUTY_UIDS } from "../constants";

describe("isRoomAdmin (req Dev Cing Permission — ส่วนตั้งค่าเดียวกับ PO)", () => {
  beforeEach(() => {
    state.currentRole = null;
    state.currentUser = null;
    state.currentUid = null;
  });

  it("PO / admin ตาม role = ได้สิทธิ์เหมือนเดิม", () => {
    state.currentUser = { uid: "u1", name: "ใครก็ได้", realName: null };
    state.currentRole = "po";
    expect(isPO()).toBe(true);
    expect(isRoomAdmin()).toBe(true);
    state.currentRole = "admin";
    expect(isRoomAdmin()).toBe(true);
  });

  it("Dev ที่ชื่อจริง (realName จาก member list) อยู่ใน deputy list = ได้สิทธิ์ส่วนตั้งค่า", () => {
    expect(PO_DEPUTY_REAL_NAMES.length).toBeGreaterThan(0);
    const deputyName = PO_DEPUTY_REAL_NAMES[0];
    state.currentRole = "dev";
    state.currentUser = { uid: "u2", name: "ชื่อเล่นอะไรก็ได้", realName: deputyName };
    expect(isPO()).toBe(false); // ไม่ใช่ PO — สิทธิ์ reveal/reset ฯลฯ ไม่ได้
    expect(isRoomAdmin()).toBe(true); // ได้เฉพาะส่วนตั้งค่า
  });

  it("Dev คนอื่น (realName ไม่อยู่ใน list / ไม่มี realName) = ไม่ได้สิทธิ์เพิ่ม", () => {
    state.currentRole = "dev";
    state.currentUser = { uid: "u3", name: "Tien", realName: "Tien" };
    expect(isRoomAdmin()).toBe(false);
    state.currentUser = { uid: "u4", name: "Cing", realName: null }; // display name อย่างเดียวไม่พอ
    expect(isRoomAdmin()).toBe(false);
  });

  it("แค่ display name (name) ตรง deputy list แต่ realName ไม่ตรง = ไม่ได้สิทธิ์", () => {
    state.currentRole = "dev";
    const deputyName = PO_DEPUTY_REAL_NAMES[0];
    state.currentUser = { uid: "u5", name: deputyName, realName: "คนละคน" };
    expect(isRoomAdmin()).toBe(false);
  });

  it("QA/UX ที่ชื่อตรง deputy list = ไม่ได้สิทธิ์ (จำกัดเฉพาะ role dev)", () => {
    const deputyName = PO_DEPUTY_REAL_NAMES[0];
    state.currentRole = "qa";
    state.currentUser = { uid: "u6", name: "x", realName: deputyName };
    expect(isRoomAdmin()).toBe(false);
  });

  it("uid อยู่ใน PO_DEPUTY_UIDS = ได้สิทธิ์แม้ realName ไม่ตรง (ล็อกตามเครื่อง)", () => {
    // PO_DEPUTY_UIDS เว้นว่างไว้ default — ทดสอบ path นี้ด้วยการยัด uid
    // ทดสอบเข้าไปใน list ชั่วคราวแล้วคืนค่าเดิม
    const saved = [...PO_DEPUTY_UIDS];
    PO_DEPUTY_UIDS.length = 0;
    PO_DEPUTY_UIDS.push("locked-uid");
    try {
      state.currentRole = "dev";
      state.currentUid = "locked-uid";
      state.currentUser = { uid: "locked-uid", name: "n", realName: "NonDeputy" };
      expect(isRoomAdmin()).toBe(true);
    } finally {
      PO_DEPUTY_UIDS.length = 0;
      PO_DEPUTY_UIDS.push(...saved);
    }
  });
});
