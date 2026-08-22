import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const outputPath = resolve(packageRoot, "scripts/w5-e-validation/d4-independent-validation.json");
const expectedSeal = "ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d";
const expectedHead = "aaf588202b3ae92ed72c63994b912d78977516bb";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
const text = async (path) => readFile(resolve(repositoryRoot, path), "utf8");
const stableJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort((left, right) => left.localeCompare(right, "en")).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
};

function compare(left, right) {
  const values = [];
  const add = (observable, key, leftValue, rightValue) => {
    if (stableJson(leftValue) !== stableJson(rightValue)) values.push({ observable, key, left: leftValue, right: rightValue });
  };
  add("background", "explanation_preference", left.semantic.background.explanation_preference, right.semantic.background.explanation_preference);
  add("diagnostic", "insufficientKnowledgePointIds", left.semantic.diagnostic.insufficientKnowledgePointIds, right.semantic.diagnostic.insufficientKnowledgePointIds);
  const rightStates = new Map(right.semantic.diagnostic.knowledgeStates.map((state) => [state.knowledgePointId, state]));
  for (const state of left.semantic.diagnostic.knowledgeStates) {
    const other = rightStates.get(state.knowledgePointId);
    for (const field of ["mastery", "confidence", "status", "validEvidenceCount", "skipEligible"]) add("knowledge_state", `${state.knowledgePointId}.${field}`, state[field], other?.[field]);
  }
  const rightNodes = new Map(right.semantic.path.nodes.map((node) => [node.knowledgePointId, node]));
  for (const node of left.semantic.path.nodes) {
    const other = rightNodes.get(node.knowledgePointId);
    for (const field of ["difficulty", "scaffold", "reasonCodes", "estimatedMinutes", "status"]) add("path_node", `${node.knowledgePointId}.${field}`, node[field], other?.[field]);
  }
  return values;
}

function validatePath(item, pointById, activityById) {
  const findings = [];
  const nodes = item.semantic.path.nodes;
  const positions = new Map(nodes.map((node, index) => [node.knowledgePointId, index]));
  if (new Set(nodes.map((node) => node.nodeId)).size !== nodes.length) findings.push("duplicate_node_id");
  if (new Set(nodes.map((node) => node.knowledgePointId)).size !== nodes.length) findings.push("duplicate_knowledge_point");
  for (const node of nodes) {
    const point = pointById.get(node.knowledgePointId);
    if (point === undefined) { findings.push(`unknown_knowledge_point:${node.knowledgePointId}`); continue; }
    if (point.prerequisiteIds.some((id) => !positions.has(id) || positions.get(id) >= positions.get(node.knowledgePointId))) findings.push(`prerequisite_order:${node.knowledgePointId}`);
    if (node.activityIds.length === 0) findings.push(`empty_activity:${node.knowledgePointId}`);
    for (const activityId of node.activityIds) {
      const activity = activityById.get(activityId);
      if (!point.activityIds.includes(activityId) || activity?.primaryKnowledgePointId !== node.knowledgePointId) findings.push(`activity_ownership:${activityId}`);
      if (!activity?.allowedScaffolds.includes(node.scaffold)) findings.push(`scaffold:${activityId}`);
    }
  }
  const available = nodes.filter((node) => node.status === "available");
  if (available.length !== 1) findings.push("available_node_count");
  if (item.semantic.nextStep.completed !== false || item.semantic.nextStep.nodeId !== available[0]?.nodeId || item.semantic.nextStep.activityId !== available[0]?.activityIds[0]) findings.push("next_step_binding");
  if (sha256(stableJson(item.semantic.path)) !== item.pathSha256) findings.push("path_hash");
  if (sha256(stableJson(item.semantic)) !== item.outputSha256) findings.push("output_hash");
  return { caseId: item.input.caseId, legal: findings.length === 0, findings, pathSha256: item.pathSha256, outputSha256: item.outputSha256 };
}

const [paths, differences, bindings, knowledge, activities, crossEnd, activityPage, routes, showcaseSource, showcaseGenerated, codeChain] = await Promise.all([
  json("pi-study-helper/scripts/w5-a-d4/showcase-path-results.json"),
  json("pi-study-helper/scripts/w5-a-d4/showcase-differences.json"),
  json("pi-study-helper/scripts/w5-b-d3/showcase-input-bindings.json"),
  json("pi-study-helper/fixtures/profiles/pandas-cleaning-revision-3-draft/knowledge/knowledge-points.json"),
  json("pi-study-helper/fixtures/profiles/pandas-cleaning-revision-3-draft/activities/learning-activities.json"),
  json("pi-study-helper/scripts/w5-a-d4/cross-end-results.json"),
  text("pi-study-helper/src/web/pages/ActivityPage.tsx"),
  text("pi-study-helper/src/web/app/routes.tsx"),
  text("pi-study-helper/src/web/showcase/formal-showcase-data.ts"),
  json("pi-study-helper/src/web/showcase/formal-showcase-data.json"),
  json("pi-study-helper/scripts/w5-e-validation/d4-real-code-chain.json"),
]);

const pointById = new Map(knowledge.knowledgePoints.map((point) => [point.id, point]));
const activityById = new Map(activities.activities.map((activity) => [activity.activityId, activity]));
const inputChecks = [];
for (const binding of bindings.entries) {
  const bytes = await readFile(resolve(repositoryRoot, binding.path));
  const normalized = Buffer.from(bytes.toString("utf8").replace(/\r\n?|\n/gu, "\n"), "utf8");
  const formal = paths.results.find((item) => item.input.caseId === binding.caseId);
  inputChecks.push({
    caseId: binding.caseId,
    path: binding.path,
    expectedSha256: binding.sha256,
    actualNormalizedSha256: sha256(normalized),
    byteLength: normalized.byteLength,
    matchesB: binding.sha256 === sha256(normalized) && binding.byteLength === normalized.byteLength,
    matchesA: formal?.input.sha256 === binding.sha256 && formal?.input.byteLength === binding.byteLength,
  });
}

