import { describe, expect, it } from "vitest";
import {
  evaluatorFailure,
  learnerFailure,
  summarizeRubric,
} from "../src/infrastructure/activity-rubric.js";

const binding = {
  evaluatorVersion: "node-python-evaluator-w3-c1",
  environmentHash: `sha256:${"1".repeat(64)}`,
  assetBundleHash: `sha256:${"2".repeat(64)}`,
};

describe("W3 C deterministic rubric", () => {
  it("passes only when the threshold and every blocking dimension pass", () => {
    const result = summarizeRubric({
      ...binding,
      rubric: {
        passThreshold: 0.8,
        dimensions: [
          { dimensionId: "blocking", weight: 0.8, blocking: true, safeFeedbackCodes: [] },
          { dimensionId: "style", weight: 0.2, blocking: false, safeFeedbackCodes: [] },
        ],
        dimensionTestMap: { blocking: ["blocking"], style: ["style"] },
      },
      tests: [
        { testId: "blocking", dimensionId: "blocking", blocking: true, passed: true },
        { testId: "style", dimensionId: "style", blocking: false, passed: true },
      ],
    });
    expect(result).toMatchObject({ verdict: "pass", score: 1 });
  });

  it("returns a partial learner result when an individual blocking test fails", () => {
    const result = summarizeRubric({
      ...binding,
      rubric: {
        passThreshold: 0.5,
        dimensions: [
          { dimensionId: "blocking", weight: 0.5, blocking: false, safeFeedbackCodes: [] },
          { dimensionId: "style", weight: 0.5, blocking: false, safeFeedbackCodes: [] },
        ],
        dimensionTestMap: { blocking: ["blocking"], style: ["style"] },
      },
      tests: [
        { testId: "blocking", dimensionId: "blocking", blocking: true, passed: false },
        { testId: "style", dimensionId: "style", blocking: false, passed: true },
      ],
    });
    expect(result).toMatchObject({ verdict: "partial", errorKind: "learner", errorCode: "test_failed", score: 0.5 });
  });

  it("keeps learner failures scoreable without private execution detail", () => {
    expect(learnerFailure({
      ...binding,
      errorCode: "syntax_error",
      safeFeedback: "The submitted source is not valid Python.",
    })).toEqual({
      executionStatus: "completed",
      verdict: "fail",
      errorKind: "learner",
      errorCode: "syntax_error",
      score: 0,
      safeFeedback: "The submitted source is not valid Python.",
      ...binding,
    });
  });

  it("never gives evaluator failures a score or dimension result", () => {
    const result = evaluatorFailure({
      ...binding,
      errorCode: "test_asset_invalid",
      safeFeedback: "Evaluation assets are unavailable.",
    });
    expect(result).toMatchObject({ verdict: "not_graded", errorKind: "evaluator" });
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("dimensionResults");
  });
});
