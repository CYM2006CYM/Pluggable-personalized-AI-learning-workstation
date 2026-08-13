import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calculateRevisionSeal } from "../src/domain/profile-revision-seal.js";
import { validateProfileV2Directory } from "../src/domain/profile-v2-schema.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";
import { ProfileFamilyQuizActivityAssetResolver } from "../src/application/quiz-activity-runtime.js";
import type { KnowledgePointDefinition } from "../src/contracts/index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createRevision3Fixture(fixtures: string): Promise<string> {
  const root = resolve(fixtures, "pandas-cleaning-revision-3-draft");
  for (const path of ["chapters", "knowledge", "goals", "sources", "quality", "cards", "activities", "assessments/private"]) await mkdir(resolve(root, path), { recursive: true });
  await writeFile(resolve(root, "subject.md"), "# Synthetic W4 fixture\n", "utf8");
  await writeFile(resolve(root, "chapters", "chapter.md"), "# Chapter\n", "utf8");
  await writeJson(resolve(root, "sources", "source-map.json"), { sources: [] });
  await writeJson(resolve(root, "quality", "quality-report.json"), { status: "fixture" });
  await writeJson(resolve(root, "profile.json"), {
    subjectId: "pandas-cleaning", name: "Synthetic W4", schemaVersion: 2, status: "draft", version: "fixture-3", revision: 3, revisionOf: 2,
    capabilities: { modalities: ["reading", "quiz"], runtimes: [], diagnostic: false },
    paths: { subject: "subject.md", chapters: "chapters", knowledge: "knowledge/knowledge-points.json", goals: "goals/learning-goals.json", sources: "sources/source-map.json", quality: "quality/quality-report.json", cards: "cards/cards.json", activities: "activities/learning-activities.json", assessments: "assessments" },
  });
  await writeJson(resolve(root, "knowledge", "knowledge-points.json"), { knowledgePoints: [{ id: "kp", title: "Point", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: ["quiz"], importance: 1, activityPolicy: "all_in_order", contentEstimatedMinutes: 3 }] });
  await writeJson(resolve(root, "goals", "learning-goals.json"), { goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: ["kp"], requiredActivityIds: [] }] });
  await writeJson(resolve(root, "cards", "cards.json"), { cards: [{ cardId: "card-kp", knowledgePointId: "kp", title: "Card", objective: "Learn", explanation: ["One"], example: "Example", commonMistake: "Mistake", sourceAnchorIds: ["source-1"], estimatedMinutes: 3 }] });
  await writeJson(resolve(root, "activities", "learning-activities.json"), { activities: [{ activityId: "quiz", profileRevision: 3, kind: "mcq", allowedSources: ["profile_fixed"], primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], title: "Quiz", prompt: "Answer", difficulty: "S-U", estimatedMinutes: 4, sourceAnchorIds: ["source-1"], templateVersion: "fixture", leakagePolicyId: "safe", allowedScaffolds: ["none"], fixedQuestionGroupId: "fixed-kp", supplementalQuestionGroupId: "supplemental-kp", evaluatorRef: "private/answer-key.json#fixed-kp" }] });
  const publicQuestion = (questionId: string) => ({ questionId, kind: "single_choice", prompt: questionId, options: ["A", "B"] });
  const privateQuestion = (questionId: string) => ({ ...publicQuestion(questionId), correctAnswer: "A", explanation: "Safe", sourceAnchorIds: ["source-1"] });
  await writeJson(resolve(root, "assessments", "question-groups.json"), { groups: [{ groupId: "fixed-kp", role: "fixed", activityId: "quiz", knowledgePointId: "kp", questions: [0, 1, 2, 3].map((index) => publicQuestion(`fixed-${index}`)) }, { groupId: "supplemental-kp", role: "supplemental", activityId: "quiz", knowledgePointId: "kp", questions: [publicQuestion("supplemental-0")] }] });
  await writeJson(resolve(root, "assessments", "private", "answer-key.json"), { groups: [{ groupId: "fixed-kp", answers: [0, 1, 2, 3].map((index) => privateQuestion(`fixed-${index}`)) }, { groupId: "supplemental-kp", answers: [privateQuestion("supplemental-0")] }] });
  await expect(validateProfileV2Directory(root, "draft")).resolves.toMatchObject({ revision: 3 });
  const calculated = await calculateRevisionSeal(root);
  await writeJson(resolve(root, "quality", "revision-seal.json"), { schemaVersion: 1, subjectId: "pandas-cleaning", revision: 3, ...calculated });
  return root;
}

