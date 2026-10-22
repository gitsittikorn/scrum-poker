/* Coupon UAT — คูปองส่วนลด TA: เครื่องคำนวณ + รัน Test Cases 24 เคส
 * ทางเข้า 2 แบบเหมือน QA Tool: (1) tab ใน Super Admin Panel (ห้อง admin)
 * (2) standalone ?coupon=1 — ไม่ต้อง login ไม่ต้องแตะ Firebase */

import { calculateCoupon, validateCoupon } from "./couponCalc";
import type { CouponInput, CouponResult } from "./couponCalc";
import { COUPON_TEST_CASES } from "./couponTestdata";
import type { CouponExpected, CouponTestCase } from "./couponTestdata";
import { showToast } from "./ui";

/** ผลต่างของ test case หนึ่งเคส */
interface FieldCheck {
  label: string;
  actual: number;
  expected: number | undefined;
  pass: boolean;
}

/** Buttons/fields are static in index.html — bind once even if admin room is rejoined */
let bound = false;

/** ทนความคลาดเคลื่อนทศนิยม (ค่า Excel ปัด 2 ตำแหน่ง / float artifact) */
const TOL = 0.005;

const money = (x: number): string =>
  new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(x);

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/* ── Calculator ──────────────────────────────────────────────────────────── */

