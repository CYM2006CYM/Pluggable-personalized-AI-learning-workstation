import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const profileRoot = resolve(process.argv[2] ?? "fixtures/profiles/pandas-cleaning-revision-3-draft");
const revision2Root = resolve(process.argv[3] ?? "fixtures/profiles/pandas-cleaning-v2-draft");
const outputPath = resolve(process.argv[4] ?? "scripts/w4-b-validation/validation-result.json");
const coreIds = [
  "pandas.clean.read-csv", "pandas.clean.inspect-dataframe", "pandas.clean.missing-values",
  "pandas.clean.duplicate-orders", "pandas.clean.type-format", "pandas.clean.validate-result",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const privatePrefixes = [
  "assessments/private/", "assessments/diagnostic/private/", "assessments/quiz-fallback/private/",
  "datasets/private/", "rubrics/", "reference-solutions/",
];

async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(absolute));
    else if (entry.isFile()) result.push(absolute);
    else throw new Error(`Unsupported entry in asset tree: ${absolute}`);
  }
  return result;
}

async function snapshot(root) {
  const entries = [];
  for (const absolute of await files(root)) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const bytes = await readFile(absolute);
    entries.push({ path, sha256: sha256(bytes), byteLength: bytes.byteLength });
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const treeSha256 = sha256(entries.map((entry) => `${entry.path}\0raw-binary\0${entry.sha256}\0${entry.byteLength}\n`).join(""));
  return { fileCount: entries.length, treeSha256, entries };
}

async function publicAssetFiles(root) {
  const result = [];
  for (const absolute of await files(root)) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const browserVisible = path === "subject.md" || path === "assessments/question-groups.json"
      || path.startsWith("cards/") || path.startsWith("chapters/") || path.startsWith("datasets/public/");
    if (browserVisible && !privatePrefixes.some((prefix) => path.startsWith(prefix))) result.push({ absolute, path });
  }
  return result;
}

const [
  manifest,
  knowledge,
  goals,
  activitiesAsset,
  cardsAsset,
  publicAsset,
  privateAsset,
  sources,
  diagnosticBlueprint,
  diagnosticAnswerKey,
] = await Promise.all([
  readJson(resolve(profileRoot, "profile.json")),
  readJson(resolve(profileRoot, "knowledge/knowledge-points.json")),
  readJson(resolve(profileRoot, "goals/learning-goals.json")),
  readJson(resolve(profileRoot, "activities/learning-activities.json")),
  readJson(resolve(profileRoot, "cards/learning-cards.json")),
  readJson(resolve(profileRoot, "assessments/question-groups.json")),
  readJson(resolve(profileRoot, "assessments/private/quiz-answer-key.json")),
  readJson(resolve(profileRoot, "sources/source-map.json")),
  readJson(resolve(profileRoot, "assessments/diagnostic/questions.json")),
  readJson(resolve(profileRoot, "assessments/diagnostic/private/answer-key.json")),
]);
const [coverage, assetInventory, qualityReport] = await Promise.all([
  readJson(resolve(profileRoot, "quality/w4-b-coverage-matrix.json")),
  readJson(resolve(profileRoot, "quality/w4-b-asset-inventory.json")),
  readJson(resolve(profileRoot, "quality/quality-report.json")),
]);

