import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { AppBootstrapSafeView, SessionRecoverySafeView } from "../src/contracts/index.js";
import type { LearningRuntimeFacade, NextStepOutput, QuizActivityDraftOutput } from "../src/contracts/facade.js";
import { createDemoRuntime, type DemoRuntime } from "../src/demo/composition-root.js";
import { startHttpServer, type HttpServerHandle } from "../src/demo/http-server.js";
import { FilePendingActivityStore } from "../src/tui/file-pending-activity-store.js";
import { TuiSharedSessionBridge, TuiSharedSessionEntry } from "../src/tui/shared-session.js";

const fixturesRoot = resolve(process.cwd(), "fixtures/profiles");
const roots: string[] = [];
const handles: HttpServerHandle[] = [];
const runtimes: DemoRuntime[] = [];
const evidence: Array<Record<string, unknown>> = [];

afterAll(async () => {
  const evidenceDir = process.env.W5_A_D4_EVIDENCE_DIR;
  if (evidenceDir === undefined) return;
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "cross-end-results.json"), `${JSON.stringify({
    schemaVersion: 1,
    status: evidence.length === 2 ? "PASS" : "INCOMPLETE",
    trajectories: evidence,
  }, null, 2)}\n`, "utf8");
});

afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (runtimes.length > 0) await runtimes.pop()!.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "w5-a-d4-cross-end-"));
  roots.push(root);
  return root;
}

