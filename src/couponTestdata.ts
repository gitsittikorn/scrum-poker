/* Test Cases คูปองส่วนลด TA — 24 เคสจากชีต "Coupon UAT" ของ Excel
 * ค่า expected = cached values ที่ Excel คำนวณไว้จริง (extract ตรงจากไฟล์ .xlsx)
 * เคสซ้ำเลข Excel (12, 19) คือชุด Min Purchase / Max Discount เพิ่มเติม — ใส่ suffix ระบุ
 * หมายเหตุ: เคส 19b Excel เขียน campaign "travel 2 คน" แต่กรอกจำนวนคน = 1 (เบี้ย 900) — ยึดค่า F=1 ตามไฟล์ */

import type { CouponInput, CouponPersonResult } from "./couponCalc";

export interface CouponExpected {
  discountAfter?: number; // L
  insurerAfter?: number; // M
  persons?: [Partial<CouponPersonResult>, Partial<CouponPersonResult>];
  sumPremium?: number; // AF
  sumVat?: number; // AG
  sumDuty?: number; // AH
  sumAll?: number; // AI
  sumTqm?: number; // AJ
  sumInsurer?: number; // AK
  sumDiscount?: number; // AL
  tqmReceive?: [number, number]; // AO, AP (คนเดียว Excel เว้นว่าง = เทียบกับ 0)
  tqmReceiveTotal?: number; // AN
  customerNetTotal?: number; // AQ
}

export interface CouponTestCase {
  id: string;
  row: number; // แถวในชีต Coupon UAT
  campaign: number; // B — Campaign ID
  product: string; // C — Campaign Detail
  note?: string;
  input: CouponInput;
  expected: CouponExpected;
}

/** เบี้ย/VAT/Duty ของคนหนึ่ง */
const p = (premium: number, vat: number, duty: number) => ({ premium, vat, duty });
/** คน 2 ว่าง (เคส 1 คน) */
const noOne = { premium: null, vat: null, duty: null };

