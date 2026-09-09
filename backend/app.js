// Thin ClickUp proxy for Scrum Poker — Express app (no listen).
// The ClickUp API token never leaves this server — the frontend only ever
// talks to these endpoints with task ids/values, never with credentials.
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const {
  PORT = 3000,
  CORS_ORIGIN = "http://localhost:5173",
  CLICKUP_API_TOKEN,
  CLICKUP_DEV_POINT_FIELD_NAME = "Dev Point Estimation (Orginal)",
  CLICKUP_QA_POINT_FIELD_NAME = "QA Point Estimation",
} = process.env;

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const clickup = axios.create({
  baseURL: CLICKUP_BASE,
  timeout: 15000,
  headers: { Authorization: String(CLICKUP_API_TOKEN || ""), "Content-Type": "application/json" },
});

const app = express();
app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN.split(",").map((s) => s.trim()) }));

// ── helpers ─────────────────────────────────────────────────────────────

// Map axios errors from ClickUp into short, user-facing Thai messages.
// Non-axios errors (our own validation throws) pass through untouched.
const clickupError = (err) => {
  if (!axios.isAxiosError(err)) return err;
  if (!err.response) {
    // Network-level failure / timeout
    const e = new Error(
      err.code === "ECONNABORTED" ? "ClickUp ตอบช้าเกินไป ลองอีกครั้ง" : "ติดต่อ ClickUp ไม่สำเร็จ"
    );
    e.status = 502;
    return e;
  }
  const status = err.response.status;
  const ecode = err.response.data?.ECODE;
  if (status === 401 && ecode === "OAUTH_027") {
    // ClickUp returns this for tasks outside the token's teams — indistinguishable from "not found"
    const e = new Error("ไม่พบ task นี้ หรือ task ไม่ได้อยู่ใน team ที่เข้าถึงได้");
    e.status = 404;
    return e;
  }
  if (status === 401 || status === 403) {
    const e = new Error("ClickUp token ไม่ถูกต้องหรือหมดอายุ");
    e.status = 502;
    return e;
  }
  if (status === 404) {
    const e = new Error("ไม่พบ task นี้ใน ClickUp");
    e.status = 404;
    return e;
  }
  const e = new Error(err.response?.data?.err || "ติดต่อ ClickUp ไม่สำเร็จ");
  e.status = status >= 400 ? status : 502;
  return e;
};

let cachedTeamId = null;
async function getTeamId() {
  if (cachedTeamId) return cachedTeamId;
  try {
    const { data } = await clickup.get("/team");
    cachedTeamId = data.teams?.[0]?.id ?? null;
  } catch (err) {
    throw clickupError(err);
  }
  if (!cachedTeamId) throw Object.assign(new Error("ไม่พบ team ใน ClickUp account"), { status: 502 });
  return cachedTeamId;
}

// Fetch a task by whatever the user pasted: full URL, bare short id, or custom id.
// Always asks for include_markdown_description so inline links ([display](url))
// survive — the plain `description` (HTML) field drops editor-made links.
async function fetchTaskByInput(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) throw Object.assign(new Error("กรุณาใส่ลิงก์หรือ id ของ task"), { status: 400 });

  // 1) URL forms: app.clickup.com/t/{taskId}, /t/{teamId}/{taskId} or /t/{teamId}/{customId}
  //    (custom id มีขีด เช่น CES-5700 — ทั้งสองกลุ่มต้องยอมรับ hyphen)
  const urlMatch = input.match(/clickup\.com\/t\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9-]+))?/i);
  const candidate = urlMatch ? (urlMatch[2] || urlMatch[1]) : input.replace(/^\/+/, "");

  try {
    const { data } = await clickup.get(`/task/${encodeURIComponent(candidate)}`, {
      params: { include_markdown_description: true },
    });
    return data;
  } catch (err) {
    const status = err.response?.status;
    // 404 = unknown task id; 401/OAUTH_027 = task exists outside this token's teams.
    // Either way, retry once as a custom-id lookup (e.g. "TQM-42") before giving up.
    const retryable = status === 404 || status === 401 || !status;
    if (retryable || !urlMatch) {
      const teamId = await getTeamId();
      const { data } = await clickup.get("/task/" + encodeURIComponent(candidate), {
        params: { custom_task_ids: true, team_id: teamId, include_markdown_description: true },
      });
      return data;
    }
    throw clickupError(err);
  }
}

function readPointField(task, fieldId) {
  const field = (task.custom_fields || []).find((f) => f.id === fieldId);
  if (!field || field.value === null || field.value === undefined) return null;
  const n = Number(field.value);
  return Number.isFinite(n) ? n : null;
}

