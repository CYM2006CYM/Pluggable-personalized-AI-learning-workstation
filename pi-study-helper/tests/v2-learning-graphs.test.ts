import { describe, expect, it } from "vitest";
import { createStudyReviewGraphs } from "../src/graphs/v2-learning-graphs.js";

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
});
