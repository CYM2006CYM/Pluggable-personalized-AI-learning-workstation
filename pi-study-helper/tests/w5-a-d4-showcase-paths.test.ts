import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BackgroundQuestionnaire } from "../src/contracts/index.js";
import { createDemoRuntime } from "../src/demo/composition-root.js";

interface ShowcaseInput {
  schemaVersion: 1;
  caseId: string;
  personaType: string;
  contract: "W5-C1/W5-R1";
  profileBinding: { subjectId: string; profileRevision: number; assetTreeSha256: string };
  entry: { mode: "recommended"; goalId: string; availableMinutes: number };
  background: BackgroundQuestionnaire;
  diagnostic: {
    blueprintId: string;
    answers: Array<
      { questionId: string; action: "answer"; answer: string | boolean }
      | { questionId: string; action: "skip" }
    >;
  };
}

interface InputBinding {
  caseId: string;
  path: string;
  sha256: string;
  byteLength: number;
}

const appRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(appRoot, "..");
const fixturesRoot = resolve(appRoot, "fixtures/profiles");
const frozenNow = () => new Date("2026-08-22T00:00:00.000Z");
const expectedSeal = "ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function replay(item: ShowcaseInput, binding: InputBinding, dataRoot: string) {
  const runtime = await createDemoRuntime({ dataRoot, fixturesRoot, now: frozenNow });
  try {
    const started = await runtime.facade.startSession({
      requestId: `start-${item.caseId}`,
      subjectId: item.profileBinding.subjectId,
      mode: item.entry.mode,
      goalId: item.entry.goalId,
      availableMinutes: item.entry.availableMinutes,
    });
    const bootstrap = await runtime.bootstrap.getBootstrap({ recoverSessionId: started.sessionId });
    const draft = await runtime.facade.saveDiagnosticDraft({
      requestId: `background-${item.caseId}`,
      sessionId: started.sessionId,
      sessionVersion: started.sessionVersion,
      profileRevision: started.profileRevision,
      diagnosticId: item.diagnostic.blueprintId,
      diagnosticVersion: bootstrap.diagnostic.diagnosticVersion,
      diagnosticDraftVersion: 0,
      background: item.background,
    });
    let diagnosticDraftVersion = draft.diagnosticDraftVersion;
    for (const answer of item.diagnostic.answers) {
      const saved = await runtime.facade.submitDiagnosticAnswer({
        requestId: `${item.caseId}-${answer.questionId}`,
        sessionId: started.sessionId,
        sessionVersion: started.sessionVersion,
        profileRevision: started.profileRevision,
        diagnosticId: item.diagnostic.blueprintId,
        diagnosticVersion: bootstrap.diagnostic.diagnosticVersion,
        diagnosticDraftVersion,
        ...answer,
      });
      diagnosticDraftVersion = saved.diagnosticDraftVersion;
    }
    const completed = await runtime.facade.completeDiagnostic({
      requestId: `complete-${item.caseId}`,
      sessionId: started.sessionId,
      sessionVersion: started.sessionVersion,
      profileRevision: started.profileRevision,
      mode: "fixed",
      diagnosticId: item.diagnostic.blueprintId,
      diagnosticVersion: bootstrap.diagnostic.diagnosticVersion,
      diagnosticDraftVersion,
    });
    const built = await runtime.facade.buildPath({
      requestId: `path-${item.caseId}`,
      sessionId: started.sessionId,
      sessionVersion: completed.sessionVersion,
      profileRevision: completed.profileRevision,
      goalId: item.entry.goalId,
      mode: item.entry.mode,
      availableMinutes: item.entry.availableMinutes,
      evidenceVersion: completed.evidenceVersion,
      selectedKnowledgePointIds: [],
      lockedNodeIds: [],
    });
    if (built.status !== "candidate" || built.pathId === undefined || built.pathVersion === undefined) {
      throw new Error(`${item.caseId} did not produce a candidate path`);
    }
    const confirmed = await runtime.facade.confirmPath({
      requestId: `confirm-${item.caseId}`,
      sessionId: started.sessionId,
      sessionVersion: built.sessionVersion,
      profileRevision: built.profileRevision,
      pathId: built.pathId,
      pathVersion: built.pathVersion,
    });
    const next = await runtime.facade.getNextStep({
      sessionId: started.sessionId,
      sessionVersion: confirmed.sessionVersion,
      profileRevision: confirmed.profileRevision,
      pathVersion: confirmed.pathVersion,
    });
    const semantic = {
      caseId: item.caseId,
      personaType: item.personaType,
      background: item.background,
      diagnostic: {
        evidenceVersion: completed.evidenceVersion,
        insufficientKnowledgePointIds: [...completed.insufficientKnowledgePointIds].sort(),
        knowledgeStates: completed.knowledgeStates.map((state) => ({
          knowledgePointId: state.knowledgePointId,
          mastery: state.mastery,
          confidence: state.confidence,
          status: state.status,
          validEvidenceCount: state.validEvidenceCount,
          evidenceFormCount: state.evidenceFormCount,
          skipEligible: state.skipEligible,
        })),
      },
      path: {
        status: built.status,
        pathVersion: built.pathVersion,
        missingPrerequisiteIds: built.missingPrerequisiteIds,
        nodes: built.nodes,
        confirmedStatus: confirmed.status,
      },
      nextStep: {
        completed: next.completed,
        nodeId: next.node?.nodeId,
        activityId: next.activity?.activityId,
        contentReadiness: next.contentReadiness,
      },
    };
    return {
      schemaVersion: 1,
      contract: item.contract,
      input: { caseId: item.caseId, path: binding.path, byteLength: binding.byteLength, sha256: binding.sha256 },
      profileBinding: item.profileBinding,
      actualIdentifiers: { pathId: built.pathId, pathVersion: built.pathVersion },
      semantic,
      pathSha256: sha256(stableJson(semantic.path)),
      outputSha256: sha256(stableJson(semantic)),
    };
  } finally {
    await runtime.close();
  }
}

