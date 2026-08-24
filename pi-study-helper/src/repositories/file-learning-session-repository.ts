import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import type { BackgroundQuestionnaire, LearningCardSafeView } from "../contracts/index.js";
import type { Evidence, KnowledgeState, LearnerDiagnostic } from "../domain/v2-types.js";
import { quizQuestionSetSha256, type QuizAttemptSnapshot } from "../domain/quiz-runtime.js";
import {
  assertSafeFileComponent,
  assertSafeSubjectId,
  resolveInside,
  writeJsonAtomic,
} from "../infrastructure/safe-files.js";
import { LearningSessionRepositoryError } from "./learning-session-repository.js";
import type {
  CommitLearningSessionInput,
  CommittedSessionSnapshot,
  CreateLearningSessionRecord,
  GetSessionSnapshotInput,
  LatestCommitMarker,
  LearningSessionRepository,
  PathSafeSnapshot,
  RecoverySnapshot,
  RecoverLearningSessionInput,
  SessionSnapshot,
  SessionBindingReader,
  RecoverableActivityCommitReader,
  DiagnosticDraftSessionPort,
  QuizAttemptSessionPort,
  LearningSessionCatalogPort,
  StoredDiagnosticAnswerState,
} from "./learning-session-repository.js";
import {
  toPathSafeSnapshot,
  type InternalPathSessionPort,
  type InternalPersistedPathSnapshot,
} from "./internal-path-session-port.js";

interface StoredSnapshot extends Omit<SessionSnapshot, "path"> {
  path?: PathSafeSnapshot;
  boundLearningCards: import("./learning-session-repository.js").BoundLearningCardSnapshot[];
  /** Full deterministic path state is never reconstructed from the public safe DTO. */
  internalPath?: InternalPersistedPathSnapshot;
  createRequestId: string;
  createInputHash: string;
  /** Private immutable history; it is deliberately not exposed by the Facade DTO. */
  pathHistory?: InternalPersistedPathSnapshot[];
}

interface StoredCommitResult {
  inputHash: string;
  response: CommittedSessionSnapshot;
}

interface StoredDiagnosticDraftCommit {
  inputHash: string;
  diagnosticDraftVersion: number;
}

interface PreparedTransaction {
  formatVersion: 1;
  input: CommitLearningSessionInput;
  inputHash: string;
  previousSessionVersion: number;
  snapshot: StoredSnapshot;
  response: CommittedSessionSnapshot;
  evidenceToPublish: Evidence[];
  archivedPathsToPublish: InternalPersistedPathSnapshot[];
  internalPathCandidate?: InternalPersistedPathSnapshot;
  quizAttemptToPublish?: QuizAttemptSnapshot;
}

export interface FileLearningSessionRepositoryOptions {
  dataRoot?: string;
  now?: () => Date;
  /** Deterministic fault-injection hook; published readers remain behind latest.json. */
  beforePublish?: (sessionId: string, requestId: string, stage: FileLearningSessionPublishStage) => Promise<void> | void;
}

export type FileLearningSessionPublishStage =
  | "candidate_written"
  | "attempt_written"
  | "evidence_written"
  | "knowledge_state_written"
  | "path_written"
  | "progress_written"
  | "checkpoint_written";

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

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredBackgroundQuestionnaire(value: unknown): BackgroundQuestionnaire | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (!sameValue(keys, ["explanation_preference", "pandas_experience", "python_experience"])) return undefined;
  const experience = new Set(["none", "basic", "comfortable", "uncertain"]);
  const preference = new Set(["concise", "step_by_step", "example_first", "uncertain"]);
  if (!experience.has(String(value.python_experience))
      || !experience.has(String(value.pandas_experience))
      || !preference.has(String(value.explanation_preference))) return undefined;
  return {
    python_experience: value.python_experience as BackgroundQuestionnaire["python_experience"],
    pandas_experience: value.pandas_experience as BackgroundQuestionnaire["pandas_experience"],
    explanation_preference: value.explanation_preference as BackgroundQuestionnaire["explanation_preference"],
  };
}

function isPathSafeCandidate(value: unknown): value is PathSafeSnapshot {
  if (!isRecord(value) || typeof value.pathId !== "string" || typeof value.pathVersion !== "number"
      || !Number.isInteger(value.pathVersion) || value.pathVersion < 1
      || !["candidate", "confirmed", "active", "superseded", "completed"].includes(String(value.status))
      || typeof value.goalId !== "string" || !["recommended", "chapter"].includes(String(value.mode))
      || !Array.isArray(value.nodes)) return false;
  return true;
}

function validatePublicPathCandidate(value: unknown): PathSafeSnapshot {
  if (!isPathSafeCandidate(value)) {
    throw new LearningSessionRepositoryError("evidence_invalid", "PathSafeSnapshot is structurally invalid");
  }
  const safe = value;
  const nodeIds = new Set<string>();
  const knowledgePointIds = new Set<string>();
  const nodes = safe.nodes.map((node) => {
    if (!isRecord(node) || typeof node.nodeId !== "string" || typeof node.knowledgePointId !== "string"
        || !Array.isArray(node.activityIds) || node.activityIds.length === 0
        || node.activityIds.some((id) => typeof id !== "string" || id.length === 0)
        || !["locked", "available", "in_progress", "completed", "skipped"].includes(String(node.status))
        || !Number.isInteger(node.estimatedMinutes) || node.estimatedMinutes < 0
        || !Array.isArray(node.reasonCodes) || node.reasonCodes.some((reason) => typeof reason !== "string")
        || !["S-R", "S-U", "M-U", "M-A", "C-A"].includes(String(node.difficulty))
        || !["none", "hint", "worked_example"].includes(String(node.scaffold))
        || typeof node.required !== "boolean" || typeof node.positionLocked !== "boolean") {
      throw new LearningSessionRepositoryError("evidence_invalid", "PathSafeSnapshot node is structurally invalid");
    }
    if (nodeIds.has(node.nodeId) || knowledgePointIds.has(node.knowledgePointId)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "PathSafeSnapshot node identifiers must be unique");
    }
    nodeIds.add(node.nodeId);
    knowledgePointIds.add(node.knowledgePointId);
    return {
      nodeId: node.nodeId,
      knowledgePointId: node.knowledgePointId,
      activityIds: [...node.activityIds],
      status: node.status,
      estimatedMinutes: node.estimatedMinutes,
      reasonCodes: [...node.reasonCodes],
      difficulty: node.difficulty,
      scaffold: node.scaffold,
      required: node.required,
      positionLocked: node.positionLocked,
    };
  });
  return {
    pathId: safe.pathId,
    pathVersion: safe.pathVersion,
    status: safe.status,
    goalId: safe.goalId,
    mode: safe.mode,
    nodes,
  };
}

function commitIdentity(
  input: CommitLearningSessionInput,
  internalPathCandidate?: InternalPersistedPathSnapshot,
): unknown {
  return internalPathCandidate === undefined
    ? { input }
    : { input, internalPathCandidate };
}

const EVIDENCE_KINDS = new Set(["diagnostic", "mcq", "code_completion", "coding_practical", "explain", "debug", "legacy", "interaction"]);
const EVIDENCE_SOURCES = new Set(["fixed_diagnostic", "deterministic_quiz", "code_submit", "practical_rubric", "legacy_final_answer", "self_report", "context_question", "hint_view", "public_run", "evaluator_error"]);
const EVIDENCE_FORMS = new Set(["selected_response", "code_reasoning", "code_execution", "practical_rubric", "legacy_attempt", "interaction"]);
const EVIDENCE_OUTCOMES = new Set(["correct", "partial", "incorrect", "unverifiable"]);
const EVIDENCE_INDEPENDENCE = new Set(["independent", "hinted", "worked_example", "answer_exposed"]);
const KNOWLEDGE_STATUSES = new Set(["unverified", "support_needed", "learning", "ready", "mastered"]);

