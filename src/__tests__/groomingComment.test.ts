import { describe, it, expect } from "vitest";
import { buildGroomingComment } from "../utils";
import type { User } from "../types";

const user = (over: Partial<User> & Pick<User, "name" | "role">): User => ({
  vote: null,
  online: true,
  lastSeen: 0,
  realName: null,
  ...over,
});

const attendees: [string, User][] = [
  ["po1", user({ name: "Yam เล่น", realName: "Yam", role: "po", vote: null })],
  ["dev1", user({ name: "Tien", realName: "Tien", role: "dev", vote: "3" })],
  ["dev2", user({ name: "นักพัฒนา", realName: "Cing", role: "dev", vote: "3" })],
  ["qa1", user({ name: "Run", realName: "Run", role: "qa", vote: "5" })],
];

describe("buildGroomingComment (รูปแบบ comment ที่ส่งไป ClickUp)", () => {
  it("header ตามโหมด + บรรทัด Dev/QA (point เป็น null = ไม่มีบรรทัดนั้น)", () => {
    const groom = buildGroomingComment("groom", "3", "5", attendees, null, "Task A");
    expect(groom.startsWith("Grooming : ")).toBe(true);
    expect(groom).toContain("Dev: 3");
    expect(groom).toContain("QA: 5");
    const pre = buildGroomingComment("pre", "1-3", null, attendees, null, "Task A");
    expect(pre.startsWith("Pre-Grooming : ")).toBe(true);
    expect(pre).toContain("Dev: 1-3");
    // QA point เป็น null → ไม่มีบรรทัดค่า QA ("QA:" ที่เหลือคือ attendees เท่านั้น)
    const qaMentions = pre.split("\n").filter((l) => l.startsWith("QA:"));
    expect(qaMentions).toEqual(["QA: Run"]);
  });

  it("req 8 — ไม่มี prefix 'Role - ' ในบรรทัด Attendees (เหลือแค่ 'PO:' 'Dev:' 'QA:')", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Task A");
    expect(c).not.toContain("Role - ");
    expect(c).toContain("Attendees");
    expect(c).toContain("PO: Yam");
    expect(c).toContain("Dev: Cing, Tien"); // เรียง a-z ด้วย realName (ไทยมาก่อนอังกฤษใน th collator)
    expect(c).toContain("QA: Run");
  });

  it("req 11 — ชื่อการ์ดอยู่บรรทัดสุดท้าย และไม่ทับข้อมูลเดิม", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Update Value from API");
    const lines = c.split("\n");
    expect(lines[lines.length - 1]).toBe("Update Value from API");
    // ข้อมูลเดิมยังอยู่ครบ (header/points/attendees ก่อนชื่อการ์ดเสมอ)
    expect(lines[0].startsWith("Grooming : ")).toBe(true);
    expect(c).toContain("Attendees");
  });

  it("retry ไม่ทำให้ชื่อการ์ดซ้ำ — สร้าง comment ใหม่ทั้งก้อนเสมอ มีชื่อการ์ดบรรทัดเดียว", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Task A");
    expect(c.split("Task A").length - 1).toBe(1);
  });

  it("owner marker ต่อท้ายชื่อคนกดบันทึก (หลังเรียงชื่อแล้ว)", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, "po1", "Task A");
    expect(c).toContain("PO: Yam(owner)");
  });

  it("ข้าม role ที่ไม่มีสมาชิก และ fallback เป็นชื่อเล่นเมื่อไม่มี realName", () => {
    const noUx: [string, User][] = attendees.filter(([, u]) => u.role !== "qa");
    const legacy: [string, User][] = [
      ["dev9", user({ name: "OldTimer", realName: null, role: "dev" })],
    ];
    const c = buildGroomingComment("groom", "3", null, [...noUx, ...legacy], null, "T");
    expect(c).not.toContain("QA:");
    expect(c).not.toContain("UX/UI:");
    expect(c).toContain("OldTimer");
  });

  it("cardName ว่าง = ไม่มีบรรทัดว่างท้ายแบบหลงเหลือ", () => {
    const c = buildGroomingComment("groom", "3", null, attendees, null, "");
    expect(c.endsWith("\n")).toBe(false);
  });
});
