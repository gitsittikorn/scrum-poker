// Inspect UAT coupon xlsx: sheet map + L-column formulas + row inputs
const fs = require("fs");
const JSZip = require("jszip");

const FILE = process.argv[2];
if (!FILE) { console.error("usage: node inspect.js <xlsx>"); process.exit(1); }

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));
  console.log("== zip entries ==");
  zip.forEach((path) => console.log(path));

  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const wbRels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  console.log("\n== workbook.xml sheets ==");
  const sheetTags = wbXml.match(/<sheet [^>]*\/>/g) || [];
  const rels = {};
  for (const m of wbRels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2];
  const sheetMap = {};
  for (const tag of sheetTags) {
    const name = /name="([^"]+)"/.exec(tag)[1];
    const rid = /r:id="([^"]+)"/.exec(tag)[1];
    sheetMap[name] = "xl/" + rels[rid].replace(/^\//, "");
    console.log(`  "${name}" -> ${sheetMap[name]}`);
  }

  const target = process.argv[3] || Object.keys(sheetMap)[0];
  console.log(`\n== inspecting sheet "${target}" (${sheetMap[target]}) ==`);
  const xml = await zip.file(sheetMap[target]).async("string");
  console.log("xml length:", xml.length);

  // dump each row's cells: ref, formula (or value), shared flag
  const rows = {};
  for (const rm of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNum = +rm[1];
    const cells = {};
    for (const cm of rm[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>(?:<f( [^>]*)?>([\s\S]*?)<\/f>)?(?:<v>([\s\S]*?)<\/v>)?<\/c>/g)) {
      const col = cm[1];
      const attrs = cm[3] || "";
      const fAttrs = (cm[4] || "").trim();
      const formula = cm[5];
      const value = cm[6];
      cells[col] = {
        shared: /t="shared"/.test(fAttrs) ? (/si="(\d+)"/.exec(fAttrs)?.[1] ?? "?") : null,
        ref: /ref="([^"]+)"/.exec(fAttrs)?.[1] || null,
        f: formula != null ? formula.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null,
        v: value != null ? value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null,
      };
    }
    rows[rowNum] = cells;
  }

  const show = (rowNum) => {
    const c = rows[rowNum];
    if (!c) return console.log(`row ${rowNum}: <absent>`);
    const cols = Object.keys(c).sort();
    console.log(`row ${rowNum}:`);
    for (const col of cols) {
      const { shared, ref, f, v } = c[col];
      const tag = shared != null ? `f[shared si=${shared}${ref ? " ref=" + ref : ""}]` : f != null ? "f" : v != null ? "v" : "-";
      console.log(`  ${col}${rowNum} ${tag}: ${f ?? v ?? ""}`);
    }
  };

  const which = process.argv[4]; // e.g. "28"
  if (which) {
    for (const r of which.split(",").map(Number)) show(r);
  } else {
    console.log("\nall row numbers:", Object.keys(rows).join(","));
  }
})();
