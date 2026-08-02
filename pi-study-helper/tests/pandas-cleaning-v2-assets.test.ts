import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateProfileV2Directory } from "../src/domain/profile-v2-schema.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/profiles/pandas-cleaning-v2-draft");
const coreKnowledgePointIds = [
  "pandas.clean.read-csv",
  "pandas.clean.inspect-dataframe",
  "pandas.clean.missing-values",
  "pandas.clean.duplicate-orders",
  "pandas.clean.type-format",
  "pandas.clean.validate-result",
];
const expectedWeights = new Map([
  ["pandas.clean.read-csv", 0.05],
  ["pandas.clean.inspect-dataframe", 0.05],
  ["pandas.clean.missing-values", 0.20],
  ["pandas.clean.duplicate-orders", 0.15],
  ["pandas.clean.type-format", 0.25],
  ["pandas.clean.validate-result", 0.30],
]);
const sourceKeys = [
  "excerptRange",
  "knowledgePointIds",
  "license",
  "locator",
  "sourceId",
  "summaryHash",
  "title",
  "type",
  "versionOrAccessDate",
];
const questionKeys = [
  "difficulty",
  "evaluatorRef",
  "kind",
  "knowledgePointId",
  "maxScore",
  "options",
  "prompt",
  "questionId",
  "required",
  "sourceAnchorIds",
];
const testCaseKeys = ["assetHash", "blocking", "dimensionId", "fileRef", "fixtureRefs", "testId", "visibility"];

