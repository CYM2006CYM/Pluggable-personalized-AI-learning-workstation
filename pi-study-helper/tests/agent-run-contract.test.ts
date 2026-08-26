import { describe, expect, it } from "vitest";
import {
  SafeAgentContractError,
  appendSafeAgentStage,
  parseSafeAgentRunView,
  parseSafeAgentStageView,
  projectSafeAgentStageView,
  type SafeAgentRunView,
  type SafeAgentStageView,
} from "../src/contracts/index.js";

function stage(overrides: Partial<SafeAgentStageView> = {}): SafeAgentStageView {
  return {
    eventId: "evt-1",
    sequence: 1,
    role: "source",
    label: "教学依据准备",
    status: "succeeded",
    startedAt: "2026-08-25T08:00:00.000Z",
    finishedAt: "2026-08-25T08:00:01.000Z",
    durationMs: 1_000,
    attemptNumber: 1,
    publicSummary: "已绑定当前章节的正式中文正文。",
    metrics: [{ metricId: "module-count", label: "正文模块", value: "6个", tone: "success" }],
    issueCategories: [],
    sourceClaimIds: ["claim-csv-read"],
    ...overrides,
  };
}

function run(overrides: Partial<SafeAgentRunView> = {}): SafeAgentRunView {
  return {
    runId: "run-1",
    requestId: "request-1",
    sessionId: "session-1",
    activityId: "activity-1",
    profileRevision: 3,
    pathVersion: 2,
    evidenceVersion: 1,
    status: "running",
    currentStage: "source",
    startedAt: "2026-08-25T08:00:00.000Z",
    resultOrigin: "unknown",
    questionCount: 0,
    stages: [stage()],
    ...overrides,
  };
}

