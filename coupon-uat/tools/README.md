# Tools — ตรวจ/แก้ไฟล์ Excel UAT คูปองส่วนลด TA

เครื่องมือ Node.js สำหรับอ่านและแก้ไขไฟล์ Excel ต้นทาง (`../references/UAT คูปองส่วนลด TA(BOTH).xlsx`)
โดยตรงผ่าน XML ภายในไฟล์ .xlsx — ไม่ต้องพึ่ง Excel/openpyxl และ**ไม่ทำให้ cached values ของสูตรเดิมหาย**
(ซึ่งเป็นสิ่งที่จะเกิดถ้า round-trip ด้วย openpyxl หรือ SheetJS)

## ติดตั้ง (ครั้งแรกครั้งเดียว)

```bash
cd coupon-uat/tools
pnpm install   # หรือ npm install — ติดตั้ง jszip + fast-xml-parser ไว้ในโฟลเดอร์นี้เท่านั้น
```

## สคริปต์

| ไฟล์ | หน้าที่ | วิธีรัน |
|---|---|---|
| `inspect.js` | ไข่กุ้งดูโครงสร้างไฟล์: sheet map, เซลล์ทุกช่องของแถวที่สนใจ (สูตร + cached value + shared formula group) | `node inspect.js` ดูรายชื่อแถว · `node inspect.js "<path>" "Coupon UAT" 28,32` ดูรายละเอียดแถว |
| `patch-min-purchase-20261027.js` | **[บันทึกประวัติ]** แพตช์ 2026-10-27 — แก้สูตร Min Purchase ของ Fix Amount + เพิ่ม test case แถว 32-34 · ใช้เป็นแม่แบบเวลาจะแพตช์สูตรอื่น | `node patch-min-purchase-20261027.js` (รันซ้ำกับไฟล์ที่แพตช์แล้วจะ error กันเขียนซ้ำ) |
| `verify.js` | ตรวจหลังแก้: XML well-formed, entry ที่เปลี่ยนต้องตรงเป้า, cached values แถว 5-31 ยังตรง testdata, input แถวใหม่ครบ | `node verify.js` |
| `backup/` | สำเนาไฟล์ Excel ก่อนแพตช์แต่ละครั้ง (ชื่อลงวันที่) | — |

## กติกา Min Purchase ปัจจุบัน (หลังแพตช์ 2026-10-27)

| ประเภทส่วนลด | ตัวที่ใช้ตรวจ Min Purchase |
|---|---|
| Fix Amount | ยอดเต็ม = เบี้ย + VAT + Duty (รวมทุกคน) |
| Percentage — Include VAT | ยอดเต็ม = เบี้ย + VAT + Duty (รวมทุกคน) |
| Percentage — Exclude VAT | เบี้ยเท่านั้น (รวมทุกคน) |

Engine ใน `src/couponCalc.ts` ใช้กติกาเดียวกัน (เคส 23-25 ใน `src/couponTestdata.ts` = แถว 32-34 ของ Excel)

## ข้อควรระวัง

- แพตช์ทุกครั้งเริ่มจากสำรองไฟล์ไว้ใน `backup/` ก่อนเสมอ
- สูตรใน Excel เก็บแบบ shared formula — แก้ต้องแก้ที่ **master cell** (เซลล์ที่มีข้อความสูตรเต็ม) สมาชิกที่เหลือจะ translate ตาม relative reference อัตโนมัติ — `inspect.js` บอกว่าเซลล์ไหนเป็น master (`si=` + มีข้อความสูตร)
- การแก้สูตรผ่าน XML จะ**ไม่**อัปเดต cached value — ถ้าผลลัพธ์ของแถวเดิมเปลี่ยนต้องเปิดไฟล์ใน Excel จริงเพื่อ recalc (สคริปต์แพตช์ตั้ง `fullCalcOnLoad` ให้ recalc อัตโนมัติตอนเปิด)
