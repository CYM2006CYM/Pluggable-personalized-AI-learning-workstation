import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProfileDirectoryDiagnosticLoader, DiagnosticRuntime } from "../src/application/diagnostic-runtime.js";
import { PathEngine, type PathEngineProfile } from "../src/domain/path-engine.js";
import type { DiagnosticQuestionSafeView } from "../src/contracts/index.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

const projectRoot = resolve(import.meta.dirname, "..", "..");
const profileDirectory = resolve(projectRoot, "pi-study-helper", "fixtures", "profiles", "pandas-cleaning-revision-3-draft");
const now = () => new Date("2026-08-25T00:00:00.000Z");
const background = {
  python_experience: "basic" as const,
  pandas_experience: "basic" as const,
  explanation_preference: "step_by_step" as const,
};
const roots: string[] = [];

async function loadPathProfile(): Promise<PathEngineProfile> {
  const manifest = JSON.parse(await readFile(resolve(profileDirectory, "profile.json"), "utf8")) as { revision: number };
  const [goalsRaw, knowledgeRaw, activitiesRaw] = await Promise.all([
    readFile(resolve(profileDirectory, "goals", "learning-goals.json"), "utf8"),
    readFile(resolve(profileDirectory, "knowledge", "knowledge-points.json"), "utf8"),
    readFile(resolve(profileDirectory, "activities", "learning-activities.json"), "utf8"),
  ]);
  return {
    profileRevision: manifest.revision,
    goals: (JSON.parse(goalsRaw) as { goals: PathEngineProfile["goals"] }).goals,
    knowledgePoints: (JSON.parse(knowledgeRaw) as { knowledgePoints: PathEngineProfile["knowledgePoints"] }).knowledgePoints,
    activities: (JSON.parse(activitiesRaw) as { activities: PathEngineProfile["activities"] }).activities,
  };
}

function alternateAnswer(question: DiagnosticQuestionSafeView, correctAnswer: string | boolean): string | boolean {
  if (question.kind === "judgment") return !correctAnswer;
  const alternate = question.options?.find((option) => option !== correctAnswer);
  if (alternate === undefined) throw new Error(`diagnostic_question_has_no_alternate:${question.questionId}`);
  return alternate;
}

