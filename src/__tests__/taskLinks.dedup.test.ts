import { describe, it, expect } from "vitest";
// backend/links.js = pure CJS module (ไม่มี dependency) — import มาเทสตรงได้
import linksMod from "../../backend/links.js";
import { dedupeTaskLinks, taskLinkKey } from "../utils";
import type { TaskLink } from "../types";

const { taskLinks, urlFileKey } = linksMod as {
  taskLinks: (task: unknown) => { type: string; url: string }[];
  urlFileKey: (u: string) => string;
};

/** helper สร้าง link สั้น ๆ */
const link = (type: string, url: string): TaskLink => ({ type, url }) as TaskLink;

// ── req 15: backend taskLinks — รวม description + attachment แบบไม่ซ้ำ ────

describe("req 15 — taskLinks (backend): รูปเดียวกันแสดงไอคอนเดียว", () => {
  it("รูปใน description (URL clickup ฝัง attachment id) + attachment ตัวเดียวกัน = 1 ไอคอน", () => {
    const links = taskLinks({
      markdown_description:
        "![image.png](https://app.clickup.com/t/task1/image/98765)",
      attachments: [
        {
          id: 98765,
          url_private_download:
            "https://attachments.clickup.com/98765/image.png?signature=abc&expires=123",
          file_extension: "png",
        },
      ],
    });
    expect(links).toHaveLength(1);
    // URL ไม่มีนามสกุลไฟล์ แต่จับคู่ attachment id ได้ → ใช้ metadata (png) เป็นรูป
    expect(links[0].type).toBe("image");
  });

  it("URL เดียวกันต่างกันแค่ signature/expires query (signed URL) = 1 ไอคอน", () => {
    const links = taskLinks({
      markdown_description:
        "[รูป](https://files.example.com/img/photo.png?X-Goog-Signature=aaa&Expires=111)",
      attachments: [
        {
          id: 555,
          url_private_download:
            "https://files.example.com/img/photo.png?X-Goog-Signature=bbb&Expires=222",
        },
      ],
    });
    expect(links).toHaveLength(1);
  });

  it("รูปต่างกัน 3 ภาพ (description + attachment คู่ขนาน) = 3 ไอคอน", () => {
    const links = taskLinks({
      markdown_description: [
        "![a](https://img.example.com/1/a.png?sig=d1)",
        "![b](https://img.example.com/2/b.png?sig=d2)",
        "![c](https://img.example.com/3/c.png?sig=d3)",
      ].join("\n"),
      attachments: [
        { id: 111, url_private_download: "https://img.example.com/1/a.png?sig=x1", file_extension: "png" },
        { id: 222, url_private_download: "https://img.example.com/2/b.png?sig=x2", file_extension: "png" },
        { id: 333, url_private_download: "https://img.example.com/3/c.png?sig=x3", file_extension: "png" },
      ],
    });
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.type === "image")).toBe(true);
  });

  it("path เดียวกันแต่ query ที่ระบุไฟล์ต่างกัน (?file=a vs ?file=b) = 2 ไอคอน — ไม่ถูกรวมผิด", () => {
    const links = taskLinks({
      markdown_description:
        "[a](https://dl.example.com/get?file=one.png) [b](https://dl.example.com/get?file=two.png)",
      attachments: [],
    });
    expect(links).toHaveLength(2);
  });

  it("ลิงก์อื่น (sheets/pdf) ไม่ถูกกระทบ — นับครบตามประเภทไฟล์", () => {
    const links = taskLinks({
      markdown_description: "[ชีต](https://docs.google.com/spreadsheets/d/SHEET1)",
      attachments: [
        { id: 777, url_private: "https://app.clickup.com/777/report.pdf", file_extension: "pdf" },
      ],
    });
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.type)).toEqual(["sheets", "pdf"]);
  });

  it("URL เดียวกันซ้ำใน description เอง (ต่าง token ต่อครั้ง) = 1 ไอคอน", () => {
    const links = taskLinks({
      markdown_description:
        "[x](https://a.example.com/i/1.png?token=t1) [x2](https://a.example.com/i/1.png?token=t2)",
      attachments: [],
    });
    expect(links).toHaveLength(1);
  });

  it("attachment id ไม่ match แบบ substring — id 123 ไม่จับ node12345 ของลิงก์อื่น", () => {
    const links = taskLinks({
      markdown_description:
        "[ดีไซน์](https://www.figma.com/file/ABC/?node-id=12345-1)",
      attachments: [
        { id: 123, url_private_download: "https://attachments.clickup.com/123/img.png", file_extension: "png" },
      ],
    });
    expect(links).toHaveLength(2); // figma กับรูปคนละไฟล์กัน — ไม่ถูกรวมหาย
  });
});

