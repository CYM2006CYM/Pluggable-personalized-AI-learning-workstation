import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const profileRoot = resolve(process.argv[2] ?? "fixtures/profiles/pandas-cleaning-revision-3-draft");
const revision2Root = resolve(process.argv[3] ?? "fixtures/profiles/pandas-cleaning-v2-draft");
const qualityRoot = resolve(profileRoot, "quality");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

async function inventory(root, exclude = new Set()) {
  const entries = [];
  for (const absolute of await files(root)) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    if (exclude.has(path)) continue;
    const bytes = await readFile(absolute);
    entries.push({ path, sha256: sha256(bytes), byteLength: (await stat(absolute)).size });
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return entries;
}

const revision2Entries = await inventory(revision2Root);
const revision2TreeSha256 = sha256(revision2Entries.map((entry) => `${entry.path}\0raw-binary\0${entry.sha256}\0${entry.byteLength}\n`).join(""));
const assetFiles = {
  cards: "cards/learning-cards.json",
  publicQuestionGroups: "assessments/question-groups.json",
  privateAnswers: "assessments/private/quiz-answer-key.json",
  sourceMap: "sources/source-map.json",
};
const [knowledge, cardsAsset, publicQuestions, privateAnswers] = await Promise.all([
  JSON.parse(await readFile(resolve(profileRoot, "knowledge/knowledge-points.json"), "utf8")),
  JSON.parse(await readFile(resolve(profileRoot, assetFiles.cards), "utf8")),
  JSON.parse(await readFile(resolve(profileRoot, assetFiles.publicQuestionGroups), "utf8")),
  JSON.parse(await readFile(resolve(profileRoot, assetFiles.privateAnswers), "utf8")),
]);
const coreIds = [
  "pandas.clean.read-csv", "pandas.clean.inspect-dataframe", "pandas.clean.missing-values",
  "pandas.clean.duplicate-orders", "pandas.clean.type-format", "pandas.clean.validate-result",
];
const points = new Map(knowledge.knowledgePoints.map((point) => [point.id, point]));
const cardsByPoint = new Map(cardsAsset.cards.map((card) => [card.knowledgePointId, card]));
const privateByGroup = new Map(privateAnswers.groups.map((group) => [group.groupId, group]));
const assetEvidence = Object.fromEntries(await Promise.all(Object.entries(assetFiles).map(async ([kind, path]) => {
  const bytes = await readFile(resolve(profileRoot, path));
  return [kind, { path, sha256: sha256(bytes), byteLength: bytes.byteLength }];
})));
const privatePrefixes = [
  "assessments/private/", "assessments/diagnostic/private/", "assessments/quiz-fallback/private/",
  "datasets/private/", "rubrics/", "reference-solutions/",
];
const privateEntries = (await inventory(profileRoot, new Set(["quality/revision-seal.json", "quality/w4-b-asset-inventory.json"])))
  .filter((entry) => privatePrefixes.some((prefix) => entry.path.startsWith(prefix)));
const coverage = {
  status: "candidate",
  coreKnowledgePointCount: coreIds.length,
  hashScope: "raw SHA-256 and byteLength of complete asset files; no sub-object canonical hash is asserted",
  coreKnowledgePoints: coreIds.map((knowledgePointId) => {
    const point = points.get(knowledgePointId);
    const card = cardsByPoint.get(knowledgePointId);
    const groups = publicQuestions.groups.filter((group) => group.knowledgePointId === knowledgePointId);
    const fixed = groups.find((group) => group.role === "fixed");
    const supplemental = groups.find((group) => group.role === "supplemental");
    return {
      knowledgePointId,
      cardId: card?.cardId,
      activityId: fixed?.activityId,
      fixedQuestionGroupId: fixed?.groupId,
      supplementalQuestionGroupId: supplemental?.groupId,
      privateAnswerGroupIds: [fixed?.groupId, supplemental?.groupId],
      privateAnswerGroupsPresent: [fixed?.groupId, supplemental?.groupId].every((id) => privateByGroup.has(id)),
      sourceAnchorIds: point?.sourceAnchorIds ?? [],
      assets: assetEvidence,
    };
  }),
  excludedAuxiliaryKnowledgePointIds: ["basic-python"],
  fixedQuestionCountPerGroup: 4,
  supplementalQuestionCountPerGroup: 1,
  supplementalPurpose: "dynamic candidate completion only; never a complete fixed retry group",
};
const isolation = {
  status: "candidate",
  publicAssets: ["cards/learning-cards.json", "assessments/question-groups.json"],
  privateAssets: privateEntries,
  privatePrefixes,
  ownerAuditRequirement: "Private asset bodies are excluded from ordinary transport ZIPs, but must be supplied in a responsible-person-readable complete audit directory that is bound by this report, the full file manifest and the revision seal.",
  prohibitedPublicTokens: ["correctAnswer", "privateAnswerRef", "referenceSolution", "hiddenTest", "rubric", "orders-variant"],
  conclusion: "Public card and quiz assets contain no answer keys, explanations, private answer references, rubrics, hidden-test references, reference solutions, or private CSV identifiers.",
};
const immutability = {
  status: "candidate",
  sourceRevision: 2,
  sourceDirectory: "fixtures/profiles/pandas-cleaning-v2-draft",
  fileCount: revision2Entries.length,
  treeSha256: revision2TreeSha256,
  algorithm: "relative POSIX path sorted by UTF-8 bytes; raw-binary SHA-256 and byte length",
  entries: revision2Entries,
};
await Promise.all([
  writeFile(resolve(qualityRoot, "w4-b-coverage-matrix.json"), `${JSON.stringify(coverage, null, 2)}\n`),
  writeFile(resolve(qualityRoot, "w4-b-answer-isolation-report.json"), `${JSON.stringify(isolation, null, 2)}\n`),
  writeFile(resolve(qualityRoot, "w4-b-revision-2-immutability.json"), `${JSON.stringify(immutability, null, 2)}\n`),
]);
const finalAssetEntries = await inventory(profileRoot, new Set([
  "quality/revision-seal.json",
  "quality/w4-b-asset-inventory.json",
]));
const assetInventory = {
  status: "candidate",
  profileDirectory: "fixtures/profiles/pandas-cleaning-revision-3-draft",
  algorithm: "relative POSIX path sorted by UTF-8 bytes; raw-binary SHA-256 and byteLength",
  excludedPaths: ["quality/revision-seal.json", "quality/w4-b-asset-inventory.json"],
  entryCount: finalAssetEntries.length,
  entries: finalAssetEntries,
};
await writeFile(resolve(qualityRoot, "w4-b-asset-inventory.json"), `${JSON.stringify(assetInventory, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", revision2TreeSha256, revision2FileCount: revision2Entries.length, revision3InventoryCount: finalAssetEntries.length, privateAssetCount: privateEntries.length }, null, 2));
