import { describe, expect, it } from "vitest";
import { selectDeterministicQuizContent } from "../src/application/deterministic-content-policy.js";
import type { QuizQuestionPrivate } from "../src/contracts/index.js";

function questions(prefix: string, count: number): QuizQuestionPrivate[] {
  return Array.from({ length: count }, (_, index) => ({
    questionId: `${prefix}-${index}`,
    kind: "single_choice",
    prompt: `Question ${index}`,
    options: ["A", "B"],
    correctAnswer: "A",
    explanation: "Explanation",
    sourceAnchorIds: ["source-1"],
  }));
}

describe("deterministic quiz content policy", () => {
  it("selects dynamic, supplemental, fixed, then insufficient in the frozen order", () => {
    const fixed = questions("fixed", 4);
    const supplemental = questions("supplemental", 2);
    expect(selectDeterministicQuizContent({ dynamic: questions("dynamic", 4), supplemental, fixed, excludedQuestionIds: [] }).source).toBe("dynamic");
    expect(selectDeterministicQuizContent({ dynamic: questions("dynamic", 2), supplemental, fixed, excludedQuestionIds: [] })).toMatchObject({ source: "supplemental", questions: expect.arrayContaining([expect.objectContaining({ questionId: "supplemental-0" })]) });
    expect(selectDeterministicQuizContent({ dynamic: [], supplemental, fixed, excludedQuestionIds: [] }).source).toBe("fixed");
    expect(selectDeterministicQuizContent({ dynamic: [], supplemental, fixed, excludedQuestionIds: ["fixed-0"] }).source).toBe("insufficient");
    expect(selectDeterministicQuizContent({ dynamic: questions("too-many", 7), supplemental: [], fixed, excludedQuestionIds: [] }).source).toBe("fixed");
  });

  it("hard rejects unknown fields, duplicate IDs, sources outside the knowledge point, and invalid answer keys", () => {
    const fixed = questions("fixed", 4);
    const dynamic = questions("dynamic", 4);
    (dynamic[0] as unknown as Record<string, unknown>).evidenceCandidate = {};
    dynamic[1]!.questionId = dynamic[2]!.questionId;
    dynamic[3]!.sourceAnchorIds = ["private-source"];
    expect(selectDeterministicQuizContent({ dynamic, supplemental: [], fixed, excludedQuestionIds: [], allowedSourceAnchorIds: ["source-1"] }).source).toBe("fixed");
  });
});
