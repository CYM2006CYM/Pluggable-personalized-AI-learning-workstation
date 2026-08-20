import { describe, expect, it } from "vitest";
import {
  clearActivityDraft,
  readActivityDraft,
  writeActivityDraft,
  type ActivityDraftBinding,
  type DraftStorage,
} from "../../src/web/state/activity-draft-storage.js";

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const binding: ActivityDraftBinding = {
  sessionId: "session-w5",
  activityId: "activity-code",
  attemptId: "attempt-1",
  profileRevision: 3,
  draftVersion: 2,
};

describe("W5 D2 activity draft storage", () => {
  it("restores only an exact server-confirmed binding", () => {
    const storage = new MemoryStorage();
    writeActivityDraft(storage, binding, "print('local')");
    expect(readActivityDraft(storage, binding)).toBe("print('local')");
    expect(readActivityDraft(storage, { ...binding, sessionId: "session-other" })).toBeUndefined();
    expect(readActivityDraft(storage, { ...binding, activityId: "activity-other" })).toBeUndefined();
    expect(readActivityDraft(storage, { ...binding, attemptId: "attempt-other" })).toBeUndefined();
    expect(readActivityDraft(storage, { ...binding, profileRevision: 4 })).toBeUndefined();
    expect(readActivityDraft(storage, { ...binding, draftVersion: 3 })).toBeUndefined();
    const record = JSON.parse([...storage.values.values()][0]!) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(["activityId", "attemptId", "draftVersion", "profileRevision", "schemaVersion", "sessionId", "userText"].sort());
  });

  it("rejects malformed, unknown-field, and invalid-identifier records", () => {
    const storage = new MemoryStorage();
    writeActivityDraft(storage, binding, "safe");
    const [key] = storage.values.keys();
    storage.setItem(key!, "not-json");
    expect(readActivityDraft(storage, binding)).toBeUndefined();
    storage.setItem(key!, JSON.stringify({ schemaVersion: 1, ...binding, userText: "unsafe", hiddenTest: "secret" }));
    expect(readActivityDraft(storage, binding)).toBeUndefined();
    expect(() => writeActivityDraft(storage, { ...binding, attemptId: "../escape" }, "unsafe")).toThrow("invalid_activity_draft_binding");
  });

  it("removes the attempt-bound record after formal completion", () => {
    const storage = new MemoryStorage();
    writeActivityDraft(storage, binding, "safe");
    clearActivityDraft(storage, binding.attemptId);
    expect(readActivityDraft(storage, binding)).toBeUndefined();
  });
});
