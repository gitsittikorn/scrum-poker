# Scrum Poker — Architecture (Mermaid)

เอกสารสถาปัตยกรรมของระบบ — อ้างอิงจาก implementation จริงใน repository ณ เวลาที่เขียน
(อัปเดตล่าสุด: พ.ย. 2026 หลัง Bug Audit & Cleanup) · บริบทโมดูล/คำสั่งเต็ม ดู `CLAUDE.md`
และคู่มือติดตั้ง ดู `SETUP.md`

---

## 1. System Architecture

Frontend เป็น SPA (Vanilla TypeScript + Vite ไม่มี framework) คุยกับ Firebase RTDB
แบบ real-time โดยตรง ส่วน ClickUp ทั้งหมดผ่าน backend proxy เพราะ token ห้ามออกจาก server

```mermaid
flowchart LR
    subgraph Browser["Browser (SPA)"]
        UI["Vanilla TS + DOM<br/>app.ts (orchestrator)<br/>voting · chat · wheel · admin"]
    end

    subgraph Firebase["Firebase (asia-southeast1)"]
        RTDB[("RTDB<br/>rooms/{roomId}<br/>members/ · settings/")]
        AUTH["Anonymous Auth<br/>(auto sign-in)"]
        HOST["Hosting (dist/)<br/>rewrite /api/** → function"]
    end

    subgraph Backend["Backend proxy — Express app.js"]
        LOCAL["local: node server.js :3000"]
        CFN["prod: Cloud Function api"]
    end

    CU["ClickUp API v2"]

    UI <-->|"real-time onValue/onChildAdded<br/>+ onDisconnect presence"| RTDB
    UI -->|"sign-in อัตโนมัติ"| AUTH
    UI -->|"POST /api/clickup/*<br/>(VITE_BACKEND_URL)"| LOCAL
    HOST -->|"same-origin /api/**"| CFN
    LOCAL -->|"axios + CLICKUP_API_TOKEN<br/>(token อยู่ฝั่งนี้เท่านั้น)"| CU
    CFN -->|"axios + CLICKUP_API_TOKEN"| CU
```

หมายเหตุ: มี `render.yaml` สำหรับ deploy backend บน Render อีกทาง (optional) —
โค้ด Express ชุดเดียวใช้ทั้ง local / Cloud Function / Render

---

## 2. Scrum Voting Flow

รอบโหวต 1 task — ตั้งแต่ดึงการ์ดจนบันทึกแล้ว reset เริ่มรอบใหม่ (ทุกสเต็ป real-time ทุก client)

```mermaid
sequenceDiagram
    participant PO as PO
    participant M as สมาชิก (Dev/QA/UX)
    participant RTDB as Firebase RTDB
    participant CU as ClickUp (ผ่าน backend)

    PO->>RTDB: วางลิงก์ → resolve-task → activeTask
    RTDB-->>M: banner ชื่อ task + ลิงก์ (real-time)
    Note over PO,M: ถ้ายังไม่มี task → แถบเตือน "ยังไม่ได้เลือกการ์ด"<br/>(ซ่อนได้ด้วย No Need Task)

    M->>RTDB: เลือกการ์ด / custom point → users/{uid}/vote
    Note over PO: คนสุดท้ายที่ยังไม่โหวต → มี animation เตือน (admin เห็น)

    PO->>RTDB: 👁 Reveal (มี modal เตือนถ้ามีคนยังไม่โหวต)
    RTDB-->>PO,M: revealed + locked + revealTime + speakers (min/max ต่อ role)
    Note over RTDB: auto-unlock countdown (ค่า default 30 วิ ปรับได้ใน settings)

    alt ติ๊ก No Need Test (admin ของห้อง)
        PO->>CU: บันทึกเฉพาะ Dev field + comment "QA: no need test"<br/>+ tag "no need test" (ไม่แตะ QA field)
    else ติ๊ก No Need Dev (admin ของห้อง)
        PO->>CU: บันทึกเฉพาะ QA field + comment "Dev: no need dev"<br/>(ไม่แตะ Dev field · ไม่ติด tag — ต่างจาก No Need Test)
    else ปกติ
        PO->>CU: บันทึก Dev + QA field (unanimous ต่อ role)<br/>+ comment สรุป (groom) / ช่วง min-max (pre-groom)
    end
    CU-->>PO: ผล per-field (ok/error) → splash กลางจอ

    PO->>RTDB: reset รอบอัตโนมัติ (ล้าง vote ทุกคน + task + unlock)
    RTDB-->>PO,M: หน้าจอกลับสถานะรอบใหม่ (real-time)
```