async function runCase(caseId: string, answerCorrectly: boolean) {
  const dataRoot = await mkdtemp(resolve(tmpdir(), `pi-study-helper-phase2-${caseId}-`));
  roots.push(dataRoot);
  const repository = new FileLearningSessionRepository({ dataRoot, now });
  const profile = await loadPathProfile();
  const view = await repository.create({
    requestId: `create-${caseId}`, subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders",
    availableMinutes: 400, profileRevision: profile.profileRevision, diagnosticRequired: true,
  });
  const loadAssets = createProfileDirectoryDiagnosticLoader(() => profileDirectory);
  const assets = await loadAssets("pandas-cleaning", profile.profileRevision);
  const runtime = new DiagnosticRuntime({ repository, dataRoot, now, loadAssets });
  const draft = await runtime.saveDiagnosticDraft({
    requestId: `background-${caseId}`, sessionId: view.sessionId, sessionVersion: view.sessionVersion,
    profileRevision: profile.profileRevision, diagnosticId: assets.blueprint.blueprintId, diagnosticVersion: 1,
    diagnosticDraftVersion: 0, background,
  });
  let draftVersion = draft.diagnosticDraftVersion;
  for (const question of assets.blueprint.questions) {
    const answerKey = assets.answerKey.answers.find((item) => item.questionId === question.questionId)!;
    const answer = answerCorrectly ? answerKey.correctAnswer : alternateAnswer(question, answerKey.correctAnswer);
    const submitted = await runtime.submitDiagnosticAnswer({
      requestId: `${caseId}-${question.questionId}`, sessionId: view.sessionId, sessionVersion: view.sessionVersion,
      profileRevision: profile.profileRevision, diagnosticId: assets.blueprint.blueprintId, diagnosticVersion: 1,
      diagnosticDraftVersion: draftVersion, questionId: question.questionId, action: "answer", answer,
    });
    draftVersion = submitted.diagnosticDraftVersion;
  }
  const completed = await runtime.completeDiagnostic({
    requestId: `complete-${caseId}`, sessionId: view.sessionId, sessionVersion: view.sessionVersion,
    profileRevision: profile.profileRevision, mode: "fixed", diagnosticId: assets.blueprint.blueprintId,
    diagnosticVersion: 1, diagnosticDraftVersion: draftVersion,
  });
  const snapshot = await repository.getSnapshot({ sessionId: view.sessionId, sessionVersion: completed.sessionVersion, profileRevision: profile.profileRevision });
  const pathInput = {
    sessionId: view.sessionId, profileRevision: profile.profileRevision, evidenceVersion: completed.evidenceVersion,
    goalId: "goal-clean-orders", mode: "recommended" as const, availableMinutes: 400,
    selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: completed.knowledgeStates,
    createdAt: now().toISOString(),
  };
  const engine = new PathEngine(profile);
  const path = engine.build(pathInput);
  if (path.status !== "ok") throw new Error(`phase2_path_infeasible:${caseId}`);
  return { completed, snapshot, path, engine, pathInput };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Phase 2 diagnostic to path fact chain", () => {
  it("uses objective-only diagnostics with two evidence forms for every core Pandas module", async () => {
    const assets = await createProfileDirectoryDiagnosticLoader(() => profileDirectory)("pandas-cleaning", 3);
    expect(assets.blueprint.questions).toHaveLength(13);
    expect(assets.answerKey.answers).toHaveLength(13);
    expect(assets.blueprint.questions.every((question) => question.kind === "single_choice" || question.kind === "judgment")).toBe(true);
    const coreKnowledgePointIds = [
      "pandas.clean.read-csv",
      "pandas.clean.inspect-dataframe",
      "pandas.clean.missing-values",
      "pandas.clean.duplicate-orders",
      "pandas.clean.type-format",
      "pandas.clean.validate-result",
    ];
    for (const knowledgePointId of coreKnowledgePointIds) {
      const questions = assets.blueprint.questions.filter((question) => question.knowledgePointId === knowledgePointId);
      expect(questions).toHaveLength(2);
      expect(new Set(questions.map((question) => question.evidenceForm))).toEqual(new Set(["selected_response", "code_reasoning"]));
    }
    expect(assets.blueprint.questions.filter((question) => question.knowledgePointId === "basic-python")).toHaveLength(1);
  });

  it("maps different diagnostic answers into evidence, knowledge states and explainable path differences", async () => {
    const correct = await runCase("all-correct", true);
    const incorrect = await runCase("all-incorrect", false);
    const correctRead = correct.completed.knowledgeStates.find((state) => state.knowledgePointId === "pandas.clean.read-csv")!;
    const incorrectRead = incorrect.completed.knowledgeStates.find((state) => state.knowledgePointId === "pandas.clean.read-csv")!;

    expect(correctRead).toMatchObject({ mastery: 1, status: "mastered", validEvidenceCount: 2, evidenceFormCount: 2, diagnosticSkipEligible: true });
    expect(incorrectRead).toMatchObject({ mastery: 0, status: "support_needed", validEvidenceCount: 2, evidenceFormCount: 2 });
    expect(incorrectRead.diagnosticSkipEligible).not.toBe(true);
    expect(correct.snapshot.evidence.find((item) => item.knowledgePointId === "pandas.clean.read-csv")?.outcome).toBe("correct");
    expect(incorrect.snapshot.evidence.find((item) => item.knowledgePointId === "pandas.clean.read-csv")?.outcome).toBe("incorrect");

    const correctNode = correct.path.path.nodes.find((node) => node.knowledgePointId === "pandas.clean.read-csv")!;
    const incorrectNode = incorrect.path.path.nodes.find((node) => node.knowledgePointId === "pandas.clean.read-csv")!;
    expect(correctNode.reasonCodes).not.toContain("low_mastery");
    expect(incorrectNode.reasonCodes).toContain("low_mastery");
    expect(correct.path.path.nodes.map((node) => node.knowledgePointId)).toEqual(incorrect.path.path.nodes.map((node) => node.knowledgePointId));
    expect(correct.path.path.nodes.filter((node) => node.status === "skipped")).toHaveLength(0);
    expect(correct.path.path.estimatedMinutes).toBe(correct.path.path.nodes.reduce((total, node) => total + (node.status === "skipped" ? 0 : node.estimatedMinutes), 0));
    expect(incorrect.path.path.estimatedMinutes).toBe(incorrect.path.path.nodes.reduce((total, node) => total + (node.status === "skipped" ? 0 : node.estimatedMinutes), 0));
  });

  it("only skips qualified modules selected by the learner and keeps the final practical", async () => {
    const result = await runCase("learner-selected-skips", true);
    const eligibleIds = result.completed.knowledgeStates
      .filter((state) => state.diagnosticSkipEligible === true)
      .map((state) => state.knowledgePointId);
    const selected = result.engine.build({ ...result.pathInput, diagnosticSkipKnowledgePointIds: eligibleIds });
    if (selected.status !== "ok") throw new Error("selected_skip_path_infeasible");

    const readCsv = selected.path.nodes.find((node) => node.knowledgePointId === "pandas.clean.read-csv")!;
    expect(readCsv.status).toBe("skipped");
    expect(readCsv.reasonCodes).toContain("diagnostic_skip_selected");

    const validation = selected.path.nodes.find((node) => node.knowledgePointId === "pandas.clean.validate-result")!;
    expect(validation.status).not.toBe("skipped");
    expect(validation.activityIds).toEqual(["act-practical"]);
    expect(validation.reasonCodes).toContain("diagnostic_skip_selected");
    expect(selected.path.estimatedMinutes).toBeLessThan(result.path.path.estimatedMinutes);
  });

  it("rejects a diagnostic skip selection without two correct evidence forms", async () => {
    const result = await runCase("unqualified-skip", false);
    const selected = result.engine.build({
      ...result.pathInput,
      diagnosticSkipKnowledgePointIds: ["pandas.clean.read-csv"],
    });
    expect(selected).toMatchObject({ status: "infeasible" });
  });

  it("does not accept general skip eligibility as objective-diagnostic skip proof", async () => {
    const result = await runCase("general-skip-only", true);
    const states = result.completed.knowledgeStates.map((state) => state.knowledgePointId === "pandas.clean.read-csv"
      ? { ...state, skipEligible: true, diagnosticSkipEligible: false }
      : state);
    const selected = result.engine.build({
      ...result.pathInput,
      knowledgeStates: states,
      diagnosticSkipKnowledgePointIds: ["pandas.clean.read-csv"],
    });
    expect(selected).toMatchObject({ status: "infeasible" });
  });

  it("rebuilds the same path deterministically from one completed diagnostic snapshot", async () => {
    const result = await runCase("repeatable", true);
    const first = result.path.path;
    const second = result.engine.build(result.pathInput);
    expect(second).toEqual(result.path);
    expect(first.estimatedMinutes).toBe(first.nodes.reduce((total, node) => total + (node.status === "skipped" ? 0 : node.estimatedMinutes), 0));
  });
});