async function server(runtime: DemoRuntime): Promise<{ handle: HttpServerHandle; baseUrl: string }> {
  const handle = startHttpServer(Promise.resolve(runtime), 0);
  handles.push(handle);
  await handle.ready;
  const address = handle.server.address() as AddressInfo;
  return { handle, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function get(baseUrl: string, path: string): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

async function post(baseUrl: string, path: string, value: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

async function readySession(facade: LearningRuntimeFacade, bootstrap: AppBootstrapSafeView, prefix: string) {
  const chapterId = bootstrap.chapters[0]?.chapterId;
  const goalId = bootstrap.goals[0]?.goalId;
  if (chapterId === undefined || goalId === undefined) throw new Error("Expected revision 3 chapter and goal fixtures");
  const started = await facade.startSession({
    requestId: `${prefix}-start`, subjectId: "pandas-cleaning", mode: "chapter",
    goalId, chapterId, availableMinutes: 400,
  });
  const background = {
    python_experience: "basic" as const,
    pandas_experience: "basic" as const,
    explanation_preference: "step_by_step" as const,
  };
  const draft = await facade.saveDiagnosticDraft({
    requestId: `${prefix}-draft`, sessionId: started.sessionId,
    sessionVersion: started.sessionVersion, profileRevision: started.profileRevision,
    diagnosticId: bootstrap.diagnostic.diagnosticId,
    diagnosticVersion: bootstrap.diagnostic.diagnosticVersion,
    diagnosticDraftVersion: 0, background,
  });
  const completed = await facade.completeDiagnostic({
    requestId: `${prefix}-diagnostic`, sessionId: started.sessionId,
    sessionVersion: draft.sessionVersion, profileRevision: started.profileRevision,
    diagnosticDraftVersion: draft.diagnosticDraftVersion, mode: "background_only", background,
  });
  const built = await facade.buildPath({
    requestId: `${prefix}-path`, sessionId: started.sessionId,
    sessionVersion: completed.sessionVersion, profileRevision: started.profileRevision,
    goalId, mode: "chapter", chapterId, availableMinutes: 400,
    evidenceVersion: completed.evidenceVersion, selectedKnowledgePointIds: [], lockedNodeIds: [],
  });
  if (built.status !== "candidate" || built.pathId === undefined || built.pathVersion === undefined) throw new Error("Expected a candidate path");
  await facade.confirmPath({
    requestId: `${prefix}-confirm`, sessionId: started.sessionId,
    sessionVersion: built.sessionVersion, profileRevision: started.profileRevision,
    pathId: built.pathId, pathVersion: built.pathVersion,
  });
  return started;
}

function bridge(runtime: DemoRuntime, dataRoot: string) {
  const store = new FilePendingActivityStore(dataRoot);
  const value = new TuiSharedSessionBridge(runtime.facade, runtime.bootstrap, store);
  return { bridge: value, entry: new TuiSharedSessionEntry(value, "http://localhost:5173"), store };
}

function quizAnswers(opened: QuizActivityDraftOutput) {
  return opened.activity.questions.map((question) => ({
    questionId: question.questionId,
    answer: question.kind === "judgment" ? false : question.options[0]!,
  }));
}

function nextUrl(session: SessionRecoverySafeView): string {
  if (session.path === undefined) throw new Error("Expected an active path");
  return `/api/sessions/${session.sessionId}/next-step?sessionVersion=${session.sessionVersion}&profileRevision=${session.profileRevision}&pathVersion=${session.path.pathVersion}`;
}

describe("W5-D4 A formal shared-session trajectories", () => {
  it("continues TUI -> Web and lets a restarted TUI read the same Attempt, Evidence and next step", async () => {
    const dataRoot = await createRoot();
    const runtime = await createDemoRuntime({ dataRoot, fixturesRoot });
    const started = await readySession(runtime.facade, await runtime.bootstrap.getBootstrap({}), "tui-web");
    const tui = bridge(runtime, dataRoot);
    const prepared = await tui.entry.prepareCurrentActivity(started.sessionId);
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;

    const web = await server(runtime);
    const opened = await post(web.baseUrl, `/api/activities/${prepared.nextStep.activity!.activityId}/open`, {
      requestId: "tui-web-open", sessionId: started.sessionId,
      sessionVersion: prepared.nextStep.sessionVersion, profileRevision: prepared.nextStep.profileRevision,
      activityVersion: prepared.nextStep.activity!.activityVersion, pathVersion: prepared.nextStep.pathVersion,
      ...(prepared.nextStep.card === undefined ? {} : { acknowledgedCardId: prepared.nextStep.card.cardId }),
    }) as QuizActivityDraftOutput;
    const submitted = await post(web.baseUrl, `/api/activities/${opened.activity.activityId}/submit`, {
      requestId: "tui-web-submit", sessionId: opened.sessionId,
      sessionVersion: opened.sessionVersion, profileRevision: opened.profileRevision,
      kind: "quiz", activityVersion: opened.activity.activityVersion, attemptId: opened.attemptId,
      answers: quizAnswers(opened),
    });
    expect(submitted).toMatchObject({ committed: true, evidenceId: expect.any(String), evidenceVersion: expect.any(Number) });

    handles.pop();
    await web.handle.close();
    const restarted = await createDemoRuntime({ dataRoot, fixturesRoot });
    runtimes.push(restarted);
    const restartedTui = bridge(restarted, dataRoot);
    const current = await restartedTui.bridge.readCurrent(started.sessionId);
    expect(current).toBeDefined();
    const attempt = await restartedTui.bridge.readActivityAttempt(current!, opened.activity.activityId, opened.attemptId);
    expect(attempt).toMatchObject({
      attemptId: opened.attemptId,
      status: "submitted",
      evidenceId: submitted.evidenceId,
      evidenceVersion: submitted.evidenceVersion,
    });
    const continuation = await restartedTui.bridge.readCurrentStep(current!);
    expect(continuation?.completed || continuation?.activity !== undefined).toBe(true);
    evidence.push({
      direction: "TUI_TO_WEB_TO_RESTARTED_TUI",
      sessionId: started.sessionId,
      attemptId: opened.attemptId,
      evidenceId: attempt.evidenceId,
      evidenceVersion: attempt.evidenceVersion,
      committed: submitted.committed,
      sameAttemptReadAfterRestart: attempt.attemptId === opened.attemptId,
      sameEvidenceReadAfterRestart: attempt.evidenceId === submitted.evidenceId && attempt.evidenceVersion === submitted.evidenceVersion,
      nextStepReadableAfterRestart: continuation?.completed || continuation?.activity !== undefined,
    });
  }, 60_000);

  it("continues Web -> TUI and exposes the same Attempt and Evidence after Web refresh", async () => {
    const dataRoot = await createRoot();
    const runtime = await createDemoRuntime({ dataRoot, fixturesRoot });
    runtimes.push(runtime);
    const started = await readySession(runtime.facade, await runtime.bootstrap.getBootstrap({}), "web-tui");
    const web = await server(runtime);
    const current = await get(web.baseUrl, `/api/bootstrap?recoverSessionId=${started.sessionId}`) as AppBootstrapSafeView;
    const next = await get(web.baseUrl, nextUrl(current.session!)) as NextStepOutput;
    const opened = await post(web.baseUrl, `/api/activities/${next.activity!.activityId}/open`, {
      requestId: "web-tui-open", sessionId: started.sessionId,
      sessionVersion: next.sessionVersion, profileRevision: next.profileRevision,
      activityVersion: next.activity!.activityVersion, pathVersion: next.pathVersion,
      ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }),
    }) as QuizActivityDraftOutput;

    const tui = bridge(runtime, dataRoot);
    const prepared = await tui.entry.prepareCurrentActivity(started.sessionId);
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    const submitted = await tui.bridge.submit({
      requestId: "web-tui-submit", sessionId: opened.sessionId,
      sessionVersion: opened.sessionVersion, profileRevision: opened.profileRevision,
      activityId: opened.activity.activityId, kind: "quiz", activityVersion: opened.activity.activityVersion,
      attemptId: opened.attemptId, answers: quizAnswers(opened),
    });
    expect(submitted).toMatchObject({ status: "saved", output: { committed: true, evidenceId: expect.any(String), evidenceVersion: expect.any(Number) } });
    if (submitted.status !== "saved") return;

    const refreshed = await get(web.baseUrl, `/api/bootstrap?recoverSessionId=${started.sessionId}`) as AppBootstrapSafeView;
    const attempt = await get(web.baseUrl, `/api/activities/${opened.activity.activityId}/attempts/${opened.attemptId}?sessionId=${opened.sessionId}&sessionVersion=${refreshed.session!.sessionVersion}&profileRevision=${opened.profileRevision}`);
    expect(attempt).toMatchObject({
      attemptId: opened.attemptId,
      status: "submitted",
      evidenceId: submitted.output.evidenceId,
      evidenceVersion: submitted.output.evidenceVersion,
    });
    evidence.push({
      direction: "WEB_TO_TUI_TO_WEB_REFRESH",
      sessionId: started.sessionId,
      attemptId: opened.attemptId,
      evidenceId: attempt.evidenceId,
      evidenceVersion: attempt.evidenceVersion,
      committed: submitted.output.committed,
      sameAttemptReadAfterRefresh: attempt.attemptId === opened.attemptId,
      sameEvidenceReadAfterRefresh: attempt.evidenceId === submitted.output.evidenceId && attempt.evidenceVersion === submitted.output.evidenceVersion,
      pendingClearedAfterCommit: tui.store.load() === undefined,
    });
  }, 60_000);
});
