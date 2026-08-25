// @vitest-environment jsdom
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createDemoRuntime, type DemoRuntime } from "../../src/demo/composition-root.js";
import { startHttpServer, type HttpServerHandle } from "../../src/demo/http-server.js";
import { ProfileFamilyQuizActivityAssetResolver } from "../../src/application/quiz-activity-runtime.js";
import { ProfileFamilyRepository } from "../../src/repositories/profile-family-repository.js";
import { recordedQuizAnswers } from "./fixtures/recorded-quiz-answers.js";
import { appRoutes } from "../../src/web/app/routes.js";
import { useUiStore } from "../../src/web/state/ui-store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixturesRoot = resolve("fixtures/profiles");
const profileRoot = resolve(fixturesRoot, "pandas-cleaning-revision-3-draft");
const solutionFiles: Readonly<Record<string, string>> = {
  "act-load-csv": "solution-read-csv.py",
  "act-inspect-dataframe": "solution-structure.py",
  "act-missing": "solution-missing.py",
  "act-duplicates": "solution-duplicates.py",
  "act-types": "solution-types.py",
  "act-practical": "solution-practical.py",
};
const cleanups: Array<() => Promise<void>> = [];
let root: Root | undefined;
let chainEvidence: Record<string, unknown> | undefined;

afterAll(async () => {
  const evidenceRoot = process.env.W5_E_D4_EVIDENCE_DIR;
  if (evidenceRoot === undefined || chainEvidence === undefined) return;
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(resolve(evidenceRoot, "d4-real-code-chain.json"), `${JSON.stringify(chainEvidence, null, 2)}\n`, "utf8");
});

afterEach(async () => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  useUiStore.setState({ activityDrafts: {} });
  sessionStorage.clear();
  document.body.innerHTML = "";
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function startServer(): Promise<{ runtime: DemoRuntime; handle: HttpServerHandle; url: string }> {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "w5-e-d4-real-code-"));
  const runtime = await createDemoRuntime({ dataRoot, fixturesRoot, pythonExecutable: process.env.PI_PYTHON_EXECUTABLE });
  const handle = startHttpServer(Promise.resolve(runtime), 0);
  await handle.ready;
  const address = handle.server.address() as AddressInfo;
  cleanups.push(async () => { await handle.close(); await runtime.close(); await rm(dataRoot, { recursive: true, force: true }); });
  return { runtime, handle, url: `http://127.0.0.1:${address.port}` };
}

async function request(url: string, path: string, init?: RequestInit) {
  const response = await fetch(`${url}${path}`, init);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

async function post(url: string, path: string, value: unknown) {
  return request(url, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}

function meta(value: any, requestId: string) {
  return { requestId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision };
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolveWait) => setTimeout(resolveWait, 50)); });
  }
  throw new Error(`wait_timeout:${label}`);
}

async function submitCodeThroughPage(baseUrl: string, opened: any, code: string) {
  const nodeFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return nodeFetch(new URL(value, baseUrl), init);
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const pathname = `/activity/${opened.sessionId}/${opened.activity.activityId}`;
  const router = createMemoryRouter(appRoutes, { initialEntries: [{ pathname, state: { opened } }] });
  await act(async () => { root!.render(<RouterProvider router={router} />); });
  await waitFor(() => host.querySelector("textarea") !== null, "code_textarea");
  const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, code);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  });
  const submit = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("提交正式评测"));
  if (!(submit instanceof HTMLButtonElement)) throw new Error("formal_submit_button_missing");
  await waitFor(() => !submit.disabled, "formal_submit_enabled");
  await act(async () => { submit.click(); });
  try {
    await waitFor(() => host.textContent?.includes("权威评测结果") === true, "formal_result");
  } catch {
    throw new Error(`formal_result_missing:${host.textContent?.slice(-800)}`);
  }
  expect(host.textContent).toContain("通过");
  expect(host.textContent).toContain("5 / 5");
  expect(host.textContent).toContain("#5");
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  useUiStore.setState({ activityDrafts: {} });
  sessionStorage.clear();
  host.remove();
}

