import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import {
  DiagnosticValidationError,
  parseDiagnosticAnswerKey,
  parseDiagnosticBlueprint,
  type DiagnosticAnswerKeyAsset,
  type DiagnosticAnswerRecord,
  type DiagnosticBlueprintAsset,
} from "../domain/diagnostic.js";
import { calculateKnowledgeStates } from "../domain/knowledge-state.js";
import type { Evidence, KnowledgePointDefinition, LearnerDiagnostic } from "../domain/v2-types.js";
import {
  assertPathInside,
  assertSafeFileComponent,
  resolveInside,
  writeJsonAtomic,
} from "../infrastructure/safe-files.js";
import {
  LearningSessionRepositoryError,
  type LearningSessionRepository,
} from "../repositories/learning-session-repository.js";
import type {
  CompleteDiagnosticInput,
  DiagnosticAnswerOutput,
  DiagnosticCompleteOutput,
  DiagnosticDraftOutput,
  LearningRuntimeFacade,
  SaveDiagnosticDraftInput,
  SubmitDiagnosticAnswerInput,
} from "./learning-runtime-facade.js";

export interface DiagnosticRuntimeAssets {
  blueprint: DiagnosticBlueprintAsset;
  answerKey: DiagnosticAnswerKeyAsset;
  knowledgePoints?: readonly Pick<KnowledgePointDefinition, "id" | "requiresCodeEvidence">[];
}

export type DiagnosticAssetsLoader = (
  subjectId: string,
  profileRevision: number,
) => Promise<DiagnosticRuntimeAssets>;

export type DiagnosticSubmissionInput = SubmitDiagnosticAnswerInput;

interface StoredDiagnosticAnswer extends DiagnosticAnswerRecord {
  diagnosticId: string;
  diagnosticVersion: number;
  submissionHash: string;
  output: DiagnosticAnswerOutput;
  evidenceCandidate?: Evidence;
}

interface StoredCompletionCandidate {
  inputHash: string;
  diagnostic: LearnerDiagnostic;
  evidenceCandidates: Evidence[];
}

export interface DiagnosticRuntimeOptions {
  repository: LearningSessionRepository;
  loadAssets: DiagnosticAssetsLoader;
  dataRoot?: string;
  now?: () => Date;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson<T>(path: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new LearningSessionRepositoryError("storage_error", `${label} is not valid JSON`);
  }
}

function assertSubmissionShape(input: unknown): asserts input is SubmitDiagnosticAnswerInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DiagnosticValidationError("diagnostic_answer_invalid", "Diagnostic submission must be an object");
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.action !== "answer" && candidate.action !== "skip") {
    throw new DiagnosticValidationError("diagnostic_answer_invalid", "Diagnostic submission action must be answer or skip");
  }
  const hasAnswer = Object.prototype.hasOwnProperty.call(candidate, "answer");
  if (candidate.action === "skip" && hasAnswer) {
    throw new DiagnosticValidationError("diagnostic_answer_invalid", "Skip submissions must not include answer");
  }
  if (candidate.action === "answer" && (!hasAnswer || candidate.answer === undefined)) {
    throw new DiagnosticValidationError("diagnostic_answer_invalid", "Answer submissions must include answer");
  }
}

const diagnosticSubmissionLocks = new Map<string, Promise<void>>();

async function withDiagnosticSubmissionLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = diagnosticSubmissionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => { release = resolveLock; });
  const chain = previous.then(() => current);
  diagnosticSubmissionLocks.set(key, chain);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (diagnosticSubmissionLocks.get(key) === chain) diagnosticSubmissionLocks.delete(key);
  }
}

function validateAssets(assets: DiagnosticRuntimeAssets, profileRevision: number): void {
  if (assets.blueprint.profileRevision !== profileRevision) {
    throw new DiagnosticValidationError("profile_revision_conflict", "Diagnostic blueprint revision does not match session");
  }
  parseDiagnosticBlueprint(assets.blueprint);
  parseDiagnosticAnswerKey(assets.answerKey, assets.blueprint);
}

export class DiagnosticRuntime implements Pick<
  LearningRuntimeFacade,
  "saveDiagnosticDraft" | "submitDiagnosticAnswer" | "completeDiagnostic"
