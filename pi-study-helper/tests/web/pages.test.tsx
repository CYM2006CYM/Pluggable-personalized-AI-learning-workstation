// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRoutes } from "../../src/web/app/routes.js";
import { PageStatePanel } from "../../src/web/components/PageStatePanel.js";
import { writeActivityDraft } from "../../src/web/state/activity-draft-storage.js";
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
  sessionStorage.clear();
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

async function selectValue(target: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(target, value);
    target.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
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
    expect(host.textContent).toContain("学习时长由系统计算");
    expect(host.querySelector('select[aria-label="可用时间"]')).toBeNull();
    expect(Array.from(host.querySelectorAll('select[aria-label="讲解偏好"] option')).map((option) => option.textContent))
      .toEqual(["逐步讲解", "重点速览", "案例优先"]);
    expect((host.querySelector('select[aria-label="讲解偏好"]') as HTMLSelectElement).value).toBe("step_by_step");
    expect(host.textContent).not.toContain("Mock DTO");
  });

  it("selects a safe Profile and binds its subjectId to the new session", async () => {
    const available = bootstrap();
    available.profiles.push({ subjectId: "python-core", name: "Python Core", revision: 8, modalities: ["reading", "quiz"] });
    const started = { requestId: "start", sessionId: "session-new", sessionVersion: 1, profileRevision: 8, subjectId: "python-core", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 120, status: "active", stage: "diagnostic", diagnosticRequired: true };
    const saved = { requestId: "draft", sessionId: "session-new", sessionVersion: 2, profileRevision: 8, diagnosticId: "diagnostic-pandas-cleaning", diagnosticVersion: 1, savedAt: "2026-08-20T00:00:00.000Z", diagnosticDraftVersion: 1 };
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(available)).mockResolvedValueOnce(ok(started)).mockResolvedValueOnce(ok(saved));
    const { host } = await renderRoute("/", fetchMock);
    await selectValue(host.querySelector('select[aria-label="学习资料包"]')!, "python-core");
    expect(host.textContent).toContain("Python Core");
    expect(host.textContent).toContain("Revision 8");
    expect(host.textContent).toContain("reading / quiz");
    await click(button(host, "开始学习"));
    expect(bodyAt(fetchMock, 1)).toMatchObject({ subjectId: "python-core" });
  });

  it("renders the recommended diagnostic from the safe envelope", async () => {
    const session = recovery({ stage: "diagnostic" });
    const payload = bootstrap(session);
    payload.diagnostic.questions[0]!.evidenceForm = "selected_response";
    const { host } = await renderRoute("/diagnostic/session-w4", vi.fn().mockResolvedValue(ok(payload)));
    expect(host.textContent).toContain("哪个表达式创建列表");
    expect(host.textContent).toContain("草稿 v1");
    expect(host.textContent).toContain("概念理解");
  });

  it("offers qualified objective-diagnostic skips without selecting them by default", async () => {
    const session = recovery({ stage: "path", pathVersion: undefined });
    session.path = undefined;
    session.evidenceVersion = 13;
    session.knowledgeStates = [{
      knowledgePointId: "pandas.clean.read-csv", profileRevision: 3, evidenceVersion: 13,
      aggregationVersion: "knowledge-state-v1", mastery: 1, confidence: 0.49, status: "mastered",
      validEvidenceCount: 2, evidenceFormCount: 2, evidenceIds: ["ev-concept", "ev-application"],
      consideredEvidenceIds: ["ev-concept", "ev-application"], asOf: "2026-08-25T00:00:00.000Z",
      skipEligible: true, diagnosticSkipEligible: true, lastUpdatedAt: "2026-08-25T00:00:00.000Z",
    }];
    const candidate = {
      requestId: "candidate-skip", sessionId: "session-w4", sessionVersion: 3, profileRevision: 3,
      status: "candidate" as const, pathId: "path-skip", pathVersion: 1, nodes: pathNodes,
      missingPrerequisiteIds: [],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(session))).mockResolvedValueOnce(ok(candidate));
    const { host, router } = await renderRoute("/diagnostic/session-w4", fetchMock);

    expect(host.textContent).toContain("诊断完成 · 跳过资格确认");
    expect(host.textContent).toContain("读取CSV数据");
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    await click(checkbox);
    await click(button(host, "按选择生成学习路径"));

    expect(bodyAt(fetchMock, 1)).toMatchObject({
      evidenceVersion: 13,
      diagnosticSkipKnowledgePointIds: ["pandas.clean.read-csv"],
    });
    expect(router.state.location.pathname).toBe("/path/session-w4");
  });

  it("counts saved diagnostic answers instead of the current question position", async () => {
    const initialSession = recovery({ stage: "diagnostic" });
    const initialBootstrap = bootstrap(initialSession);
    initialBootstrap.diagnostic.questions.push({
      questionId: "diag-q2", knowledgePointId: "pandas.clean.read-csv", kind: "single_choice",
      difficulty: "S-R", prompt: "哪个函数读取 CSV？", options: ["read_csv", "read_json"], required: true,
    });
    const savedSession = recovery({ stage: "diagnostic" });
    savedSession.diagnosticDraft = {
      ...savedSession.diagnosticDraft!,
      currentQuestionId: "diag-q2",
      processedQuestionIds: ["diag-q1"],
      answers: [{ questionId: "diag-q1", status: "answered", submittedAnswer: "[]" }],
    };
    const savedBootstrap = bootstrap(savedSession);
    savedBootstrap.diagnostic.questions = initialBootstrap.diagnostic.questions;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(initialBootstrap))
      .mockResolvedValueOnce(ok({ requestId: "answer-1", sessionId: "session-w4", sessionVersion: 3, profileRevision: 3, diagnosticId: "diagnostic-pandas-cleaning", questionId: "diag-q1", result: "pass", diagnosticDraftVersion: 2 }))
      .mockResolvedValueOnce(ok(savedBootstrap));
    const { host } = await renderRoute("/diagnostic/session-w4", fetchMock);

    const progress = () => host.querySelector<HTMLElement>(".progress-track");
    expect(progress()?.getAttribute("aria-label")).toBe("已保存诊断进度 0/2");
    expect(progress()?.querySelector("span")?.getAttribute("style")).toContain("width: 0%");

    await click(host.querySelector<HTMLInputElement>('input[type="radio"]')!);
    await click(button(host, "保存并继续"));

    expect(progress()?.getAttribute("aria-label")).toBe("已保存诊断进度 1/2");
    expect(progress()?.querySelector("span")?.getAttribute("style")).toContain("width: 50%");
    expect(host.textContent).toContain("第 2 题 / 共 2 题");
    expect(host.textContent).toContain("尚未保存");
  });

  it("renders all W4 path node fields", async () => {
    const session = recovery({ stage: "path" });
    const { host } = await renderRoute("/path/session-w4", vi.fn().mockResolvedValue(ok(bootstrap(session))));
    expect(host.textContent).toContain("基础回顾");
    expect(host.textContent).toContain("示例带练");
    expect(host.textContent).toContain("本次目标要求");
    expect(host.textContent).toContain("可以开始");
  });

  it("shows elapsed-time feedback while the learning path is being confirmed", async () => {
    const session = recovery({ stage: "path" });
    session.path = undefined;
    const candidate = {
      requestId: "candidate-1",
      sessionId: "session-w4",
      sessionVersion: 2,
      profileRevision: 3,
      status: "candidate" as const,
      pathId: "path-w4",
      pathVersion: 1,
      nodes: pathNodes,
      missingPrerequisiteIds: [],
      minimumRequiredMinutes: 12,
    };
    const pendingConfirm = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockImplementationOnce(() => pendingConfirm);
    const { host } = await renderRoute("/path/session-w4", fetchMock, { candidate });

    await click(button(host, "确认学习路径"));

    expect(button(host, "正在确认学习路径（已处理 0 秒）").disabled).toBe(true);
    expect(host.querySelector('.async-action-status[role="status"]')?.textContent)
      .toContain("正在确认学习路径（已处理 0 秒）");
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

  it("renders the learning card without an invented review timeline", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery()))).mockResolvedValueOnce(ok(nextStep));
    const { host } = await renderRoute("/learn/session-w4/node-basic", fetchMock);
    expect(host.textContent).toContain("Python 列表");
    expect(host.textContent).toContain("数据清洗实验手册");
    expect(host.textContent).toContain("使用安全基础内容");
    expect(host.textContent).toContain("客观题组");
    expect(host.textContent).not.toMatch(/\b(?:ready|mcq)\b/u);
    expect(host.textContent).not.toContain("NOT_PROVIDED");
    expect(host.textContent).not.toContain("UPSTREAM_CONTRACT_BLOCKED");
  });

  it("shows an immediate elapsed-time status while a quiz is being generated and audited", async () => {
    let resolveOpen: ((response: Response) => void) | undefined;
    const pendingOpen = new Promise<Response>((resolve) => { resolveOpen = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery())))
      .mockResolvedValueOnce(ok(nextStep))
      .mockImplementationOnce(() => pendingOpen);
    const { host, router } = await renderRoute("/learn/session-w4/node-basic", fetchMock);

    await click(button(host, "进入正式活动"));
    expect(button(host, "正在生成并审核题组（已处理 0 秒）").disabled).toBe(true);
    expect(host.querySelector('.async-action-status[role="status"]')?.textContent).toContain("正在生成并审核题组（已处理 0 秒）");

    await act(async () => { resolveOpen?.(ok(openedQuiz)); });
    await settle();
    expect(router.state.location.pathname).toBe("/activity/session-w4/act-basic");
  });

  it("keeps rich lesson bulk and individual disclosure controls in sync", async () => {
    const modules = (["intuition", "concepts", "walkthrough", "mistakes", "final-task", "terms-sources"] as const).map((moduleId, index) => ({
      moduleId,
      title: `模块${index + 1}`,
      summary: `模块${index + 1}摘要`,
      blocks: [{ blockId: `block-${index + 1}`, kind: "paragraph" as const, text: `模块${index + 1}正文` }],
    }));
    const richStep = {
      ...nextStep,
      card: {
        ...nextStep.card!,
        selectedLesson: {
          lessonId: "lesson-read-csv-guided",
          variantId: "guided" as const,
          label: "逐步讲解版",
          learningObjectives: { understand: ["理解读取流程"], master: ["掌握读取方法"] },
          modules,
          termNotes: [],
          sourceClaims: [],
          coveredRuleIds: ["rule-read-csv"],
        },
      },
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery()))).mockResolvedValueOnce(ok(richStep));
    const { host } = await renderRoute("/learn/session-w4/node-basic", fetchMock);
    const details = () => [...host.querySelectorAll<HTMLDetailsElement>(".lesson-module")];

    expect(details().map((item) => item.open)).toEqual([true, true, true, false, false, false]);
    await click(button(host, "全部收起"));
    expect(details().every((item) => !item.open)).toBe(true);
    expect(details().every((item) => item.querySelector("summary")?.getAttribute("aria-expanded") === "false")).toBe(true);

    await click(button(host, "展开全部"));
    expect(details().every((item) => item.open)).toBe(true);
    expect(details().every((item) => item.querySelector("summary")?.getAttribute("aria-expanded") === "true")).toBe(true);

    await click(details()[0]!.querySelector("summary")!);
    expect(details()[0]!.open).toBe(false);
    expect(details().slice(1).every((item) => item.open)).toBe(true);
    await click(button(host, "全部收起"));
    await click(button(host, "全部收起"));
    expect(details().every((item) => !item.open)).toBe(true);
  });

  it("does not send an incomplete learning step to summary", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery()))).mockResolvedValueOnce(ok({ ...nextStep, activity: undefined, completed: false }));
    const { host } = await renderRoute("/learn/session-w4/node-basic", fetchMock);
    expect(host.textContent).toContain("重新读取内容");
    expect(host.textContent).not.toContain("查看总结");
  });

  it("renders a four-question quiz without opening-stage answers", async () => {
    const { host } = await renderRoute("/activity/session-w4/act-basic", vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "activity" })))), { opened: openedQuiz, nodeId: "node-basic" });
    expect(host.querySelectorAll(".quiz-question")).toHaveLength(1);
    expect(host.textContent).not.toContain("正确答案：");
    expect(host.textContent).toContain("第 1 / 4 题");
    expect(host.textContent).toContain("0 题已作答");
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
    const prompts: Array<string | null> = [];
    for (let index = 0; index < 4; index += 1) {
      prompts.push(host.querySelector(".quiz-question h2")?.textContent ?? null);
      await click(host.querySelector(".quiz-question input")!);
      if (index < 3) await click(button(host, "下一题 →"));
    }
    expect(prompts).toEqual(["列表字面量？", "列表有顺序。", "追加方法？", "索引从0开始。"]);
    await click(button(host, "← 上一题"));
    expect(host.querySelector(".quiz-question h2")?.textContent).toBe("追加方法？");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/activities/act-basic/open");
  });

  it("stops activity recovery after two failures and keeps safe exits visible", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = { kind: "quiz", activityId: "act-basic", attemptId: "attempt-1", status: "draft", retryNumber: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(fail(503, "service_unavailable"))
      .mockResolvedValueOnce(fail(404, "activity_not_found"));
    const { host } = await renderRoute("/activity/session-w4/act-basic", fetchMock, { nodeId: "node-basic" });
    expect(host.textContent).toContain("服务连接暂时失败");
    expect(button(host, "再次尝试恢复")).toBeDefined();
    await click(button(host, "再次尝试恢复"));
    expect(host.textContent).toContain("原活动或作答记录不存在");
    expect(host.textContent).toContain("已达到本页恢复上限");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.includes("再次尝试恢复"))).toBe(false);
    expect(host.textContent).toContain("返回教学内容");
    expect(host.textContent).toContain("返回学习路径");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("advances a submitted refresh through Bootstrap and getNextStep without reopening the old Attempt", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = undefined;
    session.activityProgress = [{ nodeId: "node-basic", activities: [{ activityId: "act-basic", status: "completed", attemptIds: ["attempt-1"], result: "pass", quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" }] }];
    const following = { ...nextStep, activity: openedCode.kind === "code" ? openedCode.activity : undefined };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(bootstrap(session)))
      .mockResolvedValueOnce(ok(following))
      .mockResolvedValueOnce(ok(openedCode));
    const { host, router } = await renderRoute("/activity/session-w4/act-basic", fetchMock, { opened: openedQuiz, nodeId: "node-basic" });
    expect(host.textContent).toContain("已恢复服务端进度");
    expect(host.querySelectorAll(".quiz-question")).toHaveLength(0);
    await click(button(host, "继续下一步"));
    expect(router.state.location.pathname).toBe("/activity/session-w4/act-code");
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
    expect(host.textContent).toContain("已恢复服务端进度");
    expect(host.textContent).toContain("等待重做 / 证据不足");
    await click(button(host, "修改并重新评测"));
    expect(router.state.location.pathname).toBe("/activity/session-w4/act-basic");
    expect(host.textContent).toContain("attempt-2");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/activities/act-basic/open"))).toBe(true);
  });

  it("renders the approved Pyodide closed state without a preview control", async () => {
    const { host } = await renderRoute("/activity/session-w4/act-code", vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "activity" })))), { opened: openedCode });
    expect(host.textContent).toContain("PYODIDE_DISABLED_WITH_NODE_FALLBACK");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.includes("预览") || item.textContent?.includes("公开检查"))).toBe(false);
    expect(button(host, "提交正式评测").disabled).toBe(false);
  });

  it("renders a complete public code statement with downloadable CSV samples", async () => {
    if (openedCode.kind !== "code") throw new Error("code fixture expected");
    const detailed = {
      ...openedCode,
      activity: {
        ...openedCode.activity,
        problemStatement: {
          background: "公开任务背景",
          inputDescription: "输入一个公开订单 DataFrame。",
          outputDescription: "输出符合七列合同的新 DataFrame。",
          rules: ["保持七列顺序"],
          prohibitedActions: ["不得修改原始 df"],
          sample: {
            inputFileName: "sample-input.csv",
            inputCsv: "order_id,amount\nO001,88\n",
            outputFileName: "sample-output.csv",
            outputCsv: "order_id,amount\nO001,88\n",
            explanation: "本例保持公开字段。",
          },
        },
      },
    };
    const { host } = await renderRoute("/activity/session-w4/act-code", vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "activity" })))), { opened: detailed });
    expect(host.textContent).toContain("公开任务背景");
    expect(host.textContent).toContain("输入说明");
    expect(host.textContent).toContain("禁止事项");
    expect(host.textContent).toContain("样例解释");
    const downloads = [...host.querySelectorAll<HTMLAnchorElement>("a[download]")];
    expect(downloads.map((link) => link.download)).toEqual(["sample-input.csv", "sample-output.csv"]);
    expect(downloads.every((link) => link.href.startsWith("data:text/csv"))).toBe(true);
  });

  it("saves an edited code draft without calling the retained public run route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" })))).mockResolvedValueOnce(ok(savedCode));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await editTextarea(host.querySelector("textarea")!, "print('edited draft')");
    await click(button(host, "保存草稿"));
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("/api/activities/act-code/draft");
    expect(bodyAt(fetchMock, 1)).toMatchObject({ draftVersion: 1, userText: "print('edited draft')" });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/run"))).toBe(false);
  });

  it("restores sessionStorage text only after Bootstrap confirms the same Attempt and version", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = { kind: "code", activityId: "act-code", attemptId: "attempt-code-1", status: "draft", draftVersion: 2 };
    writeActivityDraft(sessionStorage, { sessionId: "session-w4", activityId: "act-code", attemptId: "attempt-code-1", profileRevision: 3, draftVersion: 2 }, "print('browser recovery')");
    const recovered = { sessionId: "session-w4", sessionVersion: 4, profileRevision: 3, attempt: session.currentAttempt, draftVersion: 2, userText: "print('server recovery')", recoveryAction: "resume_draft" };
    const codeNext = { ...nextStep, activity: openedCode.kind === "code" ? openedCode.activity : undefined };
    const opened = { ...savedCode, userText: "print('server recovery')" };
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(session))).mockResolvedValueOnce(ok(codeNext)).mockResolvedValueOnce(ok(recovered)).mockResolvedValueOnce(ok(opened));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("print('browser recovery')");
  });

  it("clears the browser draft only after a committed formal code result", async () => {
    writeActivityDraft(sessionStorage, { sessionId: "session-w4", activityId: "act-code", attemptId: "attempt-code-1", profileRevision: 3, draftVersion: 1 }, openedCode.kind === "code" ? openedCode.userText : "");
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" })))).mockResolvedValueOnce(ok(codeSubmission)).mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "learning" }))));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await click(button(host, "提交正式评测"));
    expect(sessionStorage.length).toBe(0);
    expect(useUiStore.getState().activityDrafts["attempt-code-1"]).toBeUndefined();
  });

  it("renders the frozen generic evaluator failure as actionable Chinese feedback", async () => {
    const failedSubmission = {
      ...codeSubmission,
      committed: true,
      evidenceId: "evidence-code-failed",
      result: {
        ...codeSubmission.result,
        verdict: "partial" as const,
        errorCode: "test_failed",
        score: 0.5,
        safeFeedback: "One or more deterministic checks did not pass.",
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(failedSubmission))
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await click(button(host, "提交正式评测"));
    expect(host.textContent).toContain("公开验收项尚未全部通过");
    expect(host.textContent).toContain("修改后重新提交");
    expect(host.textContent).not.toContain("One or more deterministic checks did not pass.");
  });

  it("renders safe diagnostic knowledge state projection without converting null mastery to zero", async () => {
    const state = {
      evidenceVersion: 7,
      capabilityProfileRevision: 4,
      knowledgeStates: [{
        knowledgePointId: "basic-python", profileRevision: 3, evidenceVersion: 7,
        aggregationVersion: "knowledge-state-v1" as const, mastery: null, confidence: 0,
        status: "unverified" as const, validEvidenceCount: 0, evidenceFormCount: 0,
        evidenceIds: [], consideredEvidenceIds: [], asOf: "2026-08-20T00:00:00.000Z",
        skipEligible: false, lastUpdatedAt: "2026-08-20T00:00:00.000Z",
      }],
    };
    const { host } = await renderRoute("/path/session-w4", vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "path" })))), state);
    expect(host.textContent).toContain("能力画像修订4");
    expect(host.textContent).toContain("Python基础准备未验证 · 尚未验证");
    expect(host.textContent).not.toContain("Python基础准备0.00");
  });

  it("keeps local text after a draft version conflict without opening the closed preview path", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(fail(409, "draft_version_conflict"))
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))));
    const { host } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: openedCode });
    await editTextarea(host.querySelector("textarea")!, "print('unsaved local')");
    await click(button(host, "保存草稿"));
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
    expect(host.textContent).toContain("评测服务超时");
    await click(button(host, "恢复草稿并重试评测"));
    expect(host.textContent).toContain("通过");
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
    await click(button(host, "恢复草稿并重试评测"));
    expect(host.textContent).toContain("评测服务超时");
    expect(button(host, "恢复草稿并重试评测").disabled).toBe(false);
    expect(bodyAt(fetchMock, 5)).toMatchObject({ attemptId: "attempt-code-1", draftVersion: 1 });
  });

  it.each([
    ["changed", replan()],
    ["unchanged", replan({ changed: false, changeReasons: [] })],
    ["fallback", replan({ changed: false, fallbackToPrevious: true, changeReasons: ["candidate_infeasible"] })],
  ])("renders %s replan output and server changeReasons", async (_case, output) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "path" })))).mockResolvedValueOnce(ok(output));
    const { host } = await renderRoute("/path/session-w4", fetchMock, { evidenceVersion: 7 });
    await click(button(host, "按最新诊断重算"));
    expect(host.textContent).toContain(output.changed ? "路径变化是" : "路径变化否");
    expect(host.textContent).toContain(output.fallbackToPrevious ? "沿用旧路径是" : "沿用旧路径否");
    expect(bodyAt(fetchMock, 1)).toMatchObject({ evidenceVersion: 7, pathVersion: 1, trigger: "user_constraint_changed" });
    for (const reason of output.changeReasons) expect(host.textContent).toContain(reason);
  });

  it("shows replan conflicts and disables replan after a refresh without evidenceVersion", async () => {
    const conflictFetch = vi.fn().mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "path" })))).mockResolvedValueOnce(fail(409, "path_version_conflict"));
    const first = await renderRoute("/path/session-w4", conflictFetch, { evidenceVersion: 7 });
    await click(button(first.host, "按最新诊断重算"));
    expect(first.host.textContent).toContain("path_version_conflict");
    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    const refreshed = await renderRoute("/path/session-w4", vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "path" })))));
    expect(button(refreshed.host, "按最新诊断重算").disabled).toBe(true);
  });

  it("distinguishes learner-selected diagnostic skips from learned mastery in the summary", async () => {
    const session = recovery({ stage: "activity" });
    session.path = {
      pathId: "path-w4", pathVersion: 1, status: "active",
      nodes: [
        {
          ...pathNodes[0]!, nodeId: "node-read", knowledgePointId: "pandas.clean.read-csv",
          activityIds: ["act-read"], status: "skipped", required: false, positionLocked: false,
          reasonCodes: ["diagnostic_skip_selected"],
        },
        {
          ...pathNodes[0]!, nodeId: "node-validate", knowledgePointId: "pandas.clean.validate-result",
          activityIds: ["act-practical"], status: "completed", positionLocked: false,
          reasonCodes: ["goal_required", "diagnostic_skip_selected"],
        },
      ],
    };
    const completed = { requestId: "complete-skip", sessionId: "session-w4", sessionVersion: 3, profileRevision: 3, completedAt: "2026-08-25T00:00:00.000Z", summary: "Session completed." };
    const { host } = await renderRoute("/summary/session-w4", vi.fn().mockResolvedValueOnce(ok(bootstrap(session))).mockResolvedValueOnce(ok(completed)));

    expect(host.querySelector('[data-section="diagnostic-skips"]')?.textContent).toContain("主动跳过的章节");
    expect(host.textContent).toContain("读取CSV数据");
    expect(host.textContent).toContain("已跳过章节教学和普通练习");
    expect(host.textContent).toContain("已跳过章节教学；最终综合实操仍保留");
    expect(host.textContent).toContain("不等于经过本轮教学后再次掌握");
  });

  it("renders fail, partial, insufficient and unverified from safe progress facts", async () => {
    const session = recovery({ stage: "activity" });
    session.activityProgress = [{ nodeId: "node-basic", activities: [
      { activityId: "act-fail", status: "completed", attemptIds: ["a1"], result: "fail", quizRetryCount: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      { activityId: "act-partial", status: "completed", attemptIds: ["a2"], result: "partial", quizRetryCount: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      { activityId: "act-insufficient", status: "insufficient", attemptIds: ["a3"], result: "insufficient", continuedWithGap: true, quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" },
      { activityId: "act-pending", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" },
    ] }];
    const completed = { requestId: "complete", sessionId: "session-w4", sessionVersion: 3, profileRevision: 3, completedAt: "2026-08-16T00:00:00.000Z", summary: "Session completed.", nextRecommendation: "Review." };
    const { host } = await renderRoute("/summary/session-w4", vi.fn().mockResolvedValueOnce(ok(bootstrap(session))).mockResolvedValueOnce(ok(completed)));
    for (const expected of ["未通过 · 作答 1 次", "部分完成 · 作答 1 次", "尚未验证 · 作答 0 次"]) expect(host.textContent).toContain(expected);
    expect(host.textContent).toContain("暂时跳过 / 未掌握 · 作答 1 次");
    expect(host.textContent).toContain("返回主菜单");
  });

  it("shows completed-session recovery without replaying a frozen historical summary", async () => {
    const session = recovery({ stage: "completed", status: "completed" });
    session.activityProgress = [{ nodeId: "node-basic", activities: [{ activityId: "act-pending", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z" }] }];
    const fetchMock = vi.fn().mockResolvedValue(ok(bootstrap(session)));
    const { host } = await renderRoute("/summary/session-w4", fetchMock);
    expect(host.textContent).toContain("COMPLETED_SUMMARY_NOT_REPLAYABLE");
    expect(host.textContent).toContain("尚未验证 · 作答 0 次");
    expect(host.textContent).toContain("返回主菜单");
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
    for (let index = 0; index < 4; index += 1) {
      await click(host.querySelector(".quiz-question input")!);
      if (index < 3) await click(button(host, "下一题 →"));
    }
    await click(button(host, "提交完整题组"));
    expect(host.textContent).toContain("提交后安全复盘");
    expect(host.textContent).toContain("原题列表字面量？");
    const reviewText = host.querySelector(".answer-review")?.textContent ?? "";
    expect(reviewText.indexOf("列表字面量？")).toBeLessThan(reviewText.indexOf("正确答案："));
    await click(button(host, "使用新题组重试"));
    expect(host.textContent).toContain("attempt-2");
    expect(String(fetchMock.mock.calls[5]?.[0])).toBe("/api/activities/act-basic/open");
  });

  it("keeps the new-quiz retry disabled with an elapsed-time status while Agent review is pending", async () => {
    let resolveRetry: ((response: Response) => void) | undefined;
    const pendingRetry = new Promise<Response>((resolve) => { resolveRetry = resolve; });
    const afterSubmit = recovery({ stage: "activity", sessionVersion: 4 });
    afterSubmit.sessionVersion = 4;
    const retryQuiz = openedQuiz.kind === "quiz" ? { ...openedQuiz, attemptId: "attempt-2", sessionVersion: 5, activity: { ...openedQuiz.activity, retryNumber: 1 as const } } : openedQuiz;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(quizSubmission))
      .mockResolvedValueOnce(ok(bootstrap(afterSubmit)))
      .mockResolvedValueOnce(ok(bootstrap(afterSubmit)))
      .mockResolvedValueOnce(ok(nextStep))
      .mockImplementationOnce(() => pendingRetry);
    const { host } = await renderRoute("/activity/session-w4/act-basic", fetchMock, { opened: openedQuiz, nodeId: "node-basic" });
    for (let index = 0; index < 4; index += 1) {
      await click(host.querySelector(".quiz-question input")!);
      if (index < 3) await click(button(host, "下一题 →"));
    }
    await click(button(host, "提交完整题组"));
    await click(button(host, "使用新题组重试"));

    expect(button(host, "正在生成并审核新题组（已处理 0 秒）").disabled).toBe(true);
    expect(host.querySelector('.async-action-status[role="status"]')?.textContent).toContain("正在生成并审核新题组（已处理 0 秒）");
    await act(async () => { resolveRetry?.(ok(retryQuiz)); });
    await settle();
    expect(host.textContent).toContain("attempt-2");
  });

  it("offers retry or explicit gap continuation after the second unresolved quiz", async () => {
    const retryQuiz = openedQuiz.kind === "quiz" ? {
      ...openedQuiz,
      attemptId: "attempt-2",
      sessionVersion: 6,
      activity: { ...openedQuiz.activity, retryNumber: 1 },
    } : openedQuiz;
    const secondResult = {
      ...quizSubmission,
      attemptId: "attempt-2",
      sessionVersion: 7,
      result: { ...quizSubmission.result, verdict: "fail" as const, correctCount: 0, retryAllowed: true },
    };
    const afterSecond = recovery({ stage: "activity", sessionVersion: 7 });
    afterSecond.sessionVersion = 7;
    const continued = { requestId: "gap", sessionId: "session-w4", sessionVersion: 8, profileRevision: 3, activityId: "act-basic", status: "insufficient", result: "fail", attemptCount: 2 };
    const afterContinue = recovery({ stage: "learning", sessionVersion: 8, pathVersion: 2 });
    afterContinue.sessionVersion = 8;
    afterContinue.path = { ...afterContinue.path!, pathVersion: 2 };
    const nextChapter = {
      ...nextStep,
      sessionVersion: 8,
      pathVersion: 2,
      node: { ...nextStep.node!, nodeId: "node-next" },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(secondResult))
      .mockResolvedValueOnce(ok(bootstrap(afterSecond)))
      .mockResolvedValueOnce(ok(bootstrap(afterSecond)))
      .mockResolvedValueOnce(ok(continued))
      .mockResolvedValueOnce(ok(bootstrap(afterContinue)))
      .mockResolvedValueOnce(ok(nextChapter));
    const { host, router } = await renderRoute("/activity/session-w4/act-basic", fetchMock, { opened: retryQuiz, nodeId: "node-basic" });
    for (let index = 0; index < 4; index += 1) {
      await click(host.querySelector(".quiz-question input")!);
      if (index < 3) await click(button(host, "下一题 →"));
    }
    await click(button(host, "提交完整题组"));
    expect(button(host, "使用新题组重试")).toBeDefined();
    expect(button(host, "暂时跳过，进入下一章节")).toBeDefined();
    await click(button(host, "暂时跳过，进入下一章节"));
    expect(String(fetchMock.mock.calls[4]?.[0])).toBe("/api/activities/act-basic/continue-with-gap");
    expect(bodyAt(fetchMock, 4)).toMatchObject({ sessionVersion: 7, attemptId: "attempt-2" });
    expect(String(fetchMock.mock.calls[5]?.[0])).toBe("/api/bootstrap?recoverSessionId=session-w4");
    expect(String(fetchMock.mock.calls[6]?.[0])).toContain("sessionVersion=8");
    expect(String(fetchMock.mock.calls[6]?.[0])).toContain("pathVersion=2");
    expect(router.state.location.pathname).toBe("/learn/session-w4/node-next");
  });

  it("offers code editing or gap continuation after the second failed code Attempt", async () => {
    const retryCode = openedCode.kind === "code" ? { ...openedCode, attemptId: "attempt-code-2", sessionVersion: 6, draftVersion: 1 } : openedCode;
    const secondFailure = {
      ...codeSubmission,
      attemptId: "attempt-code-2",
      sessionVersion: 7,
      result: {
        ...codeSubmission.result,
        verdict: "fail" as const,
        score: 0,
        errorCode: "test_failed",
        safeFeedback: "One or more deterministic checks did not pass.",
      },
    };
    const initial = recovery({ stage: "activity", sessionVersion: 6 });
    initial.sessionVersion = 6;
    const afterSecond = recovery({ stage: "activity", sessionVersion: 7 });
    afterSecond.sessionVersion = 7;
    afterSecond.activityProgress = [{ nodeId: "node-basic", activities: [{
      activityId: "act-code", status: "in_progress", attemptIds: ["attempt-code-1", "attempt-code-2"],
      result: "fail", quizRetryCount: 0, updatedAt: "2026-08-16T00:00:00.000Z",
    }] }];
    const continued = { requestId: "gap", sessionId: "session-w4", sessionVersion: 8, profileRevision: 3, activityId: "act-code", status: "insufficient", result: "fail", attemptCount: 2 };
    const afterContinue = recovery({ stage: "learning", sessionVersion: 8 });
    afterContinue.sessionVersion = 8;
    const nextChapter = { ...nextStep, sessionVersion: 8, node: { ...nextStep.node!, nodeId: "node-next" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(initial)))
      .mockResolvedValueOnce(ok(secondFailure))
      .mockResolvedValueOnce(ok(bootstrap(afterSecond)))
      .mockResolvedValueOnce(ok(bootstrap(afterSecond)))
      .mockResolvedValueOnce(ok(continued))
      .mockResolvedValueOnce(ok(bootstrap(afterContinue)))
      .mockResolvedValueOnce(ok(nextChapter));
    const { host, router } = await renderRoute("/activity/session-w4/act-code", fetchMock, { opened: retryCode, nodeId: "node-basic" });

    await click(button(host, "提交正式评测"));
    expect(button(host, "修改代码后重试")).toBeDefined();
    expect(button(host, "放弃并进入下一环节")).toBeDefined();
    await click(button(host, "放弃并进入下一环节"));
    expect(String(fetchMock.mock.calls[4]?.[0])).toBe("/api/activities/act-code/continue-with-gap");
    expect(bodyAt(fetchMock, 4)).toMatchObject({ sessionVersion: 7, attemptId: "attempt-code-2" });
    expect(router.state.location.pathname).toBe("/learn/session-w4/node-next");
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
