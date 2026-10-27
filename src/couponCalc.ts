/* คูปองส่วนลด TA — engine คำนวณ + validation (pure module ไม่แตะ DOM/Firebase)
 * พอร์ตจากสูตร Excel "UAT คูปองส่วนลด TA(BOTH).xlsx" > ชีต Coupon UAT:
 *   L  = ส่วนลดรวมหลัง Min/Max      M  = Insurer รวมหลังปรับสัดส่วน
 *   Q..V / Z..AE = ผลต่อคน          AF..AL = ผลรวมทุกคน
 *   AN..AQ = TQM รับชำระจริง (Sale Order) + ลูกค้าจ่ายสุทธิ
 * สูตรอ้างอิงแถวที่ถูกต้อง (M/T อ้าง AA ฐานลดคน 2 — แถวว่าง 25-27 ใน Excel อ้าง AC ผิด ไม่ใช้)
 * Min Purchase (J): Fix Amount / % Include VAT เช็คกับยอดเต็ม (เบี้ย+VAT+Duty) — % Exclude VAT เช็คกับเบี้ย
 *   (แก้ตามสเปค 2026-10-27 — พร้อมแก้สูตร Excel ใน coupon-uat/references ให้ตรงกัน) */

export type DiscountType = "Fix Amount" | "Percentage";
export type Subsidize = "Insurer" | "TQM" | "BOTH";
export type VatBasis = "Exclude VAT" | "Include VAT";

/** เบี้ย/VAT/Duty ของคนหนึ่ง (คอลัมน์ N,O,P / W,X,Y) — null = ยังไม่กรอก */
export interface CouponPersonInput {
  premium: number | null;
  vat: number | null;
  duty: number | null;
}

/** ข้อมูลกรอกทั้งรายการ (คอลัมน์ D–K + เบี้ยรายคน) */
export interface CouponInput {
  discountType: DiscountType | null; // D
  subsidize: Subsidize | null; // E
  people: 1 | 2 | null; // F
  vatBasis: VatBasis | null; // G
  /** H — ส่วนลดรวมทั้งรายการ (Fix: บาท / %: ตัวเลข เช่น 20 = 20%) */
  discountTotal: number | null;
  /** I — Insurer ลดรวมทั้งรายการ (เฉพาะ BOTH: บาท หรือ %) */
  insurerDiscount: number | null;
  /** J — Min Purchase (null = ไม่จำกัด) */
  minPurchase: number | null;
  /** K — Max Discount เฉพาะ % (null = ไม่จำกัด) */
  maxDiscount: number | null;
  /** คน 1 (N,O,P) และคน 2 (W,X,Y) — เลือก 1 คนให้คน 2 เป็น null ทั้งชุด */
  persons: [CouponPersonInput, CouponPersonInput];
}

/** ผลคำนวณรายคน */
export interface CouponPersonResult {
  full: number; // Q/Z — ยอดเต็ม = เบี้ย + VAT + Duty
  base: number; // R/AA — ฐานคำนวณส่วนลด
  tqm: number; // S/AB — TQM ลด
  insurer: number; // T/AC — Insurer ลด
  discount: number; // U/AD — ลดรวม
  net: number; // V/AE — จ่ายสุทธิ
}

/** ผลคำนวณทั้งรายการ */
export interface CouponResult {
  discountAfter: number; // L — ส่วนลดรวมหลัง Min/Max
  insurerAfter: number; // M — Insurer รวมหลังปรับสัดส่วน
  baseSum: number; // R + AA — ฐานลดรวม
  persons: [CouponPersonResult, CouponPersonResult];
  sumPremium: number; // AF — เบี้ยรวมทุกคน
  sumVat: number; // AG — VAT รวมทุกคน
  sumDuty: number; // AH — Duty รวมทุกคน
  sumAll: number; // AI — เบี้ย + VAT + Duty รวมทุกคน
  sumTqm: number; // AJ — TQM ลดรวมทุกคน
  sumInsurer: number; // AK — Insurer ลดรวมทุกคน
  sumDiscount: number; // AL — ส่วนลดรวมทุกคน
  tqmReceive: [number, number]; // AO/AP — TQM รับชำระจริงต่อคน (คนเดียวคน 2 = 0)
  tqmReceiveTotal: number; // AN — TQM รับชำระจริงรวม
  customerNetTotal: number; // AQ — ลูกค้าจ่ายสุทธิรวมทุกคน
}