---

## 3. ClickUp Integration Flow

ทุกการเขียนลงการ์ดผ่าน backend (`backend/app.js`) — รวมถึง flow การติด tag
`no need test` ที่ใช้ tag เดิมใน space ไม่สร้างซ้ำและไม่ลบ tag อื่น

```mermaid
flowchart TD
    A["PO วางลิงก์ task"] --> B["POST /api/clickup/resolve-task"]
    B --> B1{"URL / id /<br/>custom id?"}
    B1 -->|"GET /task ครั้งแรกพัง"| B2["retry เป็น custom-id<br/>(custom_task_ids + team_id)"]
    B1 --> B3["ได้ task: id, name,<br/>links (description+attachment)"]
    B2 --> B3
    B3 --> C["เขียน rooms/{id}/activeTask<br/>+ taskHistory (limit 30)"]

    C --> D["โหวต → reveal → กด 💾 บันทึก"]
    D --> E["POST check-existing อ่านค่าเดิม"]
    E --> F{"การ์ดมีค่าเดิม?"}
    F -->|"มี"| G["modal ยืนยันบันทึกทับ"]
    F -->|"ไม่มี"| H
    G --> H["POST save-points"]
    H --> H1{"No Need Test<br/>ติ๊กอยู่?"}
    H1 -->|"ใช่"| H2["เขียนเฉพาะ field Dev<br/>(qa=null → backend ไม่แตะ QA field)"]
    H1 -->|"ไม่"| H3["เขียน field Dev + QA<br/>(ต้อง unanimous ต่อ role)"]
    H2 --> I["comment สรุปทันทีที่ field สำเร็จ"]
    H3 --> I
    I --> I1["รูปแบบ comment (req 20):<br/>━ เส้นคั่น + SCRUM POKER | POINT UPDATE<br/>+ 📅 เวลาไทย Asia/Bangkok + โหมด<br/>+ Dev/QA + Attendees + 📌 การ์ด: ชื่อการ์ด + ━"]

    H2 --> J{"No Need Test<br/>ติ๊กอยู่?"}
    H3 --> J
    J -->|"ใช่"| K["POST add-tag: no need test"]
    K --> K1{"task มี tag<br/>อยู่แล้ว? (เทียบ<br/>case-insensitive)"}
    K1 -->|"มี"| DONE["จบ — ไม่เขียนอะไร"]
    K1 -->|"ไม่มี"| K2{"มีใน space<br/>(GET /space/{id}/tag)?"}
    K2 -->|"ไม่มี"| K3["POST /space/{id}/tag<br/>สร้างชื่อเดิม"]
    K2 -->|"มี"| K4
    K3 --> K4["POST /task/{id}/tag/no%20need%20test<br/>(encode ชื่อใน URL)"]
    K4 --> DONE2["จบ — tag ติดการ์ด ไม่ลบ tag อื่น"]
    J -->|"ไม่"| DONE3["จบ (ไม่มีการเพิ่ม/ลบ tag)"]

    DONE --> L["reset ห้อง เริ่มรอบใหม่"]
    DONE2 --> L
    DONE3 --> L
```

Error handling: field พัง = toast ❌ ไม่ reset ห้อง (ลองใหม่ได้) · comment พัง = ⚠️ แต่ถือว่ารอบจบ ·
tag พัง = ⚠️ toast แจ้ง (point ขึ้นการ์ดแล้ว)

---

## 4. State Management Flow (Real-time)

ไม่มี state library — ใช้ object กลาง `state.ts` + Firebase listeners ที่ detach ครบทุกตอน leave

