import { describe, expect, it, vi } from "vitest";
import type { AppBootstrapSafeView, SessionRecoverySafeView } from "../src/contracts/index.js";
import type { ActivitySubmissionOutput, LearningRuntimeFacade, NextStepOutput } from "../src/contracts/facade.js";
import { StudyTuiGateway, type StudyUiPort } from "../src/tui/study-tui-gateway.js";
import {
  TuiSharedSessionBridge,
  TuiSharedSessionEntry,
  buildStudyDeepLink,
  parsePendingActivity,
  parseStudyDeepLink,
  serializePendingActivity,
  type PendingActivityState,
  type PendingActivityStore,
} from "../src/tui/shared-session.js";

function memoryStore(): PendingActivityStore {
  let value: string | undefined;
  return { load: () => value, save: (next) => { value = next; }, clear: () => { value = undefined; } };
}

const node = {
  nodeId: "node-1", knowledgePointId: "kp", activityIds: ["activity-1"], status: "in_progress" as const,
  estimatedMinutes: 5, reasonCodes: [], difficulty: "M-U" as const, scaffold: "hint" as const,
  required: true, positionLocked: false,
};

function recovery(overrides: Partial<SessionRecoverySafeView> = {}): SessionRecoverySafeView {
  return {
    sessionId: "session-1", sessionVersion: 4, profileRevision: 3,
    view: {
      sessionId: "session-1", sessionVersion: 4, profileRevision: 3, subjectId: "pandas-cleaning",
      mode: "recommended", goalId: "goal", availableMinutes: 20, status: "active", stage: "activity",
      diagnosticRequired: false, pathVersion: 2,
    },
    diagnosticDraftVersion: 0,
    activityProgress: [{ nodeId: "node-1", activities: [{ activityId: "activity-1", status: "in_progress", attemptIds: ["attempt-1"], quizRetryCount: 0, updatedAt: "2026-08-19T00:00:00.000Z" }] }],
    currentAttempt: { kind: "code", activityId: "activity-1", attemptId: "attempt-1", status: "draft", draftVersion: 2 },
    path: { pathId: "path-1", pathVersion: 2, status: "active", nodes: [node] },
    ...overrides,
  };
}

function bootstrap(session: SessionRecoverySafeView | undefined): AppBootstrapSafeView {
  return { profiles: [], goals: [], chapters: [], diagnostic: { diagnosticId: "d", diagnosticVersion: 1, estimatedMinutes: 1, questions: [] }, recoverableSessions: [], ...(session === undefined ? {} : { session }) };
}

const nextStep: NextStepOutput = {
  sessionId: "session-1", sessionVersion: 4, profileRevision: 3, pathVersion: 2, completed: false,
  node,
  activity: { activityId: "activity-1", activityVersion: 3, kind: "code_completion", title: "Code", prompt: "Complete", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [] },
};

function pending(overrides: Partial<PendingActivityState> = {}): PendingActivityState {
  return {
    sessionId: "session-1", sessionVersion: 4, profileRevision: 3, pathVersion: 2,
    nodeId: "node-1", activityId: "activity-1", attemptId: "attempt-1", draftVersion: 2,
    savedAt: "2026-08-19T00:00:00.000Z", ...overrides,
  };
}

function harness(options: {
  session?: SessionRecoverySafeView | undefined;
  next?: NextStepOutput;
  bootstrapError?: { errorCode: string };
  recoverError?: { errorCode: string };
} = {}) {
  const getBootstrap = options.bootstrapError === undefined
    ? vi.fn().mockResolvedValue(bootstrap(Object.hasOwn(options, "session") ? options.session : recovery()))
    : vi.fn().mockRejectedValue(options.bootstrapError);
  const facade = {
    getNextStep: vi.fn().mockResolvedValue(options.next ?? nextStep),
    getActivityAttempt: vi.fn().mockResolvedValue({
      sessionId: "session-1", sessionVersion: 4, profileRevision: 3,
      kind: "code", activityId: "activity-1", attemptId: "attempt-1", status: "submitted", draftVersion: 2,
      evidenceId: "evidence-1", evidenceVersion: 3,
    }),
    recoverActivity: options.recoverError === undefined
      ? vi.fn().mockResolvedValue({ sessionId: "session-1", sessionVersion: 4, profileRevision: 3, attempt: { kind: "code", activityId: "activity-1", attemptId: "attempt-1", status: "draft", draftVersion: 2 }, draftVersion: 2, userText: "print(1)", recoveryAction: "resume_draft" })
      : vi.fn().mockRejectedValue(options.recoverError),
    saveActivityDraft: vi.fn(), submitActivity: vi.fn(),
  };
  const store = memoryStore();
  return { bridge: new TuiSharedSessionBridge(facade, { getBootstrap }, store, () => new Date("2026-08-19T00:00:00.000Z")), facade, getBootstrap, store };
}