function validateEvidenceCandidate(item: Evidence, input: CommitLearningSessionInput): void {
  if (!isRecord(item) || !item.evidenceId || !item.requestId || !item.knowledgePointId) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Evidence identifiers must be non-empty");
  }
  try {
    assertSafeFileComponent(item.evidenceId, "evidenceId");
  } catch {
    throw new LearningSessionRepositoryError("evidence_invalid", "Evidence identifier is not path-safe");
  }
  if (item.sessionId !== input.sessionId || item.profileRevision !== input.profileRevision) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Evidence session or profile revision does not match");
  }
  if (!EVIDENCE_KINDS.has(item.kind)
      || !EVIDENCE_SOURCES.has(item.source)
      || !EVIDENCE_FORMS.has(item.form)
      || !EVIDENCE_OUTCOMES.has(item.outcome)
      || !EVIDENCE_INDEPENDENCE.has(item.independence)) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Evidence enum value is invalid");
  }
  if (item.impact !== "mastery" || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 1) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Committed Evidence must be valid mastery evidence");
  }
  if (!Number.isFinite(Date.parse(item.createdAt))) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Evidence createdAt is invalid");
  }
}

function validateKnowledgeStates(states: readonly KnowledgeState[], input: CommitLearningSessionInput, version: number): void {
  if (!Array.isArray(states)) {
    throw new LearningSessionRepositoryError("evidence_invalid", "KnowledgeState collection must be an array");
  }
  const ids = new Set<string>();
  for (const state of states) {
    const rawState: unknown = state;
    if (!isRecord(rawState) || typeof rawState.knowledgePointId !== "string" || rawState.knowledgePointId.length === 0) {
      throw new LearningSessionRepositoryError("evidence_invalid", "KnowledgeState identifier must be non-empty");
    }
    const checked = state;
    if (ids.has(checked.knowledgePointId)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "KnowledgeState identifiers must be unique");
    }
    ids.add(checked.knowledgePointId);
    if (checked.profileRevision !== input.profileRevision || checked.evidenceVersion !== version) {
      throw new LearningSessionRepositoryError("evidence_invalid", "KnowledgeState version does not match transaction");
    }
    if ((checked.mastery !== null && (!Number.isFinite(checked.mastery) || checked.mastery < 0 || checked.mastery > 1))
        || !Number.isFinite(checked.confidence) || checked.confidence < 0 || checked.confidence > 1) {
      throw new LearningSessionRepositoryError("evidence_invalid", "KnowledgeState mastery or confidence is invalid");
    }
    if (checked.aggregationVersion !== "knowledge-state-v1"
        || !KNOWLEDGE_STATUSES.has(checked.status)
        || !Number.isInteger(checked.validEvidenceCount) || checked.validEvidenceCount < 0
        || !Number.isInteger(checked.evidenceFormCount) || checked.evidenceFormCount < 0
        || checked.evidenceFormCount > checked.validEvidenceCount
        || !Array.isArray(checked.evidenceIds) || checked.evidenceIds.some((id: string) => typeof id !== "string" || id.length === 0)
        || !Array.isArray(checked.consideredEvidenceIds)
        || checked.consideredEvidenceIds.some((id: string) => typeof id !== "string" || id.length === 0)
        || new Set(checked.evidenceIds).size !== checked.evidenceIds.length
        || new Set(checked.consideredEvidenceIds).size !== checked.consideredEvidenceIds.length
        || checked.validEvidenceCount !== checked.consideredEvidenceIds.length
        || checked.consideredEvidenceIds.some((id: string) => !checked.evidenceIds.includes(id))
        || !Number.isFinite(Date.parse(checked.asOf))
        || !Number.isFinite(Date.parse(checked.lastUpdatedAt))) {
      throw new LearningSessionRepositoryError("evidence_invalid", "KnowledgeState fields are not semantically valid");
    }
    if (checked.skipEligible && checked.status !== "mastered") {
      throw new LearningSessionRepositoryError("evidence_invalid", "Only mastered KnowledgeState may be skip eligible");
    }
  }
}

function validatePathCandidate(
  path: InternalPersistedPathSnapshot | undefined,
  current: StoredSnapshot,
  input: CommitLearningSessionInput,
  evidenceVersion: number,
): void {
  if (path === undefined) return;
  if (path.sessionId !== input.sessionId || path.profileRevision !== input.profileRevision || path.evidenceVersion !== evidenceVersion) {
    throw new LearningSessionRepositoryError("path_version_conflict", "Path candidate does not match the current session snapshot");
  }
  if (path.engineVersion !== "path-engine-v1" || path.pathId.length === 0
      || !Number.isInteger(path.pathVersion) || path.pathVersion < 1
      || !Number.isInteger(path.availableMinutes) || path.availableMinutes < 1
      || !Number.isInteger(path.estimatedMinutes) || path.estimatedMinutes < 0
      || !Array.isArray(path.nodes) || !Array.isArray(path.positionLockedNodeIds)
      || !Array.isArray(path.changeReasons) || !Number.isFinite(Date.parse(path.createdAt))) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Path candidate is structurally invalid");
  }
  const nodeIds = new Set<string>();
  for (const node of path.nodes) {
    if (!node.nodeId || !node.knowledgePointId || nodeIds.has(node.nodeId)
        || !Array.isArray(node.activityIds) || node.activityIds.length === 0
        || node.activityIds.some((id) => typeof id !== "string" || id.length === 0)
        || !Number.isInteger(node.estimatedMinutes) || node.estimatedMinutes < 1
        || !Array.isArray(node.reasonCodes)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Path node is structurally invalid");
    }
    nodeIds.add(node.nodeId);
  }
  if (!["candidate", "active"].includes(path.status)) {
    throw new LearningSessionRepositoryError("path_version_conflict", "Only candidate and active paths may be published");
  }
  const existing = current.internalPath;
  if (existing === undefined) {
    if (path.pathVersion !== 1 || path.status !== "candidate") {
      throw new LearningSessionRepositoryError("path_version_conflict", "First path must be version 1 candidate");
    }
    return;
  }
  if (path.pathVersion === existing.pathVersion && path.pathId === existing.pathId) {
    if (existing.status !== "candidate" || path.status !== "active") {
      throw new LearningSessionRepositoryError("path_version_conflict", "Only the current candidate path may be confirmed");
    }
    const normalize = (value: InternalPersistedPathSnapshot) => ({ ...value, status: "candidate" });
    if (!sameValue(normalize(path), normalize(existing))) {
      throw new LearningSessionRepositoryError("path_version_conflict", "Confirmed path differs from the persisted candidate");
    }
    return;
  }
  if (existing.status !== "active" || path.pathVersion !== existing.pathVersion + 1 || path.status !== "active") {
    throw new LearningSessionRepositoryError("path_version_conflict", "Replacement path version is invalid");
  }
}