ensure(manifest.schemaVersion === 2 && manifest.revision === 3 && manifest.revisionOf === 2 && manifest.status === "draft", "revision 3 manifest identity is invalid");
ensure(diagnosticBlueprint.profileRevision === manifest.revision, "diagnostic blueprint revision must match the revision 3 manifest");
ensure(diagnosticAnswerKey.blueprintId === diagnosticBlueprint.blueprintId, "diagnostic answer key must match the revision 3 blueprint");
const goalsById = new Map(goals.goals.map((goal) => [goal.goalId, goal]));
const cleanGoal = goalsById.get("goal-clean-orders");
ensure(JSON.stringify(cleanGoal.requiredActivityIds) === JSON.stringify(["act-practical"]), "goal requiredActivityIds must contain only act-practical");
const points = new Map(knowledge.knowledgePoints.map((point) => [point.id, point]));
const activities = new Map(activitiesAsset.activities.map((activity) => [activity.activityId, activity]));
const cards = cardsAsset.cards;
ensure(cards.length === coreIds.length && new Set(cards.map((card) => card.knowledgePointId)).size === coreIds.length, "exactly one card per core knowledge point is required");
const allQuestionIds = new Set();
const privateGroups = new Map(privateAsset.groups.map((group) => [group.groupId, group]));
const sourceIds = new Set(sources.sources.map((source) => source.sourceId));
const expectedCoverageAssets = [
  "cards/learning-cards.json",
  "assessments/question-groups.json",
  "assessments/private/quiz-answer-key.json",
  "sources/source-map.json",
];
const profileSnapshotWithoutInventoryAndSeal = await snapshot(profileRoot);
const actualInventoryEntries = profileSnapshotWithoutInventoryAndSeal.entries.filter((entry) =>
  entry.path !== "quality/revision-seal.json" && entry.path !== "quality/w4-b-asset-inventory.json",
);
ensure(Array.isArray(assetInventory.excludedPaths) && assetInventory.excludedPaths.includes("quality/revision-seal.json") && assetInventory.excludedPaths.includes("quality/w4-b-asset-inventory.json"), "asset inventory must explicitly exclude seal and itself");
ensure(!assetInventory.entries.some((entry) => entry.path === "quality/revision-seal.json" || entry.path === "quality/w4-b-asset-inventory.json"), "asset inventory must not include seal or itself");
ensure(assetInventory.entryCount === actualInventoryEntries.length && assetInventory.entries.length === actualInventoryEntries.length, "asset inventory entry count is stale");
for (const entry of assetInventory.entries) {
  const actual = actualInventoryEntries.find((candidate) => candidate.path === entry.path);
  ensure(actual?.sha256 === entry.sha256 && actual.byteLength === entry.byteLength, `asset inventory entry is stale: ${entry.path}`);
}
ensure(qualityReport.gates?.profileSchema === "candidate_validated_by_formal_a_schema_entrypoint", "quality report must record completed formal A Schema validation");
ensure(coverage.coreKnowledgePointCount === coreIds.length && Array.isArray(coverage.coreKnowledgePoints), "coverage matrix core point count is invalid");
for (const pointId of coreIds) {
  const point = points.get(pointId);
  ensure(point?.activityPolicy === "all_in_order" && Number.isInteger(point.contentEstimatedMinutes) && point.contentEstimatedMinutes > 0, `${pointId} requires all_in_order and a positive content estimate`);
  const card = cards.find((entry) => entry.knowledgePointId === pointId);
  ensure(card?.estimatedMinutes === point.contentEstimatedMinutes && !point.activityIds.includes(card.cardId), `${pointId} card binding is invalid`);
  ensure(card.sourceAnchorIds.every((id) => sourceIds.has(id)), `${pointId} card contains an unknown source anchor`);
  const quiz = point.activityIds.map((id) => activities.get(id)).find((activity) => activity?.kind === "mcq" && activity.fixedQuestionGroupId);
  ensure(quiz && quiz.profileRevision === 3 && !Object.hasOwn(quiz, "subtype") && !Object.hasOwn(quiz, "options"), `${pointId} must use one revision 3 group mcq without legacy fields`);
  const publicGroups = publicAsset.groups.filter((group) => group.activityId === quiz.activityId && group.knowledgePointId === pointId);
  const fixed = publicGroups.find((group) => group.role === "fixed" && group.groupId === quiz.fixedQuestionGroupId);
  const supplemental = publicGroups.find((group) => group.role === "supplemental" && group.groupId === quiz.supplementalQuestionGroupId);
  ensure(fixed?.questions.length >= 4 && fixed.questions.length <= 6, `${pointId} fixed group must have 4-6 questions`);
  ensure(supplemental?.questions.length >= 1 && supplemental.questions.length <= 2, `${pointId} supplemental group must have 1-2 questions`);
  const coveragePoint = coverage.coreKnowledgePoints.find((entry) => entry.knowledgePointId === pointId);
  ensure(coveragePoint?.cardId === card.cardId && coveragePoint.activityId === quiz.activityId, `${pointId} coverage card or activity mapping is invalid`);
  ensure(coveragePoint.fixedQuestionGroupId === fixed.groupId && coveragePoint.supplementalQuestionGroupId === supplemental.groupId, `${pointId} coverage question group mapping is invalid`);
  ensure(Array.isArray(coveragePoint.privateAnswerGroupIds) && coveragePoint.privateAnswerGroupIds.includes(fixed.groupId) && coveragePoint.privateAnswerGroupIds.includes(supplemental.groupId) && coveragePoint.privateAnswerGroupsPresent === true, `${pointId} coverage lacks private answer mapping`);
  ensure(Array.isArray(coveragePoint.sourceAnchorIds) && coveragePoint.sourceAnchorIds.length > 0 && coveragePoint.sourceAnchorIds.every((id) => sourceIds.has(id)), `${pointId} coverage lacks valid source anchors`);
  for (const assetPath of expectedCoverageAssets) {
    const asset = Object.values(coveragePoint.assets ?? {}).find((value) => value?.path === assetPath);
    const actual = actualInventoryEntries.find((entry) => entry.path === assetPath);
    ensure(asset?.sha256 === actual?.sha256 && asset.byteLength === actual.byteLength, `${pointId} coverage asset hash is stale: ${assetPath}`);
  }
  for (const group of [fixed, supplemental]) {
    const answerGroup = privateGroups.get(group.groupId);
    ensure(answerGroup?.answers.length === group.questions.length, `${group.groupId} private answer count is invalid`);
    group.questions.forEach((question, index) => {
      ensure(!Object.hasOwn(question, "correctAnswer") && !Object.hasOwn(question, "explanation") && !Object.hasOwn(question, "privateAnswerRef"), `${group.groupId} public question leaks a private field`);
      ensure(!allQuestionIds.has(question.questionId), `questionId repeats across groups: ${question.questionId}`);
      allQuestionIds.add(question.questionId);
      const answer = answerGroup.answers[index];
      ensure(answer.questionId === question.questionId && answer.kind === question.kind && answer.prompt === question.prompt && JSON.stringify(answer.options) === JSON.stringify(question.options), `${group.groupId} answer does not match public question order`);
      ensure(typeof answer.explanation === "string" && answer.explanation.trim().length > 0, `${group.groupId} answer explanation is missing`);
      if (answer.kind === "single_choice") ensure(typeof answer.correctAnswer === "string" && answer.options.includes(answer.correctAnswer), `${group.groupId} single-choice correctAnswer is invalid`);
      if (answer.kind === "judgment") ensure(typeof answer.correctAnswer === "boolean", `${group.groupId} judgment correctAnswer is invalid`);
      ensure(answer.sourceAnchorIds.every((id) => sourceIds.has(id)), `${group.groupId} answer contains an unknown source anchor`);
    });
  }
}
const leakageTokens = ["correctAnswer", "privateAnswerRef", "referenceSolution", "hiddenTest", "rubric", "orders-variant"];
const publicFiles = await publicAssetFiles(profileRoot);
for (const file of publicFiles) {
  const text = await readFile(file.absolute, "utf8").catch(() => "");
  for (const token of leakageTokens) ensure(!text.includes(token), `public asset leaks forbidden token ${token}: ${file.path}`);
}
const revision2Baseline = await snapshot(revision2Root);
const revision2ExpectedTree = "2a4538272cc47a3451b434999d620f429e5deaa0eb0f2c3f95fa76e53d80786d";
ensure(revision2Baseline.treeSha256 === revision2ExpectedTree, "revision 2 baseline tree hash changed");
const revision3Copied = await snapshot(profileRoot);
const revision3ByPath = new Map(revision3Copied.entries.map((entry) => [entry.path, entry]));
const frozenPrefixes = ["assessments/private/", "assessments/public/", "datasets/", "environments/", "rubrics/", "reference-solutions/"];
const frozenRevision2Entries = revision2Baseline.entries.filter((entry) => frozenPrefixes.some((prefix) => entry.path.startsWith(prefix)));
for (const entry of frozenRevision2Entries) {
  const copied = revision3ByPath.get(entry.path);
  ensure(copied?.sha256 === entry.sha256 && copied.byteLength === entry.byteLength, `frozen copied asset changed: ${entry.path}`);
}
const result = {
  status: "PASS",
  auditInputs: { profileRoot, revision2Root, outputPath },
  profileRoot: relative(process.cwd(), profileRoot).replaceAll("\\", "/"),
  coreKnowledgePointCount: coreIds.length, cardCount: cards.length, publicQuestionCount: allQuestionIds.size,
  revision2Baseline, leakageTokens, revision2ExpectedTree,
  frozenCopiedAssets: { prefixes: frozenPrefixes, fileCount: frozenRevision2Entries.length, result: "PASS" },
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