describe("W5-D2 A R3 pending and deep-link safety", () => {
  it("round-trips the complete safe server binding and rejects private or malformed state", () => {
    expect(parsePendingActivity(serializePendingActivity(pending()))).toEqual(pending());
    for (const invalid of [
      { ...pending(), answer: "secret" },
      { ...pending(), pathVersion: -1 },
      { ...pending(), savedAt: "not-iso" },
      { ...pending(), attemptId: undefined, draftVersion: 2 },
      { ...pending(), activityId: "C:\\private" },
    ]) expect(() => parsePendingActivity(JSON.stringify(invalid))).toThrow();
  });

  it("accepts only one copy of each safe localhost deep-link parameter", () => {
    const link = buildStudyDeepLink("http://localhost:4173/anything", { sessionId: "session-1", nodeId: "node-1", activityId: "activity-1" });
    expect(parseStudyDeepLink(link)).toEqual({ sessionId: "session-1", nodeId: "node-1", activityId: "activity-1" });
    for (const invalid of [
      `${link}&answer=secret`, `${link}&sessionId=other`, "http://user:pass@localhost:4173/study?sessionId=s",
      `${link}#fragment`, "https://localhost:4173/study?sessionId=s", "http://localhost:4173/study?sessionId=C%3A%5Cprivate",
      "http://localhost:4173/study?sessionId=line%0Abreak",
    ]) expect(() => parseStudyDeepLink(invalid)).toThrow();
  });

  it("turns an invalid deep link into an explicit Web-start recovery state", async () => {
    const { bridge } = harness();
    await expect(bridge.restoreFromDeepLink("http://localhost:4173/study?sessionId=s&answer=x"))
      .resolves.toEqual({ status: "resume_from_web", reason: "deep_link_invalid", startPath: "/" });
  });
});

describe("W5-D2 A R3 server-authoritative recovery", () => {
  it("reads a submitted Attempt and its safe Evidence reference through the existing Facade", async () => {
    const { bridge, facade } = harness();
    const current = recovery({ currentAttempt: undefined });
    await expect(bridge.readActivityAttempt(current, "activity-1", "attempt-1")).resolves.toMatchObject({
      activityId: "activity-1", attemptId: "attempt-1", status: "submitted",
      evidenceId: "evidence-1", evidenceVersion: 3,
    });
    expect(facade.getActivityAttempt).toHaveBeenCalledWith({
      sessionId: "session-1", sessionVersion: 4, profileRevision: 3,
      activityId: "activity-1", attemptId: "attempt-1",
    });
  });

  it("restores a valid pending attempt from Bootstrap and the latest getNextStep", async () => {
    const { bridge, facade, getBootstrap } = harness();
    await expect(bridge.restorePending(pending())).resolves.toMatchObject({ status: "restored", nextStep, recovery: { recoveryAction: "resume_draft" } });
    expect(getBootstrap).toHaveBeenCalledWith({ recoverSessionId: "session-1" });
    expect(facade.getNextStep).toHaveBeenCalledWith({ sessionId: "session-1", sessionVersion: 4, profileRevision: 3, pathVersion: 2 });
  });

  it("reports stale sessionVersion after re-Bootstrap without using the stale version", async () => {
    const { bridge, facade } = harness();
    await expect(bridge.restorePending(pending({ sessionVersion: 3 }))).resolves.toMatchObject({ status: "session_version_conflict", nextStep });
    expect(facade.getNextStep).toHaveBeenCalledWith(expect.objectContaining({ sessionVersion: 4 }));
    expect(facade.recoverActivity).not.toHaveBeenCalled();
  });

  it("reports stale pathVersion after re-Bootstrap without using the stale path", async () => {
    const { bridge, facade } = harness();
    await expect(bridge.restorePending(pending({ pathVersion: 1 }))).resolves.toMatchObject({ status: "path_version_conflict", nextStep });
    expect(facade.getNextStep).toHaveBeenCalledWith(expect.objectContaining({ pathVersion: 2 }));
  });

  it("routes profile mismatch and missing sessions to Web start without creating a session", async () => {
    const mismatch = harness({ session: recovery({ profileRevision: 4 }) });
    await expect(mismatch.bridge.restorePending(pending())).resolves.toMatchObject({ status: "resume_from_web", reason: "profile_revision_conflict", startPath: "/" });
    const missing = harness({ session: undefined });
    await expect(missing.bridge.restorePending(pending())).resolves.toEqual({ status: "resume_from_web", reason: "session_not_found", startPath: "/" });
    expect(mismatch.facade.getNextStep).not.toHaveBeenCalled();
    expect(missing.facade.getNextStep).not.toHaveBeenCalled();
  });

  it("does not mutate formal learning facts during pending recovery", async () => {
    const server = recovery();
    const before = structuredClone(server);
    const { bridge, facade } = harness({ session: server });
    await bridge.restorePending(pending());
    expect(server).toEqual(before);
    expect(facade.saveActivityDraft).not.toHaveBeenCalled();
    expect(facade.submitActivity).not.toHaveBeenCalled();
  });

  it("clears malformed persisted state instead of exposing it", () => {
    const { bridge, store } = harness();
    store.save(JSON.stringify({ ...pending(), hostPath: "C:\\secret" }));
    expect(bridge.loadPending()).toBeUndefined();
    expect(store.load()).toBeUndefined();
  });
});

