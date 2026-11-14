// Pure ClickUp link extraction + dedup helpers (req 15 — กันไอคอนรูปซ้ำ).
// Zero dependencies: required by app.js and imported directly by unit tests.
//
// Root cause ที่แก้ที่นี่: taskLinks เดิม dedupe ด้วย "URL string ตรง ๆ" —
// แต่รูปเดียวกันมักมาจาก 2 ทาง (markdown description + attachment list)
// ด้วยรูปแบบ URL ต่างกัน (เช่น signed URL ที่มี signature/expires ต่างกันทุกครั้ง)
// string ไม่เท่ากันเลยโชว์ไอคอนซ้ำ 2 รายการ

// Query params ที่เป็น signature/โทเคนชั่วคราว — ไฟล์เดียวกันที่ดึงคนละครั้งได้ค่า
// ต่างกัน (เช่น signed URL ของ attachment) ตัดออกก่อนเทียบ โดยไม่แตะ query
// ที่ใช้ระบุไฟล์จริง (เช่น ?file=a ของลิงก์อื่น) — ไฟล์ต่างกันไม่ถูกรวมกัน
const VOLATILE_QUERY_KEYS =
  /^(sig|signature|token|access_?token|auth|expires?|expiry|expiration|date|ts|timestamp|nonce|cb|_cb|_t|x-amz-[a-z-]+|x-goog-[a-z-]+|awsaccesskeyid)$/i;

