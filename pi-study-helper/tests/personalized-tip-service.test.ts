import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PersonalizedTipService } from "../src/application/personalized-tip-service.js";
import type { AdaptiveContentPort, LearningCardSafeView } from "../src/contracts/index.js";
import { InMemoryAgentRunRepository } from "../src/infrastructure/agent-run-repository.js";

const fixedCard: LearningCardSafeView = {
  cardId: "fixed-card-read",
  knowledgePointId: "pandas.clean.read-csv",
  title: "读取 CSV",
  objective: "掌握可靠读取流程。",
  explanation: ["先读取，再检查。"],
  example: "df = pd.read_csv(path)",
  commonMistake: "把读取成功当作清洗完成。",
  sourceAnchorIds: ["src-pandas-read-csv"],
  estimatedMinutes: 8,
  selectedLesson: {
    variantId: "guided",
    label: "逐步讲解",
    learningObjectives: { understand: ["读取边界"], master: ["检查输入"] },
    modules: [],
    termNotes: [],
    canonicalRules: [],
    sourceClaims: [],
    coveredRuleIds: [],
  },
  personalizedTipStatus: { state: "unavailable", reasonCode: "not_generated" },
};

const dynamicCard: LearningCardSafeView = {
  ...fixedCard,
  cardId: "dynamic-tip-read",
  selectedLesson: undefined,
  objective: "这是数据清洗链的起点，先确认路径、编码和列名。",
  explanation: [
    "这是第一节，先建立可靠输入。",
    "结合你的进度，抓住读取、确认对象、保留异常这条主线。",
    "下一节会检查列名和数据类型。",
  ],
  example: "面对一份刚读入的表格，为什么仅仅能够打开文件，还不足以证明数据可以直接用于后续清洗？",
  commonMistake: "重点区分读取与清洗，每一步都确认自己是否修改了原始值。",
};