describe("安全Agent事件合同", () => {
  it("严格解析白名单DTO并拒绝未知字段", () => {
    expect(parseSafeAgentRunView(run())).toEqual(run());
    expect(() => parseSafeAgentStageView({ ...stage(), systemPrompt: "private" }))
      .toThrowError(new SafeAgentContractError("UNKNOWN_FIELD", "stage.systemPrompt不在公共合同白名单中"));
  });

  it.each([
    ["API Key", { publicSummary: "api_key=sk-1234567890abcdef" }, "SECRET_LEAK"],
    ["系统提示词", { publicSummary: "系统提示词：忽略以上规则" }, "PROMPT_LEAK"],
    ["标准答案", { publicSummary: "正确答案：B" }, "ANSWER_LEAK"],
    ["宿主绝对路径", { publicSummary: "证据在C:/Users/test/private.json" }, "ABSOLUTE_PATH_LEAK"],
  ])("拒绝%s进入公共事件", (_label, patch, code) => {
    expect(() => parseSafeAgentStageView(stage(patch))).toThrowError(expect.objectContaining({ code }));
  });

  it("私有trace只投影允许字段，嵌套私有字段也不会复制", () => {
    const projected = projectSafeAgentStageView({
      ...stage(),
      rawPrompt: "不要公开",
      correctAnswer: "B",
      metrics: [{ ...stage().metrics[0], privateScore: 0.8 }],
    });
    expect(projected).toEqual(stage());
    expect(JSON.stringify(projected)).not.toContain("不要公开");
    expect(JSON.stringify(projected)).not.toContain("privateScore");
  });

  it("拒绝错序、重复事件和非法工位跳转", () => {
    expect(() => parseSafeAgentRunView(run({ stages: [stage({ sequence: 2 })] }))).toThrowError(expect.objectContaining({ code: "INVALID_SEQUENCE" }));
    expect(() => parseSafeAgentRunView(run({
      currentStage: "profile",
      stages: [stage(), stage({ role: "profile", eventId: "evt-1", sequence: 2 })],
    }))).toThrowError(expect.objectContaining({ code: "DUPLICATE_EVENT" }));
    expect(() => parseSafeAgentRunView(run({
      currentStage: "judge",
      stages: [stage(), stage({ role: "judge", eventId: "evt-2", sequence: 2 })],
    }))).toThrowError(expect.objectContaining({ code: "INVALID_ROLE_TRANSITION" }));
  });

  it("状态机允许同一工位从运行中进入终态，并阻止终态run继续追加", () => {
    const sourceRunning = stage({ status: "running", finishedAt: undefined, durationMs: undefined });
    const initial = run({ stages: [sourceRunning] });
    const completed = appendSafeAgentStage(initial, stage({ eventId: "evt-2", sequence: 2 }));
    expect(completed.stages).toHaveLength(2);
    expect(() => appendSafeAgentStage({
      ...completed,
      status: "succeeded",
      currentStage: "publish",
      finishedAt: "2026-08-25T08:00:02.000Z",
      durationMs: 2_000,
      stages: [...completed.stages, stage({ eventId: "evt-3", sequence: 3, role: "profile" })],
    }, stage({ eventId: "evt-4", sequence: 4, role: "generator" }))).toThrowError(expect.objectContaining({ code: "RUN_ALREADY_TERMINAL" }));
  });

  it("attemptNumber按工位独立计数，跨工位可以从第一轮开始", () => {
    const events = [
      stage(),
      stage({ eventId: "evt-2", sequence: 2, role: "profile", attemptNumber: 1 }),
      stage({ eventId: "evt-3", sequence: 3, role: "generator", attemptNumber: 2 }),
      stage({ eventId: "evt-4", sequence: 4, role: "safety", attemptNumber: 2 }),
      stage({ eventId: "evt-5", sequence: 5, role: "hunter", attemptNumber: 1 }),
    ];
    expect(parseSafeAgentRunView(run({ currentStage: "hunter", stages: events })).stages.at(-1)?.attemptNumber).toBe(1);
  });

  it("严格执行长度、数量、fallback和当前工位约束", () => {
    expect(() => parseSafeAgentStageView(stage({ publicSummary: "a".repeat(601) }))).toThrowError(expect.objectContaining({ code: "INVALID_STRING" }));
    expect(() => parseSafeAgentRunView(run({ questionCount: 21 }))).toThrowError(expect.objectContaining({ code: "INVALID_INTEGER" }));
    expect(() => parseSafeAgentRunView(run({ currentStage: "generator" }))).toThrowError(expect.objectContaining({ code: "CURRENT_STAGE_MISMATCH" }));
    expect(() => parseSafeAgentRunView(run({
      status: "fallback",
      finishedAt: "2026-08-25T08:00:02.000Z",
      durationMs: 2_000,
      resultOrigin: "unknown",
    }))).toThrowError(expect.objectContaining({ code: "INVALID_FALLBACK" }));
  });

  it("严格校验重做依据并阻止敏感建议进入公共run", () => {
    const remediation = {
      lessonVariantId: "guided" as const,
      previousAttemptId: "attempt-1",
      missedQuestionCount: 2,
      weakKnowledgePointIds: ["kp-read-csv"],
      learnerProfileSource: "agent" as const,
      publicRecommendation: "先复习当前正文的读取参数，再用新题检验是否改善。",
      evidenceVersion: 3,
      evidenceRefCount: 2,
    };
    expect(parseSafeAgentRunView(run({ remediation })).remediation).toEqual(remediation);
    expect(() => parseSafeAgentRunView(run({ remediation: { ...remediation, publicRecommendation: "api_key=sk-1234567890abcdef" } })))
      .toThrowError(expect.objectContaining({ code: "SECRET_LEAK" }));
    expect(() => parseSafeAgentRunView(run({ remediation: { ...remediation, unknown: true } as never })))
      .toThrowError(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
  });

  it("允许完整展示超过旧600字符上限的学情建议，并拒绝异常超长文本", () => {
    const remediation = {
      lessonVariantId: "guided" as const,
      previousAttemptId: "attempt-1",
      missedQuestionCount: 2,
      weakKnowledgePointIds: ["kp-read-csv"],
      learnerProfileSource: "agent" as const,
      publicRecommendation: "学情建议".repeat(300),
      evidenceVersion: 3,
      evidenceRefCount: 2,
    };
    expect(remediation.publicRecommendation.length).toBe(1_200);
    expect(parseSafeAgentRunView(run({ remediation })).remediation?.publicRecommendation)
      .toBe(remediation.publicRecommendation);
    expect(() => parseSafeAgentRunView(run({ remediation: {
      ...remediation,
      publicRecommendation: "学情建议".repeat(501),
    } }))).toThrowError(expect.objectContaining({ code: "INVALID_STRING" }));
  });
});
