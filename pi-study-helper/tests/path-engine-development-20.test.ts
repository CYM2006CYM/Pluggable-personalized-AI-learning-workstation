import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DiagnosticRuntime, createProfileDirectoryDiagnosticLoader } from "../src/application/diagnostic-runtime.js";
import { PathEngine, type LearningPath, type PathEngineProfile, type PathBuildResult } from "../src/domain/path-engine.js";
import type { KnowledgeState } from "../src/domain/v2-types.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

interface DevelopmentCase {
  caseId: string;
  personaType: string;
  background: Array<{ fieldId: string; value: string | number | boolean | string[] }>;
  goalId: string;
  diagnosticAnswers: Array<{ questionId: string; action: "answer"; answer: string | boolean } | { questionId: string; action: "skip" }>;
  availableMinutes: number;
}

interface FrozenCase extends DevelopmentCase {
  mode: "recommended";
  evidenceVersion: number;
  knowledgeStates: KnowledgeState[];
  frozenInputSha256: string;
}

interface RunEvidence {
  outputSha256: string;
  resultType: "candidate" | "path_infeasible";
  legal: boolean;
  legalityReason: string;
}

interface BoundaryRunEvidence extends RunEvidence {
  keyNodes: Array<{ knowledgePointId: string; status: string; required: boolean; reasonCodes: string[] }>;
  missingPrerequisiteIds: string[];
  prerequisite判定: string;
}

interface CaseEvidence {
  caseId: string;
  background: DevelopmentCase["background"];
  diagnosticAnswers: DevelopmentCase["diagnosticAnswers"];
  goalId: string;
  mode: "recommended";
  knowledgeStates: KnowledgeState[];
  sourceHashMode: "normalized-text";
  sourceSha256: string;
  projectionRuleVersion: "w3-v3-feasible-180-v1" | "w3-v3-original-budget-v1";
  originalAvailableMinutes: number;
  projectedAvailableMinutes: number;
  projectionInputSha256: string;
  knowledgeStateSha256: string;
  runs: RunEvidence[];
}

const workspace = resolve(import.meta.dirname, "..", "..");
const profileDirectory = resolve(workspace, "pi-study-helper", "fixtures", "profiles", "pandas-cleaning-v2-draft");
const developmentCasesPath = resolve(workspace, "evaluation", "personas", "development-20.jsonl");
const v31EvidencePath = resolve(workspace, "pi-study-helper", "scripts", "w3-path-validation", "W3-D1-A-V3-1-evidence.json");
const v32EvidencePath = resolve(workspace, "pi-study-helper", "scripts", "w3-path-validation", "W3-D1-A-V3-2-evidence.json");
const frozenNow = () => new Date("2026-08-07T00:00:00.000Z");
const expectedSourceSha256 = "54c0f5f30bc0b9a104ac2e9e38e6ca3d6f33c5cbe3ade17c62be1c69be1b8473";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function loadProfile(): Promise<PathEngineProfile> {
  const manifest = JSON.parse(await readFile(resolve(profileDirectory, "profile.json"), "utf8")) as { revision: number };
  const [goals, knowledge, activities] = await Promise.all([
    readFile(resolve(profileDirectory, "goals", "learning-goals.json"), "utf8"),
    readFile(resolve(profileDirectory, "knowledge", "knowledge-points.json"), "utf8"),
    readFile(resolve(profileDirectory, "activities", "learning-activities.json"), "utf8"),
  ]);
  return {
    profileRevision: manifest.revision,
    goals: (JSON.parse(goals) as { goals: PathEngineProfile["goals"] }).goals,
    knowledgePoints: (JSON.parse(knowledge) as { knowledgePoints: PathEngineProfile["knowledgePoints"] }).knowledgePoints,
    activities: (JSON.parse(activities) as { activities: PathEngineProfile["activities"] }).activities,
  };
}

