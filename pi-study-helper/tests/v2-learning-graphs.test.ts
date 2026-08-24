import { describe, expect, it } from "vitest";
import { createStudyReviewGraphs, type ReviewSafeContext } from "../src/graphs/v2-learning-graphs.js";

const context = {
  activity: {
    activityId: "activity-1",
    activityVersion: 1,
    kind: "code_completion",
    title: "Clean orders",
    primaryKnowledgePointId: "kp-1",
    supportingKnowledgePointIds: ["kp-2"],
  },
  safeFeedback: "Safe feedback.",
  sourceIds: ["source-public-1"],
  sourceSummary: "Only public sources.",
} as const;

describe("v2 review graphs", () => {
  it("validate the four role schemas and their allowed verdicts", () => {
    const graphs = createStudyReviewGraphs();

    expect(graphs.generator.validateInput({
      context,
      allowedSourcesSummary: "Only public sources.",
    })).toBe(true);
    expect(graphs.hunter.validateInput({
      context,
      generator: {
        artifactId: "artifact-1",
        candidateFeedback: "Feedback",
        rationale: "Reason",
        citedSourceIds: ["source-public-1"],
        riskFlags: [],
      },
    })).toBe(true);
    expect(graphs.defender.validateInput({
      context,
      generator: {
        artifactId: "artifact-1",
        candidateFeedback: "Feedback",
        rationale: "Reason",
        citedSourceIds: ["source-public-1"],
        riskFlags: [],
      },
      hunter: {
        issues: [],
        requiresDefender: false,
        recommendedVerdict: "accepted",
      },
    })).toBe(true);
    expect(graphs.judge.validateInput({
      context,
      generator: {
        artifactId: "artifact-1",
        candidateFeedback: "Feedback",
        rationale: "Reason",
        citedSourceIds: ["source-public-1"],
        riskFlags: [],
      },
      hunter: {
        issues: [],
        requiresDefender: false,
        recommendedVerdict: "accepted",
      },
    })).toBe(true);

    expect(graphs.judge.validateOutput({
      verdict: "accepted",
      finalSafeFeedback: "Approved.",
      summary: "Accepted.",
      blockedIssueIds: [],
    })).toBe(true);
    expect(graphs.judge.validateOutput({
      verdict: "revise",
      finalSafeFeedback: "Try again.",
      summary: "Revise.",
      blockedIssueIds: [],
    })).toBe(true);
    expect(graphs.judge.validateOutput({
      verdict: "rejected",
      finalSafeFeedback: "Rejected.",
      summary: "Rejected.",
      blockedIssueIds: [],
    })).toBe(true);
  });

  it("rejects raw learner submission and unsafe fields from the model boundary", () => {
    const graphs = createStudyReviewGraphs();

    expect(graphs.generator.validateInput({
      context: {
        ...context,
        learnerSubmission: "raw answer",
      },
      allowedSourcesSummary: "Only public sources.",
    })).toBe(false);
    expect(graphs.judge.validateInput({
      context,
      generator: {
        artifactId: "artifact-1",
        candidateFeedback: "Feedback",
        rationale: "Reason",
        citedSourceIds: ["source-public-1"],
        riskFlags: [],
      },
      hunter: {
        issues: [],
        requiresDefender: false,
        recommendedVerdict: "accepted",
      },
      defender: {
        defenseSummary: "Safe.",
        acceptedIssueIds: [],
        rebuttedIssueIds: [],
        residualRisks: [],
        extraField: true,
      },
    })).toBe(false);
  });

  it("requires Hunter and Judge to audit private candidate answers without echoing them", () => {
    const graphs = createStudyReviewGraphs();
    const reviewContext: ReviewSafeContext = {
      ...context,
      activity: { ...context.activity, supportingKnowledgePointIds: [...context.activity.supportingKnowledgePointIds] },
      sourceIds: [...context.sourceIds],
    };
    const generator = {
      artifactId: "artifact-1",
      candidateFeedback: JSON.stringify({
        artifactKind: "quiz",
        questions: [{ prompt: "题干", options: ["A", "B"], correctAnswer: "A", explanation: "正文依据" }],
      }),
      rationale: "Reason",
      citedSourceIds: ["source-public-1"],
      riskFlags: [],
    };
    const hunterInput = { context: reviewContext, generator };
    const hunterPrompt = graphs.hunter.buildSystemPrompt(hunterInput);
    expect(hunterPrompt).toContain("correctAnswer");
    expect(hunterPrompt).toContain("语义上确实正确");
    expect(hunterPrompt).toContain("不得在 message");

    const judgePrompt = graphs.judge.buildSystemPrompt({
      context: reviewContext,
      generator,
      hunter: { issues: [], requiresDefender: false, recommendedVerdict: "accepted" },
    });
    expect(judgePrompt).toContain("Hunter 已逐题审核");
    expect(judgePrompt).toContain("不得复述正确答案");
  });

  it("gives Generator a four-question example and a concrete repair instruction", () => {
    const graphs = createStudyReviewGraphs();
    const prompt = graphs.generator.buildSystemPrompt({
      context: {
        ...context,
        activity: { ...context.activity, supportingKnowledgePointIds: [...context.activity.supportingKnowledgePointIds] },
        sourceIds: [...context.sourceIds],
        allowedSourceIds: [...context.sourceIds],
        teachingContent: "当前章节中文教学正文。",
      },
      allowedSourcesSummary: "Only public sources.",
      repairInstruction: "失败类别=candidate_question_count。questions 必须包含 4 至 6 道题。",
    });

    expect(prompt).toContain("包含四道题的完整结构示例");
    expect(prompt).toContain("quiz-read-csv-4");
    expect(prompt).toContain("candidate_question_count");
    expect(prompt).toContain("必须逐字执行");
  });
});