function validatePublicPathLifecycle(path: PathSafeSnapshot, current: StoredSnapshot): void {
  if (!["candidate", "active"].includes(path.status)) {
    throw new LearningSessionRepositoryError("path_version_conflict", "Only candidate and active paths may be published");
  }
  const existing = current.path;
  if (existing === undefined) {
    if (path.pathVersion !== 1 || path.status !== "candidate") {
      throw new LearningSessionRepositoryError("path_version_conflict", "First path must be version 1 candidate");
    }
    return;
  }
  if (path.pathVersion === existing.pathVersion && path.pathId === existing.pathId) {
    if (existing.status !== "candidate" || path.status !== "active") {
      throw new LearningSessionRepositoryError("path_version_conflict", "Only the current candidate path may be confirmed");
    }
    const normalize = (value: PathSafeSnapshot) => ({ ...value, status: "candidate" });
    if (!sameValue(normalize(path), normalize(existing))) {
      throw new LearningSessionRepositoryError("path_version_conflict", "Confirmed path differs from the persisted candidate");
    }
    return;
  }
  if (existing.status !== "active" || path.pathVersion !== existing.pathVersion + 1 || path.status !== "active") {
    throw new LearningSessionRepositoryError("path_version_conflict", "Replacement path version is invalid");
  }
}

function validateDiagnostic(
  diagnostic: LearnerDiagnostic | undefined,
  states: readonly KnowledgeState[],
  input: CommitLearningSessionInput,
  evidenceVersion: number,
): void {
  if (diagnostic === undefined) return;
  if (!isRecord(diagnostic)
      || typeof diagnostic.diagnosticId !== "string" || diagnostic.diagnosticId.length === 0
      || diagnostic.sessionId !== input.sessionId
      || diagnostic.profileRevision !== input.profileRevision
      || diagnostic.evidenceVersion !== evidenceVersion
      || !Number.isInteger(diagnostic.diagnosticVersion) || diagnostic.diagnosticVersion < 1
      || typeof diagnostic.goalId !== "string" || diagnostic.goalId.length === 0
      || diagnostic.status !== "completed"
      || typeof diagnostic.summaryTemplateVersion !== "string" || diagnostic.summaryTemplateVersion.length === 0
      || !Number.isFinite(Date.parse(diagnostic.createdAt))) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Diagnostic candidate version does not match transaction");
  }
  if (!sameValue(diagnostic.states, states)) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Diagnostic states must equal committed KnowledgeState");
  }
  if (!Array.isArray(diagnostic.insufficientKnowledgePointIds)
      || diagnostic.insufficientKnowledgePointIds.some((id) => typeof id !== "string" || id.length === 0)
      || new Set(diagnostic.insufficientKnowledgePointIds).size !== diagnostic.insufficientKnowledgePointIds.length) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Diagnostic insufficient knowledge points must be unique");
  }
}

function validateQuizAttempt(attempt: QuizAttemptSnapshot | undefined, input: CommitLearningSessionInput): void {
  if (attempt === undefined) return;
  try {
    assertSafeFileComponent(attempt.attemptId, "attemptId");
    assertSafeFileComponent(attempt.activityId, "activityId");
  } catch {
    throw new LearningSessionRepositoryError("evidence_invalid", "Quiz Attempt identifiers are not path-safe");
  }
  if (attempt.sessionId !== input.sessionId || attempt.profileRevision !== input.profileRevision
      || !Number.isInteger(attempt.activityVersion) || attempt.activityVersion < 1
      || typeof attempt.title !== "string" || attempt.title.length === 0
      || typeof attempt.prompt !== "string"
      || typeof attempt.primaryKnowledgePointId !== "string" || attempt.primaryKnowledgePointId.length === 0
      || !Array.isArray(attempt.supportingKnowledgePointIds) || attempt.supportingKnowledgePointIds.some((id) => typeof id !== "string" || id.length === 0)
      || !Number.isSafeInteger(attempt.retryNumber) || attempt.retryNumber < 0
      || (attempt.status !== "draft" && attempt.status !== "submitted")
      || !Array.isArray(attempt.questions)) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Quiz Attempt binding is invalid");
  }
  const ids = new Set<string>();
  for (const question of attempt.questions) {
    if (!question.questionId || ids.has(question.questionId)
        || (question.kind !== "single_choice" && question.kind !== "judgment")
        || typeof question.prompt !== "string" || !Array.isArray(question.options)
        || typeof question.explanation !== "string" || !Array.isArray(question.sourceAnchorIds)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Quiz Attempt question snapshot is invalid");
    }
    ids.add(question.questionId);
  }
  if (attempt.gradingBinding !== undefined) {
    const source = attempt.gradingBinding.source;
    const expectedSource = attempt.questionSource === "ai_live" || attempt.questionSource === "ai_recorded" ? "ai_reviewed"
      : attempt.questionSource === "ai_supplemented" ? "profile_supplemental"
        : attempt.questionSource === "insufficient" ? "none" : "profile_fixed";
    if ((source !== "ai_reviewed" && source !== "profile_fixed" && source !== "profile_supplemental" && source !== "none")
        || source !== expectedSource
        || attempt.gradingBinding.questionSetSha256 !== quizQuestionSetSha256(attempt.questions)
        || (source === "ai_reviewed" && (!("generationRunId" in attempt.gradingBinding) || !attempt.gradingBinding.generationRunId))) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Quiz Attempt grading binding is invalid");
    }
  }
  if (attempt.status === "submitted" && (attempt.result === undefined || attempt.result.kind !== "quiz" || !attempt.submissionRequestId || !attempt.submissionHash)) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Submitted Quiz Attempt is incomplete");
  }
  const reference = input.candidate.currentAttempt;
  if (reference !== undefined && reference !== null && (reference.kind !== "quiz" || reference.activityId !== attempt.activityId || reference.attemptId !== attempt.attemptId || reference.retryNumber !== attempt.retryNumber)) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Current Attempt reference does not match Quiz Attempt");
  }
}

function validateActivityProgress(input: CommitLearningSessionInput, current: StoredSnapshot): void {
  const progress = input.candidate.activityProgress;
  if (progress === undefined) return;
  if (!Array.isArray(progress)) throw new LearningSessionRepositoryError("evidence_invalid", "Activity progress must be an array");
  const nodeIds = new Set<string>();
  for (const node of progress) {
    if (!node.nodeId || nodeIds.has(node.nodeId) || !Array.isArray(node.activities)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Activity progress node is invalid or duplicated");
    }
    nodeIds.add(node.nodeId);
    const activityIds = new Set<string>();
    for (const activity of node.activities) {
      if (!activity.activityId || activityIds.has(activity.activityId)
          || !["pending", "in_progress", "completed", "insufficient"].includes(activity.status)
          || !Array.isArray(activity.attemptIds) || new Set(activity.attemptIds).size !== activity.attemptIds.length
          || !Number.isSafeInteger(activity.quizRetryCount) || activity.quizRetryCount < 0
          || (activity.bestResult !== undefined && !["pass", "partial", "fail", "insufficient"].includes(activity.bestResult))
          || (activity.continuedWithGap !== undefined && typeof activity.continuedWithGap !== "boolean")
          || !Number.isFinite(Date.parse(activity.updatedAt))) {
        throw new LearningSessionRepositoryError("evidence_invalid", "Activity progress entry is invalid");
      }
      if ((activity.status === "completed" || activity.status === "insufficient") && activity.result === undefined) {
        throw new LearningSessionRepositoryError("evidence_invalid", "Terminal Activity progress requires a result");
      }
      activityIds.add(activity.activityId);
    }
    const pathNode = (input.candidate.pathCandidate ?? current.path)?.nodes.find((candidate) => candidate.nodeId === node.nodeId);
    if (pathNode !== undefined && JSON.stringify(pathNode.activityIds) !== JSON.stringify(node.activities.map((activity) => activity.activityId))) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Activity progress order must match the path node");
    }
  }
}