```mermaid
flowchart TD
    subgraph State["state.ts (mutable singleton)"]
        S1["currentRoom · currentUser · currentUid"]
        S2["currentRole → isPO() / isRoomAdmin()"]
        S3["selectedCard / activeCard / selectedCardCustom"]
        S4["noNeedTask (session preference)"]
    end

    subgraph Listeners["Listeners ต่อห้อง (listenRoom/initChat/…)"]
        L1["onValue rooms/{id} → updateUI<br/>(diff-based DOM — ไม่ re-render ทั้งก้อน)"]
        L2["onChildAdded/Changed messages → chat + reactions"]
        L3["onChildAdded liveReactions/sounds → emoji ลอย + เสียง<br/>(cleanup timer จับ room ตอน schedule)"]
        L4["onDisconnect → online:false + ล้าง typing"]
    end

    subgraph Members["members/ (ถาวร อยู่นอก rooms/)"]
        M1["listener + cache (hydrate จาก localStorage<br/>+ watchdog ถ้า listener ค้าง)"]
    end

    L1 -->|"room tick"| U1["renderTaskBanner · renderSaveButton<br/>updateNoNeedTestCheckbox · updateTaskRequiredReminder"]
    L2 --> U2["renderChatMessage + renderMessageReactions<br/>(escape ทุกค่าจาก RTDB ก่อนใส่ DOM)"]
    M1 --> U3["dropdown ชื่อจริงตอน join · wheel entries"]

    LEAVE["handleLeave / ลบห้อง"] -->|"off() ทุก listener + ทำลาย modals<br/>+ รีเซ็ต currentRole/noNeedTask/<br/>selectedCardCustom + checkbox DOM"| RESET["กลับ landing — ไม่มี state ค้างข้ามห้อง"]
```

---

## 5. Existing Permission Flow (ระบบสิทธิ์ปัจจุบัน)

สิทธิ์ที่มีอยู่จริงในโค้ด — 3 ชั้น (ไม่มี permission matrix แบบ granular)

```mermaid
flowchart TD
    START["ผู้ใช้เข้าห้อง (role เลือกตอน join)"] --> Q1{"role = po<br/>หรือ admin?"}

    Q1 -->|"ใช่ = isPO()"| PO["PO · สิทธิ์เต็มของห้อง:<br/>Reveal · Reset · Kick · ลบห้อง<br/>ดึง/เคลียร์ task · สลับโหมด groom/pre<br/>💾 บันทึก ClickUp · ปุ่มบันทึกโชว์เฉพาะ PO"]
    Q1 -->|"ไม่"| Q2{"deputy?<br/>(uid ใน PO_DEPUTY_UIDS หรือ<br/>realName ใน PO_DEPUTY_REAL_NAMES<br/>และ role = dev)"}

    Q2 -->|"ใช่ = isRoomAdmin()"| DEP["Dev deputy (เช่น Cing):<br/>เห็น/ใช้ checkbox No Need Task/Test/Dev/UX<br/>เปิด settings ส่วนตั้งค่าห้องได้<br/>· เห็นแถบเตือนดึง task<br/>(❌ ไม่ได้แทน PO ในการบันทึก/Reveal)"]
    Q2 -->|"ไม่"| MEMBER["สมาชิกทั่วไป (dev/qa/ux):<br/>โหวต · แชท · react · เสียง<br/>ดู banner/history/wheel ได้<br/>ไม่เห็น checkbox ทั้งหมด"]

    START --> Q3{"เข้าห้อง admin"}
    Q3 -->|"ชื่อ = SUPER_ADMIN_NAME<br/>และ role = admin"| SA["Super Admin:<br/>panel ตั้งค่าทุกห้อง (features)<br/>config การ์ด poker ทั้งระบบ<br/>member list 5 คอลัมน์ · Wheel room"]
    Q3 -->|"ไม่ผ่านเงื่อนไข"| BLOCK["บล็อก: ต้องใช้ชื่อและ Role admin เท่านั้น"]

    NOTE["หมายเหตุ: ระบบยังไม่มี Full Granular Permission Management<br/>(ยังไม่ได้พัฒนา — ตามข้อตกลงของงาน audit ครั้งนี้)"]
```

---

## การตรวจสอบ (Validation)

- Syntax Mermaid ตรวจด้วยการทบทวนโครงสร้าง manually (repo ไม่มี mermaid CLI)
- ทุกแผนภาพเขียนจากโค้ดจริง: `app.ts` `voting.ts` `clickup.ts` `room.ts` `chat.ts`
  `reactions.ts` `sounds.ts` `wheel.ts` `admin.ts` `members.ts` `state.ts` `backend/app.js`
- หากแก้ flow ใดในอนาคต ให้อัปเดตแผนภาพที่เกี่ยวข้องในไฟล์นี้ด้วย
