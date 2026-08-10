import { create } from "zustand";
import { activityDraftMock } from "../mocks/safe-dtos.js";

export const PAGE_VIEW_STATES = ["ready", "empty", "error", "conflict", "recovery"] as const;
export type PageViewState = (typeof PAGE_VIEW_STATES)[number];

export const ACTIVITY_VIEW_MODES = ["draft", "running", "submitted", "safe_feedback"] as const;
export type ActivityViewMode = (typeof ACTIVITY_VIEW_MODES)[number];

interface UiState {
  pageViewState: PageViewState;
  activityViewMode: ActivityViewMode;
  activityDraft: string;
  setPageViewState: (state: PageViewState) => void;
  setActivityViewMode: (mode: ActivityViewMode) => void;
  setActivityDraft: (draft: string) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  pageViewState: "ready" as const,
  activityViewMode: "draft" as const,
  activityDraft: activityDraftMock.userText,
};

export const useUiStore = create<UiState>((set) => ({
  ...INITIAL_STATE,
  setPageViewState: (pageViewState) => set({ pageViewState }),
  setActivityViewMode: (activityViewMode) => set({ activityViewMode }),
  setActivityDraft: (activityDraft) => set({ activityDraft }),
  reset: () => set(INITIAL_STATE),
}));
