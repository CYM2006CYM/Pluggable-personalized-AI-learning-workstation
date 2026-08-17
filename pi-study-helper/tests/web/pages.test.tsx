// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRoutes } from "../../src/web/app/routes.js";
import { PageStatePanel } from "../../src/web/components/PageStatePanel.js";
import { useUiStore } from "../../src/web/state/ui-store.js";
import {
  bootstrap,
  codeSubmission,
  fail,
  nextStep,
  ok,
  openedCode,
  openedQuiz,
  pathNodes,
  preparedCode,
  quizSubmission,
  recovery,
  replan,
  savedCode,
} from "./fixtures/w4-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  useUiStore.setState({ activityDrafts: {} });
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderRoute(pathname: string, fetchImpl: ReturnType<typeof vi.fn>, state?: unknown) {
  vi.stubGlobal("fetch", fetchImpl);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const router = createMemoryRouter(appRoutes, { initialEntries: [state === undefined ? pathname : { pathname, state }] });
  await act(async () => { root!.render(<RouterProvider router={router} />); });
  await settle();
  return { host, router };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  if (!(found instanceof HTMLButtonElement)) throw new Error(`button_not_found:${label}`);
  return found;
}

async function click(target: HTMLElement) {
  await act(async () => { target.click(); });
  await settle();
}

