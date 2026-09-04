/**
 * ClickUp integration — banner บนหัวห้อง poker
 *
 * PO วางลิงก์ task → backend resolve เป็น taskId → เขียน
 * rooms/{roomId}/activeTask (real-time ทุกคนในห้องเห็นชื่อ task + ลิงก์)
 * หลัง reveal → PO กด "บันทึก ClickUp" → เฉลี่ย Dev/QA เขียนลง custom
 * fields ของการ์ดผ่าน backend (token อยู่ฝั่ง backend เท่านั้น)
 *
 * ไม่ import voting.ts/room.ts เพื่อกัน dependency cycle (voting เรียก
 * renderTaskBanner ของไฟล์นี้ใน updateUI)
 */
import { db, get, ref, serverTimestamp, update } from "./firebase";
import {
  btnClickupClear,
  btnClickupResolve,
  clickupBanner,
  clickupInputRow,
  clickupTaskDisplay,
  clickupTaskName,
  clickupUrlInput,
} from "./dom";
import { showConfirmModal, showToast } from "./ui";
import { sendSystemMessage } from "./chat";
import { avgFor } from "./utils";
import { FEATURES } from "./config";
import { isPO, state } from "./state";
import type { ActiveTask, RoomData } from "./types";

interface ResolvedTask {
  taskId: string;
  name: string;
  url: string;
  customId: string | null;
  status: string | null;
}

interface ExistingPoints {
  dev: number | null;
  qa: number | null;
}

type SaveResult = { dev?: { ok: boolean; error?: string }; qa?: { ok: boolean; error?: string } };

/** POST เล็ก ๆ ไป backend — แปลง HTTP error เป็น message ภาษาไทยสำหรับ toast */
async function api<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("เชื่อมต่อ backend ไม่ได้ (ต้องรัน backend ก่อน)");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error || `backend error ${res.status}`);
  return data as T;
}

const fmt = (n: number): string => String(n);

// ===== Banner render (เรียกจาก updateUI ทุก tick) =====

export function renderTaskBanner(task: ActiveTask | null): void {
  if (!FEATURES.clickup || !state.currentRoom) {
    clickupBanner.classList.add("hidden");
    return;
  }
  const po = isPO();
  // ซ่อนทั้งอันเมื่อปิด flag / ไม่มี task และไม่ใช่ PO (non-PO ไม่เห็น input เปล่า ๆ)
  clickupBanner.classList.toggle("hidden", !po && !task);
  // input ผู้ใช้กำลังพิมพ์อยู่ — ห้ามแตะ value ในนี้ ไม่งั้นโดนเคลียร์ทุก room tick
  clickupInputRow.classList.toggle("hidden", !po);
  btnClickupClear.classList.toggle("hidden", !task);

  if (task) {
    clickupTaskDisplay.classList.remove("hidden");
    clickupTaskDisplay.href = task.url;
    clickupTaskName.textContent = `${task.customId ? `${task.customId} · ` : ""}${task.name}`;
  } else {
    clickupTaskDisplay.classList.add("hidden");
  }
}

// ===== Handlers =====

export async function handleResolveClickUp(): Promise<void> {
  if (!isPO() || !state.currentRoom) return;
  const input = clickupUrlInput.value.trim();
  if (!input) {
    showToast("⚠️ วางลิงก์ ClickUp task ก่อน");
    clickupUrlInput.focus();
    return;
  }

  btnClickupResolve.disabled = true;
  btnClickupResolve.textContent = "…กำลังดึง";
  try {
    const task = await api<ResolvedTask>("/api/clickup/resolve-task", { input });
    await update(ref(db, `rooms/${state.currentRoom}`), {
      activeTask: {
        taskId: task.taskId,
        name: task.name,
        url: task.url,
        customId: task.customId,
        setBy: state.currentUser?.name ?? "",
        timestamp: serverTimestamp(),
      },
    });
    clickupUrlInput.value = "";
    showToast(`✅ ตั้ง task แล้ว: ${task.name}`);
  } catch (err) {
    showToast(`❌ ${(err as Error).message}`);
  } finally {
    btnClickupResolve.disabled = false;
    btnClickupResolve.textContent = "ดึง Task";
  }
}

export async function handleClearClickUpTask(): Promise<void> {
  if (!isPO() || !state.currentRoom) return;
  await update(ref(db, `rooms/${state.currentRoom}`), { activeTask: null });
  clickupUrlInput.value = "";
  showToast("🧹 เคลียร์ task แล้ว");
}

let saveInFlight = false;

export async function handleSaveToClickUp(): Promise<void> {
  if (!isPO() || !state.currentRoom || saveInFlight) return;
  saveInFlight = true;
  try {
    const snap = await get(ref(db, `rooms/${state.currentRoom}`));
    const data = snap.val() as RoomData | null;
    if (!data) return;
    const task = data.activeTask ?? null;
    if (!data.revealed) {
      showToast("⚠️ ต้อง Reveal ผลโหวตก่อนบันทึก");
      return;
    }
    if (!task) {
      showToast("⚠️ ยังไม่ได้เลือก task จาก ClickUp");
      return;
    }

    const entries = Object.entries(data.users ?? {}).filter(([, u]) => !u.left);
    const dev = avgFor(entries.filter(([, u]) => u.role === "dev"));
    const qa = avgFor(entries.filter(([, u]) => u.role === "qa"));
    if (dev === null && qa === null) {
      showToast("⚠️ ไม่มีโหวตจาก Dev/QA ให้บันทึก");
      return;
    }

    let existing: ExistingPoints;
    try {
      existing = await api<ExistingPoints>("/api/clickup/check-existing", {
        taskId: task.taskId,
      });
    } catch (err) {
      showToast(`❌ ${(err as Error).message}`);
      return;
    }

    const doSave = async (): Promise<void> => {
      try {
        const result = await api<SaveResult>("/api/clickup/save-points", {
          taskId: task.taskId,
          dev,
          qa,
        });
        const saved: string[] = [];
        const failed: string[] = [];
        if (result.dev) (result.dev.ok ? saved : failed).push(`Dev ${fmt(dev!)}`);
        if (result.qa) (result.qa.ok ? saved : failed).push(`QA ${fmt(qa!)}`);
        if (failed.length) {
          showToast(`❌ บันทึกไม่สำเร็จ: ${failed.join(", ")}`);
        } else {
          showToast(`✅ บันทึกลง ClickUp แล้ว (${saved.join(" · ")})`);
        }
        if (saved.length) {
          void sendSystemMessage(
            `บันทึกคะแนนลง ClickUp แล้ว → ${task.name} (${saved.join(" · ")})`
          );
        }
      } catch (err) {
        showToast(`❌ ${(err as Error).message}`);
      }
    };

    // การ์ดมีค่าเดิม → ยืนยันก่อนเขียนทับ
    if (existing.dev != null || existing.qa != null) {
      const changes: string[] = [];
      if (dev !== null) changes.push(`Dev: ${fmt(existing.dev ?? 0)} → ${fmt(dev)}`);
      if (qa !== null) changes.push(`QA: ${fmt(existing.qa ?? 0)} → ${fmt(qa)}`);
      showConfirmModal({
        title: "การ์ดนี้มีค่าอยู่แล้ว",
        message: `บันทึกทับค่าเดิมใน ClickUp ไหม? — ${changes.join(" · ")}`,
        confirmText: "บันทึกทับ",
        danger: true,
        onConfirm: doSave,
      });
      return;
    }
    await doSave();
  } finally {
    saveInFlight = false;
  }
}