export const COUPON_TEST_CASES: CouponTestCase[] = [
  {
    id: "1", row: 5, campaign: 318, product: "travel 1 คน ตปท รายปี wordwide MTI",
    input: { discountType: "Fix Amount", subsidize: "Insurer", people: 1, vatBasis: "Exclude VAT", discountTotal: 50, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(1819.1, 127.9, 8), noOne] },
    expected: { discountAfter: 50, insurerAfter: 50, persons: [{ full: 1955, base: 1819.1, tqm: 0, insurer: 50, discount: 50, net: 1905 }, {}], sumPremium: 1819.1, sumVat: 127.9, sumDuty: 8, sumAll: 1955, sumTqm: 0, sumInsurer: 50, sumDiscount: 50, tqmReceive: [1905, 0], tqmReceiveTotal: 1905, customerNetTotal: 1905 },
  },
  {
    id: "2", row: 6, campaign: 318, product: "travel 1 คน ตปท รายปี wordwide MTI",
    input: { discountType: "Fix Amount", subsidize: "TQM", people: 1, vatBasis: "Exclude VAT", discountTotal: 100, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(1819.1, 127.9, 8), noOne] },
    expected: { discountAfter: 100, insurerAfter: 0, persons: [{ full: 1955, base: 1819.1, tqm: 100, insurer: 0, discount: 100, net: 1855 }, {}], sumPremium: 1819.1, sumVat: 127.9, sumDuty: 8, sumAll: 1955, sumTqm: 100, sumInsurer: 0, sumDiscount: 100, tqmReceive: [1955, 0], tqmReceiveTotal: 1955, customerNetTotal: 1855 },
  },
  {
    id: "3", row: 7, campaign: 318, product: "travel 1 คน ตปท รายปี wordwide MTI",
    input: { discountType: "Fix Amount", subsidize: "BOTH", people: 1, vatBasis: "Exclude VAT", discountTotal: 300, insurerDiscount: 100, minPurchase: null, maxDiscount: null, persons: [p(1819.1, 127.9, 8), noOne] },
    expected: { discountAfter: 300, insurerAfter: 100, persons: [{ full: 1955, base: 1819.1, tqm: 200, insurer: 100, discount: 300, net: 1655 }, {}], sumPremium: 1819.1, sumVat: 127.9, sumDuty: 8, sumAll: 1955, sumTqm: 200, sumInsurer: 100, sumDiscount: 300, tqmReceive: [1855, 0], tqmReceiveTotal: 1855, customerNetTotal: 1655 },
  },
  {
    id: "4", row: 8, campaign: 319, product: "travel 1 คน ตปท รายปี wordwide MTI",
    input: { discountType: "Percentage", subsidize: "Insurer", people: 1, vatBasis: "Include VAT", discountTotal: 10, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(1819.1, 127.9, 8), noOne] },
    expected: { discountAfter: 195.5, insurerAfter: 195.5, persons: [{ full: 1955, base: 1955, tqm: 0, insurer: 195.5, discount: 195.5, net: 1759.5 }, {}], sumPremium: 1819.1, sumVat: 127.9, sumDuty: 8, sumAll: 1955, sumTqm: 0, sumInsurer: 195.5, sumDiscount: 195.5, tqmReceive: [1759.5, 0], tqmReceiveTotal: 1759.5, customerNetTotal: 1759.5 },
  },
  {
    id: "5", row: 9, campaign: 319, product: "travel 1 คน ตปท รายปี wordwide MTI",
    input: { discountType: "Percentage", subsidize: "TQM", people: 1, vatBasis: "Exclude VAT", discountTotal: 20, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(1819.1, 127.9, 8), noOne] },
    expected: { discountAfter: 363.82, insurerAfter: 0, persons: [{ full: 1955, base: 1819.1, tqm: 363.82, insurer: 0, discount: 363.82, net: 1591.18 }, {}], sumPremium: 1819.1, sumVat: 127.9, sumDuty: 8, sumAll: 1955, sumTqm: 363.82, sumInsurer: 0, sumDiscount: 363.82, tqmReceive: [1955, 0], tqmReceiveTotal: 1955, customerNetTotal: 1591.18 },
  },
  {
    id: "6", row: 10, campaign: 319, product: "travel 1 คน ตปท รายปี wordwide MTI",
    input: { discountType: "Percentage", subsidize: "BOTH", people: 1, vatBasis: "Include VAT", discountTotal: 30, insurerDiscount: 10, minPurchase: null, maxDiscount: null, persons: [p(1819.1, 127.9, 8), noOne] },
    expected: { discountAfter: 586.5, insurerAfter: 195.5, persons: [{ full: 1955, base: 1955, tqm: 391, insurer: 195.5, discount: 586.5, net: 1368.5 }, {}], sumPremium: 1819.1, sumVat: 127.9, sumDuty: 8, sumAll: 1955, sumTqm: 391, sumInsurer: 195.5, sumDiscount: 586.5, tqmReceive: [1759.5, 0], tqmReceiveTotal: 1759.5, customerNetTotal: 1368.5 },
  },
  {
    id: "7", row: 12, campaign: 318, product: "travel 2 คน ตปท รายเทียว Japan MSIG",
    input: { discountType: "Fix Amount", subsidize: "Insurer", people: 2, vatBasis: "Exclude VAT", discountTotal: 10, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(220, 0, 20), p(220, 0, 20)] },
    expected: { discountAfter: 10, insurerAfter: 10, persons: [{ full: 240, base: 220, tqm: 0, insurer: 5, discount: 5, net: 235 }, { full: 240, base: 220, tqm: 0, insurer: 5, discount: 5, net: 235 }], sumPremium: 440, sumVat: 0, sumDuty: 40, sumAll: 480, sumTqm: 0, sumInsurer: 10, sumDiscount: 10, tqmReceive: [235, 235], tqmReceiveTotal: 470, customerNetTotal: 470 },
  },
  {
    id: "8", row: 13, campaign: 318, product: "travel 2 คน ตปท รายเทียว Japan MSIG",
    input: { discountType: "Fix Amount", subsidize: "TQM", people: 2, vatBasis: "Exclude VAT", discountTotal: 20, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(220, 0, 20), p(220, 0, 20)] },
    expected: { discountAfter: 20, insurerAfter: 0, persons: [{ full: 240, base: 220, tqm: 10, insurer: 0, discount: 10, net: 230 }, { full: 240, base: 220, tqm: 10, insurer: 0, discount: 10, net: 230 }], sumPremium: 440, sumVat: 0, sumDuty: 40, sumAll: 480, sumTqm: 20, sumInsurer: 0, sumDiscount: 20, tqmReceive: [240, 240], tqmReceiveTotal: 480, customerNetTotal: 460 },
  },
  {
    id: "9", row: 14, campaign: 318, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน)",
    input: { discountType: "Fix Amount", subsidize: "BOTH", people: 2, vatBasis: "Exclude VAT", discountTotal: 30, insurerDiscount: 10, minPurchase: null, maxDiscount: null, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 30, insurerAfter: 10, persons: [{ full: 240, base: 220, tqm: 7.86, insurer: 3.93, discount: 11.79, net: 228.21 }, { full: 360, base: 340, tqm: 12.14, insurer: 6.07, discount: 18.21, net: 341.79 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 20, sumInsurer: 10, sumDiscount: 30, tqmReceive: [236.07, 353.93], tqmReceiveTotal: 590, customerNetTotal: 570 },
  },
  {
    id: "10", row: 15, campaign: 319, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน)",
    input: { discountType: "Percentage", subsidize: "Insurer", people: 2, vatBasis: "Exclude VAT", discountTotal: 15, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 84, insurerAfter: 84, persons: [{ full: 240, base: 220, tqm: 0, insurer: 33, discount: 33, net: 207 }, { full: 360, base: 340, tqm: 0, insurer: 51, discount: 51, net: 309 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 0, sumInsurer: 84, sumDiscount: 84, tqmReceive: [207, 309], tqmReceiveTotal: 516, customerNetTotal: 516 },
  },
  {
    id: "11", row: 16, campaign: 319, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน)",
    input: { discountType: "Percentage", subsidize: "TQM", people: 2, vatBasis: "Include VAT", discountTotal: 25, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 150, insurerAfter: 0, persons: [{ full: 240, base: 240, tqm: 60, insurer: 0, discount: 60, net: 180 }, { full: 360, base: 360, tqm: 90, insurer: 0, discount: 90, net: 270 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 150, sumInsurer: 0, sumDiscount: 150, tqmReceive: [240, 360], tqmReceiveTotal: 600, customerNetTotal: 450 },
  },
  {
    id: "12", row: 17, campaign: 319, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน)",
    input: { discountType: "Percentage", subsidize: "BOTH", people: 2, vatBasis: "Exclude VAT", discountTotal: 35, insurerDiscount: 10, minPurchase: null, maxDiscount: null, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 196, insurerAfter: 56, persons: [{ full: 240, base: 220, tqm: 55, insurer: 22, discount: 77, net: 163 }, { full: 360, base: 340, tqm: 85, insurer: 34, discount: 119, net: 241 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 140, sumInsurer: 56, sumDiscount: 196, tqmReceive: [218, 326], tqmReceiveTotal: 544, customerNetTotal: 404 },
  },
  {
    id: "13", row: 19, campaign: 318, product: "Motor",
    input: { discountType: "Fix Amount", subsidize: "Insurer", people: 1, vatBasis: "Exclude VAT", discountTotal: 50, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(6980.41, 490.59, 28), noOne] },
    expected: { discountAfter: 50, insurerAfter: 50, persons: [{ full: 7499, base: 6980.41, tqm: 0, insurer: 50, discount: 50, net: 7449 }, {}], sumPremium: 6980.41, sumVat: 490.59, sumDuty: 28, sumAll: 7499, sumTqm: 0, sumInsurer: 50, sumDiscount: 50, tqmReceive: [7449, 0], tqmReceiveTotal: 7449, customerNetTotal: 7449 },
  },
  {
    id: "14", row: 20, campaign: 318, product: "Home ประกันบ้าน / คอนโด / ปูนทั้งหมด (กาญจนบุรี)",
    input: { discountType: "Fix Amount", subsidize: "TQM", people: 1, vatBasis: "Exclude VAT", discountTotal: 100, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(1675, 7, 117.74), noOne] },
    expected: { discountAfter: 100, insurerAfter: 0, persons: [{ full: 1799.74, base: 1675, tqm: 100, insurer: 0, discount: 100, net: 1699.74 }, {}], sumPremium: 1675, sumVat: 7, sumDuty: 117.74, sumAll: 1799.74, sumTqm: 100, sumInsurer: 0, sumDiscount: 100, tqmReceive: [1799.74, 0], tqmReceiveTotal: 1799.74, customerNetTotal: 1699.74 },
  },
  {
    id: "15", row: 21, campaign: 318, product: "Health",
    input: { discountType: "Fix Amount", subsidize: "BOTH", people: 1, vatBasis: "Exclude VAT", discountTotal: 300, insurerDiscount: 100, minPurchase: null, maxDiscount: null, persons: [p(1489.48, 9.52, 1), noOne] },
    expected: { discountAfter: 300, insurerAfter: 100, persons: [{ full: 1500, base: 1489.48, tqm: 200, insurer: 100, discount: 300, net: 1200 }, {}], sumPremium: 1489.48, sumVat: 9.52, sumDuty: 1, sumAll: 1500, sumTqm: 200, sumInsurer: 100, sumDiscount: 300, tqmReceive: [1400, 0], tqmReceiveTotal: 1400, customerNetTotal: 1200 },
  },
  {
    id: "16", row: 22, campaign: 319, product: "Accident",
    input: { discountType: "Percentage", subsidize: "Insurer", people: 1, vatBasis: "Include VAT", discountTotal: 10, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(1946.62, 277.38, 16), noOne] },
    expected: { discountAfter: 224, insurerAfter: 224, persons: [{ full: 2240, base: 2240, tqm: 0, insurer: 224, discount: 224, net: 2016 }, {}], sumPremium: 1946.62, sumVat: 277.38, sumDuty: 16, sumAll: 2240, sumTqm: 0, sumInsurer: 224, sumDiscount: 224, tqmReceive: [2016, 0], tqmReceiveTotal: 2016, customerNetTotal: 2016 },
  },
  {
    id: "17", row: 23, campaign: 319, product: "Pet",
    input: { discountType: "Percentage", subsidize: "TQM", people: 1, vatBasis: "Exclude VAT", discountTotal: 20, insurerDiscount: null, minPurchase: null, maxDiscount: null, persons: [p(1907.89, 134.11, 8), noOne] },
    // L ไม่ปัด (381.578) ส่วนต่อคนปัด 2 ตำแหน่ง (381.58) — ตามสูตร Excel
    expected: { discountAfter: 381.578, insurerAfter: 0, persons: [{ full: 2050, base: 1907.89, tqm: 381.58, insurer: 0, discount: 381.58, net: 1668.42 }, {}], sumPremium: 1907.89, sumVat: 134.11, sumDuty: 8, sumAll: 2050, sumTqm: 381.58, sumInsurer: 0, sumDiscount: 381.58, tqmReceive: [2050, 0], tqmReceiveTotal: 2050, customerNetTotal: 1668.42 },
  },
  {
    id: "18", row: 24, campaign: 319, product: "Special",
    input: { discountType: "Percentage", subsidize: "BOTH", people: 1, vatBasis: "Include VAT", discountTotal: 30, insurerDiscount: 10, minPurchase: null, maxDiscount: null, persons: [p(1968.2, 10.3, 20.5), noOne] },
    expected: { discountAfter: 599.7, insurerAfter: 199.9, persons: [{ full: 1999, base: 1999, tqm: 399.8, insurer: 199.9, discount: 599.7, net: 1399.3 }, {}], sumPremium: 1968.2, sumVat: 10.3, sumDuty: 20.5, sumAll: 1999, sumTqm: 399.8, sumInsurer: 199.9, sumDiscount: 599.7, tqmReceive: [1799.1, 0], tqmReceiveTotal: 1799.1, customerNetTotal: 1399.3 },
  },
  {
    id: "19", row: 28, campaign: 318, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน 3981636)", note: "Min Purchase ผ่าน (ฐาน 560 ≥ 200)",
    input: { discountType: "Fix Amount", subsidize: "BOTH", people: 2, vatBasis: "Exclude VAT", discountTotal: 30, insurerDiscount: 10, minPurchase: 200, maxDiscount: null, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 30, insurerAfter: 10, persons: [{ full: 240, base: 220, tqm: 7.86, insurer: 3.93, discount: 11.79, net: 228.21 }, { full: 360, base: 340, tqm: 12.14, insurer: 6.07, discount: 18.21, net: 341.79 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 20, sumInsurer: 10, sumDiscount: 30, tqmReceive: [236.07, 353.93], tqmReceiveTotal: 590, customerNetTotal: 570 },
  },
  {
    id: "20", row: 29, campaign: 319, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน 3981635)", note: "Max Discount 50 < 15% ของ 560 (84)",
    input: { discountType: "Percentage", subsidize: "Insurer", people: 2, vatBasis: "Exclude VAT", discountTotal: 15, insurerDiscount: null, minPurchase: 200, maxDiscount: 50, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 50, insurerAfter: 50, persons: [{ full: 240, base: 220, tqm: 0, insurer: 19.64, discount: 19.64, net: 220.36 }, { full: 360, base: 340, tqm: 0, insurer: 30.36, discount: 30.36, net: 329.64 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 0, sumInsurer: 50, sumDiscount: 50, tqmReceive: [220.36, 329.64], tqmReceiveTotal: 550, customerNetTotal: 550 },
  },
  {
    id: "21", row: 30, campaign: 319, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน 3981634)", note: "Max Discount 50 < 25% ของ 600 (150) ฐาน Include",
    input: { discountType: "Percentage", subsidize: "TQM", people: 2, vatBasis: "Include VAT", discountTotal: 25, insurerDiscount: null, minPurchase: 200, maxDiscount: 50, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 50, insurerAfter: 0, persons: [{ full: 240, base: 240, tqm: 20, insurer: 0, discount: 20, net: 220 }, { full: 360, base: 360, tqm: 30, insurer: 0, discount: 30, net: 330 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 50, sumInsurer: 0, sumDiscount: 50, tqmReceive: [240, 360], tqmReceiveTotal: 600, customerNetTotal: 550 },
  },
  {
    id: "12b", row: 31, campaign: 319, product: "travel 2 คน ตปท รายเทียว Japan MSIG (คนละแผน)", note: "BOTH ชน Max — สัดส่วน Insurer คิดจากค่าดิบ 28/112",
    input: { discountType: "Percentage", subsidize: "BOTH", people: 2, vatBasis: "Exclude VAT", discountTotal: 20, insurerDiscount: 5, minPurchase: 200, maxDiscount: 50, persons: [p(220, 0, 20), p(340, 0, 20)] },
    expected: { discountAfter: 50, insurerAfter: 12.5, persons: [{ full: 240, base: 220, tqm: 14.73, insurer: 4.91, discount: 19.64, net: 220.36 }, { full: 360, base: 340, tqm: 22.77, insurer: 7.59, discount: 30.36, net: 329.64 }], sumPremium: 560, sumVat: 0, sumDuty: 40, sumAll: 600, sumTqm: 37.5, sumInsurer: 12.5, sumDiscount: 50, tqmReceive: [235.09, 352.41], tqmReceiveTotal: 587.5, customerNetTotal: 550 },
  },
  {
    id: "19b", row: 36, campaign: 318, product: "travel ตปท รายเทียว Japan MSIG (3981636)", note: "Excel กรอก 1 คน เบี้ย 900 + Min Purchase 800 ผ่าน",
    input: { discountType: "Fix Amount", subsidize: "BOTH", people: 1, vatBasis: "Exclude VAT", discountTotal: 100, insurerDiscount: 100, minPurchase: 800, maxDiscount: null, persons: [p(900, 70, 30), noOne] },
    expected: { discountAfter: 100, insurerAfter: 100, persons: [{ full: 1000, base: 900, tqm: 0, insurer: 100, discount: 100, net: 900 }, {}], sumPremium: 900, sumVat: 70, sumDuty: 30, sumAll: 1000, sumTqm: 0, sumInsurer: 100, sumDiscount: 100, tqmReceive: [900, 0], tqmReceiveTotal: 900, customerNetTotal: 900 },
  },
  {
    id: "12c", row: 37, campaign: 319, product: "travel 2 คน ตปท รายเทียว Japan MSIG (แผนเดียวกัน)", note: "% 100 + Insurer 100 — Insurer รับทั้งหมด เหลือแค่ VAT/Duty",
    input: { discountType: "Percentage", subsidize: "BOTH", people: 2, vatBasis: "Exclude VAT", discountTotal: 100, insurerDiscount: 100, minPurchase: null, maxDiscount: null, persons: [p(220, 0, 20), p(220, 0, 20)] },
    expected: { discountAfter: 440, insurerAfter: 440, persons: [{ full: 240, base: 220, tqm: 0, insurer: 220, discount: 220, net: 20 }, { full: 240, base: 220, tqm: 0, insurer: 220, discount: 220, net: 20 }], sumPremium: 440, sumVat: 0, sumDuty: 40, sumAll: 480, sumTqm: 0, sumInsurer: 440, sumDiscount: 440, tqmReceive: [20, 20], tqmReceiveTotal: 40, customerNetTotal: 40 },
  },
];