const pathChecks = paths.results.map((item) => validatePath(item, pointById, activityById));
const byId = new Map(paths.results.map((item) => [item.input.caseId, item]));
const pairChecks = differences.pairs.map((pair) => {
  const actual = compare(byId.get(pair.leftCaseId), byId.get(pair.rightCaseId));
  return {
    leftCaseId: pair.leftCaseId,
    rightCaseId: pair.rightCaseId,
    expectedCountFromA: pair.differenceCount,
    actualCount: actual.length,
    minimumThree: actual.length >= 3,
    exactFormalMatch: stableJson(actual) === stableJson(pair.differences),
  };
});

const crossEndChecks = crossEnd.trajectories.map((item) => ({
  direction: item.direction,
  sessionId: item.sessionId,
  attemptId: item.attemptId,
  evidenceId: item.evidenceId,
  evidenceVersion: item.evidenceVersion,
  committed: item.committed,
  sameAttempt: item.sameAttemptReadAfterRestart ?? item.sameAttemptReadAfterRefresh ?? false,
  sameEvidence: item.sameEvidenceReadAfterRestart ?? item.sameEvidenceReadAfterRefresh ?? false,
  continuation: item.nextStepReadableAfterRestart ?? item.pendingClearedAfterCommit ?? false,
}));

const closedState = {
  noPreviewButtonText: !activityPage.includes("运行公开检查") && !activityPage.includes("取消预览"),
  noPageRunCall: !activityPage.includes("prepareActivityRun") && !activityPage.includes("createBrowserCodeRunner"),
  noPreviewRoute: !/path:\s*["'](?:preview|run)/u.test(routes),
  formalSubmitPresent: activityPage.includes("提交正式评测"),
  decisionVisible: activityPage.includes("PYODIDE_DISABLED_WITH_NODE_FALLBACK"),
  runnerContractRetained: await readFile(resolve(packageRoot, "src/web/preview/browser-code-runner.ts")).then(() => true, () => false),
  workerContractRetained: await readFile(resolve(packageRoot, "src/web/preview/pyodide-preview.worker.ts")).then(() => true, () => false),
};
const showcaseBinding = {
  readsLocalGeneratedProjection: showcaseSource.includes("./formal-showcase-data.json?raw"),
  generatedPathsMatchA: stableJson(showcaseGenerated.pathResults) === stableJson(paths),
  generatedDifferencesMatchA: stableJson(showcaseGenerated.differences) === stableJson(differences),
  containsManualPathNodes: showcaseSource.includes("node-basic-python") || showcaseSource.includes("act-practical"),
};
const codeChainCheck = {
  status: codeChain.status,
  codeActivityIds: codeChain.codeActivities?.map((item) => item.activityId) ?? [],
  allPageSubmitted: codeChain.codeActivities?.every((item) => item.pageSubmit && item.formalVerdict === "pass") ?? false,
  finalPractical: codeChain.finalPractical === true,
  nextStepCompleted: codeChain.nextStepCompleted === true,
  sessionCompleted: codeChain.sessionCompleted === true,
  privateCodeIncluded: codeChain.privateCodeIncluded === true,
};

const status = paths.status === "PASS"
  && differences.status === "PASS"
  && bindings.profileRevision === 3
  && bindings.assetTreeSha256 === expectedSeal
  && inputChecks.every((item) => item.matchesA && item.matchesB)
  && pathChecks.length === 3 && pathChecks.every((item) => item.legal)
  && pairChecks.length === 3 && pairChecks.every((item) => item.minimumThree && item.exactFormalMatch)
  && crossEndChecks.length === 2 && crossEndChecks.every((item) => item.committed && item.sameAttempt && item.sameEvidence && item.continuation)
  && Object.values(closedState).every(Boolean)
  && showcaseBinding.readsLocalGeneratedProjection && showcaseBinding.generatedPathsMatchA && showcaseBinding.generatedDifferencesMatchA && !showcaseBinding.containsManualPathNodes
  && codeChainCheck.status === "PASS" && codeChainCheck.codeActivityIds.length === 5 && codeChainCheck.allPageSubmitted
  && codeChainCheck.finalPractical && codeChainCheck.nextStepCompleted && codeChainCheck.sessionCompleted && !codeChainCheck.privateCodeIncluded
  ? "PASS" : "FAIL";

const result = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  contract: "W5-C1/W5-R1",
  baseHead: expectedHead,
  generatedAtUtc: new Date().toISOString(),
  profileBinding: { profileRevision: 3, assetTreeSha256: expectedSeal },
  inputChecks,
  pathChecks,
  pathLegality: { legal: pathChecks.filter((item) => item.legal).length, total: pathChecks.length, rate: `${pathChecks.filter((item) => item.legal).length}/${pathChecks.length}` },
  pairChecks,
  crossEndChecks,
  closedState,
  showcaseBinding,
  codeChainCheck,
  pyodideDecision: "PYODIDE_DISABLED_WITH_NODE_FALLBACK",
  liveModel: "LIVE_NOT_RUN",
  status,
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status, pathLegality: result.pathLegality, pairCounts: pairChecks.map((item) => item.actualCount), crossEnd: crossEndChecks.length, closedState }, null, 2)}\n`);
process.exitCode = status === "PASS" ? 0 : 1;