async function setup(fault?: "active_manifest_written" | "active_published") {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "revision-3-activation-")); roots.push(dataRoot);
  const fixtures = resolve(dataRoot, "fixtures");
  const candidate = await createRevision3Fixture(fixtures);
  let injected = fault;
  const repository = new ProfileFamilyRepository({ dataRoot, fixturesRoot: fixtures, beforeV2ActivationStage: async (stage) => { if (stage === injected) { injected = undefined; throw new Error(`fault:${stage}`); } } });
  return { dataRoot, fixtures, candidate, repository };
}

describe("W4 revision 3 sealed activation", () => {
  it.each([
    ["card time differs", async (candidate: string) => {
      const path = resolve(candidate, "cards", "cards.json");
      const value = JSON.parse(await readFile(path, "utf8")); value.cards[0].estimatedMinutes = 4; await writeJson(path, value);
    }, "estimatedMinutes must equal"],
    ["public question leaks an answer", async (candidate: string) => {
      const path = resolve(candidate, "assessments", "question-groups.json");
      const value = JSON.parse(await readFile(path, "utf8")); value.groups[0].questions[0].correctAnswer = "A"; await writeJson(path, value);
    }, "correctAnswer is an unknown core field"],
    ["mcq mixes legacy and group fields", async (candidate: string) => {
      const path = resolve(candidate, "activities", "learning-activities.json");
      const value = JSON.parse(await readFile(path, "utf8")); value.activities[0].subtype = "single_choice"; value.activities[0].options = ["A", "B"]; await writeJson(path, value);
    }, "cannot mix legacy single-question and W4 question-group fields"],
  ] as const)("rejects synthetic revision 3 when %s", async (_label, mutate, message) => {
    const { candidate } = await setup();
    await mutate(candidate);
    await expect(validateProfileV2Directory(candidate, "draft")).rejects.toThrow(message);
  });

  it("validates six goal targets while allowing one asset-free prerequisite helper", async () => {
    const { candidate } = await setup();
    const coreIds = Array.from({ length: 6 }, (_, index) => `core-${index + 1}`);
    const points: KnowledgePointDefinition[] = [
      { id: "helper", title: "Helper", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: [], importance: 1 },
      ...coreIds.map((id, index) => ({ id, title: id, chapterId: "chapter", sectionId: "section", prerequisiteIds: index === 0 ? ["helper"] : [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: [`quiz-${id}`], importance: 1, activityPolicy: "all_in_order" as const, contentEstimatedMinutes: 3 })),
    ];
    const activities = coreIds.map((id) => ({ activityId: `quiz-${id}`, profileRevision: 3, kind: "mcq", allowedSources: ["profile_fixed"], primaryKnowledgePointId: id, supportingKnowledgePointIds: [], goalIds: ["goal"], title: id, prompt: "Answer", difficulty: "S-U", estimatedMinutes: 4, sourceAnchorIds: ["source-1"], templateVersion: "fixture", leakagePolicyId: "safe", allowedScaffolds: ["none"], fixedQuestionGroupId: `fixed-${id}`, supplementalQuestionGroupId: `supplemental-${id}`, evaluatorRef: `private/answer-key.json#fixed-${id}` }));
    const publicQuestion = (questionId: string) => ({ questionId, kind: "single_choice", prompt: questionId, options: ["A", "B"] });
    const privateQuestion = (questionId: string) => ({ ...publicQuestion(questionId), correctAnswer: "A", explanation: "Safe", sourceAnchorIds: ["source-1"] });
    const publicGroups = coreIds.flatMap((id) => [
      { groupId: `fixed-${id}`, role: "fixed", activityId: `quiz-${id}`, knowledgePointId: id, questions: [0, 1, 2, 3].map((index) => publicQuestion(`${id}-fixed-${index}`)) },
      { groupId: `supplemental-${id}`, role: "supplemental", activityId: `quiz-${id}`, knowledgePointId: id, questions: [publicQuestion(`${id}-supplemental-0`)] },
    ]);
    const privateGroups = publicGroups.map((group) => ({ groupId: group.groupId, answers: group.questions.map((question) => privateQuestion(question.questionId)) }));
    await writeJson(resolve(candidate, "knowledge", "knowledge-points.json"), { knowledgePoints: points });
    await writeJson(resolve(candidate, "goals", "learning-goals.json"), { goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: coreIds, requiredActivityIds: [] }] });
    await writeJson(resolve(candidate, "activities", "learning-activities.json"), { activities });
    await writeJson(resolve(candidate, "cards", "cards.json"), { cards: coreIds.map((id) => ({ cardId: `actual-card-${id}`, knowledgePointId: id, title: id, objective: "Learn", explanation: ["One"], example: "Example", commonMistake: "Mistake", sourceAnchorIds: ["source-1"], estimatedMinutes: 3 })) });
    await writeJson(resolve(candidate, "assessments", "question-groups.json"), { groups: publicGroups });
    await writeJson(resolve(candidate, "assessments", "private", "answer-key.json"), { groups: privateGroups });
    await expect(validateProfileV2Directory(candidate, "draft")).resolves.toMatchObject({ revision: 3 });

    points[1]!.activityPolicy = "select_one";
    await writeJson(resolve(candidate, "knowledge", "knowledge-points.json"), { knowledgePoints: points });
    await expect(validateProfileV2Directory(candidate, "draft")).rejects.toThrow("must declare all_in_order");
  });

  it.each([
    ["core card", async (candidate: string) => {
      const path = resolve(candidate, "cards", "cards.json");
      const value = JSON.parse(await readFile(path, "utf8")); value.cards = []; await writeJson(path, value);
    }, "must have exactly one fixed card"],
    ["core question groups", async (candidate: string) => {
      const path = resolve(candidate, "activities", "learning-activities.json");
      const value = JSON.parse(await readFile(path, "utf8")); delete value.activities[0].fixedQuestionGroupId; await writeJson(path, value);
    }, "fixedQuestionGroupId must be a stable ASCII identifier"],
  ] as const)("rejects a revision 3 target missing %s", async (_label, mutate, message) => {
    const { candidate } = await setup();
    await mutate(candidate);
    await expect(validateProfileV2Directory(candidate, "draft")).rejects.toThrow(message);
  });

  it("activates once and reuses the same sealed active idempotently", async () => {
    const { repository } = await setup();
    const first = await repository.activateRevision3Draft("pandas-cleaning");
    const second = await repository.activateRevision3Draft("pandas-cleaning");
    expect(first).toMatchObject({ activation: "activated", manifest: { revision: 3, status: "active" } });
    expect(second).toMatchObject({ activation: "reused", seal: { assetTreeSha256: first.seal.assetTreeSha256 } });
    const assets = await new ProfileFamilyQuizActivityAssetResolver(repository).loadAssets("pandas-cleaning", 3, "quiz");
    expect(assets.activity).toMatchObject({ activityId: "quiz", title: "Quiz" });
    expect(assets.fixedQuestions).toHaveLength(4);
    expect(assets.fixedQuestions[0]).toMatchObject({ questionId: "fixed-0", correctAnswer: "A" });
    expect(assets.supplementalQuestions).toMatchObject([{ questionId: "supplemental-0" }]);
    expect(JSON.stringify(assets.activity)).not.toContain("correctAnswer");
  });

  it("rejects another active revision and an active revision 3 with a different seal", async () => {
    const first = await setup();
    const family = first.repository.familyDirectory("pandas-cleaning");
    await cp(first.candidate, resolve(family, "active"), { recursive: true });
    const manifestPath = resolve(family, "active", "profile.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")); manifest.status = "active"; manifest.revision = 2; manifest.revisionOf = 1;
    await writeJson(manifestPath, manifest);
    await expect(first.repository.activateRevision3Draft("pandas-cleaning")).rejects.toThrow("owner-approved migration");

    const second = await setup();
    await second.repository.activateRevision3Draft("pandas-cleaning");
    await writeFile(resolve(second.repository.familyDirectory("pandas-cleaning"), "active", "subject.md"), "changed\n", "utf8");
    await expect(second.repository.activateRevision3Draft("pandas-cleaning")).rejects.toThrow("does not match");
  });

  it.each(["active_manifest_written", "active_published"] as const)("rolls back without active when %s faults", async (stage) => {
    const { repository } = await setup(stage);
    await expect(repository.activateRevision3Draft("pandas-cleaning")).rejects.toThrow(`fault:${stage}`);
    await expect(repository.loadActiveProfileV2("pandas-cleaning")).rejects.toThrow();
  });
});