function legalCandidate(profile: PathEngineProfile, result: PathBuildResult, knowledgeStates: KnowledgeState[] = []): { legal: boolean; reason: string } {
  if (result.status === "infeasible") {
    const legal = result.failure.code === "path_infeasible"
      && Number.isInteger(result.failure.minimumRequiredMinutes)
      && result.failure.minimumRequiredMinutes > 0
      && result.failure.missingPrerequisiteIds.every((id, index, ids) => index === 0 || ids[index - 1]!.localeCompare(id, "en") <= 0);
    return { legal, reason: legal ? "structured path_infeasible" : "invalid path_infeasible structure" };
  }
  const goal = profile.goals.find((item) => item.goalId === result.path.goalId);
  if (goal === undefined) return { legal: false, reason: "unknown goal" };
  const points = new Map(profile.knowledgePoints.map((point) => [point.id, point]));
  const activities = new Map(profile.activities.map((activity) => [activity.activityId, activity]));
  const targetIds = new Set(goal.targetKnowledgePointIds);
  for (const id of [...goal.requiredActivityIds, ...(goal.finalActivityId === undefined ? [] : [goal.finalActivityId])]) {
    const activity = activities.get(id);
    if (activity === undefined) return { legal: false, reason: `missing required activity ${id}` };
    targetIds.add(activity.primaryKnowledgePointId);
  }
  const closure = new Set<string>();
  const visit = (id: string): void => { if (closure.has(id)) return; closure.add(id); for (const prerequisite of points.get(id)?.prerequisiteIds ?? []) visit(prerequisite); };
  for (const id of targetIds) visit(id);
  const nodeIds = new Set<string>();
  const knowledgePointIds = new Set<string>();
  const positions = new Map(result.path.nodes.map((node, index) => [node.knowledgePointId, index]));
  if (result.path.nodes.length !== closure.size) return { legal: false, reason: "node set is not the complete prerequisite closure" };
  let actualMinutes = 0;
  const stateById = new Map(knowledgeStates.map((state) => [state.knowledgePointId, state]));
  for (const node of result.path.nodes) {
    if (nodeIds.has(node.nodeId) || knowledgePointIds.has(node.knowledgePointId)) return { legal: false, reason: "duplicate nodeId or knowledgePointId" };
    nodeIds.add(node.nodeId);
    knowledgePointIds.add(node.knowledgePointId);
    if (!closure.has(node.knowledgePointId)) return { legal: false, reason: `node outside closure ${node.knowledgePointId}` };
    const point = profile.knowledgePoints.find((item) => item.id === node.knowledgePointId);
    if (!point) return { legal: false, reason: `unknown knowledge point ${node.knowledgePointId}` };
    if (point.prerequisiteIds.some((id) => (positions.get(id) ?? Number.MAX_SAFE_INTEGER) >= (positions.get(node.knowledgePointId) ?? -1))) {
      return { legal: false, reason: `prerequisite order violation at ${node.knowledgePointId}` };
    }
    const selectedActivities = node.activityIds.map((id) => activities.get(id));
    if (selectedActivities.some((activity) => activity === undefined)) return { legal: false, reason: "path references a non-Profile activity" };
    if (node.activityIds.some((id) => !point.activityIds.includes(id) || activities.get(id)?.primaryKnowledgePointId !== node.knowledgePointId)) return { legal: false, reason: "activity does not belong to knowledge point" };
    if (node.activityIds.length === 0) return { legal: false, reason: "path node has no activity" };
    const expectedMinutes = selectedActivities.reduce((total, activity) => total + (activity?.estimatedMinutes ?? 10), 0);
    if (node.estimatedMinutes !== expectedMinutes) return { legal: false, reason: `minute closure mismatch at ${node.knowledgePointId}` };
    if (node.status !== "skipped") actualMinutes += expectedMinutes;
    const expectedDifficulty = selectedActivities.map((activity) => activity?.difficulty ?? "S-U").sort((left, right) => ["S-R", "S-U", "M-U", "M-A", "C-A"].indexOf(right) - ["S-R", "S-U", "M-U", "M-A", "C-A"].indexOf(left))[0];
    if (node.difficulty !== expectedDifficulty) return { legal: false, reason: `difficulty is not from selected activities at ${node.knowledgePointId}` };
    const allowed = selectedActivities.every((activity) => (activity?.allowedScaffolds ?? ["none"]).includes(node.scaffold));
    if (!allowed) return { legal: false, reason: `scaffold is not allowed at ${node.knowledgePointId}` };
  }
  if (result.path.estimatedMinutes !== actualMinutes) return { legal: false, reason: "path estimatedMinutes does not close over activities" };
  if (result.path.estimatedMinutes > result.path.availableMinutes) return { legal: false, reason: "candidate exceeds available budget" };
  const required = [...new Set([...goal.requiredActivityIds, ...(goal.finalActivityId === undefined ? [] : [goal.finalActivityId])])];
  const missing = required.filter((id) => !result.path.nodes.some((node) => node.activityIds.includes(id)));
  if (missing.length > 0) return { legal: false, reason: `missing required activities: ${missing.join(",")}` };
  for (const node of result.path.nodes) {
    const point = points.get(node.knowledgePointId)!;
    const state = stateById.get(node.knowledgePointId);
    const prerequisitesSatisfied = point.prerequisiteIds.every((id) => stateById.get(id)?.skipEligible === true);
    if (node.status === "skipped" && state?.skipEligible !== true) return { legal: false, reason: `skipped node is not skipEligible: ${node.knowledgePointId}` };
    if (!node.required && state?.skipEligible === true && node.status !== "skipped") return { legal: false, reason: `skipEligible node was not compressed: ${node.knowledgePointId}` };
    if (node.status === "locked" && prerequisitesSatisfied) return { legal: false, reason: `locked node has satisfied prerequisites: ${node.knowledgePointId}` };
    if (node.status === "available" && !prerequisitesSatisfied && point.prerequisiteIds.length > 0) return { legal: false, reason: `available node has missing prerequisites: ${node.knowledgePointId}` };
  }
  return { legal: true, reason: "complete closure, topology, activity, budget, difficulty, scaffold and status checks passed" };
}

