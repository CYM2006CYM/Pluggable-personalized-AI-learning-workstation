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
      issueDecisions: [],
      additionalIssues: [],
      blockedIssueIds: [],
    })).toBe(true);
    expect(graphs.judge.validateOutput({
      verdict: "revise",
      finalSafeFeedback: "Try again.",
      summary: "Revise.",
      issueDecisions: [],
      additionalIssues: [],
      blockedIssueIds: [],
    })).toBe(true);
    expect(graphs.judge.validateOutput({
      verdict: "rejected",
      finalSafeFeedback: "Rejected.",
      summary: "Rejected.",
      issueDecisions: [],
      additionalIssues: [],
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
        issueAssessments: [{
          issueId: "issue-1",
          position: "rebutted",
          rationale: "The public source rebuts the issue.",
          sourceAnchorIds: ["source-public-1"],
          residualRisk: null,
        }],
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
    expect(hunterPrompt).toContain("candidateField");
    expect(hunterPrompt).toContain("evidenceSummary");
    expect(hunterPrompt).toContain("sourceAnchorIds");

    const judgePrompt = graphs.judge.buildSystemPrompt({
      context: reviewContext,
      generator,
      hunter: { issues: [], requiresDefender: false, recommendedVerdict: "accepted" },
    });
    expect(judgePrompt).toContain("Hunter 已逐题审核");
    expect(judgePrompt).toContain("不得复述正确答案");
  });

  it("requires every Hunter issue to identify its category, candidate field, evidence, and source anchors", () => {
    const graphs = createStudyReviewGraphs();
    const completeIssue = {
      issueId: "issue-evidence-1",
      severity: "medium",
      category: "source_support",
      candidateField: "candidateFeedback.questions[0].explanation",
      message: "解析缺少正文支持。",
      evidenceSummary: "正文只说明读取行为，没有支持候选新增的结论。",
      sourceAnchorIds: ["source-public-1"],
      disputed: true,
    } as const;

    expect(graphs.hunter.validateOutput({
      issues: [completeIssue],
      requiresDefender: true,
      recommendedVerdict: "revise",
    })).toBe(true);
    for (const missingField of ["category", "candidateField", "evidenceSummary", "sourceAnchorIds"] as const) {
      const incompleteIssue = { ...completeIssue } as Record<string, unknown>;
      delete incompleteIssue[missingField];
      expect(graphs.hunter.validateOutput({
        issues: [incompleteIssue],
        requiresDefender: true,
        recommendedVerdict: "revise",
      })).toBe(false);
    }
    expect(graphs.hunter.validateOutput({
      issues: [{ ...completeIssue, sourceAnchorIds: [] }],
      requiresDefender: true,
      recommendedVerdict: "revise",
    })).toBe(false);
  });

  it("requires Defender to give one sourced position and residual-risk decision per issue", () => {
    const graphs = createStudyReviewGraphs();
    const assessment = {
      issueId: "issue-evidence-1",
      position: "conceded",
      rationale: "正文没有支持候选新增的结论，因此Hunter指控成立。",
      sourceAnchorIds: ["source-public-1"],
      residualRisk: "候选仍包含正文外结论。",
    } as const;

    expect(graphs.defender.validateOutput({
      defenseSummary: "已依据正文逐项核对。",
      issueAssessments: [assessment],
    })).toBe(true);
    expect(graphs.defender.validateOutput({
      defenseSummary: "缺少逐项结论。",
      issueAssessments: [],
    })).toBe(false);
    for (const missingField of ["position", "rationale", "sourceAnchorIds", "residualRisk"] as const) {
      const incompleteAssessment = { ...assessment } as Record<string, unknown>;
      delete incompleteAssessment[missingField];
      expect(graphs.defender.validateOutput({
        defenseSummary: "字段不完整。",
        issueAssessments: [incompleteAssessment],
      })).toBe(false);
    }
  });

  it("requires Judge to return sourced issue decisions and supports sourced additional issues", () => {
    const graphs = createStudyReviewGraphs();
    const output = {
      verdict: "revise",
      finalSafeFeedback: "需要修订候选。",
      summary: "Hunter问题成立，且Judge发现一个遗漏问题。",
      issueDecisions: [{
        issueId: "issue-evidence-1",
        decision: "upheld",
        rationale: "正文不支持候选新增结论。",
        sourceAnchorIds: ["source-public-1"],
      }],
      additionalIssues: [{
        issueId: "judge-additional-1",
        severity: "medium",
        category: "clarity",
        candidateField: "candidateFeedback.questions[0].prompt",
        message: "题干缺少必要的问题对象。",
        evidenceSummary: "正文明确给出了问题对象，候选题干应保留该上下文。",
        sourceAnchorIds: ["source-public-1"],
      }],
      blockedIssueIds: ["issue-evidence-1", "judge-additional-1"],
    } as const;

    expect(graphs.judge.validateOutput(output)).toBe(true);
    expect(graphs.judge.validateOutput({ ...output, issueDecisions: [{ ...output.issueDecisions[0]!, rationale: "" }] })).toBe(false);
    expect(graphs.judge.validateOutput({ ...output, additionalIssues: [{ ...output.additionalIssues[0]!, sourceAnchorIds: [] }] })).toBe(false);
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