// Key ระบุ "ไฟล์" ของ URL — host + path เสมอ บวกเฉพาะ query ที่ระบุไฟล์จริง
// (signature ตัดทิ้ง · path ว่าง = ยึดทั้ง URL เพราะ identity อยู่ใน query)
function urlFileKey(u) {
  try {
    const p = new URL(u);
    const path = p.pathname.replace(/\/+$/, "");
    if (!path) return `${p.hostname}${p.search}`.toLowerCase();
    const identity = [...p.searchParams.entries()]
      .filter(([k]) => !VOLATILE_QUERY_KEYS.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
    return `${p.hostname}${path}${identity ? `?${identity}` : ""}`.toLowerCase();
  } catch {
    return String(u).trim().toLowerCase();
  }
}

const CLICKUP_HOST = /(^|\.)clickup\.com$/i;

function safeHost(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

// แยก URL เป็น segment เลข/ตัวอักษร — ใช้จับ "attachment id ที่ ClickUp ฝังใน URL
// รูปใน description" โดย id ต้องเป็น segment เต็ม ๆ (ไม่ใช่ substring ของ id ยาวกว่า
// เช่น id 123 ต้องไม่ match node12345 ของลิงก์ Figma)
function urlSegments(u) {
  return String(u).split(/[^A-Za-z0-9]+/).filter(Boolean);
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic)$/i;
const PDF_EXT_RE = /\.pdf$/i;

// Pull links out of the task's MARKDOWN description (fetched with
// include_markdown_description=true). Supports markdown inline links
// [display](url) and markdown IMAGES ![alt](url) — display can be shortened
// text — plus bare URLs with or without protocol. Classify known brands
// (Figma/Google/Miro/GitHub/ClickUp) and direct files by extension
// (image/pdf/other), cap at 6. Only http(s) survives — anything
// javascript:/data: is dropped by construction.
function extractLinks(rawMarkdown) {
  // markdown ว่าง/ไม่มี = ไม่พบลิงก์ (คืน [] ทันที)
  const md = String(rawMarkdown || "");
  if (!md.trim()) return [];
  const seen = new Set();
  const urls = [];
  // URL ที่มาจาก markdown image ![alt](url) — รู้แน่ว่าเป็นรูปภาพแม้ URL จะไม่มี
  // นามสกุลไฟล์ (ClickUp ฝังรูปด้วย endpoint อย่าง /t/{taskId}/image/{attId})
  const imageUrls = new Set();
  const add = (u, isImage = false) => {
    u = u
      .replace(/(&(quot|amp|lt|gt|#39|apos);)+$/i, "") // entity ท้าย URL จากการ decode ไม่สมบูรณ์
      .replace(/[)\].,;]+$/, ""); // trailing punctuation/bracket ของ markdown
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
    if (isImage) imageUrls.add(u);
  };
  // 1) markdown inline link [display](url) และ image ![alt](url) — ดึง URL จากวงเล็บ
  //    แล้ว "ตัด construct ทิ้ง" จากข้อความที่เหลือ กัน pass อื่นไปเก็บ URL/domain
  //    ที่หลงเหลือใน display text ซ้ำ · มี "!" นำหน้า = รูปภาพเสมอ
  const stripped = md.replace(
    /(!?)\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+?)\s*\)/gi,
    (_m, bang, _alt, url) => {
      add(url, bang === "!");
      return " ";
    }
  );
  // 2) Figma URL ตรง ๆ (แม้ไม่ได้อยู่ในรูป markdown link)
  for (const m of stripped.matchAll(/https?:\/\/(?:www\.)?figma\.com\/[^\s)\]"'<>]+/gi)) add(m[0]);
  // 3) bare http(s) URLs อื่น ๆ — หยุดที่ space วงเล็บปิด bracket quote < >
  for (const m of stripped.matchAll(/https?:\/\/[^\s)\]"'<>]+/gi)) add(m[0]);
  // 4) href attribute (กันกรณีปน HTML)
  for (const m of stripped.matchAll(/href=(?:"([^"]+)"|'([^']+)')/g)) add(m[1] ?? m[2]);
  // 5) ลิงก์พิมพ์เปล่าไม่มีโปรโตคอล — www.* หรือโฮสต์ที่รู้จัก (lookbehind กันจับซ้ำใน hostname อื่น)
  for (const m of stripped.matchAll(/www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s)\]"'<>]*)?/gi)) add(m[0]);
  for (const m of stripped.matchAll(
    /(?<![\w.])(?:figma\.com|fig\.ma|docs\.google\.com|drive\.google\.com|miro\.com|github\.com|clickup\.com)\/[^\s)\]"'<>]*/gi
  )) {
    add(m[0]);
  }

  const out = [];
  for (const u of urls) {
    let host = "";
    let path = "";
    let search = "";
    try {
      const parsed = new URL(u);
      host = parsed.hostname;
      path = parsed.pathname;
      search = parsed.search;
    } catch {
      continue;
    }
    let type = "link";
    // ตัด slash ท้าย path ก่อนเช็คนามสกุลไฟล์ (รูป/ไฟล์แนบที่ลิงก์ตรง ๆ)
    const filePath = path.replace(/\/+$/, "");
    if (/(^|\.)figma\.com$/.test(host) || /(^|\.)fig\.ma$/.test(host)) type = "figma";
    else if (host === "docs.google.com") {
      if (path.startsWith("/spreadsheets")) type = "sheets";
      else if (path.startsWith("/document")) type = "docs";
      else if (path.startsWith("/presentation")) type = "slides";
    } else if (host === "drive.google.com" || host === "drive.usercontent.google.com") type = "drive";
    else if (/(^|\.)miro\.com$/.test(host)) type = "miro";
    else if (/(^|\.)github\.com$/.test(host)) type = "github";
    else if (/(^|\.)clickup\.com$/.test(host)) type = "clickup";
    else if (PDF_EXT_RE.test(filePath)) type = "pdf";
    else if (IMAGE_EXT_RE.test(filePath)) type = "image";
    else if (/\.(zip|rar|7z|xlsx?|docx?|pptx?|csv|txt|json|mp4|mov|webm|mp3|wav)$/i.test(filePath)) {
      type = "file";
    }
    // ── ยกระดับเป็น "รูปภาพ" เมื่อรู้แน่ชัด (แก้: รูปฝังใน description เคยได้โซ่) ──
    // 1) มาจาก markdown image syntax ![alt](url) = รูปเสมอ
    if (imageUrls.has(u)) type = "image";
    else if (type === "clickup") {
      // 2) URL บน clickup.com ที่เป็น endpoint รูปของการ์ด เช่น /t/{taskId}/image/{attId}
      //    หรือ ?image={attId} — endpoint รูปไม่มีนามสกุลไฟล์ต่อท้าย ต้องดู pattern
      if (/\/image\//i.test(path) || /[?&]image=/i.test(search)) type = "image";
      // 3) นามสกุลไฟล์รูป/pdf บน clickup.com = ไฟล์จริง (ลิงก์การ์ดไม่มีนามสกุล)
      else if (PDF_EXT_RE.test(filePath)) type = "pdf";
      else if (IMAGE_EXT_RE.test(filePath)) type = "image";
    }
    out.push({ type, url: u });
    if (out.length >= 6) break;
  }
  return out;
}

// ClickUp task attachments → link entries. Classify by the REAL attachment
// metadata (file_extension / mime_type from the API payload) so an image
// attachment shows the image icon instead of the generic chain-link icon.
// Falls back to the download/private URL when present; anything without an
// http(s) URL is skipped. Clicks keep the original open-in-new-tab behavior.
function classifyAttachment(att) {
  const url = String(
    att?.url_private_download || att?.url_private || att?.short_url || att?.url || ""
  ).trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const ext = String(att?.file_extension || att?.extension || "")
    .toLowerCase()
    .replace(/^\./, "");
  const mime = String(att?.mime_type || att?.mimetype || "").toLowerCase();
  let type = "file";
  if (/^(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic)$/.test(ext) || mime.startsWith("image/")) {
    type = "image";
  } else if (ext === "pdf" || mime === "application/pdf") {
    type = "pdf";
  }
  return { type, url };
}

/** Links for a task = description links + real attachments, DEDUPED (req 15).
 *  รูป/ไฟล์เดียวกันมักปรากฏทั้งใน description และ attachment list ด้วยรูปแบบ URL
 *  ต่างกัน — ถือเป็น "ไฟล์เดียวกัน" เมื่อ:
 *  1. URL ใน description (โฮสต์ clickup.com) ฝัง id ของ attachment ตัวนั้นเป็น
 *     segment เต็ม ๆ (จับคู่ด้วย Attachment ID — เชื่อถือได้ที่สุด), หรือ
 *  2. file key เท่ากัน (host + path + เฉพาะ query ที่ระบุไฟล์ — signature ตัดทิ้ง)
 *  อ่านอย่างเดียว ไม่แตะ/ไม่ลบข้อมูลอะไรใน ClickUp · คงลำดับ (description ก่อน)
 *  และ cap 6 ตามพฤติกรรมเดิม · รูปใน description ยังอยู่ใน description ตามปกติ */
function taskLinks(task) {
  const attachments = task.attachments || [];
  const attById = new Map();
  attachments.forEach((a) => {
    const id = String(a?.id ?? "");
    if (id) attById.set(id, a);
  });

  const links = [];
  const seen = new Set();
  // ลิงก์ 1 รายการจองได้หลาย key (ทั้งจาก URL และจาก attachment id) —
  // เจอ key ใด ๆ ที่เคยเห็นแล้ว = ไฟล์ซ้ำ ตัดทิ้ง · ไม่เคย = จองทุก key เลย
  const push = (link, extraKeys = []) => {
    const keys = [urlFileKey(link.url), ...extraKeys];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    links.push(link);
  };

  for (let link of extractLinks(task.markdown_description)) {
    // description URL บน clickup.com ที่ฝัง attachment id เป็น segment เต็ม
    // → ไฟล์เดียวกับ attachment ตัวนั้น (จับคู่ด้วย Attachment ID ที่เชื่อถือได้)
    const extra = [];
    if (attById.size > 0 && CLICKUP_HOST.test(safeHost(link.url))) {
      const segs = urlSegments(link.url);
      for (const [id, att] of attById) {
        if (segs.includes(id)) {
          extra.push(`att:${id}`);
          // metadata ของ attachment (mime/extension) แม่นกว่าการเดาจาก URL —
          // ถ้าไฟล์แนบนั้นเป็นรูป/pdf ให้ไอคอนถูกประเภทแม้ URL จะไม่มีนามสกุล
          const attLink = classifyAttachment(att);
          if (attLink && (attLink.type === "image" || attLink.type === "pdf")) {
            link = { ...link, type: attLink.type };
          }
          break;
        }
      }
    }
    push(link, extra);
  }
  for (const att of attachments) {
    const link = classifyAttachment(att);
    if (!link) continue;
    // attachment จองทั้ง id และ URL key ของตัวเอง — description URL รูปเดียวกัน
    // (แบบไม่ฝัง id เช่น signed URL) จะได้ชนผ่าน URL key ด้วย
    push(link, att?.id != null ? [`att:${String(att.id)}`] : []);
  }
  return links.slice(0, 6);
}

module.exports = { extractLinks, classifyAttachment, taskLinks, urlFileKey };
