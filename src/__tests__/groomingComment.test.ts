import { describe, it, expect } from "vitest";
import { buildGroomingComment, formatBangkokDateTime } from "../utils";
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

// req 20 — เส้นคั่น 20 ตัวตาม requirement + หัวข้อกลาง
const RULE = "━".repeat(20);
const HEADER = "🃏 SCRUM POKER | POINT UPDATE";

describe("buildGroomingComment (รูปแบบ comment ที่ส่งไป ClickUp)", () => {
  it("req 20 — เส้นคั่นหัว/ท้าย + หัวข้อ + โหมด + คะแนน (point เป็น null = ไม่มีบรรทัดนั้น)", () => {
    const groom = buildGroomingComment("groom", "3", "5", attendees, null, "Task A", new Date("2026-11-14T05:30:00Z"));
    const lines = groom.split("\n");
    expect(lines[0]).toBe(RULE); // เส้นคั่นเปิด
    expect(lines[1]).toBe(HEADER); // หัวข้อ
    expect(lines[2]).toBe("📅 14/11/2026 12:30"); // เวลาไทย Asia/Bangkok (UTC 05:30 + 7)
    expect(lines[3]).toBe("✅ Grooming"); // โหมด
    expect(groom).toContain("Dev: 3");
    expect(groom).toContain("QA: 5");
    const pre = buildGroomingComment("pre", "1-3", null, attendees, null, "Task A", new Date());
    expect(pre).toContain("🌱 Pre-Grooming");
    expect(pre).toContain("Dev: 1-3");
    // QA point เป็น null → ไม่มีบรรทัดค่า QA ("QA:" ที่เหลือคือ attendees เท่านั้น)
    const qaMentions = pre.split("\n").filter((l) => l.startsWith("QA:"));
    expect(qaMentions).toEqual(["QA: Run"]);
  });

  it("req 20 — เส้นคั่นมี 2 เส้น (เปิดบรรทัดแรก ปิดบรรทัดสุดท้าย) เท่านั้น", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Task A", new Date());
    const lines = c.split("\n");
    expect(lines.filter((l) => l === RULE)).toHaveLength(2);
    expect(lines[lines.length - 1]).toBe(RULE);
  });

  it("req 20 — เว้นบรรทัดให้อ่านง่าย: หลังหัวข้อ ก่อน Attendees และก่อนชื่อการ์ด", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Task A", new Date());
    const lines = c.split("\n");
    // หลัง header block ก่อนบรรทัด Dev
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("Dev: 3");
    // ก่อน "Attendees"
    const attIdx = lines.indexOf("Attendees");
    expect(attIdx).toBeGreaterThan(0);
    expect(lines[attIdx - 1]).toBe("");
    // ก่อนชื่อการ์ด
    const cardIdx = lines.indexOf("Task A");
    expect(cardIdx).toBeGreaterThan(0);
    expect(lines[cardIdx - 1]).toBe("");
  });

  it("req 20 — timestamp เวลาไทย: วันข้ามปี/เดือนได้ และนาทีเติมศูนย์", () => {
    // UTC 20:30 ของวันที่ 13 → เวลาไทย 03:30 ของวันที่ 14 (ข้ามวัน)
    expect(formatBangkokDateTime(new Date("2026-11-13T20:30:00Z"))).toBe("14/11/2026 03:30");
    // นาทีหลักเดียวต้องเติมศูนย์ + ทดสอบขอบปี
    expect(formatBangkokDateTime(new Date("2026-12-31T17:05:00Z"))).toBe("01/01/2027 00:05");
    // comment ใช้ค่าเดียวกับ formatter
    const c = buildGroomingComment("groom", "3", null, attendees, null, "T", new Date("2026-11-13T20:30:00Z"));
    expect(c).toContain("📅 14/11/2026 03:30");
  });

  it("req 20 — groom และ pre ใช้ header block เดียวกัน (4 บรรทัดแรกเหมือนกันทุกบรรทัดยกเว้นโหมด)", () => {
    const now = new Date("2026-11-14T05:30:00Z");
    const groom = buildGroomingComment("groom", "3", "5", attendees, null, "Task A", now);
    const pre = buildGroomingComment("pre", "1-3", null, attendees, null, "Task A", now);
    const g = groom.split("\n");
    const p = pre.split("\n");
    expect(g[0]).toBe(p[0]);
    expect(g[1]).toBe(p[1]);
    expect(g[2]).toBe(p[2]);
    expect(g[4]).toBe(p[4]); // บรรทัดว่างหลัง header block
  });

  it("req 8 — ไม่มี prefix 'Role - ' ในบรรทัด Attendees (เหลือแค่ 'PO:' 'Dev:' 'QA:')", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Task A", new Date());
    expect(c).not.toContain("Role - ");
    expect(c).toContain("Attendees");
    expect(c).toContain("PO: Yam");
    expect(c).toContain("Dev: Cing, Tien"); // เรียง a-z ด้วย realName (ไทยมาก่อนอังกฤษใน th collator)
    expect(c).toContain("QA: Run");
  });

  it("req 11 + req 20 ข้อ 7 — ชื่อการ์ดเป็นเนื้อหาบรรทัดสุดท้าย ก่อนเส้นคั่นปิด", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Update Value from API", new Date());
    const lines = c.split("\n");
    expect(lines[lines.length - 1]).toBe(RULE); // เส้นคั่นปิด
    expect(lines[lines.length - 2]).toBe("Update Value from API"); // ชื่อการ์ดก่อนเส้นคั่น
    // ข้อมูลเดิมยังอยู่ครบ (หัวข้อ/คะแนน/attendees ก่อนชื่อการ์ดเสมอ)
    expect(lines[0]).toBe(RULE);
    expect(lines[1]).toBe(HEADER);
    expect(c).toContain("Attendees");
  });

  it("retry ไม่ทำให้ชื่อการ์ดซ้ำ — สร้าง comment ใหม่ทั้งก้อนเสมอ มีชื่อการ์ดบรรทัดเดียว", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, null, "Task A", new Date());
    expect(c.split("Task A").length - 1).toBe(1);
  });

  it("owner marker ต่อท้ายชื่อคนกดบันทึก (หลังเรียงชื่อแล้ว)", () => {
    const c = buildGroomingComment("groom", "3", "5", attendees, "po1", "Task A", new Date());
    expect(c).toContain("PO: Yam(owner)");
  });

  it("ข้าม role ที่ไม่มีสมาชิก และ fallback เป็นชื่อเล่นเมื่อไม่มี realName", () => {
    const noUx: [string, User][] = attendees.filter(([, u]) => u.role !== "qa");
    const legacy: [string, User][] = [
      ["dev9", user({ name: "OldTimer", realName: null, role: "dev" })],
    ];
    const c = buildGroomingComment("groom", "3", null, [...noUx, ...legacy], null, "T", new Date());
    expect(c).not.toContain("QA:");
    expect(c).not.toContain("UX/UI:");
    expect(c).toContain("OldTimer");
  });

  it("cardName ว่าง = ไม่มีบรรทัดว่างท้ายแบบหลงเหลือ (ปิดด้วยเส้นคั่นทันที)", () => {
    const c = buildGroomingComment("groom", "3", null, attendees, null, "", new Date());
    expect(c.endsWith("\n")).toBe(false);
    const lines = c.split("\n");
    expect(lines[lines.length - 1]).toBe(RULE);
    expect(lines[lines.length - 2]).not.toBe(""); // ไม่มีบรรทัดว่างค้างก่อนเส้นคั่น
  });

  it("req 14.3 + req 20 ข้อ 6 — qa = 'no need test' → บรรทัด QA แสดงข้อความแทน point และคงรูปแบบใหม่", () => {
    const c = buildGroomingComment("groom", "3", "no need test", attendees, null, "Task A", new Date());
    expect(c).toContain("QA: no need test");
    expect(c).toContain("Dev: 3"); // role อื่นแสดง point ตามปกติ
    expect(c).toContain("Attendees");
    expect(c).toContain("QA: Run"); // attendees ฝั่ง QA ยังแสดง
    const lines = c.split("\n");
    expect(lines[lines.length - 1]).toBe(RULE);
    expect(lines[lines.length - 2]).toBe("Task A"); // ชื่อการ์ดยังท้ายสุดก่อนเส้นคั่น
    // โหมด pre ก็ใช้ pattern เดียวกันได้ (ส่ง string "no need test" แทนช่วง)
    const pre = buildGroomingComment("pre", "1-3", "no need test", attendees, null, "Task A", new Date());
    expect(pre).toContain("Dev: 1-3");
    expect(pre).toContain("QA: no need test");
    expect(pre).toContain(HEADER);
  });
});
