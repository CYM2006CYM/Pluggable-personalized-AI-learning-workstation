import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DiagnosticRuntime, createProfileDirectoryDiagnosticLoader } from "../src/application/diagnostic-runtime.js";
import type { BackgroundQuestionnaire } from "../src/contracts/index.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

interface ShowcaseInput {
  caseId: string;
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

const appRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(appRoot, "..");
const profileRoot = resolve(appRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const showcasePaths = [
  "evaluation/showcases/computer-background/input.json",
  "evaluation/showcases/beginner-background/input.json",
  "evaluation/showcases/task-oriented/input.json",
];
const frozenNow = () => new Date("2026-08-22T00:00:00.000Z");

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en")).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function replay(item: ShowcaseInput, dataRoot: string) {
  const repository = new FileLearningSessionRepository({ dataRoot, now: frozenNow });
  const view = await repository.create({
    requestId: `start-${item.caseId}`,
    subjectId: item.profileBinding.subjectId,
    profileRevision: item.profileBinding.profileRevision,
    mode: item.entry.mode,
    goalId: item.entry.goalId,
    availableMinutes: item.entry.availableMinutes,
    diagnosticRequired: true,
  });
  const loadAssets = createProfileDirectoryDiagnosticLoader(() => profileRoot);
  const assets = await loadAssets(item.profileBinding.subjectId, item.profileBinding.profileRevision);
  const runtime = new DiagnosticRuntime({
    repository,
    loadAssets,
    dataRoot,
    now: frozenNow,
  });
  const draft = await runtime.saveDiagnosticDraft({
    requestId: `background-${item.caseId}`,
    sessionId: view.sessionId,
    sessionVersion: view.sessionVersion,
    profileRevision: item.profileBinding.profileRevision,
    diagnosticId: item.diagnostic.blueprintId,
    diagnosticVersion: 1,
    diagnosticDraftVersion: 0,
    background: item.background,
  });
  let diagnosticDraftVersion = draft.diagnosticDraftVersion;
  for (const answer of item.diagnostic.answers) {
    const saved = await runtime.submitDiagnosticAnswer({
      requestId: `${item.caseId}-${answer.questionId}`,
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: item.profileBinding.profileRevision,
      diagnosticId: item.diagnostic.blueprintId,
      diagnosticVersion: 1,
      diagnosticDraftVersion,
      ...answer,
    });
    diagnosticDraftVersion = saved.diagnosticDraftVersion;
  }
  const historicalQuestionIds = new Set(item.diagnostic.answers.map((answer) => answer.questionId));
  for (const question of assets.blueprint.questions) {
    if (historicalQuestionIds.has(question.questionId)) continue;
    const saved = await runtime.submitDiagnosticAnswer({
      requestId: `${item.caseId}-${question.questionId}-w6-compat-skip`,
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: item.profileBinding.profileRevision,
      diagnosticId: item.diagnostic.blueprintId,
      diagnosticVersion: 1,
      diagnosticDraftVersion,
      questionId: question.questionId,
      action: "skip",
    });
    diagnosticDraftVersion = saved.diagnosticDraftVersion;
  }
  const completed = await runtime.completeDiagnostic({
    requestId: `complete-${item.caseId}`,
    sessionId: view.sessionId,
    sessionVersion: view.sessionVersion,
    profileRevision: item.profileBinding.profileRevision,
    mode: "fixed",
    diagnosticId: item.diagnostic.blueprintId,
    diagnosticVersion: 1,
    diagnosticDraftVersion,
  });
  const summary = {
    profileRevision: completed.profileRevision,
    evidenceVersion: completed.evidenceVersion,
    insufficientKnowledgePointIds: completed.insufficientKnowledgePointIds,
    knowledgeStates: completed.knowledgeStates.map((state) => ({
      knowledgePointId: state.knowledgePointId,
      mastery: state.mastery,
      confidence: state.confidence,
      status: state.status,
      validEvidenceCount: state.validEvidenceCount,
      skipEligible: state.skipEligible,
    })),
  };
  return createHash("sha256").update(stableJson(summary)).digest("hex");
}

describe("W5-D3 B three showcase diagnostic replay", () => {
  for (const relativePath of showcasePaths) {
    it(`replays ${relativePath} deterministically without prewriting a path`, async () => {
      const item = JSON.parse(await readFile(resolve(workspaceRoot, relativePath), "utf8")) as ShowcaseInput;
      const firstRoot = await mkdtemp(resolve(tmpdir(), `w5-b-d3-${item.caseId}-a-`));
      const secondRoot = await mkdtemp(resolve(tmpdir(), `w5-b-d3-${item.caseId}-b-`));
      try {
        const [first, second] = await Promise.all([replay(item, firstRoot), replay(item, secondRoot)]);
        expect(first).toBe(second);
        expect(item).not.toHaveProperty("path");
        expect(item).not.toHaveProperty("knowledgeStates");
        expect(item).not.toHaveProperty("evidence");
        expect(item).not.toHaveProperty("mastery");
      } finally {
        await Promise.all([rm(firstRoot, { recursive: true, force: true }), rm(secondRoot, { recursive: true, force: true })]);
      }
    });
  }
});
