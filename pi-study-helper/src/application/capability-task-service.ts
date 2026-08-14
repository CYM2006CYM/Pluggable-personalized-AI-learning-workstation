import { createHash } from "node:crypto";
import type {
  CapabilityDimension,
  CapabilityDimensionId,
  CapabilityProfileRevision,
  CapabilityTaskPort,
} from "../contracts/index.js";
import type { ModelExecutionPort } from "../infrastructure/model-execution-port.js";
import type { W4PrivateRuntimeStore } from "../infrastructure/w4-private-runtime-store.js";

export interface CapabilityEvidenceSummary {
  evidenceId: string;
  observableDimensionIds: CapabilityDimensionId[];
  safeSummary: string;
}

export interface CapabilityEvidenceProvider {
  load(input: {
    sessionId: string;
    profileRevision: number;
    evidenceVersion: number;
    evidenceIds: string[];
    knowledgePointId?: string;
  }): Promise<CapabilityEvidenceSummary[]>;
}

export class CapabilityEvidenceProjectionStaleError extends Error {
  constructor(message = "Capability Evidence projection is stale") {
    super(message);
    this.name = "CapabilityEvidenceProjectionStaleError";
  }
}

export interface CapabilityTaskServiceOptions {
  modelExecutionPort: ModelExecutionPort;
  evidenceProvider: CapabilityEvidenceProvider;
  privateStore: W4PrivateRuntimeStore;
  modelId: string;
  promptVersion: string;
  now?: () => Date;
}

export interface CapabilityTaskRecord {
  taskId: string;
  trigger: "diagnostic_completed" | "node_completed";
  sessionId: string;
  profileRevision: number;
  evidenceVersion: number;
  taskStatus: "not_updated" | "stale" | "failed";
  createdAt: string;
  updatedAt: string;
  reasonCode?: string;
}

interface CapabilityModelDimension {
  id: CapabilityDimensionId;
  score: number;
  confidence: number;
  rationale: string;
  evidenceRefs: string[];
}

const DIMENSIONS: CapabilityDimensionId[] = [
  "syntax_api", "data_abstraction", "cleaning_reasoning", "validation_debugging", "engineering_independence",
];
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const UNSAFE_TEXT = [
  /(?:sk|api)[-_][A-Za-z0-9]{12,}/u,
  /[A-Za-z]:[\\/][^\s]*/u,
  /\\\\[^\\/\s]+[\\/][^\s]*/u,
  /\/(?:home|Users|tmp)\/[A-Za-z0-9._-]+(?:[\\/]\S*)?/iu,
  /\bAuthorization\s*:\s*Bearer\s+\S+/iu,
  /\b(?:hidden tests?|reference solutions?|private csv|rubric)\b/iu,
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2_000
    && !UNSAFE_TEXT.some((pattern) => pattern.test(value));
}

