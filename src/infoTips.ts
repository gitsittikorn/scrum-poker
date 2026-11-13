/**
 * req 19 — Info tooltip (ⓘ) ข้าง checkbox No Need Task / No Need Test
 *
 * เปิดดูคำอธิบายได้ 3 ทาง (แยกกันตามอุปกรณ์):
 *  - Desktop: hover ไอคอน (CSS :hover เป็นหลัก, mouseleave เก็บกวาด state)
 *  - Mobile/Tablet: แตะไอคอน toggle เปิด/ปิด (.open + aria-expanded)
 *    แตะที่อื่น = ปิด (document click listener)
 *  - Keyboard: Tab โฟกัสไอคอน (CSS :focus-visible โชว์) + Esc ปิด
 *
 * เป็น pure DOM module ไม่ import อะไร — ให้ DOM test เรียกจริงได้เลย
 * (ui.ts ถูก mock ในไฟล์ test จึงแยกไฟล์นี้ออกมา)
 */

/** ผูก behavior ให้ไอคอน ⓘ ทุกตัวในหน้า (เรียกครั้งเดียวตอน bindEvents —
 *  เรียกซ้ำจะ bind listener ซ้อนทำให้ toggle ย้อนกลับทันที) */
export function initInfoTips(scope: ParentNode = document): void {
  const tips = [...scope.querySelectorAll<HTMLButtonElement>(".info-tip")];
  if (tips.length === 0) return;

  const setOpen = (btn: HTMLButtonElement, open: boolean): void => {
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  };
  const closeAll = (): void => tips.forEach((b) => setOpen(b, false));

  for (const btn of tips) {
    // แตะ/คลิกไอคอน = toggle (เปิดทีละอัน — ปิดตัวอื่นก่อน)
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // กัน document click listener ปิดทันทีที่เพิ่งเปิด
      const willOpen = !btn.classList.contains("open");
      closeAll();
      setOpen(btn, willOpen);
    });
    // Esc ปิด (keyboard) — blur ด้วยเพื่อให้ :focus-visible เลิกโชว์ฟองข้อความ
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !btn.classList.contains("open")) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(btn, false);
      btn.blur();
    });
    // desktop เลื่อนเมาส์ออก = ปิด (hover โชว์/ซ่อนผ่าน CSS อยู่แล้ว
    // เก็บกวาด state .open ที่ค้างจากการคลิกก่อนหน้า)
    btn.addEventListener("mouseleave", () => setOpen(btn, false));
  }

  // แตะ/คลิกนอกไอคอน = ปิดทั้งหมด (mobile ไม่มี mouseleave ให้พึ่ง)
  document.addEventListener("click", closeAll);
}