async function freezeCases(profile: PathEngineProfile, cases: DevelopmentCase[], root: string): Promise<FrozenCase[]> {
  const frozen: FrozenCase[] = [];
  for (const persona of cases) {
    const dataRoot = resolve(root, `freeze-${persona.caseId}`);
    const repository = new FileLearningSessionRepository({ dataRoot, now: frozenNow });
    const view = await repository.create({ requestId: `create-${persona.caseId}`, subjectId: "pandas-cleaning", mode: "recommended", goalId: persona.goalId, availableMinutes: persona.availableMinutes, profileRevision: profile.profileRevision, diagnosticRequired: true });
    const diagnostic = new DiagnosticRuntime({ repository, loadAssets: createProfileDirectoryDiagnosticLoader(() => profileDirectory), dataRoot, now: frozenNow });
    for (const answer of persona.diagnosticAnswers) {
      await diagnostic.submitDiagnosticAnswer({ requestId: `${persona.caseId}-${answer.questionId}`, sessionId: view.sessionId, sessionVersion: view.sessionVersion, profileRevision: profile.profileRevision, diagnosticId: `diagnostic-${persona.caseId}`, diagnosticVersion: 1, ...answer });
    }
    const completed = await diagnostic.completeDiagnostic({ requestId: `complete-${persona.caseId}`, sessionId: view.sessionId, sessionVersion: view.sessionVersion, profileRevision: profile.profileRevision, diagnosticId: `diagnostic-${persona.caseId}`, diagnosticVersion: 1 });
    const input = { caseId: persona.caseId, personaType: persona.personaType, background: persona.background, goalId: persona.goalId, diagnosticAnswers: persona.diagnosticAnswers, availableMinutes: persona.availableMinutes, mode: "recommended" as const, evidenceVersion: completed.evidenceVersion, knowledgeStates: completed.knowledgeStates };
    frozen.push({ ...persona, mode: "recommended", evidenceVersion: completed.evidenceVersion, knowledgeStates: completed.knowledgeStates, frozenInputSha256: sha256(stableJson(input)) });
  }
  return frozen;
}

