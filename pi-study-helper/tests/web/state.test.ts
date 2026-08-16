import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../src/web/state/ui-store.js";

describe("W4 transient UI store", () => {
  beforeEach(() => useUiStore.getState().reset());

  it("starts without a mock or persisted draft", () => {
    expect(useUiStore.getState().activityDrafts).toEqual({});
  });

  it("keeps drafts isolated by server attempt id", () => {
    useUiStore.getState().setActivityDraft("attempt-a", "print('a')");
    useUiStore.getState().setActivityDraft("attempt-b", "print('b')");
    expect(useUiStore.getState().activityDrafts).toEqual({ "attempt-a": "print('a')", "attempt-b": "print('b')" });
  });

  it("clears one attempt without affecting another", () => {
    useUiStore.getState().setActivityDraft("attempt-a", "a");
    useUiStore.getState().setActivityDraft("attempt-b", "b");
    useUiStore.getState().clearActivityDraft("attempt-a");
    expect(useUiStore.getState().activityDrafts).toEqual({ "attempt-b": "b" });
  });
});