function differences(left: Awaited<ReturnType<typeof replay>>, right: Awaited<ReturnType<typeof replay>>) {
  const values: Array<{ observable: string; key: string; left: unknown; right: unknown }> = [];
  const add = (observable: string, key: string, leftValue: unknown, rightValue: unknown) => {
    if (stableJson(leftValue) !== stableJson(rightValue)) values.push({ observable, key, left: leftValue, right: rightValue });
  };
  add("background", "explanation_preference", left.semantic.background.explanation_preference, right.semantic.background.explanation_preference);
  add("diagnostic", "insufficientKnowledgePointIds", left.semantic.diagnostic.insufficientKnowledgePointIds, right.semantic.diagnostic.insufficientKnowledgePointIds);
  const rightStates = new Map(right.semantic.diagnostic.knowledgeStates.map((state) => [state.knowledgePointId, state]));
  for (const state of left.semantic.diagnostic.knowledgeStates) {
    const other = rightStates.get(state.knowledgePointId);
    for (const field of ["mastery", "confidence", "status", "validEvidenceCount", "skipEligible"] as const) {
      add("knowledge_state", `${state.knowledgePointId}.${field}`, state[field], other?.[field]);
    }
  }
  const rightNodes = new Map(right.semantic.path.nodes.map((node) => [node.knowledgePointId, node]));
  for (const node of left.semantic.path.nodes) {
    const other = rightNodes.get(node.knowledgePointId);
    for (const field of ["difficulty", "scaffold", "reasonCodes", "estimatedMinutes", "status"] as const) {
      add("path_node", `${node.knowledgePointId}.${field}`, node[field], other?.[field]);
    }
  }
  return values;
}

describe("W5-D4 A formal showcase PathEngine replay", () => {
  it("binds, replays and mechanically compares all three B showcase inputs", async () => {
    const bindingDocument = JSON.parse(await readFile(resolve(appRoot, "scripts/w5-b-d3/showcase-input-bindings.json"), "utf8")) as {
      profileRevision: number;
      assetTreeSha256: string;
      entries: InputBinding[];
    };
    expect(bindingDocument).toMatchObject({ profileRevision: 3, assetTreeSha256: expectedSeal });
    const outputs: Array<Awaited<ReturnType<typeof replay>>> = [];
    for (const binding of bindingDocument.entries) {
      const inputBytes = await readFile(resolve(workspaceRoot, binding.path));
      const repositoryBytes = Buffer.from(inputBytes.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
      expect(repositoryBytes.byteLength).toBe(binding.byteLength);
      expect(sha256(repositoryBytes)).toBe(binding.sha256);
      const item = JSON.parse(inputBytes.toString("utf8")) as ShowcaseInput;
      expect(item.profileBinding).toEqual({ subjectId: "pandas-cleaning", profileRevision: 3, assetTreeSha256: expectedSeal });
      expect(item).not.toHaveProperty("path");
      expect(item).not.toHaveProperty("knowledgeStates");
      const firstRoot = await mkdtemp(resolve(tmpdir(), `w5-a-d4-${item.caseId}-a-`));
      const secondRoot = await mkdtemp(resolve(tmpdir(), `w5-a-d4-${item.caseId}-b-`));
      try {
        const first = await replay(item, binding, firstRoot);
        const second = await replay(item, binding, secondRoot);
        expect(first.outputSha256).toBe(second.outputSha256);
        expect(first.pathSha256).toBe(second.pathSha256);
        outputs.push(first);
      } finally {
        await Promise.all([rm(firstRoot, { recursive: true, force: true }), rm(secondRoot, { recursive: true, force: true })]);
      }
    }
    const pairs = [[0, 1], [0, 2], [1, 2]] as const;
    const comparison = pairs.map(([leftIndex, rightIndex]) => {
      const left = outputs[leftIndex]!;
      const right = outputs[rightIndex]!;
      const observed = differences(left, right);
      expect(observed.length, `${left.input.caseId} versus ${right.input.caseId}`).toBeGreaterThanOrEqual(3);
      return { leftCaseId: left.input.caseId, rightCaseId: right.input.caseId, differenceCount: observed.length, differences: observed };
    });
    const evidenceDir = process.env.W5_A_D4_EVIDENCE_DIR;
    if (evidenceDir !== undefined) {
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(resolve(evidenceDir, "showcase-path-results.json"), `${JSON.stringify({ schemaVersion: 1, status: "PASS", results: outputs }, null, 2)}\n`, "utf8");
      await writeFile(resolve(evidenceDir, "showcase-differences.json"), `${JSON.stringify({ schemaVersion: 1, status: "PASS", pairs: comparison }, null, 2)}\n`, "utf8");
    }
  }, 60_000);
});