function hasChineseRationale(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isDimension(value: unknown, evidenceIds: ReadonlySet<string>, observable: ReadonlyMap<CapabilityDimensionId, ReadonlySet<string>>): value is CapabilityModelDimension {
  if (!isRecord(value) || !exactKeys(value, ["id", "score", "confidence", "rationale", "evidenceRefs"])) return false;
  if (!DIMENSIONS.includes(value.id as CapabilityDimensionId) || typeof value.score !== "number" || value.score < 0 || value.score > 100
       || typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1 || !safeText(value.rationale)
       || !hasChineseRationale(value.rationale)
      || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0 || !value.evidenceRefs.every(safeId)
      || new Set(value.evidenceRefs).size !== value.evidenceRefs.length) return false;
  const allowedForDimension = observable.get(value.id as CapabilityDimensionId) ?? new Set<string>();
  return value.evidenceRefs.every((id) => evidenceIds.has(id) && allowedForDimension.has(id));
}

function unverifiedDimension(id: CapabilityDimensionId): CapabilityDimension {
  return { id, state: "unverified", evidenceRefs: [] };
}

function taskKey(sessionId: string, evidenceVersion: number): string {
  return `${sessionId}:${evidenceVersion}`;
}

export function capabilityTaskRunId(input: Parameters<CapabilityTaskPort["enqueue"]>[0],
  modelId: string, promptVersion: string): string {
  return `w4-cap-${createHash("sha256").update(JSON.stringify({
    trigger: input.trigger, sessionId: input.sessionId, profileRevision: input.profileRevision,
    evidenceVersion: input.evidenceVersion, knowledgePointId: input.knowledgePointId, evidenceIds: input.evidenceIds,
    modelId, promptVersion,
  })).digest("hex").slice(0, 24)}`;
}

/** D-owned asynchronous implementation of A's frozen CapabilityTaskPort. */
export class CapabilityTaskService implements CapabilityTaskPort {
  readonly #options: CapabilityTaskServiceOptions;
  readonly #now: () => Date;
  readonly #jobs = new Map<string, Promise<void>>();

  constructor(options: CapabilityTaskServiceOptions) {
    if (!safeId(options.modelId) || !safeId(options.promptVersion)) throw new TypeError("modelId and promptVersion must be stable IDs");
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async enqueue(input: Parameters<CapabilityTaskPort["enqueue"]>[0]): Promise<{ taskStatus: "not_updated" | "stale" | "failed" }> {
    if ((input.trigger !== "diagnostic_completed" && input.trigger !== "node_completed")
        || !safeId(input.sessionId) || !Number.isInteger(input.profileRevision) || input.profileRevision < 1
        || !Number.isInteger(input.evidenceVersion) || input.evidenceVersion < 0
        || !Array.isArray(input.evidenceIds) || !input.evidenceIds.every(safeId)
        || new Set(input.evidenceIds).size !== input.evidenceIds.length
        || (input.knowledgePointId !== undefined && !safeId(input.knowledgePointId))) {
      return { taskStatus: "failed" };
    }
    const snapshot = await this.getSnapshot(input.sessionId);
    if (snapshot !== undefined && (snapshot.profileRevision > input.profileRevision
        || (snapshot.profileRevision === input.profileRevision && snapshot.evidenceVersion > input.evidenceVersion))) {
      await this.#writeTask(input, "stale", "newer_snapshot_exists");
      return { taskStatus: "stale" };
    }
    if (snapshot !== undefined && snapshot.profileRevision === input.profileRevision
        && snapshot.evidenceVersion === input.evidenceVersion) return { taskStatus: "not_updated" };
    const key = taskKey(input.sessionId, input.evidenceVersion);
    if (!this.#jobs.has(key)) {
      const predecessors = [...this.#jobs.entries()]
        .filter(([runningKey]) => runningKey.startsWith(`${input.sessionId}:`))
        .map(([, running]) => running);
      const job = Promise.all(predecessors).then(() => this.#process(input)).catch(async () => {
        await this.#writeTask(input, "failed", "unhandled_task_failure");
      }).finally(() => this.#jobs.delete(key));
      this.#jobs.set(key, job);
    }
    return { taskStatus: "not_updated" };
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.#jobs.values()]);
  }

  async getSnapshot(sessionId: string): Promise<CapabilityProfileRevision | undefined> {
    return this.#options.privateStore.read<CapabilityProfileRevision>("capability-snapshot", sessionId);
  }

  async getTask(sessionId: string, evidenceVersion: number): Promise<CapabilityTaskRecord | undefined> {
    return this.#options.privateStore.read<CapabilityTaskRecord>("capability-task", taskKey(sessionId, evidenceVersion));
  }

  async #process(input: Parameters<CapabilityTaskPort["enqueue"]>[0]): Promise<void> {
    const current = await this.getSnapshot(input.sessionId);
    if (current !== undefined && (current.profileRevision > input.profileRevision
        || (current.profileRevision === input.profileRevision && current.evidenceVersion > input.evidenceVersion))) {
      await this.#writeTask(input, "stale", "newer_snapshot_exists");
      return;
    }
    await this.#writeTask(input, "not_updated");
    let evidence: CapabilityEvidenceSummary[];
    try {
      evidence = await this.#options.evidenceProvider.load(input);
    } catch (error) {
      if (error instanceof CapabilityEvidenceProjectionStaleError) {
        await this.#writeTask(input, "stale", "newer_formal_evidence_exists");
        return;
      }
      await this.#writeTask(input, "failed", "evidence_projection_unavailable");
      return;
    }
    const requestedIds = new Set(input.evidenceIds);
    if (new Set(evidence.map((item) => item.evidenceId)).size !== evidence.length
        || evidence.some((item) => !safeId(item.evidenceId) || !requestedIds.has(item.evidenceId)
        || !Array.isArray(item.observableDimensionIds) || item.observableDimensionIds.some((id) => !DIMENSIONS.includes(id))
        || new Set(item.observableDimensionIds).size !== item.observableDimensionIds.length
        || !safeText(item.safeSummary))) {
      await this.#writeTask(input, "failed", "unsafe_evidence_projection");
      return;
    }

    const previous = await this.getSnapshot(input.sessionId);
    if (evidence.length === 0) {
      await this.#writeSnapshotIfFresh(input,
        this.#snapshot(input, previous, DIMENSIONS.map(unverifiedDimension), "unverified"));
      return;
    }
    const observable = new Map<CapabilityDimensionId, Set<string>>(DIMENSIONS.map((id) => [id, new Set<string>()]));
    for (const item of evidence) for (const id of item.observableDimensionIds) observable.get(id)!.add(item.evidenceId);
    const safeContext = {
      trigger: input.trigger,
      sessionId: input.sessionId,
      profileRevision: input.profileRevision,
      evidenceVersion: input.evidenceVersion,
      ...(input.knowledgePointId === undefined ? {} : { knowledgePointId: input.knowledgePointId }),
      evidence: evidence.map((item) => ({ evidenceId: item.evidenceId, observableDimensionIds: item.observableDimensionIds, safeSummary: item.safeSummary })),
    };
    const taskId = this.#taskId(input);
    let result: Awaited<ReturnType<ModelExecutionPort["execute"]>>;
    try {
      result = await this.#options.modelExecutionPort.execute({
        graphId: "capability-scorer", runId: taskId, profileRevision: input.profileRevision,
        promptVersion: this.#options.promptVersion, safeContext, budget: { timeoutMs: 60_000 },
      }, new AbortController().signal);
    } catch {
      await this.#writeTask(input, "failed", "provider_error");
      return;
    }
    if (result.status !== "ok" || result.modelId !== this.#options.modelId
        || result.promptVersion !== this.#options.promptVersion || result.sourceRefs.length !== 0
        || !isRecord(result.payload) || !exactKeys(result.payload, ["dimensions"])
        || !Array.isArray(result.payload.dimensions)) {
      await this.#writeTask(input, "failed", result.status === "ok" ? "invalid_schema" : result.status);
      return;
    }
    const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
    if (!result.payload.dimensions.every((item) => isDimension(item, evidenceIds, observable))) {
      await this.#writeTask(input, "failed", "invalid_or_unbound_dimension");
      return;
    }
    const returned = result.payload.dimensions as CapabilityModelDimension[];
    if (new Set(returned.map((item) => item.id)).size !== returned.length) {
      await this.#writeTask(input, "failed", "duplicate_dimension");
      return;
    }
    const byId = new Map(returned.map((item) => [item.id, item]));
    const sameProfile = previous?.profileRevision === input.profileRevision;
    const dimensions: CapabilityDimension[] = DIMENSIONS.map((id) => {
      const item = byId.get(id);
      if (item === undefined) {
        const old = sameProfile ? previous?.dimensions.find((dimension) => dimension.id === id) : undefined;
        if (old?.state === "verified" && old.evidenceRefs.length > 0) return clone(old);
        return unverifiedDimension(id);
      }
      return { id, state: "verified", score: item.score, confidence: item.confidence,
        rationale: item.rationale, evidenceRefs: [...item.evidenceRefs] };
    });
    const verifiedCount = dimensions.filter((item) => item.state === "verified").length;
    const status = verifiedCount === 0 ? "unverified" : verifiedCount === DIMENSIONS.length ? "complete" : "partial";
    await this.#writeSnapshotIfFresh(input, this.#snapshot(input, previous, dimensions, status));
  }

  async #writeSnapshotIfFresh(input: Parameters<CapabilityTaskPort["enqueue"]>[0],
    snapshot: CapabilityProfileRevision): Promise<void> {
    const current = await this.getSnapshot(input.sessionId);
    if (current !== undefined && (current.profileRevision > input.profileRevision
        || (current.profileRevision === input.profileRevision && current.evidenceVersion > input.evidenceVersion))) {
      await this.#writeTask(input, "stale", "newer_snapshot_exists");
      return;
    }
    await this.#options.privateStore.write("capability-snapshot", input.sessionId, snapshot);
  }

  #snapshot(input: Parameters<CapabilityTaskPort["enqueue"]>[0], previous: CapabilityProfileRevision | undefined,
    dimensions: CapabilityDimension[], status: CapabilityProfileRevision["status"]): CapabilityProfileRevision {
    return {
      capabilityProfileRevision: (previous?.capabilityProfileRevision ?? 0) + 1,
      dimensions: clone(dimensions), evidenceVersion: input.evidenceVersion, profileRevision: input.profileRevision,
      modelId: this.#options.modelId, promptVersion: this.#options.promptVersion, status,
      createdAt: this.#now().toISOString(),
    };
  }

  async #writeTask(input: Parameters<CapabilityTaskPort["enqueue"]>[0], taskStatus: CapabilityTaskRecord["taskStatus"], reasonCode?: string): Promise<void> {
    const key = taskKey(input.sessionId, input.evidenceVersion);
    const existing = await this.#options.privateStore.read<CapabilityTaskRecord>("capability-task", key);
    const timestamp = this.#now().toISOString();
    await this.#options.privateStore.write<CapabilityTaskRecord>("capability-task", key, {
      taskId: this.#taskId(input), trigger: input.trigger, sessionId: input.sessionId,
      profileRevision: input.profileRevision, evidenceVersion: input.evidenceVersion, taskStatus,
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    });
  }

  #taskId(input: Parameters<CapabilityTaskPort["enqueue"]>[0]): string {
    return capabilityTaskRunId(input, this.#options.modelId, this.#options.promptVersion);
  }
}
