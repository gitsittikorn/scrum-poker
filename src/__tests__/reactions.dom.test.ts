// @vitest-environment happy-dom
// Regression (bug audit) — XSS guards ของข้อมูลที่มาจาก Firebase:
//   animateFloatingEmoji (liveReactions ของคนอื่นในห้อง) และ
//   renderMessageReactions / reactionBadgeHtml (key ของ reactions = ค่าจาก RTDB)
// ใครก็เขียนค่า malicious ลง RTDB ได้ (anonymous auth) — ต้องไม่รันเป็นสคริปต์ในเครื่องคนอื่น
import { describe, it, expect, beforeEach, vi } from "vitest";
import html from "../index.html?raw";

vi.mock("../firebase", () => ({
  db: {},
  ref: vi.fn((...p: unknown[]) => ({ path: p.join("/") })),
  set: vi.fn(async () => {}),
  get: vi.fn(async () => ({ exists: () => false, val: () => null })),
  remove: vi.fn(async () => {}),
  push: vi.fn(() => ({ key: "k1" })),
  serverTimestamp: vi.fn(() => 0),
}));

// โหลด markup จริงก่อน import โมดูลที่อ่าน element ตอนโหลด (dom.ts)
document.body.innerHTML = html
  .match(/<body>([\s\S]*)<\/body>/)![1]
  .replace(/<script[\s\S]*?<\/script>/g, "");

const { animateFloatingEmoji, renderMessageReactions, reactionBadgeHtml } = await import("../reactions");
const { floatingReactions } = await import("../dom");
const { state } = await import("../state");

const MALICIOUS_EMOJI = '<img src=x onerror="alert(1)">';
const BREAKOUT_KEY = 'x" onclick="alert(1)" b="';

beforeEach(() => {
  floatingReactions.innerHTML = "";
  state.currentUid = "me1";
});

describe("XSS guard — animateFloatingEmoji (ค่าจาก liveReactions)", () => {
  it("emoji malicious ถูก escape — ไม่มี element จริงหรือ attribute ที่รันได้โผล่ใน DOM", () => {
    animateFloatingEmoji(MALICIOUS_EMOJI, "<script>bad()</script>");
    const out = floatingReactions.innerHTML;
    expect(out).not.toContain("<img"); // < ถูก escape → &lt;img (ไม่มี tag จริง)
    expect(out).not.toContain("<script");
    // ไม่มี element จริงเกิดขึ้น (ข้อความ escaped ที่เหลืออยู่เป็น text เฉย ๆ รันไม่ได้)
    expect(floatingReactions.querySelectorAll("img, script").length).toBe(0);
    // แสดงเป็นข้อความตาม literal ที่ผู้ใช้ส่งมา (escape แล้ว)
    expect(floatingReactions.querySelector(".floating-emoji-icon")?.textContent).toBe(MALICIOUS_EMOJI);
  });

  it("emoji ปกติแสดงได้เหมือนเดิม", () => {
    animateFloatingEmoji("🎉", "Yam");
    expect(floatingReactions.querySelector(".floating-emoji-icon")?.textContent).toBe("🎉");
    expect(floatingReactions.querySelector(".floating-emoji-name")?.textContent).toBe("Yam");
  });
});

describe("XSS guard — reaction badge (key ของ reactions มาจาก RTDB)", () => {
  it("emoji key ที่พยายาม break out จาก attribute ต้องถูก escape", () => {
    const el = document.createElement("div");
    el.dataset.msgId = "m1";
    // จำลองโครงข้อความที่มี meta ให้ badge เกาะ (renderMessageReactions ต้องการ)
    const meta = document.createElement("div");
    meta.className = "chat-msg-meta";
    el.appendChild(meta);
    document.querySelector("#chat-messages")!.appendChild(el);

    renderMessageReactions("m1", { [BREAKOUT_KEY]: { me1: "Yam" } });
    const badge = el.querySelector(".reaction-badge") as HTMLElement;
    expect(badge).toBeTruthy();
    // การ break ฟันหนูไม่สำเร็จ: ไม่เกิด attribute onclick จริงบน span
    // (ค่า malicious ถูก escape เป็น &quot; อยู่ใน data-emoji เท่านั้น —
    //  ข้อความที่แสดงเป็น text ของ span เป็น inert รันไม่ได้)
    expect(badge.getAttribute("onclick")).toBeNull();
    // data-emoji เก็บค่าเดิมแบบ escaped — อ่านกลับผ่าน DOM ได้ตรงตัว
    expect(badge.dataset.emoji).toBe(BREAKOUT_KEY);
  });

  it("reactionBadgeHtml (builder กลางที่ chat.ts ใช้ร่วม) escape ครบทั้ง display และ attr", () => {
    const html1 = reactionBadgeHtml(MALICIOUS_EMOJI, { u1: '<b>"Run"</b>' }, "m2");
    expect(html1).not.toContain("<img");
    expect(html1).not.toContain("<b>");
    expect(html1).toContain("&quot;");
    // emoji ปกติ + นับ count ถูก
    const html2 = reactionBadgeHtml("👍", { a: "A", b: "B" }, "m3");
    expect(html2).toContain("👍 <small>2</small>");
  });
});