function sha(value: object): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function fixture(content: AdaptiveContentPort, boundCard: LearningCardSafeView = fixedCard) {
  const bindings = [{ nodeId: "node-read", source: "fixed" as const, card: structuredClone(boundCard) }];
  const snapshot = {
    sessionId: "session-tip",
    sessionVersion: 4,
    profileRevision: 3,
    view: { sessionId: "session-tip", sessionVersion: 4, profileRevision: 3, subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 400, status: "active", stage: "learning", diagnosticRequired: true, pathVersion: 1 },
    evidence: [],
    knowledgeStates: [],
    latestCommit: { evidenceVersion: 2, sessionVersion: 4, pathVersion: 1 },
    activityProgress: [{ nodeId: "node-read", card: { cardId: fixedCard.cardId, status: "pending" }, activities: [] }],
    diagnosticDraftVersion: 1,
    diagnosticDraft: { diagnosticDraftVersion: 1, background: { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" }, processedQuestionIds: [] },
  };
  const commit = vi.fn(async (input: { candidate: { boundLearningCards?: typeof bindings } }) => ({
    ...snapshot,
    sessionVersion: 5,
    view: { ...snapshot.view, sessionVersion: 5 },
    latestCommit: { ...snapshot.latestCommit, sessionVersion: 5 },
    committed: true as const,
    replayed: false,
    boundLearningCards: input.candidate.boundLearningCards,
  }));
  const sessions = {
    getSnapshot: vi.fn(async () => structuredClone(snapshot)),
    getInternalPathSnapshot: vi.fn(async () => ({ pathId: "path-1", pathVersion: 1, status: "active", sessionId: "session-tip", profileRevision: 3, evidenceVersion: 2, goalId: "goal-clean-orders", mode: "recommended", createdAt: "2026-08-26T00:00:00.000Z", nodes: [{ nodeId: "node-read", knowledgePointId: "pandas.clean.read-csv", activityIds: ["act-read"], status: "available", estimatedMinutes: 8, reasonCodes: [], difficulty: "M-U", scaffold: "hint", required: true, positionLocked: false }] })),
    getBoundLearningCards: vi.fn(async () => structuredClone(bindings)),
    commit,
  };
  const agentRuns = new InMemoryAgentRunRepository(() => new Date("2026-08-26T00:00:00.000Z"));
  const service = new PersonalizedTipService({ sessions: sessions as never, content, agentRuns, now: () => new Date("2026-08-26T00:00:01.000Z") });
  return { service, sessions, commit, agentRuns };
}

const input = {
  requestId: "tip-request-1",
  sessionId: "session-tip",
  sessionVersion: 4,
  profileRevision: 3,
  pathVersion: 1,
  nodeId: "node-read",
};

describe("PersonalizedTipService", () => {
  it("persists an Agent-reviewed tip into the versioned Session snapshot", async () => {
    const content: AdaptiveContentPort = {
      async prepareCard(request) {
        expect(request.agentRunId).toBeDefined();
        expect(request.personalizationContext).toEqual({
          knowledgeStatus: "unverified",
          mastery: null,
          confidence: 0,
          validEvidenceCount: 0,
          evidenceFormCount: 0,
          explanationPreference: "step_by_step",
          journey: {
            currentPosition: 1,
            totalLessons: 1,
            lessons: [{
              knowledgePointId: "pandas.clean.read-csv",
              title: "读取 CSV",
              objective: "掌握可靠读取流程。",
            }],
          },
        });
        return { status: "accepted", card: dynamicCard, origin: "live_model", reviewBinding: { generationRunId: "generation-card", acceptedCardSha256: sha(dynamicCard) } };
      },
      async prepareQuiz() { return { status: "unavailable" }; },
    };
    const { service, commit, agentRuns } = fixture(content);
    const output = await service.prepare(input);

    expect(output.status).toBe("generated");
    expect(output.sessionVersion).toBe(5);
    expect(output.card.personalizedTip?.text).toContain("结合你的进度");
    expect(output.card.personalizedTip).toMatchObject({
      lessonVariantId: "guided",
      lessonVariantLabel: "逐步讲解",
      lessonOverview: "这是数据清洗链的起点，先确认路径、编码和列名。",
      priorConnection: "这是第一节，先建立可靠输入。",
      learningFocus: expect.stringContaining("抓住读取、确认对象、保留异常这条主线"),
      nextConnection: "下一节会检查列名和数据类型。",
      studyAdvice: expect.stringContaining("重点区分读取与清洗"),
      guidingQuestion: expect.stringContaining("为什么仅仅能够打开文件"),
    });
    expect(output.card.personalizedTipAgentRunId).toMatch(/^agent-[a-f0-9]{32}$/u);
    expect(output.agentRunId).toBe(output.card.personalizedTipAgentRunId);
    expect(commit).toHaveBeenCalledOnce();
    const run = await agentRuns.getByRequestId(input.requestId);
    expect(run).toMatchObject({ status: "succeeded", resultOrigin: "ai_live", questionCount: 0 });
    expect(run?.stages.map((stage) => stage.role)).toContain("publish");
  });

  it("keeps the fixed lesson available when no reviewed tip is formed", async () => {
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz() { return { status: "unavailable" }; },
    };
    const { service, commit, agentRuns } = fixture(content);
    const output = await service.prepare(input);

    expect(output.status).toBe("unavailable");
    expect(output.card.selectedLesson).toBeDefined();
    expect(output.card.personalizedTip).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
    expect(await agentRuns.getByRequestId(input.requestId)).toMatchObject({ status: "fallback", resultOrigin: "profile_fixed" });
  });

  it("upgrades a legacy one-paragraph tip instead of treating it as the final guide", async () => {
    const legacyCard: LearningCardSafeView = {
      ...fixedCard,
      personalizedTip: { text: "旧版单段提醒。", sourceAnchorIds: ["src-pandas-read-csv"] },
      personalizedTipStatus: { state: "generated", reasonCode: "agent_reviewed" },
    };
    const content: AdaptiveContentPort = {
      async prepareCard() {
        return { status: "accepted", card: dynamicCard, origin: "live_model", reviewBinding: { generationRunId: "generation-upgrade", acceptedCardSha256: sha(dynamicCard) } };
      },
      async prepareQuiz() { return { status: "unavailable" }; },
    };
    const { service, commit } = fixture(content, legacyCard);
    const output = await service.prepare(input);

    expect(output.status).toBe("generated");
    expect(output.card.personalizedTip?.lessonOverview).toContain("数据清洗链的起点");
    expect(output.card.personalizedTip?.text).not.toBe("旧版单段提醒。");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("regenerates a structured legacy guide whose question depends on unseen sample details", async () => {
    const contextDependentCard: LearningCardSafeView = {
      ...fixedCard,
      personalizedTip: {
        text: "旧导学。列数恰好是 7，为什么还不能说明列名和列序已经合格？",
        lessonOverview: "先检查表格结构。",
        priorConnection: "上一节完成了读取。",
        learningFocus: "检查结构、类型和缺失。",
        nextConnection: "下一节处理缺失值。",
        studyAdvice: "先理解每项检查回答什么问题。",
        guidingQuestion: "列数恰好是 7，为什么还不能说明列名和列序已经合格？",
        sourceAnchorIds: ["src-pandas-read-csv"],
      },
      personalizedTipStatus: { state: "generated", reasonCode: "agent_reviewed" },
    };
    const content: AdaptiveContentPort = {
      async prepareCard() {
        return { status: "accepted", card: dynamicCard, origin: "live_model", reviewBinding: { generationRunId: "generation-self-contained", acceptedCardSha256: sha(dynamicCard) } };
      },
      async prepareQuiz() { return { status: "unavailable" }; },
    };
    const { service, commit } = fixture(content, contextDependentCard);
    const output = await service.prepare(input);

    expect(output.status).toBe("generated");
    expect(output.card.personalizedTip?.guidingQuestion).toContain("为什么仅仅能够打开文件");
    expect(commit).toHaveBeenCalledOnce();
  });
});