// Find a custom field by display name on the task itself (exact, then
// case/space-insensitive). Field UUIDs are per ClickUp space, so resolving
// per-task by name works across boards where the UUIDs would not exist.
function findFieldByName(task, name) {
  const fields = task.custom_fields || [];
  const norm = (s) => String(s).trim().toLowerCase();
  return (
    fields.find((f) => f.name === name) ||
    fields.find((f) => norm(f.name) === norm(name))
  );
}

/** Resolve the dev/qa point fields on this task → { field, name } | null */
function devPointField(task) {
  return findFieldByName(task, CLICKUP_DEV_POINT_FIELD_NAME);
}
function qaPointField(task) {
  return findFieldByName(task, CLICKUP_QA_POINT_FIELD_NAME);
}

const isNum = (v) => v === null || v === undefined || (typeof v === "number" && Number.isFinite(v));

// Pull links out of the task's MARKDOWN description (fetched with
// include_markdown_description=true). Supports markdown inline links
// [display](url) — display can be shortened text — plus bare URLs with or
// without protocol. Classify the known brands, cap at 6. Only http(s)
// survives — anything javascript:/data: is dropped by construction.
function extractLinks(rawMarkdown) {
  // markdown ว่าง/ไม่มี = ไม่พบลิงก์ (คืน [] ทันที)
  const md = String(rawMarkdown || "");
  if (!md.trim()) return [];
  const seen = new Set();
  const urls = [];
  const add = (u) => {
    u = u
      .replace(/(&(quot|amp|lt|gt|#39|apos);)+$/i, "") // entity ท้าย URL จากการ decode ไม่สมบูรณ์
      .replace(/[)\].,;]+$/, ""); // trailing punctuation/bracket ของ markdown
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };
  // 1) markdown inline link [display](url) — ดึง URL จากวงเล็บแล้ว "ตัด construct
  //    ทิ้ง" จากข้อความที่เหลือ กัน pass อื่นไปเก็บ URL/domain ที่หลงเหลือใน display
  //    text ของลิงก์ซ้ำ (เช่น [www.figma.com\nhttps://x](https://x))
  const stripped = md.replace(/\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+?)\s*\)/gi, (_m, url) => {
    add(url);
    return " ";
  });
  // 2) Figma URL ตรง ๆ (แม้ไม่ได้อยู่ในรูป markdown link)
  for (const m of stripped.matchAll(/https?:\/\/(?:www\.)?figma\.com\/[^\s)\]"'<>]+/gi)) add(m[0]);
  // 3) bare http(s) URLs อื่น ๆ — หยุดที่ space วงเล็บปิด bracket quote < >
  for (const m of stripped.matchAll(/https?:\/\/[^\s)\]"'<>]+/gi)) add(m[0]);
  // 4) href attribute (กันกรณีปน HTML)
  for (const m of stripped.matchAll(/href=(?:"([^"]+)"|'([^']+)')/g)) add(m[1] ?? m[2]);
  // 5) ลิงก์พิมพ์เปล่าไม่มีโปรโตคอล — www.* หรือโฮสต์ที่รู้จัก (lookbehind กันจับซ้ำใน hostname อื่น)
  for (const m of stripped.matchAll(/www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s)\]"'<>]*)?/gi)) add(m[0]);
  for (const m of stripped.matchAll(/(?<![\w.])(?:figma\.com|fig\.ma|docs\.google\.com|drive\.google\.com)\/[^\s)\]"'<>]*/gi)) {
    add(m[0]);
  }

  const out = [];
  for (const u of urls) {
    let host = "";
    let path = "";
    try {
      const parsed = new URL(u);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      continue;
    }
    let type = "link";
    if (/(^|\.)figma\.com$/.test(host) || /(^|\.)fig\.ma$/.test(host)) type = "figma";
    else if (host === "docs.google.com") {
      if (path.startsWith("/spreadsheets")) type = "sheets";
      else if (path.startsWith("/document")) type = "docs";
    }
    out.push({ type, url: u });
    if (out.length >= 6) break;
  }
  return out;
}

// ── routes ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true, clickupConfigured: Boolean(CLICKUP_API_TOKEN) });
});

