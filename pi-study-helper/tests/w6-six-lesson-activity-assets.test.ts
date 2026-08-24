import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const profileRoot = resolve("fixtures/profiles/pandas-cleaning-revision-3-draft");

const lessonActivities = [
  ["pandas.clean.read-csv", "act-read-csv", "act-load-csv"],
  ["pandas.clean.inspect-dataframe", "act-quiz-inspect-dataframe", "act-inspect-dataframe"],
  ["pandas.clean.missing-values", "act-quiz-missing-values", "act-missing"],
  ["pandas.clean.duplicate-orders", "act-quiz-duplicate-orders", "act-duplicates"],
  ["pandas.clean.type-format", "act-quiz-type-format", "act-types"],
  ["pandas.clean.validate-result", "act-quiz-validate-result", "act-practical"],
] as const;

type Activity = {
  activityId: string;
  profileRevision: number;
  kind: string;
  primaryKnowledgePointId: string;
  allowedSources: string[];
  fixedQuestionGroupId?: string;
  publicTestRefs?: string[];
  hiddenTestRefs?: string[];
  rubricRef?: string;
  referenceSolutionRef?: string;
  knownWrongSolutionRefs?: string[];
  problemStatement?: {
    background: string;
    inputDescription: string;
    outputDescription: string;
    rules: string[];
    prohibitedActions: string[];
    sample: {
      inputFileName: string;
      inputCsv: string;
      outputFileName: string;
      outputCsv: string;
      explanation: string;
    };
  };
};

describe("W6 six-lesson objective and code activity matrix", () => {
  it("binds each Pandas lesson to one AI-first quiz and one formal code activity", async () => {
    const document = JSON.parse(await readFile(resolve(profileRoot, "activities/learning-activities.json"), "utf8")) as {
      activities: Activity[];
    };
    const byId = new Map(document.activities.map((activity) => [activity.activityId, activity]));

    for (const [knowledgePointId, quizId, codeId] of lessonActivities) {
      const quiz = byId.get(quizId);
      const code = byId.get(codeId);
      expect(quiz, `${quizId} is missing`).toMatchObject({
        profileRevision: 3,
        kind: "mcq",
        primaryKnowledgePointId: knowledgePointId,
        allowedSources: ["ai_generated", "profile_fixed"],
        fixedQuestionGroupId: expect.any(String),
      });
      expect(code, `${codeId} is missing`).toMatchObject({
        profileRevision: 3,
        primaryKnowledgePointId: knowledgePointId,
        allowedSources: ["profile_fixed"],
        publicTestRefs: expect.arrayContaining([expect.any(String)]),
        hiddenTestRefs: expect.arrayContaining([expect.any(String)]),
        rubricRef: expect.any(String),
        referenceSolutionRef: expect.any(String),
        knownWrongSolutionRefs: expect.arrayContaining([expect.any(String)]),
      });
    }
  });

  it("provides a complete, downloadable-safe CSV statement for all six code activities", async () => {
    const document = JSON.parse(await readFile(resolve(profileRoot, "activities/learning-activities.json"), "utf8")) as {
      activities: Activity[];
    };
    const byId = new Map(document.activities.map((activity) => [activity.activityId, activity]));

    for (const [, , codeId] of lessonActivities) {
      const statement = byId.get(codeId)?.problemStatement;
      expect(statement, `${codeId} problemStatement is missing`).toMatchObject({
        background: expect.stringMatching(/\S/u),
        inputDescription: expect.stringMatching(/\S/u),
        outputDescription: expect.stringMatching(/\S/u),
        rules: expect.arrayContaining([expect.stringMatching(/\S/u)]),
        prohibitedActions: expect.arrayContaining([expect.stringMatching(/\S/u)]),
        sample: {
          inputFileName: expect.stringMatching(/^[^\\/]+\.csv$/u),
          inputCsv: expect.stringMatching(/^[^\r\n]+,[^\r\n]+\r?\n[^\r\n]+/u),
          outputFileName: expect.stringMatching(/^[^\\/]+\.csv$/u),
          outputCsv: expect.stringMatching(/^[^\r\n]+,[^\r\n]+\r?\n[^\r\n]+/u),
          explanation: expect.stringMatching(/\S/u),
        },
      });
      expect(statement!.sample.inputCsv.split(/\r?\n/u)[0]).toContain("order_id");
      expect(statement!.sample.outputCsv.split(/\r?\n/u)[0]).toContain("order_id");
      expect(JSON.stringify(statement)).not.toMatch(/[A-Za-z]:[\\/]|\.\.\/|(?:sk|api)[-_][A-Za-z0-9]{12,}|authorization\s*:/iu);
    }
  });

  it("closes every formal bundle over public tests, hidden tests, rubric, reference, and known-wrong files", async () => {
    const document = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8")) as {
      bundles: Array<{
        activity: Activity;
        publicTests: Array<{ testId: string; fileRef: string }>;
        hiddenTests: Array<{ testId: string; fileRef: string }>;
        rubric: { rubricId: string };
      }>;
    };
    const byActivity = new Map(document.bundles.map((bundle) => [bundle.activity.activityId, bundle]));
    expect(byActivity.size).toBe(6);

    for (const [, , codeId] of lessonActivities) {
      const bundle = byActivity.get(codeId);
      expect(bundle, `${codeId} task bundle is missing`).toBeDefined();
      expect(bundle!.publicTests.map((test) => test.testId)).toEqual(bundle!.activity.publicTestRefs);
      expect(bundle!.hiddenTests.map((test) => test.testId)).toEqual(bundle!.activity.hiddenTestRefs);
      expect(bundle!.rubric.rubricId).toBe(bundle!.activity.rubricRef);
      await Promise.all([
        ...bundle!.publicTests.map((test) => access(resolve(profileRoot, test.fileRef))),
        ...bundle!.hiddenTests.map((test) => access(resolve(profileRoot, test.fileRef))),
        access(resolve(profileRoot, "rubrics", `${bundle!.activity.rubricRef}.json`)),
        access(resolve(profileRoot, "reference-solutions", `${bundle!.activity.referenceSolutionRef}.py`)),
        ...bundle!.activity.knownWrongSolutionRefs!.map((id) => access(resolve(profileRoot, "assessments/private/known-wrong", `${id}.py`))),
      ]);
    }
  });
});