async function json(relativePath: string): Promise<any> {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function exists(relativePath: string): Promise<boolean> {
  try {
    await stat(resolve(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(content: Buffer | string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function publicCandidateFiles(directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const relativePath = absolute.slice(root.length + 1).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (
        relativePath === "reference-solutions"
        || relativePath === "rubrics"
        || relativePath === "datasets/private"
        || relativePath.includes("/private")
      ) continue;
      files.push(...await publicCandidateFiles(absolute));
    } else if (!entry.name.endsWith(".pyc")) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

describe("B W2 revision-2 pandas-cleaning draft assets", () => {
  it("is accepted by A's frozen Profile v2 schema and remains a local draft", async () => {
    const manifest = await validateProfileV2Directory(root, "draft");
    expect(manifest).toMatchObject({
      subjectId: "pandas-cleaning",
      status: "draft",
      version: "0.2.0-draft",
      revision: 2,
      revisionOf: 1,
      "x-candidateApproval": "pending_owner_decision",
    });
    expect(manifest.paths.sources).toBe("sources/source-map.json");
    expect(manifest.capabilities.modalities).toEqual(["reading", "quiz", "code", "practice"]);
  });

  it("has the W2 three-chapter, six-section curriculum and migration record", async () => {
    const chapterFiles = [
      "chapters/chapter-01-data-entry-and-inspection/section-01-read-csv.md",
      "chapters/chapter-01-data-entry-and-inspection/section-02-inspect-dataframe.md",
      "chapters/chapter-02-cleaning-issues/section-01-missing-values.md",
      "chapters/chapter-02-cleaning-issues/section-02-duplicate-orders.md",
      "chapters/chapter-03-format-and-validation/section-01-type-format-cleanup.md",
      "chapters/chapter-03-format-and-validation/section-02-validate-result.md",
    ];
    expect(await Promise.all(chapterFiles.map(exists))).toEqual(Array(6).fill(true));
    expect(await exists("cards/basic-python-remediation.md")).toBe(true);
    expect(await exists("quality/revision-1-to-2.md")).toBe(true);
    expect(await exists("sources/source-registry.json")).toBe(false);
  });

  it("declares seven knowledge points with an acyclic core weighting contract", async () => {
    const { knowledgePoints } = await json("knowledge/knowledge-points.json");
    expect(knowledgePoints).toHaveLength(7);
    const byId = new Map<string, any>(knowledgePoints.map((item: any): [string, any] => [item.id, item]));
    expect([...byId.keys()]).toEqual(["basic-python", ...coreKnowledgePointIds]);
    expect(byId.get("basic-python")).toMatchObject({
      prerequisiteIds: [],
      importance: 0,
      activityIds: ["act-basic-python-remediation"],
    });
    for (const id of coreKnowledgePointIds) expect(byId.get(id).importance).toBe(expectedWeights.get(id));
    expect(coreKnowledgePointIds.reduce((total, id) => total + byId.get(id).importance, 0)).toBeCloseTo(1, 10);

    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (id: string): void => {
      if (active.has(id)) throw new Error(`cyclic prerequisite: ${id}`);
      if (visited.has(id)) return;
      active.add(id);
      for (const prerequisiteId of byId.get(id).prerequisiteIds) {
        expect(byId.has(prerequisiteId)).toBe(true);
        visit(prerequisiteId);
      }
      active.delete(id);
      visited.add(id);
    };
    for (const id of byId.keys()) visit(id);
  });

  it("separates the non-required Python remediation from the six fixed core activities", async () => {
    const { goals } = await json("goals/learning-goals.json");
    const { activities } = await json("activities/learning-activities.json");
    const goal = goals.find((item: any) => item.goalId === "goal-clean-orders");
    expect(activities).toHaveLength(7);
    expect(activities.map((item: any) => item.activityId)).toEqual([
      "act-basic-python-remediation",
      "act-read-csv",
      "act-inspect-dataframe",
      "act-missing",
      "act-duplicates",
      "act-types",
      "act-practical",
    ]);
    expect(activities.every((item: any) => item.profileRevision === 2 && item.allowedSources?.[0] === "profile_fixed")).toBe(true);
    const remediation = activities[0];
    expect(remediation).toMatchObject({
      kind: "mcq",
      primaryKnowledgePointId: "basic-python",
      subtype: "single_choice",
    });
    expect(remediation).not.toHaveProperty("datasetRefs");
    expect(remediation).not.toHaveProperty("publicTestRefs");
    expect(remediation).not.toHaveProperty("hiddenTestRefs");
    expect(remediation).not.toHaveProperty("runtimePolicyId");
    expect(goal.targetKnowledgePointIds).toEqual(coreKnowledgePointIds);
    expect(goal.requiredActivityIds).toEqual(activities.slice(1).map((item: any) => item.activityId));
    expect(goal.requiredActivityIds).not.toContain("act-basic-python-remediation");
    expect(goal.finalActivityId).toBe("act-practical");
  });

  it("uses the revision-2 official source map and closes every B-owned source reference", async () => {
    const sourceMap = await json("sources/source-map.json");
    const knowledge = await json("knowledge/knowledge-points.json");
    const activities = await json("activities/learning-activities.json");
    const diagnostic = await json("assessments/diagnostic/questions.json");
    expect(sourceMap).toMatchObject({ status: "draft", approval: "pending_owner_decision" });
    expect(sourceMap.sources.length).toBeGreaterThanOrEqual(9);
    const sourceIds = new Set<string>();
    for (const source of sourceMap.sources) {
      expect(Object.keys(source).sort()).toEqual(sourceKeys);
      expect(source.type).toBe("official");
      expect(source.knowledgePointIds.length).toBeGreaterThan(0);
      expect(source.summaryHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(source.locator).toMatch(/^https:\/\//u);
      sourceIds.add(source.sourceId);
    }
    for (const item of [...knowledge.knowledgePoints, ...activities.activities, ...diagnostic.questions]) {
      for (const sourceId of item.sourceAnchorIds) expect(sourceIds.has(sourceId)).toBe(true);
    }
  });

  it("keeps the strict eight-question diagnostic and its private answers closed one-to-one", async () => {
    const diagnostic = await json("assessments/diagnostic/questions.json");
    const answerKey = await json("assessments/diagnostic/private/answer-key.json");
    const fallback = await json("assessments/quiz-fallback/questions.json");
    const fallbackAnswerKey = await json("assessments/quiz-fallback/private/answer-key.json");
    expect(Object.keys(diagnostic).sort()).toEqual([
      "blueprintId", "estimatedMinutes", "goalIds", "minimumCoverage", "profileRevision", "questions", "scoringVersion",
    ]);
    expect(diagnostic).toMatchObject({
      blueprintId: "diagnostic-pandas-cleaning-v2-draft",
      profileRevision: 2,
      goalIds: ["goal-clean-orders"],
      minimumCoverage: 1,
      scoringVersion: "diagnostic-v2-draft",
    });
    expect(diagnostic.questions).toHaveLength(8);
    expect(new Set(diagnostic.questions.map((item: any) => item.questionId)).size).toBe(8);
    const assessedIds = diagnostic.questions.map((item: any) => item.knowledgePointId);
    expect(new Set(assessedIds)).toEqual(new Set(["basic-python", ...coreKnowledgePointIds]));
    expect(assessedIds.filter((id: string) => id === "pandas.clean.validate-result")).toHaveLength(2);
    expect(JSON.stringify(diagnostic)).not.toContain("correctAnswer");
    for (const question of diagnostic.questions) {
      expect(Object.keys(question).sort()).toEqual(question.kind === "judgment"
        ? questionKeys.filter((key) => key !== "options")
        : questionKeys);
      expect(["single_choice", "judgment"]).toContain(question.kind);
      if (question.kind === "single_choice") expect(question.options.length).toBeGreaterThanOrEqual(2);
      if (question.kind === "judgment") expect(question).not.toHaveProperty("options");
    }

    expect(Object.keys(answerKey).sort()).toEqual(["answers", "blueprintId", "evaluatorVersion"]);
    expect(answerKey.blueprintId).toBe(diagnostic.blueprintId);
    expect(answerKey.evaluatorVersion).toBe("diagnostic-v2-draft");
    expect(answerKey.answers).toHaveLength(8);
    const byQuestionId = new Map<string, any>(diagnostic.questions.map((item: any): [string, any] => [item.questionId, item]));
    expect(new Set(answerKey.answers.map((item: any) => item.questionId))).toEqual(new Set(byQuestionId.keys()));
    for (const answer of answerKey.answers) {
      const question = byQuestionId.get(answer.questionId);
      expect(answer.kind).toBe(question.kind);
      if (question.kind === "single_choice") expect(question.options).toContain(answer.correctAnswer);
      if (question.kind === "judgment") expect(typeof answer.correctAnswer).toBe("boolean");
    }

    expect(fallback).toMatchObject({ status: "draft", profileRevision: 2 });
    expect(JSON.stringify(fallback)).not.toContain("correctOptionIndex");
    expect(fallbackAnswerKey).toMatchObject({ visibility: "private", profileRevision: 2 });
    expect(new Set(fallbackAnswerKey.answers.map((item: any) => item.questionId))).toEqual(
      new Set(fallback.questions.map((item: any) => item.questionId)),
    );
  });

  it("binds D3 data, tests, five code bundles, and revision-2 hashes exactly", async () => {
    const { activities } = await json("activities/learning-activities.json");
    const { bundles } = await json("assessments/private/task-bundles.json");
    const fixturesAsset = await json("datasets/fixtures.json");
    const publicTests = (await json("assessments/public/test-cases.json")).tests;
    const privateTests = (await json("assessments/private/test-cases.json")).tests;
    const allTests = [...publicTests, ...privateTests];
    const codeActivities = activities.filter((item: any) => ["code_completion", "coding_practical"].includes(item.kind));
    expect(codeActivities.map((item: any) => item.activityId)).toEqual([
      "act-inspect-dataframe", "act-missing", "act-duplicates", "act-types", "act-practical",
    ]);
    expect(new Set(codeActivities.flatMap((item: any) => item.knownWrongSolutionRefs)).size).toBeGreaterThanOrEqual(4);
    const bundledActivityIds = new Set(bundles.map((item: any) => item.activity.activityId));
    expect(bundles).toHaveLength(5);
    expect(bundledActivityIds).toEqual(new Set(codeActivities.map((item: any) => item.activityId)));
    expect(Object.keys(fixturesAsset)).toEqual(["fixtures"]);
    expect(fixturesAsset.fixtures).toHaveLength(3);
    const fixtureById = new Map<string, any>(fixturesAsset.fixtures.map((item: any): [string, any] => [item.fixtureId, item]));
    const knownFiles = new Set<string>();
    for (const fixture of fixturesAsset.fixtures) {
      expect(Object.keys(fixture).sort()).toEqual(["assetHash", "fileRef", "fixtureId", "format", "visibility"]);
      expect(fixture.assetHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(fixture.format).toBe("csv");
      expect(fixture.fileRef).not.toMatch(/(?:^|\/|\\)\.\.(?:\/|\\|$)/u);
      expect(fixture.fileRef).not.toMatch(/^[A-Za-z]:|^\//u);
      expect(fixture.fileRef.startsWith(fixture.visibility === "public" ? "datasets/public/" : "datasets/private/")).toBe(true);
      const content = await readFile(resolve(root, fixture.fileRef));
      expect(sha256(content)).toBe(fixture.assetHash);
      knownFiles.add(fixture.fileRef);
    }
    const publicRows = (await readFile(resolve(root, "datasets/public/orders-learning.csv"), "utf8")).trim().split(/\r?\n/u);
    const privateRows = await Promise.all(["orders-variant-01.csv", "orders-variant-02.csv"].map(async (file) =>
      (await readFile(resolve(root, `datasets/private/${file}`), "utf8")).trim().split(/\r?\n/u),
    ));
    expect(publicRows).toHaveLength(31);
    expect(privateRows.map((rows) => rows.length)).toEqual([25, 25]);
    expect(publicRows[0]).toBe("order_id,customer_id,amount,city,order_date,status,note");
    for (const test of allTests) {
      expect(Object.keys(test).sort()).toEqual(testCaseKeys);
      expect(test.assetHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(test.fileRef).not.toMatch(/(?:^|\/|\\)\.\.(?:\/|\\|$)/u);
      expect(test.visibility === "public"
        ? test.fileRef.startsWith("assessments/public/tests/")
        : test.fileRef.startsWith("assessments/private/tests/")).toBe(true);
      expect(new Set(test.fixtureRefs).size).toBe(test.fixtureRefs.length);
      for (const fixtureId of test.fixtureRefs) expect(fixtureById.has(fixtureId)).toBe(true);
      if (test.visibility === "public") for (const fixtureId of test.fixtureRefs) expect(fixtureById.get(fixtureId).visibility).toBe("public");
      const content = await readFile(resolve(root, test.fileRef));
      expect(sha256(content)).toBe(test.assetHash);
      knownFiles.add(test.fileRef);
    }
    for (const bundle of bundles) {
      expect(bundle.bundleId).toMatch(/^bundle-act-[a-z-]+-v2$/u);
      expect(bundle.activity.profileRevision).toBe(2);
      expect(bundle.activity.primaryKnowledgePointId).not.toMatch(/^kp-/u);
      const activity = activities.find((item: any) => item.activityId === bundle.activity.activityId);
      expect(bundle.activity).toEqual(activity);
      expect(bundle.contract.entryPoint.name).toBe(activity.entryPoint);
      expect(bundle.contract.entryPoint.argumentFixtureIds).toEqual(expect.arrayContaining(activity.datasetRefs));
      expect(await exists(`reference-solutions/${activity.referenceSolutionRef}.py`)).toBe(true);
      for (const wrongRef of activity.knownWrongSolutionRefs) expect(await exists(`assessments/private/known-wrong/${wrongRef}.py`)).toBe(true);
      for (const test of [...bundle.publicTests, ...bundle.hiddenTests]) {
        const activityRef = test.visibility === "public" ? activity.publicTestRefs : activity.hiddenTestRefs;
        expect(activityRef).toContain(test.testId);
        expect(allTests.map((item: any) => item.testId)).toContain(test.testId);
        expect(test.fixtureRefs.every((id: string) => activity.datasetRefs.includes(id))).toBe(true);
      }
      const { assetBundleHash, ...withoutHash } = bundle;
      const resolvedFixtures = fixturesAsset.fixtures.filter((item: any) => activity.datasetRefs.includes(item.fixtureId));
      expect(createHash("sha256").update(canonicalJson({ ...withoutHash, resolvedFixtures }), "utf8").digest("hex")).toBe(assetBundleHash);
    }
    expect(knownFiles.size).toBe(14);
  });

  it("records candidate evidence and keeps the data contract independently reproducible", async () => {
    const evidence = await json("quality/c-execution-evidence.json");
    expect(evidence).toMatchObject({
      status: "candidate_evidence_only",
      harnessVersion: "b-candidate-evidence-v5",
      overallExitCode: 0,
      summary: {
        repeatCount: 3,
        baselinePassed: true,
        allBaselineRepeatsStable: true,
        allStartersRejected: true,
        allKnownWrongRejectedPerFixture: true,
      },
    });
    expect(evidence.summary.baselineOutputCount).toBeGreaterThanOrEqual(9);
    expect(Object.keys(evidence.baselineOutputFingerprints).length).toBe(evidence.summary.baselineOutputCount);
    expect(Object.values(evidence.baselineRepeatFingerprints).every((fingerprints: any) =>
      fingerprints.length === 3 && fingerprints.every((fingerprint: string) => fingerprint === fingerprints[0]))).toBe(true);
    expect(evidence.results.length).toBeGreaterThan(60);
    expect(evidence.results.every((item: any) => typeof item.bundleId === "string" && Number.isInteger(item.exitCode))).toBe(true);
    const baselineResults = evidence.results.filter((item: any) => item.implementation === "baseline");
    expect(baselineResults.length).toBeGreaterThan(0);
    expect(baselineResults.every((item: any) => typeof item.outputFingerprint === "string")).toBe(true);
    const wrongResults = evidence.results.filter((item: any) => item.implementation === "known_wrong:wrong-practical");
    expect(wrongResults.length).toBeGreaterThanOrEqual(3);
    expect(wrongResults.every((item: any) => item.exitCode !== 0)).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/assessments\/private\/|datasets\/private\/|reference-solutions\/|hidden/u);
    expect(evidence.limitations.join(" ")).toContain("C executes V2-3");
  });

  it("validates the 20 development and 60 final input-only persona cases", async () => {
    const readJsonl = async (path: string) => (await readFile(resolve("..", path), "utf8"))
      .trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const development = await readJsonl("evaluation/personas/development-20.jsonl");
    const final = await readJsonl("evaluation/personas/final-60.jsonl");
    const questions = await json("assessments/diagnostic/questions.json");
    const questionById = new Map<string, any>(questions.questions.map((item: any): [string, any] => [item.questionId, item]));
    const validKinds = new Set(["cs_student", "self_learner", "practice_oriented"]);
    const validate = (cases: any[], prefix: string) => {
      expect(cases.length).toBe(prefix === "dev" ? 20 : 60);
      expect(new Set(cases.map((item) => item.caseId)).size).toBe(cases.length);
      for (const item of cases) {
        expect(Object.keys(item).sort()).toEqual(["availableMinutes", "background", "caseId", "diagnosticAnswers", "goalId", "notes", "personaType"]);
        expect(item.caseId).toMatch(new RegExp(`^${prefix}-\\d{3}$`, "u"));
        expect(validKinds.has(item.personaType)).toBe(true);
        expect(item.goalId).toBe("goal-clean-orders");
        expect(Number.isInteger(item.availableMinutes)).toBe(true);
        expect(item.availableMinutes).toBeGreaterThan(0);
        expect(item.background.every((field: any) => Object.keys(field).sort().join(",") === "fieldId,value")).toBe(true);
        expect(item.diagnosticAnswers).toHaveLength(8);
        expect(new Set(item.diagnosticAnswers.map((answer: any) => answer.questionId)).size).toBe(8);
        for (const answer of item.diagnosticAnswers) {
          const question = questionById.get(answer.questionId);
          expect(question).toBeDefined();
          if (answer.action === "skip") expect(Object.keys(answer).sort()).toEqual(["action", "questionId"]);
          else {
            expect(Object.keys(answer).sort()).toEqual(["action", "answer", "questionId"]);
            if (question.kind === "single_choice") expect(question.options).toContain(answer.answer);
            else expect(typeof answer.answer).toBe("boolean");
          }
        }
        expect(JSON.stringify(item)).not.toMatch(/(?:systemPath|recommend|gold|buildPath|absolute|C:\\\\|\/home\/)/iu);
      }
    };
    validate(development, "dev");
    validate(final, "final");
    expect(new Set(final.slice(0, 20).map((item) => item.personaType))).toEqual(new Set(["cs_student"]));
    expect(new Set(final.slice(20, 40).map((item) => item.personaType))).toEqual(new Set(["self_learner"]));
    expect(new Set(final.slice(40, 60).map((item) => item.personaType))).toEqual(new Set(["practice_oriented"]));
  });

  it("keeps all answer keys and private execution material out of the public candidate surface", async () => {
    const paths = await publicCandidateFiles();
    expect(paths).toContain("profile.json");
    expect(paths).toContain("sources/source-map.json");
    expect(paths).toContain("assessments/diagnostic/questions.json");
    expect(paths).not.toContain("sources/source-registry.json");
    expect(paths.some((path) => path.includes("/private/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("reference-solutions/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("rubrics/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("datasets/private/"))).toBe(false);
    const publicText = (await Promise.all(paths.map((path) => readFile(resolve(root, path), "utf8")))).join("\n");
    for (const forbidden of [
      "correctAnswer", "correctOptionIndex", "private-case-", "BEGIN PRIVATE KEY", "BEGIN OPENSSH PRIVATE KEY",
      "C:\\Users\\", "/home/",
    ]) expect(publicText).not.toContain(forbidden);
  });
});
