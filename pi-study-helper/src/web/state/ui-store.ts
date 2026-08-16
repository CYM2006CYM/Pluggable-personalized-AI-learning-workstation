import { create } from "zustand";

interface UiState {
  activityDrafts: Record<string, string>;
  setActivityDraft: (attemptId: string, draft: string) => void;
  clearActivityDraft: (attemptId: string) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  activityDrafts: {} as Record<string, string>,
};

export const useUiStore = create<UiState>((set) => ({
  ...INITIAL_STATE,
  setActivityDraft: (attemptId, draft) => set((state) => ({ activityDrafts: { ...state.activityDrafts, [attemptId]: draft } })),
  clearActivityDraft: (attemptId) => set((state) => {
    const { [attemptId]: _removed, ...activityDrafts } = state.activityDrafts;
    return { activityDrafts };
  }),
  reset: () => set(INITIAL_STATE),
}));
