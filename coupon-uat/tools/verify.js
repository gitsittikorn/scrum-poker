// ตรวจไฟล์ Excel หลังแก้: XML valid, สูตรใหม่, cached L แถว 5-31, input แถว 32-34, diff vs backup
// (CASES = expected discountAfter เคส 1-22 มิเรอร์จาก src/couponTestdata.ts — แก้พร้อมกันถ้า Excel เปลี่ยน)
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { XMLParser } = require("fast-xml-parser");

const SRC = path.join(__dirname, "..", "references", "UAT คูปองส่วนลด TA(BOTH).xlsx");
const BACKUP = path.join(__dirname, "backup", "UAT คูปองส่วนลด TA(BOTH).backup-2026-10-27.xlsx");

// cached discountAfter ตาม testdata (id -> [row, expected])
const CASES = [
  [1,5,50],[2,6,100],[3,7,300],[4,8,195.5],[5,9,363.82],[6,10,586.5],[7,12,10],[8,13,20],[9,14,30],
  [10,15,84],[11,16,150],[12,17,196],[13,19,50],[14,20,100],[15,21,300],[16,22,224],[17,23,381.578],
  [18,24,599.7],[19,28,30],[20,29,50],[21,30,50],[22,31,50],
];

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(SRC));
  const oldZip = await JSZip.loadAsync(fs.readFileSync(BACKUP));
  const parser = new XMLParser({ ignoreAttributes: false });

  // 1) XML well-formed ทุก entry
  for (const name of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/sharedStrings.xml", "xl/workbook.xml"]) {
    const xml = await zip.file(name).async("string");
    parser.parse(xml);
    console.log("well-formed:", name);
  }

  // 2) diff vs backup (เทียบเนื้อหา decompressed ทุก entry)
  const names = Object.keys(zip.files);
  const changed = [];
  for (const n of names) {
    if (zip.file(n) === null) continue;
    const a = await zip.file(n).async("string");
    const b = oldZip.file(n) ? await oldZip.file(n).async("string") : "(new)";
    if (a !== b) changed.push(n);
  }
  console.log("changed entries:", changed);
  const expected = ["xl/sharedStrings.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"];
  const unexpected = changed.filter((c) => !expected.includes(c));
  if (unexpected.length) throw new Error("unexpected changes: " + unexpected);

  // 3) สูตร L ใหม่ + cached values แถวเดิม
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  for (const r of [5, 12, 19, 28]) {
    const i = sheet.indexOf(`r="L${r}"`);
    const seg = sheet.slice(sheet.lastIndexOf("<c ", i), sheet.indexOf("</c>", i) + 4);
    const hasNew = seg.includes(`IF(D${r}=&quot;Fix Amount&quot;,Q${r}+IF(F${r}=2,Z${r},0),R${r}+IF(F${r}=2,AA${r},0))&gt;=J${r}`);
    if (!hasNew) throw new Error(`L${r} new formula missing`);
    console.log(`L${r} formula OK (type-aware min purchase basis)`);
  }
  let mismatch = 0;
  for (const [id, row, exp] of CASES) {
    const i = sheet.indexOf(`r="L${row}"`);
    const seg = sheet.slice(sheet.lastIndexOf("<c ", i), sheet.indexOf("</c>", i) + 4);
    const v = /<v>([^<]*)<\/v>/.exec(seg)?.[1];
    const ok = v !== undefined && Math.abs(parseFloat(v) - exp) < 1e-9;
    if (!ok) { mismatch++; console.log(`  !! case ${id} row ${row}: cached L=${v} vs testdata ${exp}`); }
  }
  console.log(mismatch === 0 ? "cached L values rows 5-31 all match testdata (22/22)" : `cached mismatches: ${mismatch}`);

  // 4) input แถว 32-34
  const ss = await zip.file("xl/sharedStrings.xml").async("string");
  const sis = [...ss.matchAll(/<si>[\s\S]*?<\/si>/g)].map((m) => m[0].replace(/<[^>]+>/g, ""));
  for (const row of [32, 33, 34]) {
    const rm = sheet.match(new RegExp(`<row r="${row}"[^>]*>[\\s\\S]*?</row>`));
    const get = (col) => {
      const m = rm[0].match(new RegExp(`<c r="${col}${row}"[^>]*>(?:<v>([^<]*)</v>|<is><t>([^<]*)</t></is>)</c>`));
      if (!m) return null;
      if (m[2] !== undefined) return m[2];
      return m[1];
    };
    const d = get("D") != null ? sis[+get("D")] : null;
    const e = get("E") != null ? sis[+get("E")] : null;
    const g = get("G") != null ? sis[+get("G")] : null;
    console.log(`row ${row}: A=${get("A")} B=${get("B")} C="${(get("C") || "").slice(0, 40)}..." D=${d} E=${e} F=${get("F")} G=${g} H=${get("H")} J=${get("J")} N=${get("N")}/${get("O")}/${get("P")}`);
  }
  console.log("\nALL CHECKS DONE");
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