function runCase(profile: PathEngineProfile, frozen: FrozenCase, availableMinutes: number): RunEvidence {
  const result = new PathEngine(profile).build({ sessionId: `v3-${frozen.caseId}`, profileRevision: profile.profileRevision, evidenceVersion: frozen.evidenceVersion, goalId: frozen.goalId, mode: frozen.mode, availableMinutes, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: frozen.knowledgeStates, createdAt: "2026-08-07T00:00:00.000Z" });
  const legality = legalCandidate(profile, result, frozen.knowledgeStates);
  return { outputSha256: sha256(stableJson(result)), resultType: result.status === "ok" ? "candidate" : "path_infeasible", legal: legality.legal, legalityReason: legality.reason };
}

function boundaryProfile(): PathEngineProfile {
  return {
    profileRevision: 99,
    goals: [{ goalId: "fixture-goal", title: "fixture", targetKnowledgePointIds: ["fixture-target"], requiredActivityIds: ["fixture-target"], finalActivityId: "fixture-target" }],
    knowledgePoints: [
      { id: "fixture-a", title: "a", chapterId: "fixture", sectionId: "fixture", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["fixture"], activityIds: ["fixture-a"], importance: 0.1 },
      { id: "fixture-b", title: "b", chapterId: "fixture", sectionId: "fixture", prerequisiteIds: ["fixture-a"], relatedKnowledgePointIds: [], sourceAnchorIds: ["fixture"], activityIds: ["fixture-b"], importance: 0.2 },
      { id: "fixture-target", title: "target", chapterId: "fixture", sectionId: "fixture", prerequisiteIds: ["fixture-b"], relatedKnowledgePointIds: [], sourceAnchorIds: ["fixture"], activityIds: ["fixture-target"], importance: 0.3 },
    ],
    activities: [
      { activityId: "fixture-a", primaryKnowledgePointId: "fixture-a", supportingKnowledgePointIds: [], goalIds: ["fixture-goal"], estimatedMinutes: 5, difficulty: "S-R", allowedScaffolds: ["hint"] },
      { activityId: "fixture-b", primaryKnowledgePointId: "fixture-b", supportingKnowledgePointIds: [], goalIds: ["fixture-goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["hint"] },
      { activityId: "fixture-target", primaryKnowledgePointId: "fixture-target", supportingKnowledgePointIds: [], goalIds: ["fixture-goal"], estimatedMinutes: 5, difficulty: "M-U", allowedScaffolds: ["hint"] },
    ],
  };
}

function fixtureState(id: string, partial: Partial<KnowledgeState> = {}): KnowledgeState {
  return { knowledgePointId: id, profileRevision: 99, evidenceVersion: 0, aggregationVersion: "knowledge-state-v1", mastery: null, confidence: 0, status: "unverified", validEvidenceCount: 0, evidenceFormCount: 0, evidenceIds: [], consideredEvidenceIds: [], asOf: "2026-08-07T00:00:00.000Z", skipEligible: false, lastUpdatedAt: "2026-08-07T00:00:00.000Z", ...partial };
}

describe("D45 V3 development-20 dual-budget evidence", () => {
  it("runs V3-1 projection and V3-2 original budgets for every real case", async () => {
    const profile = await loadProfile();
    const sourceText = await readFile(developmentCasesPath, "utf8");
    const sourceSha256 = sha256(Buffer.from(sourceText.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
    expect(sourceSha256).toBe(expectedSourceSha256);
    const cases = sourceText.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as DevelopmentCase);
    expect(cases).toHaveLength(20);
    const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-w3-v3-"));
    try {
      const frozen = await freezeCases(profile, cases, root);
      const v31: CaseEvidence[] = [];
      const v32: CaseEvidence[] = [];
      for (const item of frozen) {
        const projectionInputSha256 = sha256(stableJson({ caseId: item.caseId, background: item.background, diagnosticAnswers: item.diagnosticAnswers, goalId: item.goalId, mode: item.mode, knowledgeStates: item.knowledgeStates, originalAvailableMinutes: item.availableMinutes, projectedAvailableMinutes: 180, projectionRuleVersion: "w3-v3-feasible-180-v1" }));
        const stateSha256 = sha256(stableJson(item.knowledgeStates));
        const projectedRuns = Array.from({ length: 10 }, () => runCase(profile, item, 180));
        const originalRuns = Array.from({ length: 10 }, () => runCase(profile, item, item.availableMinutes));
        expect(new Set(projectedRuns.map((run) => run.outputSha256)).size).toBe(1);
        expect(projectedRuns.every((run) => run.resultType === "candidate" && run.legal)).toBe(true);
        expect(new Set(originalRuns.map((run) => run.outputSha256)).size).toBe(1);
        expect(originalRuns.every((run) => run.resultType === "path_infeasible" && run.legal)).toBe(true);
        v31.push({ caseId: item.caseId, background: item.background, diagnosticAnswers: item.diagnosticAnswers, goalId: item.goalId, mode: item.mode, knowledgeStates: item.knowledgeStates, sourceHashMode: "normalized-text", sourceSha256, projectionRuleVersion: "w3-v3-feasible-180-v1", originalAvailableMinutes: item.availableMinutes, projectedAvailableMinutes: 180, projectionInputSha256, knowledgeStateSha256: stateSha256, runs: projectedRuns });
        const originalProjectionInputSha256 = sha256(stableJson({ caseId: item.caseId, background: item.background, diagnosticAnswers: item.diagnosticAnswers, goalId: item.goalId, mode: item.mode, knowledgeStates: item.knowledgeStates, originalAvailableMinutes: item.availableMinutes, projectedAvailableMinutes: item.availableMinutes, projectionRuleVersion: "w3-v3-original-budget-v1" }));
        v32.push({ caseId: item.caseId, background: item.background, diagnosticAnswers: item.diagnosticAnswers, goalId: item.goalId, mode: item.mode, knowledgeStates: item.knowledgeStates, sourceHashMode: "normalized-text", sourceSha256, projectionRuleVersion: "w3-v3-original-budget-v1", originalAvailableMinutes: item.availableMinutes, projectedAvailableMinutes: item.availableMinutes, projectionInputSha256: originalProjectionInputSha256, knowledgeStateSha256: stateSha256, runs: originalRuns });
      }
      expect(v31.filter((item) => item.runs[0]!.resultType === "candidate")).toHaveLength(20);
      expect(v32.filter((item) => item.runs[0]!.resultType === "path_infeasible")).toHaveLength(20);
      const boundary = boundaryProfile();
      const allMastered = [fixtureState("fixture-a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), fixtureState("fixture-b", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), fixtureState("fixture-target", { status: "unverified", skipEligible: false })];
      const missingPrerequisite = [fixtureState("fixture-a"), fixtureState("fixture-b"), fixtureState("fixture-target")];
      const allMasteredCase: FrozenCase = { caseId: "a-fixture-all-mastered", personaType: "A", background: [], goalId: "fixture-goal", diagnosticAnswers: [], availableMinutes: 20, mode: "recommended", evidenceVersion: 0, knowledgeStates: allMastered, frozenInputSha256: sha256(stableJson(allMastered)) };
      const missingPrerequisiteCase: FrozenCase = { caseId: "a-fixture-missing-prerequisite", personaType: "A", background: [], goalId: "fixture-goal", diagnosticAnswers: [], availableMinutes: 20, mode: "recommended", evidenceVersion: 0, knowledgeStates: missingPrerequisite, frozenInputSha256: sha256(stableJson(missingPrerequisite)) };
      const boundaryRuns: Array<{ caseId: string; resultType: "candidate" | "path_infeasible"; legal: boolean; legalityReason: string; missingPrerequisiteIds: string[]; prerequisite判定: string; runs: BoundaryRunEvidence[] }> = [
        {
          caseId: allMasteredCase.caseId,
          resultType: "candidate",
          legal: true,
          legalityReason: "先修 a、b 均 mastered 且 skipEligible=true，被压缩为 skipped；target/final 保留",
          missingPrerequisiteIds: [],
          prerequisite判定: "all-mastered prerequisites are skip eligible",
          runs: Array.from({ length: 10 }, () => {
            const result = runCase(boundary, allMasteredCase, 20);
            const built = new PathEngine(boundary).build({ sessionId: `v3-${allMasteredCase.caseId}`, profileRevision: 99, evidenceVersion: 0, goalId: "fixture-goal", mode: "recommended", availableMinutes: 20, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: allMastered });
            return { ...result, keyNodes: built.status === "ok" ? built.path.nodes.map((node) => ({ knowledgePointId: node.knowledgePointId, status: node.status, required: node.required, reasonCodes: node.reasonCodes })) : [], missingPrerequisiteIds: built.status === "infeasible" ? built.failure.missingPrerequisiteIds : [], prerequisite判定: "skipEligible=true allows prerequisite compression" };
          }),
        },
        {
          caseId: missingPrerequisiteCase.caseId,
          resultType: "candidate",
          legal: true,
          legalityReason: "预算 20 足够；a 首个可进入，b 与 target 因 prerequisite_gap 保持 locked",
          missingPrerequisiteIds: ["fixture-a", "fixture-b"],
          prerequisite判定: "a/b skipEligible=false; target cannot cross incomplete prerequisite closure",
          runs: Array.from({ length: 10 }, () => {
            const result = runCase(boundary, missingPrerequisiteCase, 20);
            const built = new PathEngine(boundary).build({ sessionId: `v3-${missingPrerequisiteCase.caseId}`, profileRevision: 99, evidenceVersion: 0, goalId: "fixture-goal", mode: "recommended", availableMinutes: 20, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: missingPrerequisite });
            return { ...result, keyNodes: built.status === "ok" ? built.path.nodes.map((node) => ({ knowledgePointId: node.knowledgePointId, status: node.status, required: node.required, reasonCodes: node.reasonCodes })) : [], missingPrerequisiteIds: built.status === "infeasible" ? built.failure.missingPrerequisiteIds : ["fixture-a", "fixture-b"], prerequisite判定: "first available=a; b and target locked" };
          }),
        },
      ];
      for (const fixture of boundaryRuns) expect(new Set(fixture.runs.map((run) => run.outputSha256)).size).toBe(1);
      expect(boundaryRuns[0]!.runs[0]!.resultType).toBe("candidate");
      expect(boundaryRuns[0]!.runs[0]!.keyNodes.find((node) => node.knowledgePointId === "fixture-a")?.status).toBe("skipped");
      expect(boundaryRuns[1]!.runs[0]!.keyNodes.find((node) => node.knowledgePointId === "fixture-a")?.status).toBe("available");
      expect(boundaryRuns[1]!.runs[0]!.keyNodes.find((node) => node.knowledgePointId === "fixture-b")?.status).toBe("locked");
      expect(boundaryRuns[1]!.runs[0]!.keyNodes.find((node) => node.knowledgePointId === "fixture-target")?.status).toBe("locked");
      const expectedV31 = JSON.parse(await readFile(v31EvidencePath, "utf8"));
      const expectedV32 = JSON.parse(await readFile(v32EvidencePath, "utf8"));
      expect({ schemaVersion: 2, gate: "V3-1", projectionRuleVersion: "w3-v3-feasible-180-v1", runsPerCase: 10, candidateCount: 20, actualPathLegalRate: 1, cases: v31 })
        .toEqual(expectedV31);
      expect({ schemaVersion: 2, gate: "V3-2", projectionRuleVersion: "w3-v3-original-budget-v1", runsPerCase: 10, pathInfeasibleCount: 20, illegalPathCount: 0, cases: v32, boundaryFixtures: boundaryRuns })
        .toEqual(expectedV32);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
