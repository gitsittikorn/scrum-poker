// @vitest-environment happy-dom
// (escapeHtml/escapeAttr ใช้ DOM serialize — ต้องรันใน happy-dom)
import { describe, it, expect } from "vitest";
import { unanimousFor, rangeFor, parseRange, hasConfiguredCards, escapeAttr, safeHttpUrl } from "../utils";

// ── Bug audit — XSS guards สำหรับข้อมูลที่มาจาก Firebase ───────────────────

describe("escapeAttr (ค่าที่จะใส่ HTML attribute — ต้อง escape ฟันหนู/ฟันเดี่ยวด้วย)", () => {
  it("ฟันหนู/ฟันเดี่ยว กลายเป็น entity — กัน break out จาก attribute", () => {
    const out = escapeAttr('x" onclick="alert(1)" b="');
    expect(out).not.toContain('"');
    expect(out).toContain("onclick=&quot;alert(1)&quot;");
    expect(escapeAttr("it's")).not.toContain("'");
  });
  it("< > & ถูก escape เหมือน escapeHtml", () => {
    expect(escapeAttr("<img src=x>")).not.toContain("<");
    expect(escapeAttr("a&b")).toBe("a&amp;b");
  });
  it("ข้อความปกติผ่านเปลี่ยนแปลงน้อยที่สุด", () => {
    expect(escapeAttr("😀 hi")).toBe("😀 hi");
  });
});

describe("safeHttpUrl (href จากข้อมูลภายนอก — ยอมเฉพาะ http/https)", () => {
  it("javascript:/data: → '#' (กันรันสคริปต์ตอนคลิก)", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBe("#");
    expect(safeHttpUrl("JaVaScRiPt:alert(1)")).toBe("#");
    expect(safeHttpUrl("data:text/html,<script>")).toBe("#");
  });
  it("http/https ปกติผ่านตรง ๆ", () => {
    expect(safeHttpUrl("https://app.clickup.com/t/abc")).toBe("https://app.clickup.com/t/abc");
    expect(safeHttpUrl("http://localhost:5173")).toBe("http://localhost:5173");
  });
});


describe("unanimousFor (ค่าเดียวที่ทุกคนในกลุ่มโหวตเหมือนกัน)", () => {
  it("กลุ่มว่าง = null", () => {
    expect(unanimousFor([])).toBeNull();
  });
  it("มีคนยังไม่โหวต = null", () => {
    expect(
      unanimousFor([
        ["a", { vote: "3" }],
        ["b", { vote: null }],
      ])
    ).toBeNull();
  });
  it("โหวต non-numeric = null", () => {
    expect(
      unanimousFor([
        ["a", { vote: "3" }],
        ["b", { vote: "?" }],
      ])
    ).toBeNull();
  });
  it("ทุกคนเท่ากัน = ค่านั้น", () => {
    expect(
      unanimousFor([
        ["a", { vote: "3" }],
        ["b", { vote: "3.0" }],
      ])
    ).toBe(3);
  });
  it("ไม่เท่ากัน = null", () => {
    expect(
      unanimousFor([
        ["a", { vote: "3" }],
        ["b", { vote: "5" }],
      ])
    ).toBeNull();
  });
});

describe("rangeFor (ช่วง min-max ของ pre-groom)", () => {
  it("ไม่มีใครโหวตเลข = null", () => {
    expect(rangeFor([["a", { vote: null }], ["b", { vote: "?" }]])).toBeNull();
  });
  it("min == max = เลขเดียว (ข้ามค่าที่ไม่ใช่ตัวเลข)", () => {
    expect(
      rangeFor([
        ["a", { vote: "3" }],
        ["b", { vote: "3" }],
        ["c", { vote: "?" }],
      ])
    ).toBe("3");
  });
  it("ต่างกัน = 'min-max'", () => {
    expect(
      rangeFor([
        ["a", { vote: "1" }],
        ["b", { vote: "8" }],
        ["c", { vote: "3" }],
      ])
    ).toBe("1-8");
  });
});

describe("parseRange (ตัวกลับของ rangeFor — ใช้รวมยอดใน history)", () => {
  it("'1-3' → {1,3}", () => {
    expect(parseRange("1-3")).toEqual({ min: 1, max: 3 });
  });
  it("'3' → {3,3}", () => {
    expect(parseRange("3")).toEqual({ min: 3, max: 3 });
  });
  it("null/ไม่ใช่เลข → null", () => {
    expect(parseRange(null)).toBeNull();
    expect(parseRange("abc")).toBeNull();
  });
});

describe("hasConfiguredCards (ตัดสินว่าจะใช้ config จาก DB หรือ default seed)", () => {
  it("array ว่าง / ไม่ใช่ array / ทุกช่อง value ว่าง = false", () => {
    expect(hasConfiguredCards(null)).toBe(false);
    expect(hasConfiguredCards("x")).toBe(false);
    expect(hasConfiguredCards([])).toBe(false);
    expect(
      hasConfiguredCards([{ value: "", label: "x" }, { value: "  ", label: "" }])
    ).toBe(false);
    expect(hasConfiguredCards([null, "bad", 5])).toBe(false);
  });
  it("มีอย่างน้อย 1 ช่องมี point = true (ป้องกัน bad write)", () => {
    expect(hasConfiguredCards([{ value: "0.5", label: "" }, { value: "", label: "" }])).toBe(true);
  });
});