async function editTextarea(target: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function bodyAt(fetchMock: ReturnType<typeof vi.fn>, index: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

describe("W4 real API pages", () => {
  it("renders the start page from Bootstrap with both entry modes and three questionnaire fields", async () => {
    const { host } = await renderRoute("/", vi.fn().mockResolvedValue(ok(bootstrap())));
    expect(host.textContent).toContain("Pandas Cleaning");
    expect(host.textContent).toContain("系统推荐");
    expect(host.textContent).toContain("按章节学习");
    expect(host.querySelectorAll("select")).toHaveLength(5);
    expect(host.textContent).not.toContain("Mock DTO");
  });

  it("renders the recommended diagnostic from the safe envelope", async () => {
    const session = recovery({ stage: "diagnostic" });
    const { host } = await renderRoute("/diagnostic/session-w4", vi.fn().mockResolvedValue(ok(bootstrap(session))));
    expect(host.textContent).toContain("哪个表达式创建列表");
    expect(host.textContent).toContain("Draft v1");
  });

  it("renders all W4 path node fields", async () => {
    const session = recovery({ stage: "path" });
    const { host } = await renderRoute("/path/session-w4", vi.fn().mockResolvedValue(ok(bootstrap(session))));
    expect(host.textContent).toContain("S-R");
    expect(host.textContent).toContain("worked_example");
    expect(host.textContent).toContain("必需");
    expect(host.textContent).toContain("位置锁定");
  });

  it("prefers a server-confirmed path over a stale candidate kept in browser history", async () => {
    const session = recovery({ stage: "learning", pathVersion: 1 });
    const staleCandidate = {
      requestId: "stale-candidate",
      sessionId: "session-w4",
      sessionVersion: 1,
      profileRevision: 3,
      status: "candidate" as const,
      pathId: "path-w4",
      pathVersion: 1,
      nodes: pathNodes,
      missingPrerequisiteIds: [],
      minimumRequiredMinutes: 12,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(nextStep));
    const { host, router } = await renderRoute("/path/session-w4", fetchMock, { candidate: staleCandidate });

    expect(button(host, "进入学习")).toBeDefined();
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.includes("确认路径"))).toBe(false);
    await click(button(host, "进入学习"));
    expect(router.state.location.pathname).toBe("/learn/session-w4/node-basic");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/confirm"))).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/next-step"))).toBe(true);
  });

  it("renders the learning card and treats the optional review timeline as not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery()))).mockResolvedValueOnce(ok(nextStep));
    const { host } = await renderRoute("/learn/session-w4/node-basic", fetchMock);
    expect(host.textContent).toContain("Python 列表");
    expect(host.textContent).toContain("NOT_PROVIDED");
    expect(host.textContent).not.toContain("UPSTREAM_CONTRACT_BLOCKED");
  });

  it("does not send an incomplete learning step to summary", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery()))).mockResolvedValueOnce(ok({ ...nextStep, activity: undefined, completed: false }));
    const { host } = await renderRoute("/learn/session-w4/node-basic", fetchMock);
    expect(host.textContent).toContain("重新读取内容");
    expect(host.textContent).not.toContain("查看总结");
  });

  it("renders a four-question quiz without opening-stage answers", async () => {
    const { host } = await renderRoute("/activity/session-w4/act-basic", vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "activity" })))), { opened: openedQuiz, nodeId: "node-basic" });
    expect(host.querySelectorAll(".quiz-question")).toHaveLength(4);
    expect(host.textContent).not.toContain("正确答案：");
    expect(host.textContent).toContain("0/4 已回答");
  });

  it("recovers the same quiz Attempt and question IDs from the Bootstrap reference", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = { kind: "quiz", activityId: "act-basic", attemptId: "attempt-1", status: "draft", retryNumber: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(nextStep))
      .mockResolvedValueOnce(ok(openedQuiz));
    const { host } = await renderRoute("/activity/session-w4/act-basic", fetchMock);
    expect(host.textContent).toContain("attempt-1");
    expect([...host.querySelectorAll(".quiz-question h2")].map((item) => item.textContent)).toEqual([
      "1. 列表字面量？", "2. 列表有顺序。", "3. 追加方法？", "4. 索引从0开始。",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/activities/act-basic/open");
  });

  it("advances a submitted refresh through Bootstrap and getNextStep without reopening the old Attempt", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = undefined;
    session.activityProgress = [{ nodeId: "node-basic", activities: [{ activityId: "act-basic", status: "completed", attemptIds: ["attempt-1"], result: "pass", quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" }] }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(nextStep));
    const { host, router } = await renderRoute("/activity/session-w4/act-basic", fetchMock, { opened: openedQuiz, nodeId: "node-basic" });
    expect(host.textContent).toContain("SUBMITTED_PROGRESS_RECOVERED");
    expect(host.querySelectorAll(".quiz-question")).toHaveLength(0);
    await click(button(host, "进入下一活动"));
    expect(router.state.location.pathname).toBe("/learn/session-w4/node-basic");
    expect(fetchMock.mock.calls.map((call) => String(call[0])).slice(0, 3)).toEqual([
      "/api/bootstrap?recoverSessionId=session-w4",
      "/api/bootstrap?recoverSessionId=session-w4",
      "/api/sessions/session-w4/next-step?sessionVersion=2&profileRevision=3&pathVersion=1",
    ]);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/activities/act-basic/open"))).toBe(false);
  });

  it("recovers an insufficient result even when an older snapshot kept the lifecycle in progress", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = undefined;
    session.activityProgress = [{ nodeId: "node-basic", activities: [{
      activityId: "act-basic", status: "in_progress", attemptIds: ["attempt-1"],
      result: "insufficient", quizRetryCount: 1, updatedAt: "2026-08-16T00:00:00.000Z",
    }] }];
    const retryQuiz = openedQuiz.kind === "quiz" ? {
      ...openedQuiz, attemptId: "attempt-2", sessionVersion: 3,
      activity: { ...openedQuiz.activity, retryNumber: 1 as const },
    } : openedQuiz;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(nextStep))
      .mockResolvedValueOnce(ok(retryQuiz));
    const { host, router } = await renderRoute("/activity/session-w4/act-basic", fetchMock);
    expect(host.textContent).toContain("SUBMITTED_PROGRESS_RECOVERED");
    expect(host.textContent).toContain("in_progress/insufficient");
    await click(button(host, "开始新 Attempt 重试"));
    expect(router.state.location.pathname).toBe("/activity/session-w4/act-basic");
    expect(host.textContent).toContain("attempt-2");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/activities/act-basic/open"))).toBe(true);
  });

  it("saves edited code before preview and runs the returned draftVersion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(savedCode))
      .mockResolvedValueOnce(ok(preparedCode));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await editTextarea(host.querySelector("textarea")!, "print('edited draft')");
    await click(button(host, "运行公开检查"));
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("/api/activities/act-code/draft");
    expect(bodyAt(fetchMock, 1)).toMatchObject({ draftVersion: 1, userText: "print('edited draft')" });
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("/api/activities/act-code/run");
    expect(bodyAt(fetchMock, 2)).toMatchObject({ draftVersion: 2, attemptId: "attempt-code-1", mode: "preview" });
    expect(host.textContent).toContain("public-pandas");
  });

  it("does not run stale code after a draft save failure and keeps the local text", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(fail(409, "draft_version_conflict"))
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await editTextarea(host.querySelector("textarea")!, "print('unsaved local')");
    await click(button(host, "运行公开检查"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/run"))).toBe(false);
    expect(useUiStore.getState().activityDrafts["attempt-code-1"]).toBe("print('unsaved local')");
    expect(host.textContent).toContain("draft_version_conflict");
  });

  it("restores a saved code draft from the same server Attempt after refresh", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "draft", draftVersion: 2 };
    const recovered = {
      sessionId: "session-w4", sessionVersion: 4, profileRevision: 3,
      attempt: { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "draft", draftVersion: 2 },
      draftVersion: 2, userText: "print('edited draft')", recoveryAction: "resume_draft",
    };
    const codeNext = { ...nextStep, activity: openedCode.kind === "code" ? openedCode.activity : undefined };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(codeNext))
      .mockResolvedValueOnce(ok(recovered))
      .mockResolvedValueOnce(ok(savedCode));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("print('edited draft')");
    expect(host.textContent).toContain("attempt-code-1");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain("/api/activities/act-code/recover");
  });

  it("keeps evaluator_error on the same Attempt and supports a successful recovery retry", async () => {
    const initialSession = recovery({ stage: "activity" });
    initialSession.currentAttempt = { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "draft", draftVersion: 1 };
    const errorSession = recovery({ stage: "activity", sessionVersion: 4 });
    errorSession.sessionVersion = 4;
    errorSession.currentAttempt = { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "evaluator_error", draftVersion: 1 };
    const recovered = {
      sessionId: "session-w4", sessionVersion: 5, profileRevision: 3,
      attempt: { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "evaluator_error", draftVersion: 1 },
      draftVersion: 1, userText: "print('server draft')", recoveryAction: "retry_after_evaluator_error",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(initialSession)))
      .mockResolvedValueOnce(ok({ status: "evaluator_error", errorCode: "evaluator_timeout", verdict: "not_graded" }, 202))
      .mockResolvedValueOnce(ok(bootstrap(errorSession)))
      .mockResolvedValueOnce(ok(bootstrap(errorSession)))
      .mockResolvedValueOnce(ok(recovered))
      .mockResolvedValueOnce(ok(codeSubmission))
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "learning", sessionVersion: 6 }))));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await click(button(host, "提交正式评测"));
    expect(host.textContent).toContain("evaluator_timeout");
    await click(button(host, "重新读取草稿后重试"));
    expect(host.textContent).toContain("pass");
    expect(bodyAt(fetchMock, 5)).toMatchObject({ attemptId: "attempt-code-1", draftVersion: 1, userText: "print('server draft')" });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain("/api/activities/act-code/recover");
  });

  it("keeps the recovery action available after a repeated evaluator failure", async () => {
    const initialSession = recovery({ stage: "activity" });
    initialSession.currentAttempt = { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "draft", draftVersion: 1 };
    const errorSession = recovery({ stage: "activity", sessionVersion: 4 });
    errorSession.sessionVersion = 4;
    errorSession.currentAttempt = { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "evaluator_error", draftVersion: 1 };
    const recovered = {
      sessionId: "session-w4", sessionVersion: 5, profileRevision: 3,
      attempt: { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "evaluator_error", draftVersion: 1 },
      draftVersion: 1, userText: "print('server draft')", recoveryAction: "retry_after_evaluator_error",
    };
    const evaluatorFailure = { status: "evaluator_error", errorCode: "evaluator_timeout", verdict: "not_graded" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(initialSession)))
      .mockResolvedValueOnce(ok(evaluatorFailure, 202))
      .mockResolvedValueOnce(ok(bootstrap(errorSession)))
      .mockResolvedValueOnce(ok(bootstrap(errorSession)))
      .mockResolvedValueOnce(ok(recovered))
      .mockResolvedValueOnce(ok(evaluatorFailure, 202))
      .mockResolvedValueOnce(ok(bootstrap(errorSession)));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await click(button(host, "提交正式评测"));
    await click(button(host, "重新读取草稿后重试"));
    expect(host.textContent).toContain("evaluator_timeout");
    expect(button(host, "重新读取草稿后重试").disabled).toBe(false);
    expect(bodyAt(fetchMock, 5)).toMatchObject({ attemptId: "attempt-code-1", draftVersion: 1 });
  });

  it.each([
    ["changed", replan()],
    ["unchanged", replan({ changed: false, changeReasons: [] })],
    ["fallback", replan({ changed: false, fallbackToPrevious: true, changeReasons: ["candidate_infeasible"] })],
  ])("renders %s replan output and server changeReasons", async (_case, output) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "path" })))).mockResolvedValueOnce(ok(output));
    const { host } = await renderRoute("/path/session-w4", fetchMock, { evidenceVersion: 7 });
    await click(button(host, "重新计算路径"));
    expect(host.textContent).toContain(output.changed ? "路径变化是" : "路径变化否");
    expect(host.textContent).toContain(output.fallbackToPrevious ? "沿用旧路径是" : "沿用旧路径否");
    expect(bodyAt(fetchMock, 1)).toMatchObject({ evidenceVersion: 7, pathVersion: 1, trigger: "user_constraint_changed" });
    for (const reason of output.changeReasons) expect(host.textContent).toContain(reason);
  });

  it("shows replan conflicts and disables replan after a refresh without evidenceVersion", async () => {
    const conflictFetch = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "path" })))).mockResolvedValueOnce(fail(409, "path_version_conflict"));
    const first = await renderRoute("/path/session-w4", conflictFetch, { evidenceVersion: 7 });
    await click(button(first.host, "重新计算路径"));
    expect(first.host.textContent).toContain("path_version_conflict");
    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    const refreshed = await renderRoute("/path/session-w4", vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "path" })))));
    expect(button(refreshed.host, "重新计算路径").disabled).toBe(true);
    expect(refreshed.host.textContent).toContain("安全 DTO 未冻结 evidenceVersion");
  });

  it("renders fail, partial, insufficient and unverified from safe progress facts", async () => {
    const session = recovery({ stage: "activity" });
    session.activityProgress = [{ nodeId: "node-basic", activities: [
      { activityId: "act-fail", status: "completed", attemptIds: ["a1"], result: "fail", quizRetryCount: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      { activityId: "act-partial", status: "completed", attemptIds: ["a2"], result: "partial", quizRetryCount: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      { activityId: "act-insufficient", status: "insufficient", attemptIds: ["a3"], result: "insufficient", quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" },
      { activityId: "act-pending", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" },
    ] }];
    const completed = { requestId: "complete", sessionId: "session-w4", sessionVersion: 3, profileRevision: 3, completedAt: "2026-08-16T00:00:00.000Z", summary: "Session completed.", nextRecommendation: "Review." };
    const { host } = await renderRoute("/summary/session-w4", vi.fn().mockResolvedValueOnce(ok(bootstrap(session))).mockResolvedValueOnce(ok(completed)));
    for (const expected of ["act-fail: fail", "act-partial: partial", "act-insufficient: insufficient", "act-pending: unverified"]) expect(host.textContent).toContain(expected);
  });

  it("shows completed-session recovery without replaying a frozen historical summary", async () => {
    const session = recovery({ stage: "completed", status: "completed" });
    session.activityProgress = [{ nodeId: "node-basic", activities: [{ activityId: "act-pending", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" }] }];
    const fetchMock = vi.fn().mockResolvedValue(ok(bootstrap(session)));
    const { host } = await renderRoute("/summary/session-w4", fetchMock);
    expect(host.textContent).toContain("COMPLETED_SUMMARY_NOT_REPLAYABLE");
    expect(host.textContent).toContain("act-pending: unverified");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders an empty unresolved result without inventing mastery", async () => {
    const session = recovery({ stage: "activity" });
    session.activityProgress = [{ nodeId: "node-basic", activities: [{ activityId: "act-pass", status: "completed", attemptIds: ["a1"], result: "pass", quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" }] }];
    const completed = { requestId: "complete", sessionId: "session-w4", sessionVersion: 3, profileRevision: 3, summary: "Done." };
    const { host } = await renderRoute("/summary/session-w4", vi.fn().mockResolvedValueOnce(ok(bootstrap(session))).mockResolvedValueOnce(ok(completed)));
    expect(host.textContent).toContain("暂无未解决项");
    expect(host.textContent).not.toContain("mastery");
  });

  it("renders submitted quiz safe review and starts a new Attempt only through the next-step API", async () => {
    const afterSubmit = recovery({ stage: "activity", sessionVersion: 4 });
    afterSubmit.sessionVersion = 4;
    const retryNext = { ...nextStep, sessionVersion: 4 };
    const retryQuiz = openedQuiz.kind === "quiz" ? { ...openedQuiz, requestId: "retry-open", sessionVersion: 5, attemptId: "attempt-2", activity: { ...openedQuiz.activity, retryNumber: 1 as const, questions: openedQuiz.activity.questions.map((question) => ({ ...question, questionId: `retry-${question.questionId}` })) } } : openedQuiz;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(quizSubmission))
      .mockResolvedValueOnce(ok(bootstrap(afterSubmit)))
      .mockResolvedValueOnce(ok(bootstrap(afterSubmit)))
      .mockResolvedValueOnce(ok(retryNext))
      .mockResolvedValueOnce(ok(retryQuiz));
    const { host } = await renderRoute("/activity/session-w4/act-basic", fetchMock, { opened: openedQuiz });
    for (const question of host.querySelectorAll(".quiz-question")) await click(question.querySelector("input")!);
    await click(button(host, "提交完整题组"));
    expect(host.textContent).toContain("提交后安全复盘");
    await click(button(host, "开始新 Attempt 重试"));
    expect(host.textContent).toContain("attempt-2");
    expect(String(fetchMock.mock.calls[5]?.[0])).toBe("/api/activities/act-basic/open");
  });

  it("maps loading, empty, error, conflict and recovery to stable accessible panels", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    for (const state of ["loading", "empty", "error", "conflict", "recovery"] as const) {
      act(() => root!.render(<PageStatePanel page="activity" state={state} />));
      expect(host.querySelector(`[data-state="${state}"]`)).not.toBeNull();
    }
  });

  it("renders transport errors without leaking server messages", async () => {
    const { host } = await renderRoute("/", vi.fn().mockResolvedValue(fail(503, "initialization_not_ready")));
    expect(host.textContent).toContain("initialization_not_ready");
    expect(host.textContent).not.toContain("safe error");
  });
});