/** อ่านค่าจากฟอร์มเป็น CouponInput (ช่องว่าง = null) */
function readInput(): CouponInput {
  const num = (id: string): number | null => {
    const raw = (byId<HTMLInputElement>(id).value ?? "").trim();
    if (raw === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const people = (num("coupon-people") ?? 1) === 2 ? 2 : 1;
  return {
    discountType: (byId<HTMLSelectElement>("coupon-type").value || null) as CouponInput["discountType"],
    subsidize: (byId<HTMLSelectElement>("coupon-subsidize").value || null) as CouponInput["subsidize"],
    people,
    vatBasis: (byId<HTMLSelectElement>("coupon-vatbasis").value || null) as CouponInput["vatBasis"],
    discountTotal: num("coupon-discount"),
    insurerDiscount: num("coupon-insurer"),
    minPurchase: num("coupon-min"),
    maxDiscount: num("coupon-max"),
    persons: [
      { premium: num("coupon-p1-premium"), vat: num("coupon-p1-vat"), duty: num("coupon-p1-duty") },
      people === 2
        ? { premium: num("coupon-p2-premium"), vat: num("coupon-p2-vat"), duty: num("coupon-p2-duty") }
        : { premium: null, vat: null, duty: null },
    ],
  };
}

/** ล็อกฟิลด์ตามกติกา: Fix → ฐาน Exclude + ไม่ใช้ Max / BOTH เท่านั้นที่กรอก I / 1 คนซ่อนคน 2 */
function applyFieldRules(): void {
  const type = byId<HTMLSelectElement>("coupon-type").value;
  const subs = byId<HTMLSelectElement>("coupon-subsidize").value;
  const people = byId<HTMLSelectElement>("coupon-people").value;
  const vatEl = byId<HTMLSelectElement>("coupon-vatbasis");
  const maxEl = byId<HTMLInputElement>("coupon-max");
  const insEl = byId<HTMLInputElement>("coupon-insurer");

  const isFix = type === "Fix Amount";
  if (isFix) vatEl.value = "Exclude VAT"; // กติกา: Fix Amount ฐานเบี้ยเท่านั้น
  vatEl.disabled = isFix;
  maxEl.disabled = isFix;
  if (isFix) maxEl.value = ""; // Fix Amount ไม่ใช้ Max Discount
  insEl.disabled = subs !== "BOTH";
  if (subs !== "BOTH") insEl.value = "";
  // หน่วยช่องส่วนลดสลับตามประเภท — แสดงในช่องเลย ไม่ต้องอธิบายเพิ่ม
  const unit = isFix ? "บาท" : "%";
  byId("coupon-discount-suffix").textContent = unit;
  byId("coupon-insurer-suffix").textContent = unit;

  byId("coupon-person-2").classList.toggle("coupon-person-hidden", people !== "2");
}

/** คำนวณ + วาดผลใหม่ทุกครั้งที่แก้ฟอร์ม */
function recalc(): void {
  const input = readInput();
  const validation = validateCoupon(input);
  const box = byId("coupon-result");

  if (validation.status === "") {
    box.innerHTML = "";
    box.appendChild(hintRow("กรอกข้อมูลด้านบนเพื่อคำนวณส่วนลด"));
    return;
  }

  const res = calculateCoupon(input);

  // แถวสถานะ + ข้อความผิดกติกา
  const statusRow = document.createElement("div");
  statusRow.className = "coupon-status-row";
  const badge = document.createElement("span");
  const ok = validation.status === "OK";
  badge.className = `coupon-status-badge ${ok ? "ok" : "bad"}`;
  badge.textContent = ok ? "✓ ผ่าน" : validation.display;
  statusRow.appendChild(badge);
  if (validation.messages.length > 0) {
    const list = document.createElement("ul");
    list.className = "coupon-messages";
    for (const m of validation.messages) {
      const li = document.createElement("li");
      li.textContent = m;
      list.appendChild(li);
    }
    statusRow.appendChild(list);
  }

  // การ์ดยอดหลัก
  const cards = document.createElement("div");
  cards.className = "coupon-cards";
  const card = (label: string, value: number, sub?: string): void => {
    const el = document.createElement("div");
    el.className = "coupon-card";
    const l = document.createElement("div");
    l.className = "coupon-card-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "coupon-card-value";
    v.textContent = money(value);
    el.appendChild(l);
    el.appendChild(v);
    if (sub) {
      const s = document.createElement("div");
      s.className = "coupon-card-sub";
      s.textContent = sub;
      el.appendChild(s);
    }
    cards.appendChild(el);
  };
  card("ส่วนลดรวมหลัง Min/Max", res.discountAfter, "หลังเช็ค Min และจำกัดด้วย Max");
  card("Insurer ลดรวม", res.sumInsurer, "ส่วนที่ Insurer รับผิดชอบ");
  card("TQM ลดรวม", res.sumTqm, "ลดรวม − Insurer ลด");
  card("TQM รับชำระจริง", res.tqmReceiveTotal, "ยอดเต็ม − Insurer ลด (Sale Order)");
  card("ลูกค้าจ่ายสุทธิ", res.customerNetTotal, "ยอดเต็ม − ส่วนลดทั้งสองฝ่าย");

  // ตารางต่อคน + แถวรวม
  const table = document.createElement("table");
  table.className = "coupon-table";
  table.innerHTML =
    "<thead><tr><th></th>" +
    `<th>${tip("ยอดเต็ม", "เบี้ย + VAT + Duty ของคนนี้")}</th>` +
    `<th>${tip("ฐานลด", "Fix Amount และ % Exclude VAT = เบี้ย · % Include VAT = ยอดเต็ม")}</th>` +
    "<th>TQM ลด</th><th>Insurer ลด</th><th>ลดรวม</th><th>จ่ายสุทธิ</th>" +
    `<th>${tip("TQM รับจริง", "ยอดเต็ม − Insurer ลด ไม่หักส่วนลด TQM")}</th>` +
    "</tr></thead>";
  const tbody = document.createElement("tbody");
  const two = input.people === 2;
  const rows: Array<[string, CouponResult["persons"][number], number]> = [
    ["คนที่ 1", res.persons[0], res.tqmReceive[0]],
  ];
  if (two) rows.push(["คนที่ 2", res.persons[1], res.tqmReceive[1]]);
  for (const [label, pr, tqmReal] of rows) {
    const tr = document.createElement("tr");
    const cells = [
      label,
      pr.full,
      pr.base,
      pr.tqm,
      pr.insurer,
      pr.discount,
      pr.net,
      tqmReal,
    ];
    for (const [i, c] of cells.entries()) {
      const td = document.createElement(i === 0 ? "th" : "td");
      td.textContent = i === 0 ? String(c) : money(c as number);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  const total = document.createElement("tr");
  total.className = "coupon-table-total";
  const totalCells = [
    "รวม",
    res.sumAll,
    res.baseSum,
    res.sumTqm,
    res.sumInsurer,
    res.sumDiscount,
    res.customerNetTotal,
    res.tqmReceiveTotal,
  ];
  for (const [i, c] of totalCells.entries()) {
    const td = document.createElement(i === 0 ? "th" : "td");
    td.textContent = i === 0 ? String(c) : money(c as number);
    total.appendChild(td);
  }
  tbody.appendChild(total);
  table.appendChild(tbody);

  // ตารางแยกตามผู้รับผิดชอบ — ครบทุกค่าที่ใช้ตรวจที่ Front Office
  // คนเดียว: คอลัมน์คนที่ 2 = 0
  const dbTitle = document.createElement("div");
  dbTitle.className = "coupon-section-title";
  dbTitle.textContent = "แยกตามผู้รับผิดชอบ — ค่าสำหรับตรวจที่ Front Office";
  const dbTable = document.createElement("table");
  dbTable.className = "coupon-table coupon-table-db";
  dbTable.innerHTML = "<thead><tr><th>รายการ</th><th>คนที่ 1</th><th>คนที่ 2</th><th>รวม 1+2</th></tr></thead>";
  const dbBody = document.createElement("tbody");
  const prem1 = input.persons[0].premium ?? 0;
  const vat1 = input.persons[0].vat ?? 0;
  const duty1 = input.persons[0].duty ?? 0;
  const prem2 = two ? input.persons[1].premium ?? 0 : 0;
  const vat2 = two ? input.persons[1].vat ?? 0 : 0;
  const duty2 = two ? input.persons[1].duty ?? 0 : 0;
  const dbRows: Array<[string, number, number, number]> = [
    ["TQM ลด", res.persons[0].tqm, res.persons[1].tqm, res.sumTqm],
    ["Insurer ลด", res.persons[0].insurer, res.persons[1].insurer, res.sumInsurer],
    ["ลดรวม", res.persons[0].discount, res.persons[1].discount, res.sumDiscount],
    ["จ่ายสุทธิ", res.persons[0].net, res.persons[1].net, res.customerNetTotal],
    ["TQM รับชำระจริง", res.tqmReceive[0], res.tqmReceive[1], res.tqmReceiveTotal],
    ["เบี้ย", prem1, prem2, res.sumPremium],
    ["VAT", vat1, vat2, res.sumVat],
    ["Duty", duty1, duty2, res.sumDuty],
    ["ยอดเต็ม (เบี้ย+VAT+Duty)", res.persons[0].full, res.persons[1].full, res.sumAll],
  ];
  for (const [label, v1, v2, sum] of dbRows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    tr.appendChild(th);
    for (const v of [v1, v2, sum]) {
      const td = document.createElement("td");
      td.textContent = money(v);
      tr.appendChild(td);
    }
    dbBody.appendChild(tr);
  }
  dbTable.appendChild(dbBody);

  box.innerHTML = "";
  box.appendChild(statusRow);
  box.appendChild(cards);
  box.appendChild(table);
  box.appendChild(dbTitle);
  box.appendChild(dbTable);
}

function hintRow(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "coupon-hint";
  el.textContent = text;
  return el;
}

/** span พร้อม tooltip (hover ดูคำอธิบาย) — ใช้ในหัวตาราง/การ์ด */
const tip = (label: string, text: string): string =>
  `<span class="coupon-tip" data-tip="${text}">${label}</span>`;

/* ── Test runner ─────────────────────────────────────────────────────────── */

/** รวมทุกฟิลด์ที่เทียบเป็นรายการ (label + actual + expected) */
function buildChecks(res: CouponResult, exp: CouponExpected): FieldCheck[] {
  const checks: Array<[string, number, number | undefined]> = [
    ["ส่วนลดรวมหลัง Min/Max", res.discountAfter, exp.discountAfter],
    ["Insurer ลดรวมหลังปรับสัดส่วน", res.insurerAfter, exp.insurerAfter],
  ];
  const personLabels = ["ยอดเต็ม", "ฐานลด", "TQM ลด", "Insurer ลด", "ลดรวม", "จ่ายสุทธิ"] as const;
  const personKeys = ["full", "base", "tqm", "insurer", "discount", "net"] as const;
  for (const pi of [0, 1] as const) {
    const expP = exp.persons?.[pi];
    for (const [fi, key] of personKeys.entries()) {
      checks.push([
        `คนที่ ${pi + 1} — ${personLabels[fi]}`,
        res.persons[pi][key],
        expP?.[key],
      ]);
    }
  }
  checks.push(
    ["เบี้ยรวมทุกคน", res.sumPremium, exp.sumPremium],
    ["VAT รวมทุกคน", res.sumVat, exp.sumVat],
    ["Duty รวมทุกคน", res.sumDuty, exp.sumDuty],
    ["เบี้ย+VAT+Duty รวมทุกคน", res.sumAll, exp.sumAll],
    ["TQM ลดรวมทุกคน", res.sumTqm, exp.sumTqm],
    ["Insurer ลดรวมทุกคน", res.sumInsurer, exp.sumInsurer],
    ["ส่วนลดรวมทุกคน", res.sumDiscount, exp.sumDiscount],
    ["TQM รับชำระจริงคนที่ 1", res.tqmReceive[0], exp.tqmReceive?.[0]],
    ["TQM รับชำระจริงคนที่ 2", res.tqmReceive[1], exp.tqmReceive?.[1]],
    ["TQM รับชำระจริงรวม", res.tqmReceiveTotal, exp.tqmReceiveTotal],
    ["ลูกค้าจ่ายสุทธิรวมทุกคน", res.customerNetTotal, exp.customerNetTotal]
  );
  return checks
    .filter(([, , expected]) => expected !== undefined)
    .map(([label, actual, expected]) => ({
      label,
      actual,
      expected,
      pass: Math.abs(actual - (expected as number)) <= TOL,
    }));
}

/** สรุปอินพุตย่อ 1 บรรทัดสำหรับแสดงในตาราง */
function configSummary(tc: CouponTestCase): string {
  const i = tc.input;
  const parts = [
    i.discountType === "Fix Amount" ? "Fix" : "%",
    i.subsidize,
    `${i.people} คน`,
    i.vatBasis === "Include VAT" ? "Incl VAT" : "Excl VAT",
    `H ${i.discountTotal}`,
  ];
  if (i.insurerDiscount != null) parts.push(`I ${i.insurerDiscount}`);
  if (i.minPurchase != null) parts.push(`Min ${i.minPurchase}`);
  if (i.maxDiscount != null) parts.push(`Max ${i.maxDiscount}`);
  return parts.join(" · ");
}

/** รันทั้ง 24 เคสแล้ววาดตาราง + สรุป */
function runTests(): void {
  const holder = byId("coupon-tests-table");
  const summary = byId("coupon-tests-summary");
  holder.innerHTML = "";

  let passCount = 0;
  for (const tc of COUPON_TEST_CASES) {
    const res = calculateCoupon(tc.input);
    const validation = validateCoupon(tc.input);
    const checks = buildChecks(res, tc.expected);
    const fails = checks.filter((c) => !c.pass);
    const passed = fails.length === 0 && validation.status === "OK";
    if (passed) passCount++;

    const details = document.createElement("details");
    details.className = `coupon-test ${passed ? "pass" : "fail"}`;

    const summaryRow = document.createElement("summary");
    for (const [cls, text] of [
      ["t-id", `เคส ${tc.id}`],
      ["t-camp", String(tc.campaign)],
      ["t-prod", tc.product],
      ["t-config", configSummary(tc)],
    ] as const) {
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text;
      summaryRow.appendChild(span);
    }
    const badge = document.createElement("span");
    badge.className = `t-badge ${passed ? "pass" : "fail"}`;
    badge.textContent = passed ? "✓ ผ่าน" : `✗ ตก ${fails.length || 1} จุด`;
    summaryRow.appendChild(badge);
    details.appendChild(summaryRow);

    const table = document.createElement("table");
    table.className = "coupon-table coupon-table-detail";
    table.innerHTML = "<thead><tr><th>ฟิลด์</th><th>Expected (Excel)</th><th>Actual</th><th>ผล</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const c of checks) {
      const tr = document.createElement("tr");
      if (!c.pass) tr.className = "coupon-row-fail";
      const tdL = document.createElement("td");
      tdL.textContent = c.label;
      const tdE = document.createElement("td");
      tdE.textContent = money(c.expected as number);
      const tdA = document.createElement("td");
      tdA.textContent = money(c.actual);
      const tdR = document.createElement("td");
      tdR.textContent = c.pass ? "✓" : "✗";
      tr.append(tdL, tdE, tdA, tdR);
      tbody.appendChild(tr);
    }
    // สถานะ validation ประกอบด้วย (ทุกเคสต้อง OK ตาม Excel)
    const trV = document.createElement("tr");
    const tdL = document.createElement("td");
    tdL.textContent = "สถานะ (AM/AS)";
    const tdE = document.createElement("td");
    tdE.textContent = "OK / ผ่าน";
    const tdA = document.createElement("td");
    tdA.textContent = validation.status === "OK" ? `${validation.status} / ${validation.display}` : validation.display;
    const tdR = document.createElement("td");
    tdR.textContent = validation.status === "OK" ? "✓" : "✗";
    if (validation.status !== "OK") trV.className = "coupon-row-fail";
    trV.append(tdL, tdE, tdA, tdR);
    tbody.appendChild(trV);
    table.appendChild(tbody);
    details.appendChild(table);

    if (tc.note) {
      const note = document.createElement("div");
      note.className = "coupon-test-note";
      note.textContent = `ℹ️ ${tc.note}`;
      details.appendChild(note);
    }

    holder.appendChild(details);
  }

  const all = COUPON_TEST_CASES.length;
  summary.textContent = `ผ่าน ${passCount}/${all} เคส`;
  summary.className = `coupon-tests-summary ${passCount === all ? "all-pass" : "has-fail"}`;
}

/* ── Init + standalone (?coupon=1) ───────────────────────────────────────── */

/** Initialize the Coupon UAT page — called from initSuperAdminPanel() flow in app.ts */
export function initCouponUat(): void {
  if (bound) return;

  applyFieldRules();
  const fieldIds = [
    "coupon-type",
    "coupon-subsidize",
    "coupon-people",
    "coupon-vatbasis",
    "coupon-discount",
    "coupon-insurer",
    "coupon-min",
    "coupon-max",
    "coupon-p1-premium",
    "coupon-p1-vat",
    "coupon-p1-duty",
    "coupon-p2-premium",
    "coupon-p2-vat",
    "coupon-p2-duty",
  ];
  for (const id of fieldIds) {
    byId<HTMLElement>(id).addEventListener("input", recalc);
    byId<HTMLElement>(id).addEventListener("change", () => {
      applyFieldRules();
      recalc();
    });
  }

  // Sub-tab เครื่องคำนวณ / Test Cases / สูตรคำนวณ
  for (const pane of SUBTAB_PANES) {
    byId(`coupon-tab-${pane}`).addEventListener("click", () => switchSubtab(pane));
  }

  // ล้างข้อมูล — รีเซ็ตฟอร์มกลับค่า default ทั้งหมด
  byId("btn-coupon-clear").addEventListener("click", () => {
    byId<HTMLSelectElement>("coupon-type").value = "Fix Amount";
    byId<HTMLSelectElement>("coupon-subsidize").value = "Insurer";
    byId<HTMLSelectElement>("coupon-people").value = "1";
    byId<HTMLSelectElement>("coupon-vatbasis").value = "Exclude VAT";
    const numericIds = [
      "coupon-discount",
      "coupon-insurer",
      "coupon-min",
      "coupon-max",
      "coupon-p1-premium",
      "coupon-p1-vat",
      "coupon-p1-duty",
      "coupon-p2-premium",
      "coupon-p2-vat",
      "coupon-p2-duty",
    ];
    for (const id of numericIds) byId<HTMLInputElement>(id).value = "";
    applyFieldRules();
    recalc();
    showToast("🧹 ล้างข้อมูลแล้ว");
  });

  byId("btn-coupon-run-tests").addEventListener("click", runTests);

  runTests(); // รันไว้เลยตั้งแต่เปิดหน้า — กดปุ่มเพื่อรันซ้ำ
  recalc();
  bound = true;
}

/** Sub-tab ทั้งหมด — id ปุ่ม = coupon-tab-{pane} / id pane = coupon-{pane}-pane */
const SUBTAB_PANES = ["calc", "tests", "formula"] as const;

function switchSubtab(pane: (typeof SUBTAB_PANES)[number]): void {
  for (const p of SUBTAB_PANES) {
    byId(`coupon-tab-${p}`).classList.toggle("active", p === pane);
    byId(`coupon-${p}-pane`).classList.toggle("hidden", p !== pane);
  }
}

/* ── Standalone mode (?coupon=1) — mirror รูปแบบ qaTool.ts ─────────────── */

/** Home position of #coupon-uat-page inside the room page — for restoring after standalone */
let homeParent: HTMLElement | null = null;
let homeNext: Node | null = null;

/** True when the app was opened with ?coupon=1 (standalone coupon tool, no login) */
export function isCouponStandaloneUrl(): boolean {
  return new URLSearchParams(window.location.search).get("coupon") === "1";
}

/** Show the Coupon UAT page as a standalone page (?coupon=1) — no login, no Firebase */
export function initCouponStandalone(): void {
  const page = document.getElementById("coupon-uat-page");
  const app = document.getElementById("app");
  if (!page || !app) return;

  if (!homeParent) {
    homeParent = page.parentElement;
    homeNext = page.nextSibling;
  }
  app.appendChild(page);

  document.getElementById("landing-page")?.classList.add("hidden");
  document.getElementById("room-page")?.classList.add("hidden");
  page.classList.remove("hidden");
  page.classList.add("qa-standalone");
  document.getElementById("coupon-back-link")?.classList.remove("hidden");
}

/** Put #coupon-uat-page back to its home position in the room page (no-op if already there) */
export function restoreCouponUatHome(): void {
  const page = document.getElementById("coupon-uat-page");
  if (!page || !homeParent) return;
  homeParent.insertBefore(page, homeNext ?? null);
}