/** คำนวณส่วนลดคูปอง — ช่องที่ยังไม่กรอกถือเป็น 0 (เรียก validateCoupon ก่อนเพื่อเช็คข้อมูลครบ) */
export function calculateCoupon(input: CouponInput): CouponResult {
  const two = input.people === 2;
  const p1 = input.persons[0];
  const p2 = input.persons[1];
  const prem1 = p1.premium ?? 0;
  const vat1 = p1.vat ?? 0;
  const duty1 = p1.duty ?? 0;
  const prem2 = two ? p2.premium ?? 0 : 0;
  const vat2 = two ? p2.vat ?? 0 : 0;
  const duty2 = two ? p2.duty ?? 0 : 0;

  // Q/Z — ยอดเต็ม
  const full1 = prem1 + vat1 + duty1;
  const full2 = two ? prem2 + vat2 + duty2 : 0;

  // R/AA — ฐานลด: Fix → เบี้ย / % Include → ยอดเต็ม / % Exclude → เบี้ย
  const baseOf = (premium: number, full: number): number => {
    if (input.discountType === "Fix Amount") return premium;
    return input.vatBasis === "Include VAT" ? full : premium;
  };
  const base1 = baseOf(prem1, full1);
  const base2 = two ? baseOf(prem2, full2) : 0;
  const baseSum = base1 + base2;

  // ส่วนลดดิบบนฐานรวม (Fix: บาท / %: ฐาน×rate/100) — ห้ามติดลบ ห้ามเกินฐาน
  const rawSide = (rate: number): number =>
    input.discountType === "Fix Amount"
      ? Math.min(Math.max(0, rate), Math.max(0, baseSum))
      : Math.min(Math.max(0, (baseSum * rate) / 100), Math.max(0, baseSum));

  // L — ผ่าน Min Purchase ก่อน แล้ว % จึงถูกจำกัดด้วย Max Discount (Fix ไม่มี Max)
  // ฐานเช็ค Min Purchase: Fix Amount / % Include VAT = ยอดเต็ม (เบี้ย+VAT+Duty) / % Exclude VAT = เบี้ย
  const fullSum = full1 + full2;
  const minBase = input.discountType === "Fix Amount" ? fullSum : baseSum;
  const hSide = rawSide(input.discountTotal ?? 0);
  const minOk = input.minPurchase == null || minBase >= input.minPurchase;
  const capMax = input.discountType === "Percentage" && input.maxDiscount != null;
  const discountAfter = !minOk ? 0 : capMax ? Math.min(hSide, Math.max(0, input.maxDiscount ?? 0)) : hSide;

  // M — Insurer รวม: Insurer รับทั้งหมด / TQM = 0 / BOTH คงสัดส่วนดิบ (ก่อนหัก Max) ของ I ต่อ H
  let insurerAfter: number;
  if (input.subsidize === "Insurer") {
    insurerAfter = discountAfter;
  } else if (input.subsidize === "TQM") {
    insurerAfter = 0;
  } else {
    const iSide = rawSide(input.insurerDiscount ?? 0);
    insurerAfter = hSide === 0 ? 0 : (discountAfter * Math.min(iSide, hSide)) / hSide;
  }

  // แบ่งตามสัดส่วนฐาน — คน 1 ROUND 2 ตำแหน่ง / คน 2 ได้ส่วนต่าง (สูตร U/AD, T/AC) รวมเป๊ะไม่มีเศษหาย
  const share1 = baseSum === 0 ? 0 : base1 / baseSum;
  const d1 = round2(discountAfter * share1);
  const i1 = round2(insurerAfter * share1);
  const d2 = two ? discountAfter - d1 : 0;
  const i2 = two ? insurerAfter - i1 : 0;

  const mkPerson = (full: number, base: number, discount: number, insurer: number): CouponPersonResult => ({
    full,
    base,
    tqm: discount - insurer, // S/AB
    insurer, // T/AC
    discount, // U/AD
    net: full - discount, // V/AE
  });
  const persons: [CouponPersonResult, CouponPersonResult] = [
    mkPerson(full1, base1, d1, i1),
    mkPerson(full2, base2, d2, i2),
  ];

  const sumPremium = prem1 + prem2;
  const sumVat = vat1 + vat2;
  const sumDuty = duty1 + duty2;
  const tqmReceive: [number, number] = [full1 - i1, two ? full2 - i2 : 0];

  return {
    discountAfter,
    insurerAfter,
    baseSum,
    persons,
    sumPremium,
    sumVat,
    sumDuty,
    sumAll: sumPremium + sumVat + sumDuty,
    sumTqm: persons[0].tqm + persons[1].tqm,
    sumInsurer: persons[0].insurer + persons[1].insurer,
    sumDiscount: persons[0].discount + persons[1].discount,
    tqmReceive,
    tqmReceiveTotal: tqmReceive[0] + tqmReceive[1],
    customerNetTotal: persons[0].net + persons[1].net,
  };
}

