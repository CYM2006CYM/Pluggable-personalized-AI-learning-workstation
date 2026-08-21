import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComposedLearningRuntimeFacade } from "../src/application/composed-learning-runtime-facade.js";
import { hashPublicExecutionBundle, validatePublicExecutionBundle } from "../src/application/public-execution-bundle.js";
import type { PreparedActivityOutput } from "../src/contracts/facade.js";
import { createDemoRuntime, type DemoRuntime } from "../src/demo/composition-root.js";
import { startHttpServer, type HttpServerHandle } from "../src/demo/http-server.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const fixturesRoot = resolve(import.meta.dirname, "../fixtures/profiles");
const cleanups: Array<() => Promise<void>> = [];

interface OpenCodeActivity {
  activityId: string;
  activityVersion: number;
  attemptId: string;
  draftVersion: number;
  profileRevision: number;
  sessionId: string;
  sessionVersion: number;
  starterCode: string;
}

interface RealServer {
  dataRoot: string;
  runtime: DemoRuntime;
  sessions: FileLearningSessionRepository;
  url: string;
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

export async function post(url: string, path: string, body: Record<string, unknown>) {
  const requestId = typeof body.requestId === "string" ? body.requestId : "w5-c-http";
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": requestId },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as any };
}

export async function get(url: string, path: string) {
  const response = await fetch(`${url}${path}`);
  return { response, body: await response.json() as any };
}

export function writeMeta(data: any, requestId: string) {
  return {
    requestId,
    sessionId: data.sessionId,
    sessionVersion: data.sessionVersion,
    profileRevision: data.profileRevision,
  };
}

export async function createRealServer(pythonExecutable?: string): Promise<RealServer> {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "w5-c-real-root-"));
  const runtime = await createDemoRuntime({ dataRoot, fixturesRoot, ...(pythonExecutable === undefined ? {} : { pythonExecutable }) });
  const handle: HttpServerHandle = startHttpServer(Promise.resolve(runtime), 0);
  await handle.ready;
  const address = handle.server.address() as AddressInfo;
  cleanups.push(async () => {
    await handle.close();
    await rm(dataRoot, { recursive: true, force: true });
  });
  return {
    dataRoot,
    runtime,
    sessions: new FileLearningSessionRepository({ dataRoot }),
    url: `http://127.0.0.1:${address.port}`,
  };
}