describe("add image — รูปฝังใน description ต้องได้ไอคอนรูป ไม่ใช่โซ่", () => {
  it("markdown image ![alt](url) บน host อื่นแม้ไม่มีนามสกุลไฟล์ = ไอคอนรูป", () => {
    const links = taskLinks({
      markdown_description: "![mockup](https://cdn.example.com/attachments/abc123)",
      attachments: [],
    });
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe("image");
  });

  it("URL clickup.com แบบ endpoint /t/{taskId}/image/{attId} (ไม่มีนามสกุล) = ไอคอนรูป", () => {
    const links = taskLinks({
      markdown_description: "[image.png](https://app.clickup.com/t/task1/image/98765)",
      attachments: [],
    });
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe("image");
  });

  it("จับคู่ attachment id ได้ → ใช้ metadata ของ attachment กำหนดประเภท (pdf)", () => {
    const links = taskLinks({
      markdown_description: "[ไฟล์](https://app.clickup.com/t/task1/999)",
      attachments: [
        { id: 999, url_private: "https://app.clickup.com/999/doc", file_extension: "pdf" },
      ],
    });
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe("pdf");
  });

  it("ลิงก์ markdown ธรรมดา (ไม่ใช่ ![]()) ยังเป็นโซ่/link ตามเดิม — ไม่ over-classify", () => {
    const links = taskLinks({
      markdown_description: "[เว็บรวมรูป](https://example.com/gallery)",
      attachments: [],
    });
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe("link");
  });
});

describe("req 15 — urlFileKey (backend): key ระบุไฟล์อย่างไร", () => {
  it("ตัด query แบบ signature คง query ที่ระบุไฟล์ และ normalize host/path", () => {
    const a = urlFileKey("https://Files.Example.com/i/1.png?token=x&SIG=y");
    const b = urlFileKey("https://files.example.com/i/1.png?token=z");
    expect(a).toBe(b); // token เป็น volatile → เท่ากัน
    const c = urlFileKey("https://files.example.com/i/1.png?file=other");
    expect(a).not.toBe(c); // query ระบุไฟล์ต่างกัน → คนละไฟล์
    expect(urlFileKey("https://x.com/a/")).toBe(urlFileKey("https://X.COM/a"));
  });
});

// ── req 15: frontend dedupeTaskLinks — กันไอคอนซ้ำจากข้อมูลเก่าใน Firebase ──

describe("req 15 — dedupeTaskLinks (frontend): ตัดซ้ำก่อน render", () => {
  it("รูปเดียวกันสอง URL form (signature ต่างกัน) เหลือ 1 — คงตัวแรกตามลำดับ", () => {
    const out = dedupeTaskLinks([
      link("image", "https://att.clickup.com/98765/a.png?signature=aaa"),
      link("image", "https://att.clickup.com/98765/a.png?signature=bbb"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("signature=aaa");
  });

  it("รูปต่างกัน 3 ภาพ = 3 รายการ", () => {
    const out = dedupeTaskLinks([
      link("image", "https://a.example.com/1.png"),
      link("image", "https://a.example.com/2.png"),
      link("image", "https://a.example.com/3.png"),
    ]);
    expect(out).toHaveLength(3);
  });

  it("query ที่ใช้ระบุไฟล์ไม่ถูกตัด — คนละไฟล์ไม่ถูกรวม", () => {
    const out = dedupeTaskLinks([
      link("file", "https://dl.example.com/get?file=a.zip"),
      link("file", "https://dl.example.com/get?file=b.zip"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("links ว่าง/undefined คืน array ว่าง (ไม่โยน)", () => {
    expect(dedupeTaskLinks(undefined)).toEqual([]);
    expect(dedupeTaskLinks(null)).toEqual([]);
    expect(dedupeTaskLinks([])).toEqual([]);
  });

  it("taskLinkKey รองรับ URL พิมพ์ผิด (ไม่ parse ได้) โดยไม่โยน", () => {
    expect(taskLinkKey("ไม่ใช่ URL")).toBe("ไม่ใช่ url");
  });
});