> {
  private readonly repository: LearningSessionRepository;
  private readonly loadAssets: DiagnosticAssetsLoader;
  private readonly familiesRoot: string;
  private readonly now: () => Date;

  constructor(options: DiagnosticRuntimeOptions) {
    this.repository = options.repository;
    this.loadAssets = options.loadAssets;
    this.familiesRoot = profileFamiliesRoot(resolveStudyDataRoot(options.dataRoot));
    this.now = options.now ?? (() => new Date());
  }

  private async sessionDirectory(subjectId: string, sessionId: string): Promise<string> {
    assertSafeFileComponent(sessionId, "sessionId");
    const directory = resolveInside(this.familiesRoot, subjectId, "_user", "learning_sessions", sessionId);
    if (!(await exists(resolve(directory, "checkpoints", "latest.json")))) {
      throw new LearningSessionRepositoryError("session_not_found", `Learning session not found: ${sessionId}`);
    }
    return directory;
  }

  private async snapshot(input: { sessionId: string; sessionVersion: number; profileRevision: number }) {
    const snapshot = await this.repository.getSnapshot(input);
    if (snapshot.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    if (snapshot.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }
    return snapshot;
  }

  async saveDiagnosticDraft(input: SaveDiagnosticDraftInput): Promise<DiagnosticDraftOutput> {
    assertSafeFileComponent(input.requestId, "requestId");
    assertSafeFileComponent(input.diagnosticId, "diagnosticId");
    const snapshot = await this.snapshot(input);
    const assets = await this.loadAssets(snapshot.view.subjectId, input.profileRevision);
    validateAssets(assets, input.profileRevision);
    if (!assets.blueprint.questions.some((question) => question.questionId === input.currentQuestionId)
        && input.currentQuestionId !== undefined) {
      throw new DiagnosticValidationError("diagnostic_answer_invalid", "Current diagnostic question does not exist");
    }

    const savedAt = this.now().toISOString();
    const directory = await this.sessionDirectory(snapshot.view.subjectId, input.sessionId);
    await writeJsonAtomic(resolve(directory, "diagnostic", "background.json"), {
      diagnosticId: input.diagnosticId,
      diagnosticVersion: input.diagnosticVersion,
      background: input.background,
      savedAt,
    });
    await writeJsonAtomic(resolve(directory, "diagnostic", "draft.json"), {
      requestId: input.requestId,
      diagnosticId: input.diagnosticId,
      diagnosticVersion: input.diagnosticVersion,
      ...(input.currentQuestionId === undefined ? {} : { currentQuestionId: input.currentQuestionId }),
      savedAt,
    });
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      diagnosticId: input.diagnosticId,
      diagnosticVersion: input.diagnosticVersion,
      ...(input.currentQuestionId === undefined ? {} : { currentQuestionId: input.currentQuestionId }),
      savedAt,
    };
  }

  async submitDiagnosticAnswer(input: DiagnosticSubmissionInput): Promise<DiagnosticAnswerOutput> {
    assertSubmissionShape(input);
    assertSafeFileComponent(input.requestId, "requestId");
    assertSafeFileComponent(input.diagnosticId, "diagnosticId");
    assertSafeFileComponent(input.questionId, "questionId");
    const lockKey = JSON.stringify([input.sessionId, input.diagnosticId, input.diagnosticVersion]);
    return withDiagnosticSubmissionLock(lockKey, async () => {
    const snapshot = await this.repository.getSnapshot(input);
    const directory = await this.sessionDirectory(snapshot.view.subjectId, input.sessionId);
    const answerPath = resolve(directory, "diagnostic", "answers", `${input.questionId}.json`);
    const submissionHash = hashValue(input);
    const answersDirectory = resolve(directory, "diagnostic", "answers");
    if (await exists(answersDirectory)) {
      for (const entry of await readdir(answersDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const existing = await readJson<StoredDiagnosticAnswer>(resolve(answersDirectory, entry.name), entry.name);
        if (existing.requestId !== input.requestId) continue;
        if (existing.submissionHash !== submissionHash) {
          throw new LearningSessionRepositoryError("idempotency_conflict", "Diagnostic requestId has different content");
        }
        return existing.output;
      }
    }
    if (await exists(answerPath)) {
      const existing = await readJson<StoredDiagnosticAnswer>(answerPath, "diagnostic answer");
      if (existing.requestId === input.requestId) {
        if (existing.submissionHash !== submissionHash) {
          throw new LearningSessionRepositoryError("idempotency_conflict", "Diagnostic requestId has different content");
        }
        return existing.output;
      }
      throw new DiagnosticValidationError("diagnostic_answer_conflict", "Diagnostic question was already answered or skipped");
    }

    if (snapshot.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    const assets = await this.loadAssets(snapshot.view.subjectId, input.profileRevision);
    validateAssets(assets, input.profileRevision);
    const question = assets.blueprint.questions.find((item) => item.questionId === input.questionId);
    if (question === undefined) {
      throw new DiagnosticValidationError("diagnostic_answer_invalid", "Diagnostic question does not exist");
    }

    const createdAt = this.now().toISOString();
    const baseOutput = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      diagnosticId: input.diagnosticId,
      questionId: input.questionId,
    };

    if (input.action === "skip") {
      const output: DiagnosticAnswerOutput = { ...baseOutput, result: "skipped" };
      const record: StoredDiagnosticAnswer = {
        questionId: input.questionId,
        requestId: input.requestId,
        status: "skipped",
        createdAt,
        diagnosticId: input.diagnosticId,
        diagnosticVersion: input.diagnosticVersion,
        submissionHash,
        output,
      };
      await writeJsonAtomic(answerPath, record);
      return output;
    }

    if (question.kind === "single_choice") {
      if (typeof input.answer !== "string" || !question.options?.includes(input.answer)) {
        throw new DiagnosticValidationError("diagnostic_answer_invalid", "Answer must equal a diagnostic option");
      }
    } else if (typeof input.answer !== "boolean") {
      throw new DiagnosticValidationError("diagnostic_answer_invalid", "Judgment answer must be boolean");
    }
    const answerKey = assets.answerKey.answers.find((item) => item.questionId === input.questionId);
    if (answerKey === undefined || answerKey.kind !== question.kind) {
      throw new DiagnosticValidationError("invalid_profile", "Diagnostic answer key is incomplete");
    }
    const correct = answerKey.correctAnswer === input.answer;
    const evidenceId = `evidence-${hashValue(`${input.sessionId}:${input.diagnosticVersion}:${input.questionId}`).slice(0, 24)}`;
    const evidenceCandidate: Evidence = {
      evidenceId,
      requestId: input.requestId,
      sessionId: input.sessionId,
      knowledgePointId: question.knowledgePointId,
      profileRevision: input.profileRevision,
      kind: "diagnostic",
      source: "fixed_diagnostic",
      form: "selected_response",
      impact: "mastery",
      outcome: correct ? "correct" : "incorrect",
      score: correct ? 1 : 0,
      difficulty: question.difficulty,
      independence: "independent",
      attemptId: `${input.diagnosticId}.${input.diagnosticVersion}.${input.questionId}`,
      evaluatorVersion: assets.answerKey.evaluatorVersion,
      createdAt,
    };
    const output: DiagnosticAnswerOutput = { ...baseOutput, result: correct ? "pass" : "fail" };
    const record: StoredDiagnosticAnswer = {
      questionId: input.questionId,
      requestId: input.requestId,
      status: "answered",
      submittedAnswer: input.answer,
      normalizedScore: evidenceCandidate.score,
      evidenceId,
      evaluatorVersion: assets.answerKey.evaluatorVersion,
      createdAt,
      diagnosticId: input.diagnosticId,
      diagnosticVersion: input.diagnosticVersion,
      submissionHash,
      output,
      evidenceCandidate,
    };
    await writeJsonAtomic(answerPath, record);
    return output;
    });
  }

  async completeDiagnostic(input: CompleteDiagnosticInput): Promise<DiagnosticCompleteOutput> {
    assertSafeFileComponent(input.requestId, "requestId");
    assertSafeFileComponent(input.diagnosticId, "diagnosticId");
    const snapshot = await this.repository.getSnapshot(input);
    if (snapshot.latestDiagnostic?.diagnosticId === input.diagnosticId) {
      if (snapshot.latestCommit.requestId !== input.requestId) {
        throw new LearningSessionRepositoryError("idempotency_conflict", "Diagnostic is already committed");
      }
      return {
        requestId: input.requestId,
        sessionId: input.sessionId,
        sessionVersion: snapshot.sessionVersion,
        profileRevision: input.profileRevision,
        diagnosticId: input.diagnosticId,
        evidenceVersion: snapshot.latestCommit.evidenceVersion,
        knowledgeStates: snapshot.knowledgeStates,
        insufficientKnowledgePointIds: snapshot.latestDiagnostic.insufficientKnowledgePointIds,
      };
    }
    if (snapshot.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    const assets = await this.loadAssets(snapshot.view.subjectId, input.profileRevision);
    validateAssets(assets, input.profileRevision);
    const directory = await this.sessionDirectory(snapshot.view.subjectId, input.sessionId);
    const answersDirectory = resolve(directory, "diagnostic", "answers");
    await mkdir(answersDirectory, { recursive: true });

    const answers = new Map<string, StoredDiagnosticAnswer>();
    for (const entry of await readdir(answersDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const answer = await readJson<StoredDiagnosticAnswer>(resolve(answersDirectory, entry.name), entry.name);
      if (answer.diagnosticId === input.diagnosticId && answer.diagnosticVersion === input.diagnosticVersion) {
        answers.set(answer.questionId, answer);
      }
    }
    if (assets.blueprint.questions.some((question) => !answers.has(question.questionId))) {
      throw new DiagnosticValidationError("diagnostic_incomplete", "Every diagnostic question must be answered or skipped");
    }

    const completionPath = resolve(directory, "diagnostic", `completion-${input.requestId}.json`);
    const inputHash = hashValue(input);
    let prepared: StoredCompletionCandidate;
    if (await exists(completionPath)) {
      prepared = await readJson<StoredCompletionCandidate>(completionPath, "diagnostic completion candidate");
      if (prepared.inputHash !== inputHash) {
        throw new LearningSessionRepositoryError("idempotency_conflict", "Completion requestId has different content");
      }
    } else {
      const candidates = assets.blueprint.questions
        .map((question) => answers.get(question.questionId)?.evidenceCandidate)
        .filter((item): item is Evidence => item !== undefined);
      const nextEvidenceVersion = snapshot.latestCommit.evidenceVersion + (candidates.length > 0 ? 1 : 0);
      const asOf = this.now().toISOString();
      const requiresCode = new Map(assets.knowledgePoints?.map((point) => [point.id, point.requiresCodeEvidence]));
      const knowledgePointIds = [...new Set(assets.blueprint.questions.map((question) => question.knowledgePointId))];
      const states = calculateKnowledgeStates({
        knowledgePoints: knowledgePointIds.map((id) => ({ id, requiresCodeEvidence: requiresCode.get(id) })),
        profileRevision: input.profileRevision,
        evidenceVersion: nextEvidenceVersion,
        evidence: [...snapshot.evidence, ...candidates],
        asOf,
      });
      const insufficientKnowledgePointIds = [...new Set(
        assets.blueprint.questions
          .filter((question) => answers.get(question.questionId)?.status === "skipped")
          .map((question) => question.knowledgePointId),
      )];
      const diagnostic: LearnerDiagnostic = {
        diagnosticId: input.diagnosticId,
        sessionId: input.sessionId,
        profileRevision: input.profileRevision,
        diagnosticVersion: input.diagnosticVersion,
        evidenceVersion: nextEvidenceVersion,
        goalId: snapshot.view.goalId,
        status: "completed",
        states,
        insufficientKnowledgePointIds,
        summaryTemplateVersion: "diagnostic-summary-v1",
        createdAt: asOf,
      };
      prepared = { inputHash, diagnostic, evidenceCandidates: candidates };
      await writeJsonAtomic(completionPath, prepared);
    }

    const committed = await this.repository.commit({
      ...input,
      candidate: {
        requestId: input.requestId,
        ...(prepared.evidenceCandidates.length === 0 ? {} : { evidenceCandidates: prepared.evidenceCandidates }),
        knowledgeStates: prepared.diagnostic.states,
        diagnosticCandidate: prepared.diagnostic,
        nextStage: "path",
      },
    });
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: input.profileRevision,
      diagnosticId: input.diagnosticId,
      evidenceVersion: committed.latestCommit.evidenceVersion,
      knowledgeStates: committed.knowledgeStates,
      insufficientKnowledgePointIds: prepared.diagnostic.insufficientKnowledgePointIds,
    };
  }
}

export function createProfileDirectoryDiagnosticLoader(
  profileDirectoryFor: (subjectId: string, profileRevision: number) => string,
): DiagnosticAssetsLoader {
  return async (subjectId, profileRevision) => {
    const profileDirectory = profileDirectoryFor(subjectId, profileRevision);
    const manifest = JSON.parse(await readFile(resolve(profileDirectory, "profile.json"), "utf8")) as {
      revision?: number;
      paths?: { diagnostic?: string; knowledge?: string };
    };
    if (manifest.revision !== profileRevision || typeof manifest.paths?.diagnostic !== "string") {
      throw new DiagnosticValidationError("profile_revision_conflict", "Profile diagnostic path or revision is invalid");
    }
    const diagnosticPath = assertPathInside(profileDirectory, resolve(profileDirectory, manifest.paths.diagnostic));
    const blueprint = parseDiagnosticBlueprint(JSON.parse(await readFile(diagnosticPath, "utf8")));
    const answerKeyPath = assertPathInside(profileDirectory, resolve(dirname(diagnosticPath), "private", "answer-key.json"));
    const answerKey = parseDiagnosticAnswerKey(JSON.parse(await readFile(answerKeyPath, "utf8")), blueprint);
    let knowledgePoints: DiagnosticRuntimeAssets["knowledgePoints"];
    if (typeof manifest.paths.knowledge === "string") {
      const knowledgePath = assertPathInside(profileDirectory, resolve(profileDirectory, manifest.paths.knowledge));
      const knowledge = JSON.parse(await readFile(knowledgePath, "utf8")) as { knowledgePoints?: KnowledgePointDefinition[] };
      knowledgePoints = knowledge.knowledgePoints?.map(({ id, requiresCodeEvidence }) => ({ id, requiresCodeEvidence }));
    }
    return { blueprint, answerKey, knowledgePoints };
  };
}
