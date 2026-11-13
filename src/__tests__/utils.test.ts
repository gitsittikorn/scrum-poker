import { describe, it, expect } from "vitest";
import { unanimousFor, rangeFor, parseRange, hasConfiguredCards } from "../utils";

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
