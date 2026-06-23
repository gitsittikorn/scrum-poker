import type { CurrentUser } from "./types";

export const state = {
  currentRoom: null as string | null,
  currentUser: null as CurrentUser | null,
  currentUid: null as string | null,
  selectedCard: null as string | null,
  /** True when the current vote was entered via the custom-input card (so the
   *  custom card is highlighted instead of any fixed card sharing the same value). */
  selectedCardCustom: false,
  /** Card currently focused (keyboard) / under consideration — distinct from selectedCard (voted) */
  activeCard: null as string | null,
  currentRole: null as string | null,
  isSuperAdmin: false,
  isWheelRoom: false,
};

export const isPO = (): boolean => state.currentRole === "po" || state.currentRole === "admin";
export const isSuperAdmin = (): boolean => state.isSuperAdmin;