// { input } → { taskId, name, url, customId, status, links }
app.post("/api/clickup/resolve-task", async (req, res, next) => {
  try {
    const task = await fetchTaskByInput(req.body?.input);
    const links = extractLinks(task.markdown_description);
    const figmaUrls = links.filter((l) => l.type === "figma").map((l) => l.url);
    console.log(`[clickup] resolve task=${task.id} custom=${task.custom_id || "-"}`);
    console.log(`[clickup]   markdown_description=${JSON.stringify(task.markdown_description ?? null)}`);
    console.log(`[clickup]   figma=${JSON.stringify(figmaUrls)} total_links=${links.length}`);
    res.json({
      taskId: task.id,
      name: task.name,
      url: task.url,
      customId: task.custom_id || null,
      status: task.status?.status || null,
      links,
    });
  } catch (err) {
    next(clickupError(err));
  }
});

// { taskId } → { dev, qa } — current values of the two point fields (null = empty)
app.post("/api/clickup/check-existing", async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || "").trim();
    if (!taskId) throw Object.assign(new Error("ต้องระบุ taskId"), { status: 400 });
    const { data: task } = await clickup.get(`/task/${encodeURIComponent(taskId)}`);
    res.json({
      dev: readPointField(task, devPointField(task)?.id),
      qa: readPointField(task, qaPointField(task)?.id),
    });
  } catch (err) {
    next(clickupError(err));
  }
});

// { taskId, dev?, qa?, comment? } → write each provided value to its custom field,
// then post `comment` (grooming summary) on the card when every write succeeded
app.post("/api/clickup/save-points", async (req, res, next) => {
  try {
    const { taskId } = req.body || {};
    const dev = req.body?.dev ?? null;
    const qa = req.body?.qa ?? null;
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
    if (!taskId) throw Object.assign(new Error("ต้องระบุ taskId"), { status: 400 });
    if (!isNum(dev) || !isNum(qa)) throw Object.assign(new Error("ค่า point ไม่ถูกต้อง"), { status: 400 });
    if (dev === null && qa === null) throw Object.assign(new Error("ไม่มีค่าที่จะบันทึก"), { status: 400 });

    // Resolve field ids by name on THIS card (UUIDs differ across spaces)
    const { data: task } = await clickup.get(`/task/${encodeURIComponent(taskId)}`);
    const devField = dev !== null ? devPointField(task) : null;
    const qaField = qa !== null ? qaPointField(task) : null;
    if (dev !== null && !devField) {
      throw Object.assign(
        new Error(`ไม่พบ custom field "${CLICKUP_DEV_POINT_FIELD_NAME}" บนการ์ดนี้`),
        { status: 422 }
      );
    }
    if (qa !== null && !qaField) {
      throw Object.assign(
        new Error(`ไม่พบ custom field "${CLICKUP_QA_POINT_FIELD_NAME}" บนการ์ดนี้`),
        { status: 422 }
      );
    }

    const jobs = [];
    if (dev !== null) jobs.push(["dev", devField.id, dev, devField.name]);
    if (qa !== null) jobs.push(["qa", qaField.id, qa, qaField.name]);

    const results = await Promise.allSettled(
      // ClickUp's set-custom-field endpoint is POST (PUT returns 405)
      jobs.map(([, fieldId, value]) =>
        clickup.post(`/task/${encodeURIComponent(taskId)}/field/${fieldId}`, { value })
      )
    );

    const out = {};
    let anyFailed = false;
    results.forEach((r, i) => {
      const [key, , , fieldName] = jobs[i];
      if (r.status === "fulfilled") out[key] = { ok: true, field: fieldName };
      else {
        anyFailed = true;
        out[key] = { ok: false, error: r.reason?.response?.data?.err || r.reason?.message || "บันทึกไม่สำเร็จ" };
      }
    });

    // Grooming comment — best-effort: only when the points actually landed
    if (comment && !anyFailed) {
      try {
        await clickup.post(`/task/${encodeURIComponent(taskId)}/comment`, {
          comment_text: comment,
          notify_all: false,
        });
        out.comment = { ok: true };
      } catch (err) {
        out.comment = { ok: false, error: clickupError(err).message };
      }
    }
    res.status(anyFailed ? 502 : 200).json(out);
  } catch (err) {
    next(clickupError(err));
  }
});

// { taskId, comment } → post a comment on the card (pre-groom summary — no field writes)
app.post("/api/clickup/post-comment", async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || "").trim();
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
    if (!taskId) throw Object.assign(new Error("ต้องระบุ taskId"), { status: 400 });
    if (!comment) throw Object.assign(new Error("ต้องระบุ comment"), { status: 400 });
    await clickup.post(`/task/${encodeURIComponent(taskId)}/comment`, {
      comment_text: comment,
      notify_all: false,
    });
    res.json({ ok: true });
  } catch (err) {
    next(clickupError(err));
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("[api]", status, err.message, err.response?.data ?? "");
  res.status(status).json({ error: err.message || "เกิดข้อผิดพลาด" });
});

module.exports = app;
