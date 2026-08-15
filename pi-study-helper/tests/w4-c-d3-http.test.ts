import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoRuntime, type DemoRuntime } from "../src/demo/composition-root.js";
import { startHttpServer, type HttpServerHandle } from "../src/demo/http-server.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const roots: string[] = [];
const fixtures = resolve(process.cwd(), "fixtures/profiles");

async function runtime(): Promise<DemoRuntime> {
  const root = await mkdtemp(resolve(tmpdir(), "w4-c-d3-http-"));
  roots.push(root);
  return createDemoRuntime({ dataRoot: root, fixturesRoot: fixtures });
}

async function postJson(url: string, pathname: string, value: Record<string, unknown>): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${url}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  return { response, body: await response.json() };
}

async function listen(value: Promise<DemoRuntime>, port = 0): Promise<{ handle: HttpServerHandle; url: string }> {
  const handle = startHttpServer(value, port);
  await new Promise<void>((resolveReady) => {
    if (handle.server.listening) resolveReady();
    else handle.server.once("listening", () => resolveReady());
  });
  const address = handle.server.address();
  if (typeof address !== "object" || address === null) throw new Error("server did not bind");
  return { handle, url: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("W4 C D3 HTTP adapter", () => {
  it("serves bootstrap and creates a session through the existing Facade", async () => {
    const { handle, url } = await listen(runtime());
    await handle.ready;
    const bootstrap = await fetch(`${url}/api/bootstrap`);
    expect(bootstrap.status).toBe(200);
    const bootstrapBody = await bootstrap.json() as { data: { profiles: Array<{ revision: number }> } };
    expect(bootstrapBody.data.profiles[0]?.revision).toBe(3);
    const missingRecovery = await fetch(`${url}/api/bootstrap?recoverSessionId=missing-session`);
    expect(missingRecovery.status).toBe(404);
    const created = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "http-session-1", subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 20 }),
    });
    expect(created.status).toBe(200);
    expect((await created.json() as { data?: { sessionId: string } }).data?.sessionId).toMatch(/^session-/u);
    await handle.close();
  });

  it("keeps Bootstrap available when no local Python executable is configured", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w4-c-d3-no-python-"));
    roots.push(root);
    const withoutPython = createDemoRuntime({ dataRoot: root, fixturesRoot: fixtures });
    const { handle, url } = await listen(withoutPython);
    await handle.ready;
    expect((await fetch(`${url}/api/bootstrap`)).status).toBe(200);
    await handle.close();
  });

  it("maps transport errors without calling the Facade", async () => {
    const { handle, url } = await listen(runtime());
    await handle.ready;
    const badType = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(badType.status).toBe(400);
    const badJson = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(badJson.status).toBe(400);
    const unknown = await fetch(`${url}/api/no-such-resource`);
    expect(unknown.status).toBe(404);
    const unknownPost = await fetch(`${url}/api/no-such-resource`, { method: "POST" });
    expect(unknownPost.status).toBe(404);
    const oversized = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(64 * 1024) }) });
    expect(oversized.status).toBe(400);
    const missingFields = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(missingFields.status).toBe(400);
    const extraField = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "shape-1", subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 20, extra: true }) });
    expect(extraField.status).toBe(400);
    const privateField = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "shape-2", subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 20, knowledgeStates: [] }) });
    expect(privateField.status).toBe(400);
    await handle.close();
  });

  it("returns 202 for an accepted asynchronous content state", async () => {
    const fake = {
      facade: { getNextStep: async () => ({ contentReadiness: "preparing" }) },
      bootstrap: {},
      close: async () => undefined,
    } as unknown as DemoRuntime;
    const { handle, url } = await listen(Promise.resolve(fake));
    await handle.ready;
    const response = await fetch(`${url}/api/sessions/session-1/next-step?sessionVersion=1&profileRevision=3&pathVersion=1`);
    expect(response.status).toBe(202);
    await handle.close();
  });

  it("maps every fixed resource route to one Facade method", async () => {
    const calls: string[] = [];
    const methods = [
      "startSession", "recoverSession", "completeSession", "saveDiagnosticDraft", "submitDiagnosticAnswer", "completeDiagnostic",
      "buildPath", "confirmPath", "getNextStep", "replanPath", "openActivity", "saveActivityDraft", "prepareActivityRun",
      "submitActivity", "getActivityAttempt", "recoverActivity", "askContextQuestion",
    ];
    const facade = new Proxy({}, { get: (_target, property: string) => async () => { calls.push(property); return { ok: true }; } }) as unknown as DemoRuntime["facade"];
    const fake = { facade, bootstrap: { getBootstrap: async () => ({}) }, close: async () => undefined } as unknown as DemoRuntime;
    const { handle, url } = await listen(Promise.resolve(fake));
    await handle.ready;
    const routes: Array<[string, string]> = [
      ["POST", "/api/sessions"], ["POST", "/api/sessions/s1/recover"], ["POST", "/api/sessions/s1/complete"],
      ["POST", "/api/sessions/s1/diagnostic/draft"], ["POST", "/api/sessions/s1/diagnostic/answers"], ["POST", "/api/sessions/s1/diagnostic/complete"],
      ["POST", "/api/sessions/s1/path"], ["POST", "/api/sessions/s1/path/confirm"], ["GET", "/api/sessions/s1/next-step?sessionVersion=1&profileRevision=3&pathVersion=1"],
      ["POST", "/api/sessions/s1/path/replan"], ["POST", "/api/activities/a1/open"], ["POST", "/api/activities/a1/draft"],
      ["POST", "/api/activities/a1/run"], ["POST", "/api/activities/a1/submit"], ["GET", "/api/activities/a1/attempts/t1?sessionId=s1&sessionVersion=1&profileRevision=3"],
      ["POST", "/api/activities/a1/recover"], ["POST", "/api/sessions/s1/context-questions"],
    ];
    const payloadFor = (path: string): Record<string, unknown> => {
      if (path === "/api/sessions") return { requestId: "route-start", subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 20 };
      if (path.includes("diagnostic/draft")) return { requestId: "route-draft", sessionVersion: 0, profileRevision: 3, diagnosticId: "diagnostic-pandas-cleaning", diagnosticVersion: 1, background: { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" }, diagnosticDraftVersion: 0 };
      if (path.includes("diagnostic/answers")) return { requestId: "route-answer", sessionVersion: 0, profileRevision: 3, diagnosticId: "diagnostic-pandas-cleaning", diagnosticVersion: 1, questionId: "q1", action: "skip", diagnosticDraftVersion: 0 };
      if (path.includes("diagnostic/complete")) return { requestId: "route-complete-diagnostic", sessionVersion: 0, profileRevision: 3, mode: "fixed", diagnosticId: "diagnostic-pandas-cleaning", diagnosticVersion: 1, diagnosticDraftVersion: 0 };
      if (path.includes("/sessions/") && (path.endsWith("/recover") || path.endsWith("/complete"))) return { requestId: "route-session-write", sessionVersion: 0, profileRevision: 3 };
      if (path.endsWith("/path")) return { requestId: "route-path", sessionVersion: 0, profileRevision: 3, goalId: "goal-clean-orders", mode: "recommended", availableMinutes: 20, evidenceVersion: 0, selectedKnowledgePointIds: [], lockedNodeIds: [] };
      if (path.includes("path/confirm")) return { requestId: "route-confirm", sessionVersion: 0, profileRevision: 3, pathId: "path-1", pathVersion: 1 };
      if (path.includes("path/replan")) return { requestId: "route-replan", sessionVersion: 0, profileRevision: 3, pathVersion: 1, evidenceVersion: 0, trigger: "knowledge_state_changed", availableMinutes: 20, selectedKnowledgePointIds: [], lockedNodeIds: [] };
      if (path.includes("next-step")) return {};
      if (path.includes("attempts/") || path.endsWith("/recover")) return { sessionId: "s1", sessionVersion: 0, profileRevision: 3, attemptId: "t1" };
      if (path.endsWith("/open")) return { requestId: "route-open", sessionId: "s1", sessionVersion: 0, profileRevision: 3, activityVersion: 1, pathVersion: 1 };
      if (path.endsWith("/draft")) return { requestId: "route-activity-draft", sessionId: "s1", sessionVersion: 0, profileRevision: 3, activityVersion: 1, attemptId: "t1", draftVersion: 0, userText: "x" };
      if (path.endsWith("/run")) return { requestId: "route-run", sessionId: "s1", sessionVersion: 0, profileRevision: 3, activityVersion: 1, attemptId: "t1", draftVersion: 0, mode: "preview" };
      if (path.endsWith("/submit")) return { requestId: "route-submit", sessionId: "s1", sessionVersion: 0, profileRevision: 3, kind: "code", activityVersion: 1, attemptId: "t1", draftVersion: 0, userText: "x" };
      if (path.includes("context-questions")) return { requestId: "route-context", sessionVersion: 0, profileRevision: 3, pathVersion: 1, nodeId: "node-1", question: "Why?" };
      return { requestId: "route-write", sessionVersion: 0, profileRevision: 3 };
    };
    for (const [method, path] of routes) {
      const response = await fetch(`${url}${path}`, method === "GET" ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payloadFor(path)) });
      expect(response.status, `${path} ${await response.text()}`).toBe(200);
    }
    expect(calls).toEqual(methods);
    await handle.close();
  });

  it("passes complete query metadata to both GET Facade methods", async () => {
    const received: Record<string, unknown>[] = [];
    const fake = {
      facade: {
        getNextStep: async (input: Record<string, unknown>) => { received.push(input); return { ok: true }; },
        getActivityAttempt: async (input: Record<string, unknown>) => { received.push(input); return { ok: true }; },
      },
      bootstrap: {},
      close: async () => undefined,
    } as unknown as DemoRuntime;
    const { handle, url } = await listen(Promise.resolve(fake));
    await handle.ready;
    expect((await fetch(`${url}/api/sessions/s1/next-step?sessionVersion=7&profileRevision=3&pathVersion=2`)).status).toBe(200);
    expect((await fetch(`${url}/api/activities/a1/attempts/t1?sessionId=s1&sessionVersion=7&profileRevision=3`)).status).toBe(200);
    expect(received).toEqual([
      { sessionId: "s1", sessionVersion: 7, profileRevision: 3, pathVersion: 2 },
      { sessionId: "s1", sessionVersion: 7, profileRevision: 3, activityId: "a1", attemptId: "t1" },
    ]);
    await handle.close();
  });

  it("rejects missing, duplicate, non-integer, negative, empty, and unexpected GET query fields", async () => {
    let calls = 0;
    const facade = {
      getNextStep: async () => { calls += 1; return {}; },
      getActivityAttempt: async () => { calls += 1; return {}; },
    } as unknown as DemoRuntime["facade"];
    const fake = { facade, bootstrap: {}, close: async () => undefined } as unknown as DemoRuntime;
    const { handle, url } = await listen(Promise.resolve(fake));
    await handle.ready;
    const invalid = [
      "/api/sessions/s1/next-step?profileRevision=3&pathVersion=2",
      "/api/sessions/s1/next-step?sessionVersion=7&pathVersion=2",
      "/api/sessions/s1/next-step?sessionVersion=7&profileRevision=3",
      "/api/sessions/s1/next-step?sessionVersion=7.5&profileRevision=3&pathVersion=2",
      "/api/sessions/s1/next-step?sessionVersion=-1&profileRevision=3&pathVersion=2",
      "/api/sessions/s1/next-step?sessionVersion=&profileRevision=3&pathVersion=2",
      "/api/sessions/s1/next-step?sessionVersion=7&sessionVersion=8&profileRevision=3&pathVersion=2",
      "/api/sessions/s1/next-step?sessionVersion=7&profileRevision=3&pathVersion=2&extra=1",
      "/api/activities/a1/attempts/t1?sessionVersion=7&profileRevision=3",
      "/api/activities/a1/attempts/t1?sessionId=s1&sessionVersion=x&profileRevision=3",
      "/api/activities/a1/attempts/t1?sessionId=&sessionVersion=7&profileRevision=3",
    ];
    for (const pathname of invalid) {
      const response = await fetch(`${url}${pathname}`);
      expect(response.status, pathname).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_query" } });
    }
    expect(calls).toBe(0);
    await handle.close();
  });

  it("maps stale GET metadata through the existing conflict semantics without a write", async () => {
    let writes = 0;
    const conflict = Object.assign(new Error("stale"), { errorCode: "session_version_conflict" });
    const facade = {
      getNextStep: async () => { throw conflict; },
      getActivityAttempt: async () => { throw conflict; },
      submitActivity: async () => { writes += 1; return {}; },
    } as unknown as DemoRuntime["facade"];
    const fake = { facade, bootstrap: {}, close: async () => undefined } as unknown as DemoRuntime;
    const { handle, url } = await listen(Promise.resolve(fake));
    await handle.ready;
    expect((await fetch(`${url}/api/sessions/s1/next-step?sessionVersion=1&profileRevision=3&pathVersion=1`)).status).toBe(409);
    expect((await fetch(`${url}/api/activities/a1/attempts/t1?sessionId=s1&sessionVersion=1&profileRevision=3`)).status).toBe(409);
    expect(writes).toBe(0);
    await handle.close();
  });

  it("keeps the HTTP status taxonomy separate from business outcomes", async () => {
    const facade = {
      startSession: async (input: { requestId: string }) => {
        const errors: Record<string, string> = {
          missing: "session_not_found",
          conflict: "session_version_conflict",
          semantic: "diagnostic_answer_invalid",
          storage: "storage_error",
          evaluator: "evaluator_error",
        };
        const code = errors[input.requestId];
        if (code !== undefined) throw Object.assign(new Error("private details must not escape"), { errorCode: code });
        return { status: "path_infeasible", requestId: input.requestId };
      },
    } as unknown as DemoRuntime["facade"];
    const fake = { facade, bootstrap: {}, close: async () => undefined } as unknown as DemoRuntime;
    const { handle, url } = await listen(Promise.resolve(fake));
    await handle.ready;
    const send = async (requestId: string) => {
      const response = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 20 }) });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    expect((await send("missing")).status).toBe(404);
    expect((await send("conflict")).status).toBe(409);
    expect((await send("semantic")).status).toBe(422);
    expect((await send("storage")).status).toBe(500);
    const evaluator = await send("evaluator");
    expect(evaluator.status).toBe(200);
    expect(evaluator.body.data).toMatchObject({ status: "evaluator_error", errorCode: "evaluator_error", verdict: "not_graded" });
    expect(JSON.stringify(evaluator.body)).not.toContain("private details");
    expect((await send("business")).status).toBe(200);
    await handle.close();
  });

  it("blocks automatic activation when another Profile revision is active", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w4-c-d3-active-conflict-"));
    roots.push(root);
    const active = resolve(root, "profile_families", "pandas-cleaning", "active");
    await mkdir(resolve(root, "profile_families", "pandas-cleaning"), { recursive: true });
    await cp(resolve(fixtures, "pandas-cleaning-v2-draft"), active, { recursive: true });
    const manifestPath = resolve(active, "profile.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.status = "active";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    await expect(createDemoRuntime({ dataRoot: root, fixturesRoot: fixtures })).rejects.toThrow(/active Profile requires owner-approved migration/u);
  });

  it("fails immediately when the requested API port is occupied", async () => {
    const occupied = createNetServer().listen({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolveReady) => occupied.once("listening", () => resolveReady()));
    const address = occupied.address();
    if (typeof address !== "object" || address === null) throw new Error("occupied port unavailable");
    const handle = startHttpServer(Promise.resolve(await runtime()), address.port);
    await expect(handle.ready).rejects.toBeDefined();
    await new Promise<void>((resolveClose) => occupied.close(() => resolveClose()));
  });

  it("returns 503 while the composition root is still initializing", async () => {
    let resolveRuntime!: (runtime: DemoRuntime) => void;
    const pending = new Promise<DemoRuntime>((resolveValue) => { resolveRuntime = resolveValue; });
    const { handle, url } = await listen(pending, 0);
    const before = await fetch(`${url}/api/bootstrap`);
    expect(before.status).toBe(503);
    resolveRuntime(await runtime());
    await handle.ready;
    const after = await fetch(`${url}/api/bootstrap`);
    expect(after.status).toBe(200);
    await handle.close();
  });

  it("reuses revision 3 activation with the same seal", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w4-c-d3-reuse-"));
    roots.push(root);
    const first = await createDemoRuntime({ dataRoot: root, fixturesRoot: fixtures });
    await first.close();
    const second = await createDemoRuntime({ dataRoot: root, fixturesRoot: fixtures });
    const { handle, url } = await listen(Promise.resolve(second));
    await handle.ready;
    expect((await fetch(`${url}/api/bootstrap`)).status).toBe(200);
    await handle.close();
  });

  it("runs and refreshes a real chapter quiz flow without Python", async () => {
    const { handle, url } = await listen(runtime());
    await handle.ready;

    const bootstrapResponse = await fetch(`${url}/api/bootstrap`);
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = (await bootstrapResponse.json() as any).data;
    const started = await postJson(url, "/api/sessions", {
      requestId: "r3-main-start",
      subjectId: "pandas-cleaning",
      mode: "chapter",
      goalId: "goal-clean-orders",
      chapterId: bootstrap.chapters[0].chapterId,
      availableMinutes: 400,
    });
    expect(started.response.status).toBe(200);
    const sessionId = started.body.data.sessionId as string;
    const profileRevision = started.body.data.profileRevision as number;
    let sessionVersion = started.body.data.sessionVersion as number;
    const background = { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" } as const;
    const savedDraft = await postJson(url, `/api/sessions/${sessionId}/diagnostic/draft`, {
      requestId: "r3-main-diagnostic-draft",
      sessionVersion,
      profileRevision,
      diagnosticId: bootstrap.diagnostic.diagnosticId,
      diagnosticVersion: bootstrap.diagnostic.diagnosticVersion,
      background,
      diagnosticDraftVersion: 0,
    });
    expect(savedDraft.response.status, JSON.stringify(savedDraft.body)).toBe(200);
    sessionVersion = savedDraft.body.data.sessionVersion;
    const completed = await postJson(url, `/api/sessions/${sessionId}/diagnostic/complete`, {
      requestId: "r3-main-diagnostic-complete",
      sessionVersion,
      profileRevision,
      mode: "background_only",
      background,
      diagnosticDraftVersion: savedDraft.body.data.diagnosticDraftVersion,
    });
    expect(completed.response.status, JSON.stringify(completed.body)).toBe(200);
    sessionVersion = completed.body.data.sessionVersion;

    const built = await postJson(url, `/api/sessions/${sessionId}/path`, {
      requestId: "r3-main-build",
      sessionVersion,
      profileRevision,
      goalId: "goal-clean-orders",
      mode: "chapter",
      chapterId: bootstrap.chapters[0].chapterId,
      availableMinutes: 400,
      evidenceVersion: completed.body.data.evidenceVersion,
      selectedKnowledgePointIds: [],
      lockedNodeIds: [],
    });
    expect(built.response.status).toBe(200);
    expect(built.body.data.status, JSON.stringify(built.body)).toBe("candidate");
    sessionVersion = built.body.data.sessionVersion;
    const pathVersion = built.body.data.pathVersion as number;
    const confirmed = await postJson(url, `/api/sessions/${sessionId}/path/confirm`, {
      requestId: "r3-main-confirm",
      sessionVersion,
      profileRevision,
      pathId: built.body.data.pathId,
      pathVersion,
    });
    expect(confirmed.response.status).toBe(200);
    sessionVersion = confirmed.body.data.sessionVersion;

    const nextUrl = `/api/sessions/${sessionId}/next-step?sessionVersion=${sessionVersion}&profileRevision=${profileRevision}&pathVersion=${pathVersion}`;
    const firstNextResponse = await fetch(`${url}${nextUrl}`);
    expect(firstNextResponse.status).toBe(200);
    const firstNext = (await firstNextResponse.json() as any).data;
    expect(firstNext.activity.kind).toBe("mcq");
    expect(firstNext.activity.activityId).toBe("act-basic-python-remediation");

    const refreshedBootstrap = await fetch(`${url}/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(refreshedBootstrap.status).toBe(200);
    const recovery = (await refreshedBootstrap.json() as any).data.session;
    expect(recovery.view.sessionVersion).toBe(sessionVersion);
    expect(recovery.activityProgress).toBeDefined();
    const refreshedNext = (await (await fetch(`${url}${nextUrl}`)).json() as any).data;
    expect(refreshedNext.activity).toEqual(firstNext.activity);
    expect(refreshedNext.card).toEqual(firstNext.card);

    const opened = await postJson(url, `/api/activities/${firstNext.activity.activityId}/open`, {
      requestId: "r3-main-open",
      sessionId,
      sessionVersion,
      profileRevision,
      activityVersion: firstNext.activity.activityVersion,
      pathVersion,
      ...(firstNext.card === undefined ? {} : { acknowledgedCardId: firstNext.card.cardId }),
    });
    expect(opened.response.status).toBe(200);
    expect(opened.body.data.kind).toBe("quiz");
    expect(JSON.stringify(opened.body.data)).not.toMatch(/correctAnswer|answerKey|explanation/iu);
    sessionVersion = opened.body.data.sessionVersion;
    const attemptId = opened.body.data.attemptId as string;
    const activityId = opened.body.data.activity.activityId as string;

    const attemptQuery = (version: number) => `/api/activities/${activityId}/attempts/${attemptId}?sessionId=${sessionId}&sessionVersion=${version}&profileRevision=${profileRevision}`;
    const draftAttempt = await fetch(`${url}${attemptQuery(sessionVersion)}`);
    expect(draftAttempt.status).toBe(200);
    expect((await draftAttempt.json() as any).data).toMatchObject({ kind: "quiz", status: "draft", attemptId });

    const answers = opened.body.data.activity.questions.map((question: { questionId: string; kind: string; options?: string[] }) => ({
      questionId: question.questionId,
      answer: question.kind === "judgment" ? false : question.options?.[0],
    }));
    const submitted = await postJson(url, `/api/activities/${activityId}/submit`, {
      requestId: "r3-main-submit",
      sessionId,
      sessionVersion,
      profileRevision,
      kind: "quiz",
      activityVersion: opened.body.data.activity.activityVersion,
      attemptId,
      answers,
    });
    expect(submitted.response.status).toBe(200);
    expect(["pass", "partial", "fail", "insufficient"]).toContain(submitted.body.data.result.verdict);
    expect(submitted.body.data.result.answerReview).toBeDefined();
    sessionVersion = submitted.body.data.sessionVersion;

    const refreshedAfterSubmit = await fetch(`${url}/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(refreshedAfterSubmit.status).toBe(200);
    const afterSubmitRecovery = (await refreshedAfterSubmit.json() as any).data.session;
    expect(afterSubmitRecovery.view.sessionVersion).toBe(sessionVersion);
    expect(afterSubmitRecovery.activityProgress.flatMap((entry: any) => entry.activities).some((entry: any) => entry.attemptIds.includes(attemptId))).toBe(true);
    const submittedAttempt = await fetch(`${url}${attemptQuery(sessionVersion)}`);
    expect(submittedAttempt.status).toBe(200);
    expect((await submittedAttempt.json() as any).data).toMatchObject({ kind: "quiz", status: "submitted", attemptId });
    await handle.close();
  }, 60_000);

  it("completes the recommended questionnaire and path through HTTP", async () => {
    const { handle, url } = await listen(runtime());
    await handle.ready;
    const bootstrap = (await (await fetch(`${url}/api/bootstrap`)).json() as any).data;
    const started = await postJson(url, "/api/sessions", {
      requestId: "r3-recommended-start",
      subjectId: "pandas-cleaning",
      mode: "recommended",
      goalId: "goal-clean-orders",
      availableMinutes: 400,
    });
    expect(started.response.status).toBe(200);
    const sessionId = started.body.data.sessionId as string;
    const profileRevision = started.body.data.profileRevision as number;
    const diagnosticId = bootstrap.diagnostic.diagnosticId as string;
    const diagnosticVersion = bootstrap.diagnostic.diagnosticVersion as number;
    const background = { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" } as const;
    const draft = await postJson(url, `/api/sessions/${sessionId}/diagnostic/draft`, {
      requestId: "r3-recommended-draft",
      sessionVersion: started.body.data.sessionVersion,
      profileRevision,
      diagnosticId,
      diagnosticVersion,
      background,
      diagnosticDraftVersion: 0,
      currentQuestionId: bootstrap.diagnostic.questions[0].questionId,
    });
    expect(draft.response.status).toBe(200);
    let sessionVersion = draft.body.data.sessionVersion as number;
    let diagnosticDraftVersion = draft.body.data.diagnosticDraftVersion as number;
    for (const question of bootstrap.diagnostic.questions) {
      const answer = question.kind === "judgment" ? false : question.options[0];
      const submitted = await postJson(url, `/api/sessions/${sessionId}/diagnostic/answers`, {
        requestId: `r3-recommended-answer-${question.questionId}`,
        sessionVersion,
        profileRevision,
        diagnosticId,
        diagnosticVersion,
        questionId: question.questionId,
        action: "answer",
        answer,
        diagnosticDraftVersion,
      });
      expect(submitted.response.status, JSON.stringify(submitted.body)).toBe(200);
      sessionVersion = submitted.body.data.sessionVersion;
      diagnosticDraftVersion = submitted.body.data.diagnosticDraftVersion;
    }
    const completed = await postJson(url, `/api/sessions/${sessionId}/diagnostic/complete`, {
      requestId: "r3-recommended-complete",
      sessionVersion,
      profileRevision,
      mode: "fixed",
      diagnosticId,
      diagnosticVersion,
      diagnosticDraftVersion,
    });
    expect(completed.response.status, JSON.stringify(completed.body)).toBe(200);
    sessionVersion = completed.body.data.sessionVersion;
    const built = await postJson(url, `/api/sessions/${sessionId}/path`, {
      requestId: "r3-recommended-build",
      sessionVersion,
      profileRevision,
      goalId: "goal-clean-orders",
      mode: "recommended",
      availableMinutes: 400,
      evidenceVersion: completed.body.data.evidenceVersion,
      selectedKnowledgePointIds: [],
      lockedNodeIds: [],
    });
    expect(built.response.status, JSON.stringify(built.body)).toBe(200);
    expect(built.body.data.status).toBe("candidate");
    const confirmed = await postJson(url, `/api/sessions/${sessionId}/path/confirm`, {
      requestId: "r3-recommended-confirm",
      sessionVersion: built.body.data.sessionVersion,
      profileRevision,
      pathId: built.body.data.pathId,
      pathVersion: built.body.data.pathVersion,
    });
    expect(confirmed.response.status, JSON.stringify(confirmed.body)).toBe(200);
    const next = await fetch(`${url}/api/sessions/${sessionId}/next-step?sessionVersion=${confirmed.body.data.sessionVersion}&profileRevision=${profileRevision}&pathVersion=${built.body.data.pathVersion}`);
    expect(next.status).toBe(200);
    expect((await next.json() as any).data.node.nodeId).toBeDefined();
    await handle.close();
  }, 60_000);

  it("does not expose private answer vocabulary or host paths", async () => {
    const { handle, url } = await listen(runtime());
    const response = await fetch(`${url}/api/bootstrap`);
    const text = await response.text();
    expect(text).not.toMatch(/hidden|reference solution|rubric|correctAnswer|answer key|[A-Za-z]:\\/iu);
    await handle.close();
  });
});