function validateBoundLearningCards(input: CommitLearningSessionInput, current: StoredSnapshot): void {
  const bindings = input.candidate.boundLearningCards ?? current.boundLearningCards;
  if (!Array.isArray(bindings) || new Set(bindings.map((binding) => binding.nodeId)).size !== bindings.length) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Bound learning cards must contain unique path nodes");
  }
  const path = input.candidate.pathCandidate ?? current.path;
  const progress = input.candidate.activityProgress ?? current.activityProgress;
  for (const binding of bindings) {
    const card = binding.card as LearningCardSafeView;
    const pathNode = path?.nodes.find((node) => node.nodeId === binding.nodeId);
    const progressCard = progress.find((node) => node.nodeId === binding.nodeId)?.card;
    if (!binding.nodeId || (binding.source !== "dynamic" && binding.source !== "fixed")
        || !card?.cardId || !card.knowledgePointId || !card.title || !card.objective
        || !Array.isArray(card.explanation) || !card.example || !card.commonMistake
        || !Array.isArray(card.sourceAnchorIds) || !Number.isFinite(card.estimatedMinutes)
        || pathNode?.knowledgePointId !== card.knowledgePointId || progressCard?.cardId !== card.cardId) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Bound learning card snapshot is invalid");
    }
  }
  if (progress.some((node) => node.card !== undefined && !bindings.some((binding) => binding.nodeId === node.nodeId && binding.card.cardId === node.card?.cardId))) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Every projected learning card must have one complete bound snapshot");
  }
}

