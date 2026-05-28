import type { CurrentUser } from "./types";

export const state = {
  currentRoom: null as string | null,
  currentUser: null as CurrentUser | null,
  currentUid: null as string | null,
  selectedCard: null as string | null,
  currentRole: null as string | null,
};

export const isPO = (): boolean => state.currentRole === "po";
