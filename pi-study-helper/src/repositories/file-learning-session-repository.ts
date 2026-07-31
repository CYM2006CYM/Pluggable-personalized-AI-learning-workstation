import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import type { Evidence, KnowledgeState, LearnerDiagnostic } from "../domain/v2-types.js";
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
  RecoverySnapshot,
  RecoverLearningSessionInput,
  SessionSnapshot,
} from "./learning-session-repository.js";

interface StoredSnapshot extends SessionSnapshot {
  createRequestId: string;
  createInputHash: string;
}

interface StoredCommitResult {
  inputHash: string;
  response: CommittedSessionSnapshot;
}

interface PreparedTransaction {
  formatVersion: 1;
  input: CommitLearningSessionInput;
  inputHash: string;
  previousSessionVersion: number;
  snapshot: StoredSnapshot;
  response: CommittedSessionSnapshot;
  evidenceToPublish: Evidence[];
}

export interface FileLearningSessionRepositoryOptions {
  dataRoot?: string;
  now?: () => Date;
  /** Test hook invoked after durable candidate creation and before publication. */
  beforePublish?: (sessionId: string, requestId: string) => Promise<void> | void;
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

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const checked = rawState as unknown as KnowledgeState;
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
        || !Array.isArray(checked.evidenceIds) || checked.evidenceIds.some((id) => typeof id !== "string" || id.length === 0)
        || !Array.isArray(checked.consideredEvidenceIds)
        || checked.consideredEvidenceIds.some((id) => typeof id !== "string" || id.length === 0)
        || new Set(checked.evidenceIds).size !== checked.evidenceIds.length
        || new Set(checked.consideredEvidenceIds).size !== checked.consideredEvidenceIds.length
        || checked.validEvidenceCount !== checked.consideredEvidenceIds.length
        || checked.consideredEvidenceIds.some((id) => !checked.evidenceIds.includes(id))
        || !Number.isFinite(Date.parse(checked.asOf))
        || !Number.isFinite(Date.parse(checked.lastUpdatedAt))) {
      throw new LearningSessionRepositoryError("evidence_invalid", "KnowledgeState fields are not semantically valid");
    }
    if (checked.skipEligible && checked.status !== "mastered") {
      throw new LearningSessionRepositoryError("evidence_invalid", "Only mastered KnowledgeState may be skip eligible");
    }
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