/* ── Validation — พอร์ตสูตร AR (TEXTJOIN 17 ข้อ) + สถานะ AM + สรุปผล AS ── */

export const MSG_REQUIRED = "กรุณากรอกข้อมูลให้ครบ";

export interface CouponValidation {
  /** AM — "" = ไม่มีข้อมูล / OK / INCOMPLETE (ข้อมูลไม่ครบ) / CHECK (ผิดกติกา) */
  status: "" | "OK" | "INCOMPLETE" | "CHECK";
  /** AR — ข้อความที่ผิดทั้งหมดตามลำดับสูตร */
  messages: string[];
  /** AS — ข้อความสรุปผล (ผ่าน / ข้อความแรก) */
  display: string;
}

const isNum = (x: number | null): boolean => x != null && Number.isFinite(x);

/** ตรวจข้อมูลคูปอง — กติกา 17 ข้อตามลำดับในสูตร AR ของ Excel */
export function validateCoupon(input: CouponInput): CouponValidation {
  const msgs: string[] = [];
  const push = (cond: boolean, msg: string): void => {
    if (cond) msgs.push(msg);
  };
  const two = input.people === 2;
  const [p1, p2] = input.persons;
  const p2Filled = p2.premium != null || p2.vat != null || p2.duty != null;

  // มีข้อมูลอะไรกรอกบ้าง (เทียบ COUNTA ของ AM) — ว่างทั้งหมด = ไม่ขึ้นสถานะ
  const hasData =
    input.discountType != null ||
    input.subsidize != null ||
    input.people != null ||
    input.vatBasis != null ||
    input.discountTotal != null ||
    input.insurerDiscount != null ||
    input.minPurchase != null ||
    input.maxDiscount != null ||
    p1.premium != null ||
    p1.vat != null ||
    p1.duty != null ||
    p2Filled;
  if (!hasData) return { status: "", messages: [], display: "" };

  // 1. ข้อมูลจำเป็น (E,D,F,G,H + เบี้ยครบทุกคน)
  const pMissing = (p: CouponPersonInput): boolean => !isNum(p.premium) || !isNum(p.vat) || !isNum(p.duty);
  push(
    input.subsidize == null ||
      input.discountType == null ||
      input.people == null ||
      input.vatBasis == null ||
      !isNum(input.discountTotal) ||
      pMissing(p1) ||
      (two && pMissing(p2)),
    MSG_REQUIRED
  );
  // 2-5. ค่า dropdown ถูกชุด
  push(input.subsidize != null && !["Insurer", "TQM", "BOTH"].includes(input.subsidize), "ผู้รับผิดชอบส่วนลดไม่ถูกต้อง");
  push(
    input.discountType != null && !["Fix Amount", "Percentage"].includes(input.discountType),
    "ประเภทส่วนลดไม่ถูกต้อง"
  );
  push(input.people != null && input.people !== 1 && input.people !== 2, "จำนวนคนต้องเป็น 1 หรือ 2");
  push(
    input.vatBasis != null && !["Include VAT", "Exclude VAT"].includes(input.vatBasis),
    "ฐานลดไม่ถูกต้อง"
  );
  // 6. Fix Amount ลดจากเบี้ยเท่านั้น (G ว่างก็ถือว่าผิด เหมือนสูตร Excel G<>"Exclude VAT")
  push(
    input.discountType === "Fix Amount" && input.vatBasis !== "Exclude VAT",
    "Fix Amount ต้อง Exclude VAT"
  );
  // 7. H ต้องเป็นตัวเลขไม่ติดลบ
  push(!isNum(input.discountTotal) || (input.discountTotal ?? 0) < 0, "ส่วนลดรวมห้ามติดลบและต้องเป็นตัวเลข");
  // 8. % ต้องไม่เกิน 100
  push(
    input.discountType === "Percentage" && isNum(input.discountTotal) && (input.discountTotal ?? 0) > 100,
    "ส่วนลดรวมต้องไม่เกิน 100 (กรอก 20 หมายถึง 20%)"
  );
  // 9. เบี้ย/VAT/Duty ห้ามติดลบ
  const people = two ? [p1, p2] : [p1];
  push(
    people.some((p) => [p.premium, p.vat, p.duty].some((v) => (isNum(v) ? (v ?? 0) < 0 : false))),
    "เบี้ย VAT Duty ห้ามติดลบ"
  );
  // 10. เลือก 1 คนแล้วห้ามมีข้อมูลคน 2
  push(input.people === 1 && p2Filled, "เลือก 1 คน ต้องลบข้อมูลคนที่ 2");
  // 11. BOTH ต้องกรอก I
  push(
    input.subsidize === "BOTH" && (!isNum(input.insurerDiscount) || (input.insurerDiscount ?? 0) < 0),
    "กรุณากรอก Insurer ลดให้ถูกต้อง"
  );
  // 12. BOTH + % : I ต้องไม่เกิน H และไม่เกิน 100
  push(
    input.subsidize === "BOTH" &&
      input.discountType === "Percentage" &&
      isNum(input.insurerDiscount) &&
      (!isNum(input.discountTotal) ||
        (input.insurerDiscount ?? 0) > (input.discountTotal ?? 0) ||
        (input.insurerDiscount ?? 0) > 100),
    "Insurer เกินส่วนลดรวม"
  );
  // 13. BOTH + Fix : I ต้องไม่เกิน MIN(H, เบี้ยรวม)
  const premSum = (p1.premium ?? 0) + (two ? p2.premium ?? 0 : 0);
  push(
    input.subsidize === "BOTH" &&
      input.discountType === "Fix Amount" &&
      isNum(input.insurerDiscount) &&
      (!isNum(input.discountTotal) || (input.insurerDiscount ?? 0) > Math.min(input.discountTotal ?? 0, premSum)),
    "Insurer เกินส่วนลดที่ใช้ได้จริง"
  );
  // 14. % Include VAT : ส่วนลดห้ามเกินยอดเต็ม (ต้องคำนวณก่อน — เฉพาะข้อมูลหลักครบ)
  if (
    input.discountType === "Percentage" &&
    input.vatBasis === "Include VAT" &&
    isNum(input.discountTotal) &&
    input.people != null &&
    !pMissing(p1) &&
    (!two || !pMissing(p2))
  ) {
    const r = calculateCoupon(input);
    push(
      r.persons[0].discount > r.persons[0].full || (two && r.persons[1].discount > r.persons[1].full),
      "ส่วนลดเกินยอดเต็ม"
    );
  }
  // 15-16. Min/Max ต้องเป็นตัวเลขไม่ติดลบ
  push(
    input.minPurchase != null && (!Number.isFinite(input.minPurchase) || input.minPurchase < 0),
    "Min Purchase ต้องเป็นตัวเลขไม่ติดลบ"
  );
  push(
    input.maxDiscount != null && (!Number.isFinite(input.maxDiscount) || input.maxDiscount < 0),
    "Max Discount ต้องเป็นตัวเลขไม่ติดลบ"
  );
  // 17. Fix Amount ไม่ใช้ Max Discount
  push(input.discountType === "Fix Amount" && input.maxDiscount != null, "Fix Amount ไม่ใช้ Max Discount");

  const status: CouponValidation["status"] =
    msgs.length === 0 ? "OK" : msgs.includes(MSG_REQUIRED) ? "INCOMPLETE" : "CHECK";
  const display = status === "OK" ? "ผ่าน" : status === "INCOMPLETE" ? "ข้อมูลไม่ครบ" : msgs[0];
  return { status, messages: msgs, display };
}

/** ROUND(x, 2) แบบ Excel — ครึ่งหนึ่งปัดออกจากศูนย์ (ค่าในระบบเป็นบวกทั้งหมด) */
function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
