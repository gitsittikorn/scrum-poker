/* [บันทึกประวัติ] แพตช์ Excel ครั้งแรก 2026-10-27 — รันซ้ำกับไฟล์ที่แพตช์แล้วจะ error (replaceOnce กันเขียนซ้ำ)
 * ถ้าจะแพตช์สูตรอย่างอื่นในอนาคต ใช้ไฟล์นี้เป็นแม่แบบ: โหลด zip → แก้ XML ด้วย replaceOnce → save
 *
 * สิ่งที่แพตช์ครั้งนั้น:
 *  1) สูตรคอลัมน์ L ทั้ง 4 master (L5/L12/L19/L28): Min Purchase ของ Fix Amount เช็คจากยอดเต็ม (Q+Z) แทนฐานลด (R+AA)
 *  2) ข้อความคู่มือ (sharedStrings 68/70) ให้ตรงกติกาใหม่
 *  3) เติม input แถว 32-34 = test case 23-25 (ตัวอย่างสเปค Min Purchase) — สูตรรออยู่แล้วในทุกแถว
 *  4) fullCalcOnLoad ให้ Excel recalc ตอนเปิดไฟล์ */
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const SRC = path.join(__dirname, "..", "references", "UAT คูปองส่วนลด TA(BOTH).xlsx");
const BACKUP_DIR = path.join(__dirname, "backup");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── ข้อมูลแถวใหม่: [cell, ค่า, ชนิด] — ss index: Fix=9 %=129 Insurer=125 TQM=127 BOTH=128 Include=130 Exclude=126
const newRow = (id, campaign, product, d, e, f, g, h, j, n, o, p) => [
  ["A", String(id), "n"],
  ["B", String(campaign), "n"],
  ["C", product, "inline"],
  ["D", String(d), "s"],
  ["E", String(e), "s"],
  ["F", String(f), "n"],
  ["G", String(g), "s"],
  ["H", String(h), "n"],
  ["J", String(j), "n"],
  ["N", String(n), "n"],
  ["O", String(o), "n"],
  ["P", String(p), "n"],
];

const ROWS = {
  32: newRow(23, 318, "Min Purchase ตัวอย่าง A: Fix Amount ได้รับส่วนลด (เบี้ย 80 + VAT 10 + Duty 10 = 100 ≥ Min 100)", 9, 127, 1, 126, 20, 100, 80, 10, 10),
  33: newRow(24, 319, "Min Purchase ตัวอย่าง B: Percentage Include VAT ได้รับส่วนลด (ยอดเต็ม 100 ≥ Min 100)", 129, 125, 1, 130, 10, 100, 80, 10, 10),
  34: newRow(25, 319, "Min Purchase ตัวอย่าง C: Percentage Exclude VAT ไม่ได้รับส่วนลด (เบี้ย 80 < Min 100)", 129, 127, 1, 126, 20, 100, 80, 10, 10),
};

function replaceOnce(haystack, needle, replacement, label) {
  const count = haystack.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 occurrence, found ${count}`);
  return haystack.replace(needle, replacement);
}

(async () => {
  // backup ก่อนแตะไฟล์
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = path.join(BACKUP_DIR, "UAT คูปองส่วนลด TA(BOTH).backup-2026-10-27.xlsx");
  fs.copyFileSync(SRC, backup);
  console.log("backup ->", backup);

  const zip = await JSZip.loadAsync(fs.readFileSync(SRC));

  // ── 1) แก้สูตร L ทั้ง 4 master
  let sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  for (const r of [5, 12, 19, 28]) {
    const oldCmp = `(R${r}+IF(F${r}=2,AA${r},0))&gt;=J${r}`;
    const newCmp = `IF(D${r}=&quot;Fix Amount&quot;,Q${r}+IF(F${r}=2,Z${r},0),R${r}+IF(F${r}=2,AA${r},0))&gt;=J${r}`;
    sheet = replaceOnce(sheet, oldCmp, newCmp, `L${r} min-purchase basis`);
    console.log(`L${r}: min purchase basis patched`);
  }
  // ตรวจว่าไม่เหลือสูตรเก่าที่ไหน (member ใช้ master แปล relative จึงไม่มี text ซ้ำ)
  if (/\(R\d+\+IF\(F\d+=2,AA\d+,0\)\)&gt;=J\d+/.test(sheet)) throw new Error("old min-purchase comparison still present");
  zip.file("xl/worksheets/sheet1.xml", sheet);

  // ── 2) แก้ข้อความคู่มือ (plain <si><t>)
  let ss = await zip.file("xl/sharedStrings.xml").async("string");
  ss = replaceOnce(
    ss,
    `<si><t>ฐาน = เบี้ยเท่านั้น; ตรวจ Min Purchase จากฐานนี้; ส่วนลด = MIN(Fix Amount, เบี้ยรวม)</t></si>`,
    `<si><t>ฐาน = เบี้ยเท่านั้น; ตรวจ Min Purchase จากยอดเต็ม (เบี้ย + VAT + Duty); ส่วนลด = MIN(Fix Amount, เบี้ยรวม)</t></si>`,
    "manual fix-amount rule"
  );
  ss = replaceOnce(
    ss,
    `<si><t>ถ้าฐานรวมต่ำกว่า Min Purchase → ส่วนลดทั้งหมดเป็น 0</t></si>`,
    `<si><t>ตัวที่ใช้ตรวจ Min Purchase: Fix Amount / % Include VAT = เบี้ย + VAT + Duty, % Exclude VAT = เบี้ย — ถ้าต่ำกว่า Min Purchase ส่วนลดทั้งหมดเป็น 0</t></si>`,
    "manual generic rule"
  );
  zip.file("xl/sharedStrings.xml", ss);
  console.log("manual texts patched (ss 68, 70)");

  // ── 3) เติม input แถว 32-34 (แปลง <c r="Xn" s="Y"/> เปล่าเป็นมีค่า)
  for (const [rowNum, cells] of Object.entries(ROWS)) {
    for (const [col, value, kind] of cells) {
      const re = new RegExp(`<c r="${col}${rowNum}"([^/>]*)/>`);
      const m = sheet.match(re);
      if (!m) throw new Error(`cell ${col}${rowNum} (empty) not found`);
      const attrs = m[1];
      let cell;
      if (kind === "s") cell = `<c r="${col}${rowNum}"${attrs} t="s"><v>${value}</v></c>`;
      else if (kind === "inline") cell = `<c r="${col}${rowNum}"${attrs} t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
      else cell = `<c r="${col}${rowNum}"${attrs}><v>${value}</v></c>`;
      sheet = replaceOnce(sheet, m[0], cell, `cell ${col}${rowNum}`);
    }
    console.log(`row ${rowNum}: inputs filled`);
  }
  zip.file("xl/worksheets/sheet1.xml", sheet);

  // ── 4) fullCalcOnLoad
  let wb = await zip.file("xl/workbook.xml").async("string");
  wb = replaceOnce(wb, "<calcPr/>", '<calcPr fullCalcOnLoad="1"/>', "calcPr");
  zip.file("xl/workbook.xml", wb);
  console.log("fullCalcOnLoad set");

  // ── เขียนไฟล์กลับ
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(SRC, buf);
  console.log("written ->", SRC, `(${buf.length} bytes)`);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