export class FileLearningSessionRepository implements LearningSessionRepository {
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
    return snapshot;
  }

  private publicSnapshot(snapshot: StoredSnapshot): SessionSnapshot {
    const { createRequestId: _createRequestId, createInputHash: _createInputHash, ...safe } = snapshot;
    return safe;
  }

  private prepareTransaction(current: StoredSnapshot, input: CommitLearningSessionInput): PreparedTransaction {
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

    const nextEvidenceVersion = candidates.length > 0
      ? current.latestCommit.evidenceVersion + 1
      : current.latestCommit.evidenceVersion;
    if (candidates.some((item) => item.evidenceVersion !== undefined && item.evidenceVersion !== nextEvidenceVersion)) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Evidence candidate version does not match transaction");
    }
    validateKnowledgeStates(input.candidate.knowledgeStates, input, nextEvidenceVersion);
    validateDiagnostic(input.candidate.diagnosticCandidate, input.candidate.knowledgeStates, input, nextEvidenceVersion);

    const evidenceToPublish = candidates.map((item) => ({ ...item, evidenceVersion: nextEvidenceVersion }));
    const nextSessionVersion = current.sessionVersion + 1;
    const nextView = {
      ...current.view,
      sessionVersion: nextSessionVersion,
      ...(input.candidate.nextStage === undefined ? {} : { stage: input.candidate.nextStage }),
    };
    const marker: LatestCommitMarker = {
      evidenceVersion: nextEvidenceVersion,
      sessionVersion: nextSessionVersion,
      ...(input.candidate.pathCandidate !== undefined
        ? { pathVersion: input.candidate.pathCandidate.pathVersion }
        : current.latestCommit.pathVersion === undefined ? {} : { pathVersion: current.latestCommit.pathVersion }),
      requestId: input.requestId,
    };
    const stored: StoredSnapshot = {
      ...nextView,
      view: nextView,
      evidence: [...current.evidence, ...evidenceToPublish],
      knowledgeStates: input.candidate.knowledgeStates,
      ...(input.candidate.diagnosticCandidate !== undefined
        ? { latestDiagnostic: input.candidate.diagnosticCandidate }
        : current.latestDiagnostic === undefined ? {} : { latestDiagnostic: current.latestDiagnostic }),
      ...(input.candidate.pathCandidate !== undefined
        ? { path: input.candidate.pathCandidate }
        : current.path === undefined ? {} : { path: current.path }),
      latestCommit: marker,
      createRequestId: current.createRequestId,
      createInputHash: current.createInputHash,
    };
    const publicSnapshot = this.publicSnapshot(stored);
    const response: CommittedSessionSnapshot = {
      ...publicSnapshot,
      committed: true,
      ...(single === undefined ? {} : { committedEvidenceId: evidenceToPublish[0]?.evidenceId }),
      ...(batch === undefined ? {} : { committedEvidenceIds: evidenceToPublish.map((item) => item.evidenceId) }),
      ...(input.candidate.diagnosticCandidate === undefined
        ? {}
        : { committedDiagnosticId: input.candidate.diagnosticCandidate.diagnosticId }),
    };
    const storedInput = JSON.parse(JSON.stringify(input)) as CommitLearningSessionInput;
    return {
      formatVersion: 1,
      input: storedInput,
      inputHash: hashValue(storedInput),
      previousSessionVersion: current.sessionVersion,
      snapshot: stored,
      response,
      evidenceToPublish,
    };
  }

  private validatePreparedTransaction(
    current: StoredSnapshot,
    requestId: string,
    candidate: unknown,
  ): PreparedTransaction {
    assertSafeFileComponent(requestId, "candidate requestId");
    if (!isRecord(candidate)
        || candidate.formatVersion !== 1
        || !isRecord(candidate.input)
        || typeof candidate.inputHash !== "string") {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction format is incomplete");
    }
    const prepared = candidate as unknown as PreparedTransaction;
    if (prepared.input.requestId !== requestId
        || prepared.previousSessionVersion !== current.sessionVersion
        || prepared.input.sessionId !== current.sessionId
        || prepared.input.profileRevision !== current.profileRevision) {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction does not follow latest commit");
    }
    if (hashValue(prepared.input) !== prepared.inputHash) {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction input hash does not close");
    }
    const expected = this.prepareTransaction(current, prepared.input);
    if (!sameValue(prepared, expected)) {
      throw new LearningSessionRepositoryError("storage_error", "Prepared transaction semantic closure failed");
    }
    return prepared;
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
        latestCommit: marker,
        createRequestId: input.requestId,
        createInputHash: inputHash,
      };

      await mkdir(resolve(directory, "diagnostic", "answers"), { recursive: true });
      await mkdir(resolve(directory, "evidence"), { recursive: true });
      await mkdir(resolve(directory, "snapshots"), { recursive: true });
      await mkdir(resolve(directory, ".candidates"), { recursive: true });
      await mkdir(resolve(directory, "commits"), { recursive: true });
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
    return this.publicSnapshot(stored);
  }

  async commit(input: CommitLearningSessionInput): Promise<CommittedSessionSnapshot> {
    assertSafeFileComponent(input.requestId, "requestId");
    return this.withLock(input.sessionId, async () => {
      const directory = await this.findSessionDirectory(input.sessionId);
      const commitPath = resolve(directory, "commits", `${input.requestId}.json`);
      const inputHash = hashValue(input);
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
          const candidate = await readJson<unknown>(preparedPath, "prepared transaction");
          const current = await this.loadStoredSnapshot(directory);
          const prepared = this.validatePreparedTransaction(current, input.requestId, candidate);
          if (committed.inputHash !== prepared.inputHash || !sameValue(committed.response, prepared.response)) {
            throw new LearningSessionRepositoryError("storage_error", "Commit result does not match prepared transaction");
          }
          await this.publishPrepared(directory, input.requestId, prepared);
        }
        return committed.response;
      }

      const current = await this.loadStoredSnapshot(directory);
      if (current.sessionVersion !== input.sessionVersion) {
        throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
      }
      if (current.profileRevision !== input.profileRevision) {
        throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
      }

      const prepared = this.prepareTransaction(current, input);
      const candidateDirectory = resolve(directory, ".candidates", input.requestId);
      await mkdir(candidateDirectory, { recursive: true });
      await writeJsonAtomic(resolve(candidateDirectory, "transaction.json"), prepared);
      await this.beforePublish?.(input.sessionId, input.requestId);
      const durable = await readJson<unknown>(resolve(candidateDirectory, "transaction.json"), "prepared transaction");
      const validated = this.validatePreparedTransaction(current, input.requestId, durable);
      await this.publishPrepared(directory, input.requestId, validated);
      return validated.response;
    });
  }

  private async publishPrepared(directory: string, requestId: string, prepared: PreparedTransaction): Promise<void> {
    assertSafeFileComponent(requestId, "requestId");
    for (const evidence of prepared.evidenceToPublish) {
      assertSafeFileComponent(evidence.evidenceId, "evidenceId");
      await writeJsonAtomic(resolve(directory, "evidence", `${evidence.evidenceId}.json`), evidence);
    }
    await writeJsonAtomic(resolve(directory, "knowledge_state.json"), prepared.snapshot.knowledgeStates);
    if (prepared.snapshot.latestDiagnostic !== undefined) {
      await writeJsonAtomic(resolve(directory, "diagnostic", "result.json"), prepared.snapshot.latestDiagnostic);
    }
    await writeJsonAtomic(
      resolve(directory, "snapshots", `${prepared.snapshot.sessionVersion}.json`),
      prepared.snapshot,
    );
    await writeJsonAtomic(resolve(directory, "session.json"), prepared.snapshot.view);
    await writeJsonAtomic(resolve(directory, "commits", `${requestId}.json`), {
      inputHash: prepared.inputHash,
      response: prepared.response,
    } satisfies StoredCommitResult);
    // The marker is deliberately last: readers only observe the new snapshot after this rename.
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
          const candidate = await readJson<unknown>(
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