describe("W5-D2 A R3 real TUI entry and formal write forwarding", () => {
  it("runs the StudyTuiGateway path from current server step to pending and deep link", async () => {
    const { bridge, store } = harness();
    const entry = new TuiSharedSessionEntry(bridge, "http://localhost:4173");
    const ui: StudyUiPort = { setWidget: vi.fn(), input: vi.fn(), select: vi.fn() };
    const gateway = new StudyTuiGateway(ui, entry);
    await expect(gateway.prepareSharedWebActivity("session-1")).resolves.toMatchObject({
      status: "ready", pending: { sessionId: "session-1", pathVersion: 2, nodeId: "node-1", activityId: "activity-1" },
      deepLink: "http://localhost:4173/study?sessionId=session-1&nodeId=node-1&activityId=activity-1",
    });
    expect(parsePendingActivity(store.load()!)).toMatchObject({ sessionVersion: 4, profileRevision: 3, pathVersion: 2 });
  });

  it("returns a CAS conflict and re-Bootstraps instead of overwriting newer state", async () => {
    const { bridge, facade, getBootstrap } = harness();
    facade.saveActivityDraft.mockRejectedValue({ errorCode: "session_version_conflict" });
    const result = await bridge.saveDraft({ requestId: "save", sessionId: "session-1", sessionVersion: 3, profileRevision: 3, activityId: "activity-1", activityVersion: 3, attemptId: "attempt-1", draftVersion: 2, userText: "old" });
    expect(result).toMatchObject({ status: "conflict", reason: "session_version_conflict", bootstrap: { sessionVersion: 4 } });
    expect(getBootstrap).toHaveBeenLastCalledWith({ recoverSessionId: "session-1" });
  });

  it("preserves formal idempotency and clears pending only for a committed result", async () => {
    const { bridge, facade, store } = harness();
    bridge.savePending({ ...pending(), savedAt: undefined } as never);
    const output: ActivitySubmissionOutput = {
      kind: "code", requestId: "submit", sessionId: "session-1", sessionVersion: 5, profileRevision: 3,
      attemptId: "attempt-1", committed: true, evidenceId: "evidence-1", evidenceVersion: 1,
      result: { executionStatus: "completed", verdict: "pass", safeFeedback: "ok", evaluatorVersion: "fixture", environmentHash: `sha256:${"a".repeat(64)}`, assetBundleHash: `sha256:${"b".repeat(64)}` },
    };
    facade.submitActivity.mockResolvedValue(output);
    const input = { kind: "code" as const, requestId: "submit", sessionId: "session-1", sessionVersion: 4, profileRevision: 3, activityId: "activity-1", activityVersion: 3, attemptId: "attempt-1", draftVersion: 2, userText: "print(1)" };
    await expect(bridge.submit(input)).resolves.toEqual({ status: "saved", output });
    await expect(bridge.submit(input)).resolves.toEqual({ status: "saved", output });
    expect(facade.submitActivity).toHaveBeenNthCalledWith(1, input);
    expect(facade.submitActivity).toHaveBeenNthCalledWith(2, input);
    expect(store.load()).toBeUndefined();
  });

  it("surfaces different-input idempotency conflicts after reading current facts", async () => {
    const { bridge, facade } = harness();
    facade.submitActivity.mockRejectedValue({ errorCode: "idempotency_conflict" });
    await expect(bridge.submit({ kind: "code", requestId: "submit", sessionId: "session-1", sessionVersion: 4, profileRevision: 3, activityId: "activity-1", activityVersion: 3, attemptId: "attempt-1", draftVersion: 2, userText: "changed" }))
      .resolves.toMatchObject({ status: "conflict", reason: "idempotency_conflict", bootstrap: { sessionVersion: 4 } });
  });
});