describe("W5 D4 E real Web code chain", () => {
  it("submits every code completion and the final practical through ActivityPage and the real Node/Python API", async () => {
    const { url } = await startServer();
    const initial = await request(url, "/api/bootstrap");
    const started = await post(url, "/api/sessions", {
      requestId: "e-d4-code-start", subjectId: "pandas-cleaning", mode: "chapter",
      goalId: initial.goals[0].goalId, chapterId: initial.chapters[0].chapterId, availableMinutes: 400,
    });
    const sessionId = started.sessionId;
    const background = { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" };
    const draft = await post(url, `/api/sessions/${sessionId}/diagnostic/draft`, {
      ...meta(started, "e-d4-code-draft"), diagnosticId: initial.diagnostic.diagnosticId,
      diagnosticVersion: initial.diagnostic.diagnosticVersion, diagnosticDraftVersion: 0, background,
    });
    const diagnosed = await post(url, `/api/sessions/${sessionId}/diagnostic/complete`, {
      ...meta(draft, "e-d4-code-diagnostic"), mode: "background_only", background,
      diagnosticDraftVersion: draft.diagnosticDraftVersion,
    });
    const built = await post(url, `/api/sessions/${sessionId}/path`, {
      ...meta(diagnosed, "e-d4-code-path"), goalId: started.goalId, mode: "chapter", chapterId: started.chapterId,
      availableMinutes: 400, evidenceVersion: diagnosed.evidenceVersion, selectedKnowledgePointIds: [], lockedNodeIds: [],
    });
    await post(url, `/api/sessions/${sessionId}/path/confirm`, {
      ...meta(built, "e-d4-code-confirm"), pathId: built.pathId, pathVersion: built.pathVersion,
    });

    const profileDataRoot = await mkdtemp(resolve(tmpdir(), "w5-e-d4-quiz-profile-"));
    cleanups.push(() => rm(profileDataRoot, { recursive: true, force: true }));
    const profiles = new ProfileFamilyRepository({ dataRoot: profileDataRoot, fixturesRoot });
    await profiles.activateRevision3Draft("pandas-cleaning");
    const quizzes = new ProfileFamilyQuizActivityAssetResolver(profiles);
    const recordedAnswers = await recordedQuizAnswers();
    const completedCodeActivities: string[] = [];

    for (let step = 0; step < 24; step += 1) {
      const snapshot = await request(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
      const session = snapshot.session;
      const next = await request(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${session.view.sessionVersion}&profileRevision=${session.view.profileRevision}&pathVersion=${session.path.pathVersion}`);
      if (next.completed) break;
      const activity = next.activity;
      const opened = await post(url, `/api/activities/${activity.activityId}/open`, {
        ...meta(next, `e-d4-open-${step}`), sessionId, activityVersion: activity.activityVersion, pathVersion: next.pathVersion,
        ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }),
      });
      if (opened.kind === "code") {
        const solutionFile = solutionFiles[activity.activityId];
        if (solutionFile === undefined) throw new Error(`unexpected_code_activity:${activity.activityId}`);
        const code = await readFile(resolve(profileRoot, "reference-solutions", solutionFile), "utf8");
        await submitCodeThroughPage(url, opened, code);
        completedCodeActivities.push(activity.activityId);
      } else {
        const assets = await quizzes.loadAssets("pandas-cleaning", 3, activity.activityId);
        const privateQuestions = [...assets.fixedQuestions, ...assets.supplementalQuestions,
          ...(assets.legacyQuestion === undefined ? [] : [assets.legacyQuestion])];
        const answersById = new Map<string, string | boolean>([
          ...privateQuestions.map((question) => [question.questionId, question.correctAnswer] as const),
          ...recordedAnswers,
        ]);
        const answers = opened.activity.questions.map((question: any) => ({ questionId: question.questionId, answer: answersById.get(question.questionId) }));
        const submitted = await post(url, `/api/activities/${activity.activityId}/submit`, {
          ...meta(opened, `e-d4-quiz-${step}`), sessionId, kind: "quiz", activityVersion: opened.activity.activityVersion,
          attemptId: opened.attemptId, answers,
        });
        expect(submitted.result.verdict).toBe("pass");
      }
    }

    expect(completedCodeActivities).toEqual([
      "act-load-csv", "act-inspect-dataframe", "act-missing", "act-duplicates", "act-types", "act-practical",
    ]);
    const final = await request(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    const finalNext = await request(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${final.session.view.sessionVersion}&profileRevision=${final.session.view.profileRevision}&pathVersion=${final.session.path.pathVersion}`);
    expect(finalNext.completed).toBe(true);
    const summary = await post(url, `/api/sessions/${sessionId}/complete`, { ...meta(final.session.view, "e-d4-session-complete") });
    expect(summary.completedAt).toEqual(expect.any(String));
    chainEvidence = {
      schemaVersion: 1,
      status: "PASS",
      sessionId,
      codeActivities: completedCodeActivities.map((activityId) => ({ activityId, pageSubmit: true, formalVerdict: "pass" })),
      finalPractical: completedCodeActivities.at(-1) === "act-practical",
      nextStepCompleted: finalNext.completed,
      sessionCompleted: typeof summary.completedAt === "string",
      privateCodeIncluded: false,
    };
  }, 180_000);
});
