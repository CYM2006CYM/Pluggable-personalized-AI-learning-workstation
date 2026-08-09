import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import { assertSafeFileComponent, assertSafeSubjectId, resolveInside, writeJsonAtomic, writeTextAtomic } from "../infrastructure/safe-files.js";
import type { ActivityResult } from "../domain/v2-types.js";
import type {
  ActivityAssignment,
  ActivityAttemptCandidate,
  ActivityDraft,
  ActivityRecoveryReport,
  ActivityRepository,
  EvaluationFailureRecord,
  OpenActivityInput,
  PrepareActivityRunInput,
  PreparedActivityRun,
  RecordActivityResultInput,
  SaveActivityDraftInput,
  ActivityResultRecord,
} from "./activity-repository.js";
import { ActivityRepositoryError } from "./activity-repository.js";

interface FileActivityRepositoryOptions {
  dataRoot?: string;
  now?: () => Date;
  beforePublish?: (stage: "draft" | "result" | "commit", requestId: string) => Promise<void> | void;
}

interface StoredDraft extends Omit<ActivityDraft, "code"> {
  codeRef: "draft.py";
}

interface StoredAttempt extends Omit<ActivityAttemptCandidate, "resultRef" | "submissionRef"> {
  resultRef: "result.json";
  submissionRef: "submission.py";
  inputHash: string;
}

interface StoredTransaction {
  formatVersion: 1;
  kind: "result";
  inputHash: string;
  attempt: StoredAttempt;
  result: RecordActivityResultInput["result"];
  code: string;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson<T>(path: string, label: string): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new ActivityRepositoryError("storage_error", `${label} is not valid JSON`);
  }
}