export class FileLearningSessionRepository implements LearningSessionRepository, InternalPathSessionPort, SessionBindingReader, RecoverableActivityCommitReader, DiagnosticDraftSessionPort, QuizAttemptSessionPort, LearningSessionCatalogPort {
  readonly dataRoot: string;
  readonly familiesRoot: string;
  private readonly now: () => Date;
  private readonly beforePublish?: FileLearningSessionRepositoryOptions["beforePublish"];
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: FileLearningSessionRepositoryOptions = {}) {
    this.dataRoot = resolveStudyDataRoot(options.dataRoot);
    this.familiesRoot = profileFamiliesRoot(this.dataRoot);
    this.now = options.now ?? (() => new Date());
    this.beforePublish = options.beforePublish;
  }

  private async withLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    const chain = previous.then(() => current);
    this.locks.set(sessionId, chain);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(sessionId) === chain) this.locks.delete(sessionId);
    }
  }

  private sessionsRoot(subjectId: string): string {
    assertSafeSubjectId(subjectId);
    return resolveInside(this.familiesRoot, subjectId, "_user", "learning_sessions");
  }

  private sessionDirectory(subjectId: string, sessionId: string): string {
    assertSafeFileComponent(sessionId, "sessionId");
    return resolveInside(this.sessionsRoot(subjectId), sessionId);
  }

  private async findSessionDirectory(sessionId: string): Promise<string> {
    assertSafeFileComponent(sessionId, "sessionId");
    await mkdir(this.familiesRoot, { recursive: true });
    const families = await readdir(this.familiesRoot, { withFileTypes: true });
    for (const family of families.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!family.isDirectory()) continue;
      const candidate = resolveInside(this.familiesRoot, family.name, "_user", "learning_sessions", sessionId);
      if (await exists(resolve(candidate, "checkpoints", "latest.json"))) return candidate;
    }
    throw new LearningSessionRepositoryError("session_not_found", `Learning session not found: ${sessionId}`);
  }

  private async loadStoredSnapshot(directory: string): Promise<StoredSnapshot> {
    const marker = await readJson<LatestCommitMarker>(resolve(directory, "checkpoints", "latest.json"), "latest.json");
    const snapshot = await readJson<StoredSnapshot>(
      resolve(directory, "snapshots", `${marker.sessionVersion}.json`),
      "committed session snapshot",
    );
    if (snapshot.sessionVersion !== marker.sessionVersion
        || snapshot.latestCommit.evidenceVersion !== marker.evidenceVersion) {
      throw new LearningSessionRepositoryError("storage_error", "Committed snapshot does not match latest marker");
    }
    let diagnosticDraftVersion = snapshot.diagnosticDraftVersion ?? 0;
    const draftMarkerPath = resolve(directory, "diagnostic", "checkpoint.json");
    if (await exists(draftMarkerPath)) {
      const draftMarker = await readJson<{ diagnosticDraftVersion: number }>(draftMarkerPath, "diagnostic checkpoint");
      if (!Number.isInteger(draftMarker.diagnosticDraftVersion) || draftMarker.diagnosticDraftVersion < diagnosticDraftVersion) {
        throw new LearningSessionRepositoryError("storage_error", "Diagnostic draft checkpoint is invalid");
      }
      diagnosticDraftVersion = draftMarker.diagnosticDraftVersion;
      const draft = await readJson<Record<string, unknown>>(
        resolve(directory, "diagnostic", "drafts", `${diagnosticDraftVersion}.json`),
        "diagnostic draft version",
      );
      const background = parseStoredBackgroundQuestionnaire(draft.background);
      const restoredAnswers: NonNullable<SessionSnapshot["diagnosticDraft"]>["answers"] = [];
      snapshot.diagnosticDraft = {
        diagnosticDraftVersion,
        ...(background === undefined ? {} : { background }),
        ...(typeof draft.currentQuestionId === "string" ? { currentQuestionId: draft.currentQuestionId } : {}),
        processedQuestionIds: Array.isArray(draft.processedQuestionIds)
          ? draft.processedQuestionIds.filter((value): value is string => typeof value === "string")
          : [],
        answers: restoredAnswers,
      };
      const answersDirectory = resolve(directory, "diagnostic", "answers");
      if (await exists(answersDirectory)) {
        for (const entry of (await readdir(answersDirectory, { withFileTypes: true }))
          .filter((item) => item.isFile() && item.name.endsWith(".json"))
          .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
          const answer = await readJson<StoredDiagnosticAnswerState>(resolve(answersDirectory, entry.name), entry.name);
          if (typeof answer.questionId !== "string" || (answer.status !== "answered" && answer.status !== "skipped")) continue;
          restoredAnswers.push({
            questionId: answer.questionId,
            status: answer.status,
            ...(answer.submittedAnswer === undefined ? {} : { submittedAnswer: answer.submittedAnswer }),
          });
        }
      }
    }
    return {
      ...snapshot,
      activityProgress: snapshot.activityProgress ?? [],
      boundLearningCards: snapshot.boundLearningCards ?? [],
      diagnosticDraftVersion,
    };
  }

  private publicSnapshot(snapshot: StoredSnapshot): SessionSnapshot {
    const {
      createRequestId: _createRequestId,
      createInputHash: _createInputHash,
      pathHistory: _pathHistory,
      internalPath: _internalPath,
      boundLearningCards: _boundLearningCards,
      ...safe
    } = snapshot;
    return structuredClone(safe);
  }

  private prepareTransaction(
    current: StoredSnapshot,
    input: CommitLearningSessionInput,
    internalPathCandidate?: InternalPersistedPathSnapshot,
  ): PreparedTransaction {
    assertSafeFileComponent(input.requestId, "requestId");
    assertSafeFileComponent(input.sessionId, "sessionId");
    assertSafeSubjectId(current.view.subjectId);
    if (!isRecord(input.candidate) || input.candidate.requestId !== input.requestId) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Candidate requestId must match commit requestId");
    }
    if (current.sessionId !== input.sessionId || current.view.sessionId !== input.sessionId) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session candidate does not match committed session");
    }
    if (current.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    if (current.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }

    const single = input.candidate.evidenceCandidate;
    const batch = input.candidate.evidenceCandidates;
    if (single !== undefined && batch !== undefined) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Single and batch Evidence are mutually exclusive");
    }
    if (batch !== undefined && (!Array.isArray(batch) || batch.length === 0)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Diagnostic Evidence batch must be non-empty");
    }
    if (batch !== undefined && input.candidate.diagnosticCandidate === undefined) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Diagnostic Evidence batch requires a diagnostic candidate");
    }
    if (single !== undefined && input.candidate.diagnosticCandidate !== undefined) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Single activity Evidence cannot carry a diagnostic candidate");
    }
    if (input.candidate.diagnosticCandidate !== undefined && input.candidate.activityAttemptId !== undefined) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Diagnostic and activity candidates are mutually exclusive");
    }
    const candidates = single === undefined ? (batch ?? []) : [single];
    for (const candidate of candidates) validateEvidenceCandidate(candidate, input);
    if (new Set(candidates.map((item) => item.evidenceId)).size !== candidates.length) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Evidence identifiers must be unique");
    }
    const committedEvidenceIds = new Set(current.evidence.map((item) => item.evidenceId));
    if (candidates.some((item) => committedEvidenceIds.has(item.evidenceId))) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Evidence identifier is already committed");
    }

    const nextEvidenceVersion = candidates.length > 0
      ? current.latestCommit.evidenceVersion + 1
      : current.latestCommit.evidenceVersion;
    if (candidates.some((item) => item.evidenceVersion !== undefined && item.evidenceVersion !== nextEvidenceVersion)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Evidence candidate version does not match transaction");
    }
    validateKnowledgeStates(input.candidate.knowledgeStates, input, nextEvidenceVersion);
    validateDiagnostic(input.candidate.diagnosticCandidate, input.candidate.knowledgeStates, input, nextEvidenceVersion);
    validateQuizAttempt(input.candidate.quizAttemptCandidate, input);
    validateActivityProgress(input, current);
    validateBoundLearningCards(input, current);
    const safePathCandidate = input.candidate.pathCandidate === undefined
      ? undefined
      : validatePublicPathCandidate(input.candidate.pathCandidate);
    if (safePathCandidate !== undefined) validatePublicPathLifecycle(safePathCandidate, current);
    if (internalPathCandidate !== undefined && safePathCandidate === undefined) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Internal path snapshot requires a public PathSafeSnapshot");
    }
    if (internalPathCandidate !== undefined && !sameValue(toPathSafeSnapshot(internalPathCandidate), safePathCandidate)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Internal path snapshot does not match the public PathSafeSnapshot");
    }
    validatePathCandidate(internalPathCandidate, current, input, nextEvidenceVersion);
    if (safePathCandidate !== undefined && internalPathCandidate === undefined && current.internalPath !== undefined
        && !sameValue(safePathCandidate, toPathSafeSnapshot(current.internalPath))) {
      throw new LearningSessionRepositoryError("evidence_invalid", "A public-only path cannot replace deterministic internal path state");
    }
    const nextPath = safePathCandidate ?? current.path;
    const nextInternalPath = internalPathCandidate !== undefined
      ? structuredClone(internalPathCandidate)
      : safePathCandidate === undefined
        ? current.internalPath
        : current.internalPath !== undefined && sameValue(safePathCandidate, toPathSafeSnapshot(current.internalPath))
          ? current.internalPath
          : undefined;

    const evidenceToPublish = candidates.map((item) => ({ ...item, evidenceVersion: nextEvidenceVersion }));
    const nextSessionVersion = current.sessionVersion + 1;
    const nextView = {
      ...current.view,
      sessionVersion: nextSessionVersion,
      ...(safePathCandidate === undefined ? {} : { pathVersion: safePathCandidate.pathVersion }),
      ...(input.candidate.nextStage === undefined ? {} : { stage: input.candidate.nextStage }),
      ...(input.candidate.nextStage === "completed" ? { status: "completed" as const } : {}),
    };
    const marker: LatestCommitMarker = {
      evidenceVersion: nextEvidenceVersion,
      sessionVersion: nextSessionVersion,
      ...(safePathCandidate !== undefined
        ? { pathVersion: safePathCandidate.pathVersion }
        : current.latestCommit.pathVersion === undefined ? {} : { pathVersion: current.latestCommit.pathVersion }),
      requestId: input.requestId,
    };
    const archivedPathsToPublish: InternalPersistedPathSnapshot[] = current.internalPath?.status === "active" && internalPathCandidate?.status === "active"
      ? [{ ...structuredClone(current.internalPath), status: "superseded" }]
      : [];
    const stored: StoredSnapshot = {
      ...nextView,
      view: nextView,
      evidence: [...current.evidence, ...evidenceToPublish],
      knowledgeStates: input.candidate.knowledgeStates,
      activityProgress: input.candidate.activityProgress === undefined
        ? current.activityProgress
        : structuredClone(input.candidate.activityProgress),
      boundLearningCards: input.candidate.boundLearningCards === undefined
        ? current.boundLearningCards
        : structuredClone(input.candidate.boundLearningCards),
      diagnosticDraftVersion: input.candidate.diagnosticDraftVersion ?? current.diagnosticDraftVersion,
      ...(input.candidate.currentAttempt === undefined
        ? current.currentAttempt === undefined ? {} : { currentAttempt: structuredClone(current.currentAttempt) }
        : input.candidate.currentAttempt === null ? {} : { currentAttempt: structuredClone(input.candidate.currentAttempt) }),
      ...(input.candidate.diagnosticCandidate !== undefined
        ? { latestDiagnostic: input.candidate.diagnosticCandidate }
        : current.latestDiagnostic === undefined ? {} : { latestDiagnostic: current.latestDiagnostic }),
      ...(nextPath === undefined ? {} : { path: structuredClone(nextPath) }),
      ...(nextInternalPath === undefined ? {} : { internalPath: structuredClone(nextInternalPath) }),
      ...(archivedPathsToPublish.length > 0 || current.pathHistory !== undefined
        ? { pathHistory: [...(current.pathHistory ?? []), ...archivedPathsToPublish] }
        : {}),
      latestCommit: marker,
      createRequestId: current.createRequestId,
      createInputHash: current.createInputHash,
    };
    const publicSnapshot = this.publicSnapshot(stored);
    const response: CommittedSessionSnapshot = {
      ...publicSnapshot,
      committed: true,
      replayed: false,
      ...(single === undefined ? {} : { committedEvidenceId: evidenceToPublish[0]?.evidenceId }),
      ...(batch === undefined ? {} : { committedEvidenceIds: evidenceToPublish.map((item) => item.evidenceId) }),
      ...(input.candidate.diagnosticCandidate === undefined
        ? {}
        : { committedDiagnosticId: input.candidate.diagnosticCandidate.diagnosticId }),
    };
    const storedInput = JSON.parse(JSON.stringify(input)) as CommitLearningSessionInput;
    const storedInternalPath = internalPathCandidate === undefined
      ? undefined
      : structuredClone(internalPathCandidate);
    return {
      formatVersion: 1,
      input: storedInput,
      inputHash: hashValue(commitIdentity(storedInput, storedInternalPath)),
      previousSessionVersion: current.sessionVersion,
      snapshot: stored,
      response,
      evidenceToPublish,
      archivedPathsToPublish,
      ...(input.candidate.quizAttemptCandidate === undefined
        ? {}
        : { quizAttemptToPublish: structuredClone(input.candidate.quizAttemptCandidate) }),
      ...(storedInternalPath === undefined ? {} : { internalPathCandidate: storedInternalPath }),
    };
  }

  private validatePreparedTransaction(
    current: StoredSnapshot,
    requestId: string,
    candidate: PreparedTransaction,
  ): PreparedTransaction {
    assertSafeFileComponent(requestId, "candidate requestId");
    if (!isRecord(candidate)
        || candidate.formatVersion !== 1
        || !isRecord(candidate.input)
        || typeof candidate.inputHash !== "string") {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction format is incomplete");
    }
    if (candidate.input.requestId !== requestId
        || candidate.previousSessionVersion !== current.sessionVersion
        || candidate.input.sessionId !== current.sessionId
        || candidate.input.profileRevision !== current.profileRevision) {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction does not follow latest commit");
    }
    if (hashValue(commitIdentity(candidate.input, candidate.internalPathCandidate)) !== candidate.inputHash) {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction input hash does not close");
    }
    const expected = this.prepareTransaction(current, candidate.input, candidate.internalPathCandidate);
    if (!sameValue(candidate, expected)) {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction semantic closure failed");
    }
    return expected;
  }

  async create(input: CreateLearningSessionRecord) {
    assertSafeSubjectId(input.subjectId);
    assertSafeFileComponent(input.requestId, "requestId");
    if (!Number.isInteger(input.profileRevision) || input.profileRevision < 1) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "profileRevision must be positive");
    }
    if (!Number.isInteger(input.availableMinutes) || input.availableMinutes < 1) {
      throw new LearningSessionRepositoryError("storage_error", "availableMinutes must be a positive integer");
    }

    const sessionId = `session-${hashValue(`${input.subjectId}:${input.requestId}`).slice(0, 24)}`;
    return this.withLock(sessionId, async () => {
      const directory = this.sessionDirectory(input.subjectId, sessionId);
      const inputHash = hashValue(input);
      if (await exists(resolve(directory, "checkpoints", "latest.json"))) {
        const existing = await this.loadStoredSnapshot(directory);
        if (existing.createRequestId !== input.requestId || existing.createInputHash !== inputHash) {
          throw new LearningSessionRepositoryError("idempotency_conflict", "Create requestId has different content");
        }
        return existing.view;
      }

      const createdAt = this.now().toISOString();
      const view = {
        sessionId,
        sessionVersion: 1,
        profileRevision: input.profileRevision,
        subjectId: input.subjectId,
        mode: input.mode,
        goalId: input.goalId,
        ...(input.chapterId === undefined ? {} : { chapterId: input.chapterId }),
        availableMinutes: input.availableMinutes,
        status: "active" as const,
        stage: input.diagnosticRequired ? "diagnostic" as const : "path" as const,
        diagnosticRequired: input.diagnosticRequired,
      };
      const marker: LatestCommitMarker = { evidenceVersion: 0, sessionVersion: 1, requestId: input.requestId };
      const snapshot: StoredSnapshot = {
        ...view,
        view,
        evidence: [],
        knowledgeStates: [],
        activityProgress: [],
        boundLearningCards: [],
        diagnosticDraftVersion: 0,
        latestCommit: marker,
        createRequestId: input.requestId,
        createInputHash: inputHash,
      };

      await mkdir(resolve(directory, "diagnostic", "answers"), { recursive: true });
      await mkdir(resolve(directory, "evidence"), { recursive: true });
      await mkdir(resolve(directory, "snapshots"), { recursive: true });
      await mkdir(resolve(directory, ".candidates"), { recursive: true });
      await mkdir(resolve(directory, "commits"), { recursive: true });
      await mkdir(resolve(directory, "paths", "superseded"), { recursive: true });
      await writeJsonAtomic(resolve(directory, "session.json"), view);
      await writeJsonAtomic(resolve(directory, "knowledge_state.json"), []);
      await writeJsonAtomic(resolve(directory, "snapshots", "1.json"), snapshot);
      await writeJsonAtomic(resolve(directory, "checkpoints", "latest.json"), marker);
      await writeJsonAtomic(resolve(directory, "created.json"), { requestId: input.requestId, inputHash, createdAt });
      return view;
    });
  }

  async getSnapshot(input: GetSessionSnapshotInput): Promise<SessionSnapshot> {
    const directory = await this.findSessionDirectory(input.sessionId);
    const stored = await this.loadStoredSnapshot(directory);
    if (stored.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }
    if (stored.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    return this.publicSnapshot(stored);
  }

  async getBoundSnapshot(sessionId: string): Promise<SessionSnapshot> {
    const directory = await this.findSessionDirectory(sessionId);
    const stored = await this.loadStoredSnapshot(directory);
    return this.publicSnapshot(stored);
  }

  async listBoundSnapshots(): Promise<SessionSnapshot[]> {
    await mkdir(this.familiesRoot, { recursive: true });
    const snapshots: SessionSnapshot[] = [];
    for (const family of (await readdir(this.familiesRoot, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      if (!family.isDirectory()) continue;
      const root = resolveInside(this.familiesRoot, family.name, "_user", "learning_sessions");
      if (!(await exists(root))) continue;
      for (const session of (await readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
        if (!session.isDirectory() || !(await exists(resolve(root, session.name, "checkpoints", "latest.json")))) continue;
        snapshots.push(this.publicSnapshot(await this.loadStoredSnapshot(resolve(root, session.name))));
      }
    }
    return snapshots;
  }

  async getQuizAttempt(input: GetSessionSnapshotInput & { activityId: string; attemptId: string }): Promise<QuizAttemptSnapshot | undefined> {
    assertSafeFileComponent(input.activityId, "activityId");
    assertSafeFileComponent(input.attemptId, "attemptId");
    const directory = await this.findSessionDirectory(input.sessionId);
    const current = await this.loadStoredSnapshot(directory);
    if (current.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }
    if (current.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    const attemptDirectory = resolve(directory, "activities", input.activityId, "quiz-attempts", input.attemptId);
    if (!(await exists(attemptDirectory))) return undefined;
    const versions = (await readdir(attemptDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d+\.json$/u.test(entry.name))
      .map((entry) => Number.parseInt(entry.name, 10))
      .filter((version) => version <= current.sessionVersion)
      .sort((left, right) => right - left);
    if (versions[0] === undefined) return undefined;
    return structuredClone(await readJson<QuizAttemptSnapshot>(resolve(attemptDirectory, `${versions[0]}.json`), "Quiz Attempt"));
  }

  async saveDiagnosticDraftState(input: {
    requestId: string;
    sessionId: string;
    sessionVersion: number;
    profileRevision: number;
    diagnosticDraftVersion: number;
    draft: Record<string, unknown>;
    background?: unknown;
  }): Promise<{ diagnosticDraftVersion: number }> {
    assertSafeFileComponent(input.requestId, "requestId");
    return this.withLock(input.sessionId, async () => {
      const directory = await this.findSessionDirectory(input.sessionId);
      const current = await this.loadStoredSnapshot(directory);
      if (current.sessionVersion !== input.sessionVersion) {
        throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
      }
      if (current.profileRevision !== input.profileRevision) {
        throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
      }
      const identity = {
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
        diagnosticDraftVersion: input.diagnosticDraftVersion,
        draft: input.draft,
        background: input.background,
      };
      const inputHash = hashValue(identity);
      const commits = resolve(directory, "diagnostic", "draft-commits");
      const commitPath = resolve(commits, `${input.requestId}.json`);
      if (await exists(commitPath)) {
        const committed = await readJson<StoredDiagnosticDraftCommit>(commitPath, "diagnostic draft commit");
        if (committed.inputHash !== inputHash) {
          throw new LearningSessionRepositoryError("idempotency_conflict", "Diagnostic draft requestId has different content");
        }
        if (current.diagnosticDraftVersion < committed.diagnosticDraftVersion) {
          if (committed.diagnosticDraftVersion !== current.diagnosticDraftVersion + 1
              || !(await exists(resolve(directory, "diagnostic", "drafts", `${committed.diagnosticDraftVersion}.json`)))) {
            throw new LearningSessionRepositoryError("storage_error", "Diagnostic draft commit cannot be recovered");
          }
          await writeJsonAtomic(resolve(directory, "diagnostic", "checkpoint.json"), {
            diagnosticDraftVersion: committed.diagnosticDraftVersion,
            requestId: input.requestId,
          });
        }
        return { diagnosticDraftVersion: committed.diagnosticDraftVersion };
      }
      if (current.diagnosticDraftVersion !== input.diagnosticDraftVersion) {
        throw new LearningSessionRepositoryError("session_version_conflict", "Diagnostic draft version is stale");
      }
      const nextVersion = current.diagnosticDraftVersion + 1;
      const versions = resolve(directory, "diagnostic", "drafts");
      await mkdir(versions, { recursive: true });
      await mkdir(commits, { recursive: true });
      const previous = current.diagnosticDraftVersion === 0
        ? {}
        : await readJson<Record<string, unknown>>(resolve(versions, `${current.diagnosticDraftVersion}.json`), "previous diagnostic draft");
      const processedQuestionIds = [
        ...(Array.isArray(previous.processedQuestionIds) ? previous.processedQuestionIds.filter((value): value is string => typeof value === "string") : []),
        ...(typeof input.draft.processedQuestionId === "string" ? [input.draft.processedQuestionId] : []),
      ];
      const { processedQuestionId: _processedQuestionId, ...draft } = input.draft;
      await writeJsonAtomic(resolve(versions, `${nextVersion}.json`), {
        ...previous,
        ...draft,
        ...(input.background === undefined ? {} : { background: input.background }),
        processedQuestionIds: [...new Set(processedQuestionIds)],
        diagnosticDraftVersion: nextVersion,
      });
      await writeJsonAtomic(commitPath, { inputHash, diagnosticDraftVersion: nextVersion } satisfies StoredDiagnosticDraftCommit);
      await writeJsonAtomic(resolve(directory, "diagnostic", "checkpoint.json"), { diagnosticDraftVersion: nextVersion, requestId: input.requestId });
      return { diagnosticDraftVersion: nextVersion };
    });
  }

  async saveDiagnosticAnswerState(input: {
    requestId: string;
    sessionId: string;
    sessionVersion: number;
    profileRevision: number;
    diagnosticDraftVersion: number;
    answer: StoredDiagnosticAnswerState;
  }): Promise<{ diagnosticDraftVersion: number; output: import("../contracts/facade.js").DiagnosticAnswerOutput }> {
    assertSafeFileComponent(input.requestId, "requestId");
    assertSafeFileComponent(input.answer.questionId, "questionId");
    return this.withLock(input.sessionId, async () => {
      const directory = await this.findSessionDirectory(input.sessionId);
      const current = await this.loadStoredSnapshot(directory);
      if (current.sessionVersion !== input.sessionVersion) {
        throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
      }
      if (current.profileRevision !== input.profileRevision) {
        throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
      }
      const answersDirectory = resolve(directory, "diagnostic", "answers");
      const answerPath = resolve(answersDirectory, `${input.answer.questionId}.json`);
      let recoverableAnswer: StoredDiagnosticAnswerState | undefined;
      for (const entry of await readdir(answersDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const existing = await readJson<StoredDiagnosticAnswerState>(resolve(answersDirectory, entry.name), entry.name);
        if (existing.requestId !== input.requestId) continue;
        if (existing.submissionHash !== input.answer.submissionHash) {
          throw new LearningSessionRepositoryError("idempotency_conflict", "Diagnostic requestId has different content");
        }
        if (existing.output.diagnosticDraftVersion <= current.diagnosticDraftVersion) {
          return { diagnosticDraftVersion: existing.output.diagnosticDraftVersion, output: structuredClone(existing.output) };
        }
        recoverableAnswer = existing;
      }
      if (current.diagnosticDraftVersion !== input.diagnosticDraftVersion) {
        throw new LearningSessionRepositoryError("session_version_conflict", "Diagnostic draft version is stale");
      }
      const nextVersion = current.diagnosticDraftVersion + 1;
      if (input.answer.draftVersionBefore !== input.diagnosticDraftVersion
          || input.answer.output.diagnosticDraftVersion !== nextVersion) {
        throw new LearningSessionRepositoryError("evidence_invalid", "Diagnostic answer draft version binding is invalid");
      }
      const versions = resolve(directory, "diagnostic", "drafts");
      await mkdir(versions, { recursive: true });
      const previous = current.diagnosticDraftVersion === 0
        ? {}
        : await readJson<Record<string, unknown>>(resolve(versions, `${current.diagnosticDraftVersion}.json`), "previous diagnostic draft");
      const priorIds = Array.isArray(previous.processedQuestionIds)
        ? previous.processedQuestionIds.filter((value): value is string => typeof value === "string")
        : [];
      if (await exists(answerPath) && recoverableAnswer === undefined) {
        const previousAnswer = await readJson<StoredDiagnosticAnswerState>(answerPath, "previous diagnostic answer");
        const historyDirectory = resolve(directory, "diagnostic", "answer-history", input.answer.questionId);
        await mkdir(historyDirectory, { recursive: true });
        await writeJsonAtomic(
          resolve(historyDirectory, `${previousAnswer.output.diagnosticDraftVersion}-${hashValue(previousAnswer.requestId).slice(0, 12)}.json`),
          previousAnswer,
        );
      }
      await writeJsonAtomic(answerPath, recoverableAnswer ?? input.answer);
      await writeJsonAtomic(resolve(versions, `${nextVersion}.json`), {
        ...previous,
        processedQuestionIds: [...new Set([...priorIds, input.answer.questionId])],
        diagnosticDraftVersion: nextVersion,
      });
      await writeJsonAtomic(resolve(directory, "diagnostic", "checkpoint.json"), {
        diagnosticDraftVersion: nextVersion,
        requestId: input.requestId,
      });
      return { diagnosticDraftVersion: nextVersion, output: structuredClone(input.answer.output) };
    });
  }

  async hasRecoverableActivityCommit(input: { sessionId: string; requestId: string }): Promise<boolean> {
    const directory = await this.findSessionDirectory(input.sessionId);
    return exists(resolve(directory, ".candidates", input.requestId, "transaction.json"));
  }

  /** Internal A port; full path metadata never crosses the public 21号 snapshot DTO. */
  async getInternalPathSnapshot(input: GetSessionSnapshotInput): Promise<InternalPersistedPathSnapshot | undefined> {
    const directory = await this.findSessionDirectory(input.sessionId);
    const stored = await this.loadStoredSnapshot(directory);
    if (stored.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }
    if (stored.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    return stored.internalPath === undefined ? undefined : structuredClone(stored.internalPath);
  }

  async getBoundLearningCards(input: GetSessionSnapshotInput) {
    const directory = await this.findSessionDirectory(input.sessionId);
    const stored = await this.loadStoredSnapshot(directory);
    if (stored.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }
    if (stored.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    return structuredClone(stored.boundLearningCards);
  }

  async commit(input: CommitLearningSessionInput): Promise<CommittedSessionSnapshot> {
    return this.commitWithPath(input, input.candidate.internalPathCandidate);
  }

  async commitInternalPath(
    input: CommitLearningSessionInput,
    path: InternalPersistedPathSnapshot,
  ): Promise<CommittedSessionSnapshot> {
    return this.commitWithPath(input, path);
  }

  private async commitWithPath(
    input: CommitLearningSessionInput,
    internalPathCandidate?: InternalPersistedPathSnapshot,
  ): Promise<CommittedSessionSnapshot> {
    assertSafeFileComponent(input.requestId, "requestId");
    return this.withLock(input.sessionId, async () => {
      const directory = await this.findSessionDirectory(input.sessionId);
      const commitPath = resolve(directory, "commits", `${input.requestId}.json`);
      const inputHash = hashValue(commitIdentity(input, internalPathCandidate));
      if (await exists(commitPath)) {
        const committed = await readJson<StoredCommitResult>(commitPath, "commit result");
        if (committed.inputHash !== inputHash) {
          throw new LearningSessionRepositoryError("idempotency_conflict", "Commit requestId has different content");
        }
        const marker = await readJson<LatestCommitMarker>(resolve(directory, "checkpoints", "latest.json"), "latest.json");
        if (marker.requestId !== input.requestId) {
          const preparedPath = resolve(directory, ".candidates", input.requestId, "transaction.json");
          if (!(await exists(preparedPath))) {
            throw new LearningSessionRepositoryError("storage_error", "Commit result exists without a published marker or candidate");
          }
          const candidate = await readJson<PreparedTransaction>(preparedPath, "prepared transaction");
          const current = await this.loadStoredSnapshot(directory);
          const prepared = this.validatePreparedTransaction(current, input.requestId, candidate);
          if (committed.inputHash !== prepared.inputHash || !sameValue(committed.response, prepared.response)) {
            throw new LearningSessionRepositoryError("storage_error", "Commit result does not match prepared transaction");
          }
          await this.publishPrepared(directory, input.requestId, prepared);
        }
        return { ...committed.response, replayed: true };
      }

      const current = await this.loadStoredSnapshot(directory);
      if (current.sessionVersion !== input.sessionVersion) {
        throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
      }
      if (current.profileRevision !== input.profileRevision) {
        throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
      }

      const prepared = this.prepareTransaction(current, input, internalPathCandidate);
      const candidateDirectory = resolve(directory, ".candidates", input.requestId);
      await mkdir(candidateDirectory, { recursive: true });
      await writeJsonAtomic(resolve(candidateDirectory, "transaction.json"), prepared);
      await this.beforePublish?.(input.sessionId, input.requestId, "candidate_written");
      const durable = await readJson<PreparedTransaction>(resolve(candidateDirectory, "transaction.json"), "prepared transaction");
      const validated = this.validatePreparedTransaction(current, input.requestId, durable);
      await this.publishPrepared(directory, input.requestId, validated);
      return validated.response;
    });
  }

  private async publishPrepared(directory: string, requestId: string, prepared: PreparedTransaction): Promise<void> {
    assertSafeFileComponent(requestId, "requestId");
    if (prepared.quizAttemptToPublish !== undefined) {
      const attempt = prepared.quizAttemptToPublish;
      await writeJsonAtomic(
        resolve(directory, "activities", attempt.activityId, "quiz-attempts", attempt.attemptId, `${prepared.snapshot.sessionVersion}.json`),
        attempt,
      );
    }
    await this.beforePublish?.(prepared.input.sessionId, requestId, "attempt_written");
    await this.beforePublish?.(prepared.input.sessionId, requestId, "evidence_written");
    for (const evidence of prepared.evidenceToPublish) {
      assertSafeFileComponent(evidence.evidenceId, "evidenceId");
      await writeJsonAtomic(resolve(directory, "evidence", `${evidence.evidenceId}.json`), evidence);
    }
    await this.beforePublish?.(prepared.input.sessionId, requestId, "knowledge_state_written");
    for (const archived of prepared.archivedPathsToPublish) {
      await writeJsonAtomic(resolve(directory, "paths", "superseded", `${archived.pathVersion}.json`), archived);
    }
    await writeJsonAtomic(resolve(directory, "knowledge_state.json"), prepared.snapshot.knowledgeStates);
    if (prepared.snapshot.latestDiagnostic !== undefined) {
      await writeJsonAtomic(resolve(directory, "diagnostic", "result.json"), prepared.snapshot.latestDiagnostic);
    }
    await this.beforePublish?.(prepared.input.sessionId, requestId, "path_written");
    await writeJsonAtomic(
      resolve(directory, "snapshots", `${prepared.snapshot.sessionVersion}.json`),
      prepared.snapshot,
    );
    await this.beforePublish?.(prepared.input.sessionId, requestId, "progress_written");
    await writeJsonAtomic(resolve(directory, "session.json"), prepared.snapshot.view);
    await writeJsonAtomic(resolve(directory, "commits", `${requestId}.json`), {
      inputHash: prepared.inputHash,
      response: prepared.response,
    } satisfies StoredCommitResult);
    // The marker is deliberately last: readers only observe the new snapshot after this rename.
    await this.beforePublish?.(prepared.input.sessionId, requestId, "checkpoint_written");
    await writeJsonAtomic(resolve(directory, "checkpoints", "latest.json"), prepared.snapshot.latestCommit);
    await rm(resolve(directory, ".candidates", requestId), { recursive: true, force: true });
  }

  async recover(input: RecoverLearningSessionInput): Promise<RecoverySnapshot> {
    assertSafeFileComponent(input.requestId, "requestId");
    return this.withLock(input.sessionId, async () => {
      const directory = await this.findSessionDirectory(input.sessionId);
      let current = await this.loadStoredSnapshot(directory);
      if (current.profileRevision !== input.profileRevision) {
        throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
      }
      if (current.sessionVersion !== input.sessionVersion) {
        throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
      }

      const candidateRoot = resolve(directory, ".candidates");
      await mkdir(candidateRoot, { recursive: true });
      const entries = await readdir(candidateRoot, { withFileTypes: true });
      let isolatedCandidate = false;
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        try {
          assertSafeFileComponent(entry.name, "candidate requestId");
          const candidate = await readJson<PreparedTransaction>(
            resolve(candidateRoot, entry.name, "transaction.json"),
            "prepared transaction",
          );
          const prepared = this.validatePreparedTransaction(current, entry.name, candidate);
          await this.publishPrepared(directory, entry.name, prepared);
          current = await this.loadStoredSnapshot(directory);
          return {
            ...this.publicSnapshot(current),
            recoveryAction: "completed_candidate_commit",
          };
        } catch {
          isolatedCandidate = true;
          const quarantine = resolve(directory, "quarantine");
          await mkdir(quarantine, { recursive: true });
          const quarantineName = `candidate-${hashValue(entry.name).slice(0, 16)}-${Date.now()}`;
          await rename(resolve(candidateRoot, entry.name), resolve(quarantine, quarantineName));
        }
      }

      const storedKnowledge = await readJson<KnowledgeState[]>(resolve(directory, "knowledge_state.json"), "knowledge_state.json");
      if (!sameValue(storedKnowledge, current.knowledgeStates)) {
        await writeJsonAtomic(resolve(directory, "knowledge_state.json"), current.knowledgeStates);
        return { ...this.publicSnapshot(current), recoveryAction: "rebuilt_derived_state" };
      }
      return {
        ...this.publicSnapshot(current),
        recoveryAction: isolatedCandidate ? "isolated_incomplete_candidate" : "none",
      };
    });
  }
}