export async function openRevision3CodeActivity(server: RealServer): Promise<OpenCodeActivity> {
  const initial = (await get(server.url, "/api/bootstrap")).body.data;
  const started = await post(server.url, "/api/sessions", {
    requestId: "w5-c-start",
    subjectId: "pandas-cleaning",
    mode: "chapter",
    goalId: initial.goals[0].goalId,
    chapterId: initial.chapters[0].chapterId,
    availableMinutes: 400,
  });
  expect(started.response.status, JSON.stringify(started.body)).toBe(200);
  const sessionId = started.body.data.sessionId;
  const background = {
    python_experience: "basic",
    pandas_experience: "basic",
    explanation_preference: "step_by_step",
  };
  const draft = await post(server.url, `/api/sessions/${sessionId}/diagnostic/draft`, {
    ...writeMeta(started.body.data, "w5-c-diagnostic-draft"),
    diagnosticId: initial.diagnostic.diagnosticId,
    diagnosticVersion: initial.diagnostic.diagnosticVersion,
    diagnosticDraftVersion: 0,
    background,
  });
  expect(draft.response.status, JSON.stringify(draft.body)).toBe(200);
  const completed = await post(server.url, `/api/sessions/${sessionId}/diagnostic/complete`, {
    ...writeMeta(draft.body.data, "w5-c-diagnostic-complete"),
    mode: "background_only",
    background,
    diagnosticDraftVersion: draft.body.data.diagnosticDraftVersion,
  });
  expect(completed.response.status, JSON.stringify(completed.body)).toBe(200);
  const built = await post(server.url, `/api/sessions/${sessionId}/path`, {
    ...writeMeta(completed.body.data, "w5-c-path-build"),
    goalId: started.body.data.goalId,
    mode: "chapter",
    chapterId: started.body.data.chapterId,
    availableMinutes: 400,
    evidenceVersion: completed.body.data.evidenceVersion,
    selectedKnowledgePointIds: [],
    lockedNodeIds: [],
  });
  expect(built.response.status, JSON.stringify(built.body)).toBe(200);
  const confirmed = await post(server.url, `/api/sessions/${sessionId}/path/confirm`, {
    ...writeMeta(built.body.data, "w5-c-path-confirm"),
    pathId: built.body.data.pathId,
    pathVersion: built.body.data.pathVersion,
  });
  expect(confirmed.response.status, JSON.stringify(confirmed.body)).toBe(200);

  let state = confirmed.body.data;
  for (let step = 0; step < 12; step += 1) {
    const next = await get(server.url, `/api/sessions/${sessionId}/next-step?sessionVersion=${state.sessionVersion}&profileRevision=${state.profileRevision}&pathVersion=${state.pathVersion}`);
    expect(next.response.status, JSON.stringify(next.body)).toBe(200);
    expect(next.body.data.completed).toBe(false);
    const activity = next.body.data.activity;
    const opened = await post(server.url, `/api/activities/${activity.activityId}/open`, {
      ...writeMeta(next.body.data, `w5-c-open-${step}`),
      sessionId,
      activityVersion: activity.activityVersion,
      pathVersion: next.body.data.pathVersion,
      ...(next.body.data.card === undefined ? {} : { acknowledgedCardId: next.body.data.card.cardId }),
    });
    expect(opened.response.status, JSON.stringify(opened.body)).toBe(200);
    if (opened.body.data.kind === "code") {
      expect(opened.body.data.activity.activityVersion).toBe(3);
      return {
        activityId: opened.body.data.activity.activityId,
        activityVersion: opened.body.data.activity.activityVersion,
        attemptId: opened.body.data.attemptId,
        draftVersion: opened.body.data.draftVersion,
        profileRevision: opened.body.data.profileRevision,
        sessionId,
        sessionVersion: opened.body.data.sessionVersion,
        starterCode: opened.body.data.userText,
      };
    }

    // Use only the public question projection. A failed first attempt is retried;
    // the deterministic quiz lifecycle advances after the bounded retry.
    const answers = opened.body.data.activity.questions.map((question: any) => ({
      questionId: question.questionId,
      answer: question.kind === "judgment" ? false : question.options[0],
    }));
    const submitted = await post(server.url, `/api/activities/${activity.activityId}/submit`, {
      ...writeMeta(opened.body.data, `w5-c-quiz-submit-${step}`),
      kind: "quiz",
      activityVersion: opened.body.data.activity.activityVersion,
      attemptId: opened.body.data.attemptId,
      answers,
    });
    expect(submitted.response.status, JSON.stringify(submitted.body)).toBe(200);
    const refreshed = await get(server.url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(refreshed.response.status, JSON.stringify(refreshed.body)).toBe(200);
    state = {
      ...refreshed.body.data.session,
      pathVersion: refreshed.body.data.session.path.pathVersion,
    };
  }
  throw new Error("Revision 3 code activity was not reached through the public trajectory");
}

function runInput(opened: OpenCodeActivity, requestId: string) {
  return {
    requestId,
    sessionId: opened.sessionId,
    sessionVersion: opened.sessionVersion,
    profileRevision: opened.profileRevision,
    activityVersion: opened.activityVersion,
    attemptId: opened.attemptId,
    draftVersion: opened.draftVersion,
    mode: "preview",
  };
}

function expectSafePreparationError(payload: any, requestId: string, code: string) {
  expect(payload).toEqual({
    requestId,
    error: { code, message: "The public preview could not be prepared." },
  });
  expect(JSON.stringify(payload)).not.toMatch(/\b(data|verdict|evaluator_error|publicDatasetFiles|publicTestSources|bundleHash|hiddenTests|rubric|referenceSolution)\b/iu);
}

describe("W5 C D1 public execution boundary through the real composition root", () => {
  it("prepares a public bundle without changing authoritative session facts", async () => {
    const server = await createRealServer();
    expect(server.runtime.facade).toBeInstanceOf(ComposedLearningRuntimeFacade);
    const opened = await openRevision3CodeActivity(server);
    const before = await server.sessions.getBoundSnapshot(opened.sessionId);
    const requestId = "w5-c-run-success";
    const result = await post(server.url, `/api/activities/${opened.activityId}/run`, runInput(opened, requestId));

    expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.requestId).toBe(requestId);
    const prepared = result.body.data as PreparedActivityOutput;
    expect(prepared.requestId).toBe(requestId);
    expect(prepared.mode).toBe("preview");
    expect(prepared.profileRevision).toBe(3);
    expect(prepared.publicDatasetFiles.length).toBeGreaterThan(0);
    expect(prepared.publicTestSources.length).toBeGreaterThan(0);
    expect(prepared.bundleHash).toBe(hashPublicExecutionBundle(prepared));
    validatePublicExecutionBundle({
      runId: prepared.runId,
      sessionId: prepared.sessionId,
      activityId: prepared.activityId,
      profileRevision: prepared.profileRevision,
      environmentId: prepared.environmentId,
      starterCodeHash: prepared.starterCodeHash,
      publicDatasetFiles: prepared.publicDatasetFiles,
      publicTestSources: prepared.publicTestSources,
      expiresAt: prepared.expiresAt,
      bundleHash: prepared.bundleHash,
    }, {
      sessionId: opened.sessionId,
      activityId: opened.activityId,
      profileRevision: 3,
      environmentId: prepared.environmentId,
    }, new Date());
    expect(await server.sessions.getBoundSnapshot(opened.sessionId)).toEqual(before);
    expect(JSON.stringify(result.body)).not.toMatch(/hiddenTests|assessments[\\/]private|rubric|referenceSolution|correctAnswer|answerKey|[A-Za-z]:[\\/]/iu);
  }, 60_000);

  it("returns a safe HTTP 500 envelope for an environment mismatch without changing facts", async () => {
    const server = await createRealServer();
    const opened = await openRevision3CodeActivity(server);
    const before = await server.sessions.getBoundSnapshot(opened.sessionId);
    const profiles = new ProfileFamilyRepository({ dataRoot: server.dataRoot, fixturesRoot });
    const profileRoot = await profiles.profileV2RevisionDirectory("pandas-cleaning", 3);
    const lockPath = resolve(profileRoot, "environments/environment-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    await writeFile(lockPath, `${JSON.stringify({ ...lock, environmentId: "env-owner-mismatch" }, null, 2)}\n`, "utf8");
    const requestId = "w5-c-run-environment-mismatch";
    const result = await post(server.url, `/api/activities/${opened.activityId}/run`, runInput(opened, requestId));

    expect(result.response.status).toBe(500);
    expectSafePreparationError(result.body, requestId, "environment_mismatch");
    expect(await server.sessions.getBoundSnapshot(opened.sessionId)).toEqual(before);
  }, 60_000);

  it("returns a safe HTTP 500 envelope for invalid public test assets without changing facts", async () => {
    const server = await createRealServer();
    const opened = await openRevision3CodeActivity(server);
    const before = await server.sessions.getBoundSnapshot(opened.sessionId);
    const profiles = new ProfileFamilyRepository({ dataRoot: server.dataRoot, fixturesRoot });
    const profileRoot = await profiles.profileV2RevisionDirectory("pandas-cleaning", 3);
    const bundles = JSON.parse(await readFile(resolve(profileRoot, "assessments", "private", "task-bundles.json"), "utf8"));
    const bundle = bundles.bundles.find((item: any) => item.activity.activityId === opened.activityId);
    expect(bundle?.publicTests[0]?.fileRef).toBeTypeOf("string");
    const publicTestPath = resolve(profileRoot, bundle.publicTests[0].fileRef);
    const publicTest = await readFile(publicTestPath, "utf8");
    await writeFile(publicTestPath, `${publicTest}\n# owner-induced hash mismatch\n`, "utf8");
    const requestId = "w5-c-run-test-asset-invalid";
    const result = await post(server.url, `/api/activities/${opened.activityId}/run`, runInput(opened, requestId));

    expect(result.response.status).toBe(500);
    expectSafePreparationError(result.body, requestId, "test_asset_invalid");
    expect(await server.sessions.getBoundSnapshot(opened.sessionId)).toEqual(before);
  }, 60_000);

  it("keeps submit evaluator failures at HTTP 200 and creates no authoritative fact", async () => {
    const server = await createRealServer();
    const opened = await openRevision3CodeActivity(server);
    const before = await server.sessions.getBoundSnapshot(opened.sessionId);
    const requestId = "w5-c-submit-unavailable";
    const { mode: _mode, ...submitInput } = runInput(opened, requestId);
    const result = await post(server.url, `/api/activities/${opened.activityId}/submit`, {
      ...submitInput,
      kind: "code",
      userText: opened.starterCode,
    });

    expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toEqual({
      requestId,
      data: { status: "evaluator_error", errorCode: "environment_mismatch", verdict: "not_graded" },
    });
    expect(await server.sessions.getBoundSnapshot(opened.sessionId)).toEqual(before);
  }, 60_000);
});
