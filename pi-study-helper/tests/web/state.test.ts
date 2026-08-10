import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVITY_VIEW_MODES, PAGE_VIEW_STATES, useUiStore } from "../../src/web/state/ui-store.js";

describe("W3 D2 UI state", () => {
  beforeEach(() => useUiStore.getState().reset());

  it("starts from a valid ready and draft state", () => {
    expect(useUiStore.getState().pageViewState).toBe("ready");
    expect(useUiStore.getState().activityViewMode).toBe("draft");
    expect(useUiStore.getState().activityDraft.length).toBeGreaterThan(0);
  });

  it.each(PAGE_VIEW_STATES)("switches the page to %s", (pageViewState) => {
    useUiStore.getState().setPageViewState(pageViewState);
    expect(useUiStore.getState().pageViewState).toBe(pageViewState);
  });

  it.each(ACTIVITY_VIEW_MODES)("switches the activity to %s", (activityViewMode) => {
    useUiStore.getState().setActivityViewMode(activityViewMode);
    expect(useUiStore.getState().activityViewMode).toBe(activityViewMode);
  });

  it("resets both finite states together", () => {
    useUiStore.getState().setPageViewState("conflict");
    useUiStore.getState().setActivityViewMode("submitted");
    useUiStore.getState().setActivityDraft("unique draft");
    useUiStore.getState().reset();
    expect(useUiStore.getState()).toMatchObject({ pageViewState: "ready", activityViewMode: "draft" });
    expect(useUiStore.getState().activityDraft).not.toBe("unique draft");
  });

  it.each(["conflict", "error", "recovery"] as const)("preserves the activity draft through %s", (state) => {
    const draft = `draft-preserved-through-${state}`;
    useUiStore.getState().setActivityDraft(draft);
    useUiStore.getState().setPageViewState(state);
    useUiStore.getState().setPageViewState("ready");
    expect(useUiStore.getState().activityDraft).toBe(draft);
  });
});