function hashValue(value: unknown): string { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function hashCode(code: string): string { return createHash("sha256").update(code, "utf8").digest("hex"); }
function clone<T>(value: T): T { return structuredClone(value); }

function resultIdentity(input: RecordActivityResultInput): unknown {
  return {
    subjectId: input.subjectId, sessionId: input.sessionId, sessionVersion: input.sessionVersion,
    requestId: input.requestId, attemptId: input.attemptId, activityId: input.activityId,
    activityVersion: input.activityVersion, profileRevision: input.profileRevision,
    assignment: {
      assignmentId: input.assignment.assignmentId, activityId: input.assignment.activityId,
      activityVersion: input.assignment.activityVersion, profileRevision: input.assignment.profileRevision,
      primaryKnowledgePointId: input.assignment.primaryKnowledgePointId, kind: input.assignment.kind,
      source: input.assignment.source, assetBundleHash: input.assignment.assetBundleHash,
      environmentId: input.assignment.environmentId,
    },
    draftVersion: input.draftVersion, codeHash: hashCode(input.code),
    highestAssistance: input.highestAssistance ?? "independent", result: input.result,
  };
}

function safe(value: string, label: string): void {
  try { assertSafeFileComponent(value, label); } catch { throw new ActivityRepositoryError("submission_contract_error", `Invalid ${label}`); }
}

function validateAssignment(value: ActivityAssignment): void {
  safe(value.assignmentId, "assignmentId"); safe(value.activityId, "activityId");
  safe(value.environmentId, "environmentId");
  if (!/^(?:sha256:)?[a-f0-9]{64}$/u.test(value.assetBundleHash)) throw new ActivityRepositoryError("submission_contract_error", "Activity asset bundle hash is invalid");
  if (!Number.isSafeInteger(value.activityVersion) || value.activityVersion < 1 || !Number.isSafeInteger(value.profileRevision) || value.profileRevision < 1 || value.primaryKnowledgePointId.trim() === "") {
    throw new ActivityRepositoryError("submission_contract_error", "Activity assignment version or knowledge point is invalid");
  }
}

export class FileActivityRepository implements ActivityRepository {
  private readonly dataRoot: string;
  private readonly familiesRoot: string;
  private readonly now: () => Date;
  private readonly beforePublish?: FileActivityRepositoryOptions["beforePublish"];
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: FileActivityRepositoryOptions = {}) {
    this.dataRoot = resolveStudyDataRoot(options.dataRoot);
    this.familiesRoot = profileFamiliesRoot(this.dataRoot);
    this.now = options.now ?? (() => new Date());
    this.beforePublish = options.beforePublish;
  }

  private activityDirectory(subjectId: string, sessionId: string, activityId: string): string {
    assertSafeSubjectId(subjectId); safe(sessionId, "sessionId"); safe(activityId, "activityId");
    return resolveInside(this.familiesRoot, subjectId, "_user", "learning_sessions", sessionId, "activities", activityId);
  }
  private sessionLock(subjectId: string, sessionId: string): string { return `${subjectId}/${sessionId}`; }
  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    this.locks.set(key, current);
    await previous;
    try { return await operation(); } finally { release(); if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  private iso(value?: string): string { return value ?? this.now().toISOString(); }

  async openActivity(input: OpenActivityInput): Promise<ActivityDraft> {
    validateAssignment(input.assignment); safe(input.requestId, "requestId");
    return this.withLock(this.sessionLock(input.subjectId, input.sessionId), async () => {
      const directory = this.activityDirectory(input.subjectId, input.sessionId, input.assignment.activityId);
      await mkdir(directory, { recursive: true });
      const draftPath = resolve(directory, "draft.json");
      if (await exists(draftPath)) {
        const stored = await readJson<StoredDraft>(draftPath, "draft.json");
        if (stored.profileRevision !== input.assignment.profileRevision || stored.activityVersion !== input.assignment.activityVersion) throw new ActivityRepositoryError("activity_version_conflict", "Draft is bound to another activity revision");
        return this.readDraft(directory, stored);
      }
      const draft: ActivityDraft = { sessionId: input.sessionId, activityId: input.assignment.activityId, activityVersion: input.assignment.activityVersion, profileRevision: input.assignment.profileRevision, attemptId: input.attemptId ?? `attempt-${randomUUID()}`, draftVersion: 1, code: "", codeHash: hashCode(""), hintEvents: [], updatedAt: this.iso(input.now) };
      await writeTextAtomic(resolve(directory, "draft.py"), "");
      await writeJsonAtomic(draftPath, { ...draft, code: undefined, codeRef: "draft.py" });
      return clone(draft);
    });
  }

  async saveDraft(input: SaveActivityDraftInput): Promise<ActivityDraft> {
    safe(input.requestId, "requestId"); safe(input.attemptId, "attemptId");
    return this.withLock(this.sessionLock(input.subjectId, input.sessionId), async () => {
      const directory = this.activityDirectory(input.subjectId, input.sessionId, input.activityId);
      if (!(await exists(resolve(directory, "draft.json")))) throw new ActivityRepositoryError("activity_not_found", "Activity draft does not exist");
      const current = await this.readDraft(directory);
      if (current.attemptId !== input.attemptId || current.profileRevision !== input.profileRevision || current.activityVersion !== input.activityVersion) throw new ActivityRepositoryError("activity_version_conflict", "Draft binding does not match");
      if (current.draftVersion !== input.draftVersion) throw new ActivityRepositoryError("draft_version_conflict", "Draft version is stale");
      const draft: ActivityDraft = { ...current, draftVersion: current.draftVersion + 1, code: input.code, codeHash: hashCode(input.code), hintEvents: [...(input.hintEvents ?? current.hintEvents)], updatedAt: this.iso(input.now) };
      const stage = resolve(directory, ".candidates", `draft-${input.requestId}`);
      await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true });
      await writeTextAtomic(resolve(stage, "draft.py"), input.code);
      await writeJsonAtomic(resolve(stage, "draft.json"), { ...draft, code: undefined, codeRef: "draft.py" });
      await this.beforePublish?.("draft", input.requestId);
      await rename(resolve(stage, "draft.py"), resolve(directory, "draft.py"));
      await rename(resolve(stage, "draft.json"), resolve(directory, "draft.json"));
      await rm(stage, { recursive: true, force: true });
      return clone(draft);
    });
  }

  async prepareRun(input: PrepareActivityRunInput): Promise<PreparedActivityRun> {
    safe(input.requestId, "requestId"); safe(input.attemptId, "attemptId");
    const directory = this.activityDirectory(input.subjectId, input.sessionId, input.activityId);
    const draft = await this.readDraft(directory);
    if (draft.attemptId !== input.attemptId || draft.activityVersion !== input.activityVersion || draft.profileRevision !== input.profileRevision) throw new ActivityRepositoryError("activity_version_conflict", "Run binding does not match draft");
    if (draft.draftVersion !== input.draftVersion) throw new ActivityRepositoryError("draft_version_conflict", "Run draft version is stale");
    const prepared: PreparedActivityRun = { runId: `run-${randomUUID()}`, sessionId: input.sessionId, activityId: input.activityId, attemptId: input.attemptId, draftVersion: input.draftVersion, mode: input.mode, codeHash: draft.codeHash, createdAt: this.iso(input.now) };
    await writeJsonAtomic(resolve(directory, "runs", `${prepared.runId}.json`), prepared);
    return clone(prepared);
  }

  async recordResult(input: RecordActivityResultInput): Promise<ActivityResultRecord | EvaluationFailureRecord> {
    validateAssignment(input.assignment); safe(input.requestId, "requestId"); safe(input.attemptId, "attemptId");
    return this.withLock(this.sessionLock(input.subjectId, input.sessionId), async () => {
      const directory = this.activityDirectory(input.subjectId, input.sessionId, input.activityId);
      const inputHash = hashValue(resultIdentity(input));
      const commitPath = resolve(directory, "attempts", input.attemptId, "attempt.json");
      if (await exists(commitPath)) {
        const existing = await readJson<StoredAttempt>(commitPath, "attempt.json");
        if (existing.inputHash !== inputHash) throw new ActivityRepositoryError("idempotency_conflict", "Attempt identity has different content");
        return { attempt: clone(existing), result: clone(await readJson<ActivityResult>(resolve(directory, "attempts", input.attemptId, "result.json"), "result.json")) };
      }
      if (input.assignment.activityId !== input.activityId || input.assignment.activityVersion !== input.activityVersion || input.assignment.profileRevision !== input.profileRevision) throw new ActivityRepositoryError("activity_version_conflict", "Assignment binding does not match submission");
      const draft = await this.readDraft(directory);
      if (draft.attemptId !== input.attemptId || draft.draftVersion !== input.draftVersion || draft.profileRevision !== input.profileRevision) throw new ActivityRepositoryError("draft_version_conflict", "Submission draft is stale");
      if (draft.codeHash !== hashCode(input.code)) throw new ActivityRepositoryError("draft_version_conflict", "Submission code does not match the current draft");
      if (input.result.errorKind === "evaluator" || input.result.verdict === "not_graded" || input.result.executionStatus !== "completed") {
        const failure: EvaluationFailureRecord = { requestId: input.requestId, attemptId: input.attemptId, sessionId: input.sessionId, activityId: input.activityId, assignmentId: input.assignment.assignmentId, errorCode: input.result.errorCode ?? "evaluator_error", stage: "user_code", environmentHash: input.result.environmentHash, createdAt: this.iso(input.now) };
        await writeJsonAtomic(resolve(directory, "failures", `${input.requestId}.json`), failure);
        return clone(failure);
      }
      if (!Number.isFinite(input.result.score) || input.result.score === undefined || input.result.score < 0 || input.result.score > 1) throw new ActivityRepositoryError("submission_contract_error", "Graded result score must be in 0..1");
      if (input.result.assetBundleHash !== input.assignment.assetBundleHash) throw new ActivityRepositoryError("environment_mismatch", "Result asset bundle does not match the assignment lock");
      if (!/^sha256:[a-f0-9]{64}$/u.test(input.result.environmentHash)) throw new ActivityRepositoryError("environment_mismatch", "Result environment hash is not a formal lock hash");
      const attempt: StoredAttempt = { attemptId: input.attemptId, requestId: input.requestId, sessionId: input.sessionId, activityId: input.activityId, activityVersion: input.activityVersion, assignmentId: input.assignment.assignmentId, primaryKnowledgePointId: input.assignment.primaryKnowledgePointId, kind: input.assignment.kind, profileRevision: input.profileRevision, source: input.assignment.source, assetBundleHash: input.assignment.assetBundleHash, submissionRef: "submission.py", codeHash: hashCode(input.code), highestAssistance: input.highestAssistance ?? "independent", resultRef: "result.json", attemptStatus: "completed", createdAt: this.iso(input.now), inputHash };
      const stage = resolve(directory, ".candidates", `result-${input.requestId}`);
      await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true });
      await writeTextAtomic(resolve(stage, "submission.py"), input.code);
      await writeJsonAtomic(resolve(stage, "result.json"), input.result);
      await writeJsonAtomic(resolve(stage, "attempt.json"), attempt);
      await this.beforePublish?.("result", input.requestId);
      const target = resolve(directory, "attempts", input.attemptId); await mkdir(resolve(directory, "attempts"), { recursive: true });
      await rm(target, { recursive: true, force: true }); await rename(stage, target);
      return { attempt: clone(attempt), result: clone(input.result) };
    });
  }

  async getAttempt(input: { subjectId: string; sessionId: string; activityId: string; attemptId: string }): Promise<ActivityResultRecord | undefined> {
    const directory = this.activityDirectory(input.subjectId, input.sessionId, input.activityId);
    const attemptPath = resolve(directory, "attempts", input.attemptId, "attempt.json");
    if (!(await exists(attemptPath))) return undefined;
    const attempt = await readJson<StoredAttempt>(attemptPath, "attempt.json");
    const result = await readJson<RecordActivityResultInput["result"]>(resolve(directory, "attempts", input.attemptId, "result.json"), "result.json");
    return { attempt: clone(attempt), result: clone(result) };
  }

  async markCommitted(input: { subjectId: string; sessionId: string; activityId: string; attemptId: string; committedAt?: string }): Promise<ActivityAttemptCandidate> {
    return this.withLock(this.sessionLock(input.subjectId, input.sessionId), async () => {
      const directory = this.activityDirectory(input.subjectId, input.sessionId, input.activityId); const path = resolve(directory, "attempts", input.attemptId, "attempt.json");
      const attempt = await readJson<StoredAttempt>(path, "attempt.json");
      if (attempt.committedAt !== undefined) return clone(attempt);
      const updated = { ...attempt, committedAt: input.committedAt ?? this.now().toISOString() };
      await writeJsonAtomic(path, updated); return clone(updated);
    });
  }

  async discardAttempt(input: { subjectId: string; sessionId: string; activityId: string; attemptId: string }): Promise<void> {
    const directory = this.activityDirectory(input.subjectId, input.sessionId, input.activityId);
    await rm(resolve(directory, "attempts", input.attemptId), { recursive: true, force: true });
  }

  async recover(input: { subjectId: string; sessionId: string }): Promise<ActivityRecoveryReport> {
    const root = resolveInside(this.familiesRoot, input.subjectId, "_user", "learning_sessions", input.sessionId, "activities");
    const report: ActivityRecoveryReport = { publishedCandidates: [], quarantinedCandidates: [], removedOrphanResults: [] };
    if (!(await exists(root))) return report;
    for (const activityEntry of await readdir(root, { withFileTypes: true })) {
      if (!activityEntry.isDirectory()) continue;
      const directory = resolve(root, activityEntry.name); const candidateRoot = resolve(directory, ".candidates");
      if (!(await exists(candidateRoot))) continue;
      for (const candidate of await readdir(candidateRoot, { withFileTypes: true })) {
        if (!candidate.isDirectory()) continue;
        const stage = resolve(candidateRoot, candidate.name); const transaction = resolve(stage, "attempt.json");
        try {
          if (!candidate.name.startsWith("result-") || !(await exists(transaction))) throw new Error("invalid candidate");
          const attempt = await readJson<StoredAttempt>(transaction, "candidate attempt");
          const result = await readJson<ActivityResult>(resolve(stage, "result.json"), "candidate result");
          if (hashCode(await readFile(resolve(stage, "submission.py"), "utf8")) !== attempt.codeHash) throw new Error("code hash mismatch");
          const target = resolve(directory, "attempts", attempt.attemptId); await mkdir(resolve(directory, "attempts"), { recursive: true });
          await rm(target, { recursive: true, force: true }); await rename(stage, target); void result;
          report.publishedCandidates.push(`${activityEntry.name}/${attempt.attemptId}`);
        } catch { const quarantine = resolve(directory, "quarantine"); await mkdir(quarantine, { recursive: true }); await rename(stage, resolve(quarantine, `${candidate.name}-${Date.now()}`)); report.quarantinedCandidates.push(`${activityEntry.name}/${candidate.name}`); }
      }
    }
    return report;
  }

  private async readDraft(directory: string, stored?: StoredDraft): Promise<ActivityDraft> {
    const metadata = stored ?? await readJson<StoredDraft>(resolve(directory, "draft.json"), "draft.json");
    const code = await readFile(resolve(directory, metadata.codeRef), "utf8");
    if (hashCode(code) !== metadata.codeHash) throw new ActivityRepositoryError("storage_error", "Draft code hash does not match metadata");
    return { ...metadata, code, hintEvents: clone(metadata.hintEvents) };
  }
}
