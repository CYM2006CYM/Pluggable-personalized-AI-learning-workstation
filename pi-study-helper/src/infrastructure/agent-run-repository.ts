import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  appendSafeAgentStage,
  parseSafeAgentRunView,
  parseSafeAgentStageView,
  type AgentResultOrigin,
  type AgentRunStatus,
  type AgentStageRole,
  type AgentStageStatus,
  type SafeAgentMetricView,
  type SafeAgentRunView,
  type SafeAgentStageView,
  type QuizRemediationSafeView,
} from "../contracts/index.js";
import { resolveInside, writeJsonAtomic } from "./safe-files.js";

export interface CreateAgentRunInput {
  requestId: string;
  sessionId: string;
  activityId: string;
  profileRevision: number;
  pathVersion: number;
  evidenceVersion: number;
  remediation?: QuizRemediationSafeView;
}

export interface AppendAgentStageInput {
  role: AgentStageRole;
  label: string;
  status: AgentStageStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  attemptNumber: number;
  publicSummary: string;
  metrics?: SafeAgentMetricView[];
  issueCategories?: string[];
  decision?: SafeAgentStageView["decision"];
  sourceClaimIds?: string[];
}

export interface CompleteAgentRunInput {
  status: Extract<AgentRunStatus, "succeeded" | "failed" | "fallback">;
  finishedAt: string;
  resultOrigin: AgentResultOrigin;
  questionCount: number;
  artifactSha256?: string;
  fallbackReasonCode?: string;
}

export type AgentRunListener = (run: SafeAgentRunView) => void;

export interface AgentRunRepository {
  create(input: CreateAgentRunInput): Promise<SafeAgentRunView>;
  getByRunId(runId: string): Promise<SafeAgentRunView | undefined>;
  getByRequestId(requestId: string): Promise<SafeAgentRunView | undefined>;
  listBySession(sessionId: string): Promise<SafeAgentRunView[]>;
  append(runId: string, event: AppendAgentStageInput): Promise<SafeAgentRunView>;
  complete(runId: string, input: CompleteAgentRunInput): Promise<SafeAgentRunView>;
  subscribe(runId: string, listener: AgentRunListener): () => void;
}

export class AgentRunRepositoryError extends Error {
  constructor(readonly code: "agent_run_not_found" | "agent_run_conflict", message: string) {
    super(message);
    this.name = "AgentRunRepositoryError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function agentRunIdForRequest(requestId: string): string {
  return `agent-${createHash("sha256").update(requestId, "utf8").digest("hex").slice(0, 32)}`;
}

function initialRun(input: CreateAgentRunInput, now: Date): SafeAgentRunView {
  return parseSafeAgentRunView({
    runId: agentRunIdForRequest(input.requestId),
    requestId: input.requestId,
    sessionId: input.sessionId,
    activityId: input.activityId,
    profileRevision: input.profileRevision,
    pathVersion: input.pathVersion,
    evidenceVersion: input.evidenceVersion,
    status: "queued",
    currentStage: "source",
    startedAt: now.toISOString(),
    resultOrigin: "unknown",
    questionCount: 0,
    ...(input.remediation === undefined ? {} : { remediation: clone(input.remediation) }),
    stages: [],
  });
}

function sameBinding(left: SafeAgentRunView, right: CreateAgentRunInput): boolean {
  return left.requestId === right.requestId && left.sessionId === right.sessionId
    && left.activityId === right.activityId && left.profileRevision === right.profileRevision
    && left.pathVersion === right.pathVersion && left.evidenceVersion === right.evidenceVersion
    && JSON.stringify(left.remediation) === JSON.stringify(right.remediation);
}

abstract class BaseAgentRunRepository implements AgentRunRepository {
  readonly #locks = new Map<string, Promise<void>>();
  readonly #listeners = new Map<string, Set<AgentRunListener>>();
  readonly #now: () => Date;

  protected constructor(now?: () => Date) {
    this.#now = now ?? (() => new Date());
  }

  protected abstract read(runId: string): Promise<SafeAgentRunView | undefined>;
  protected abstract write(run: SafeAgentRunView): Promise<void>;
  protected abstract readAll(): Promise<SafeAgentRunView[]>;

  async create(input: CreateAgentRunInput): Promise<SafeAgentRunView> {
    const runId = agentRunIdForRequest(input.requestId);
    return this.exclusive(runId, async () => {
      const existing = await this.read(runId);
      if (existing !== undefined) {
        if (!sameBinding(existing, input)) throw new AgentRunRepositoryError("agent_run_conflict", "requestId已绑定到其他Agent运行");
        return clone(existing);
      }
      const created = initialRun(input, this.#now());
      await this.write(created);
      this.emit(created);
      return clone(created);
    });
  }

  async getByRunId(runId: string): Promise<SafeAgentRunView | undefined> {
    const value = await this.read(runId);
    return value === undefined ? undefined : clone(value);
  }

  async getByRequestId(requestId: string): Promise<SafeAgentRunView | undefined> {
    return this.getByRunId(agentRunIdForRequest(requestId));
  }

  async listBySession(sessionId: string): Promise<SafeAgentRunView[]> {
    return (await this.readAll()).filter((run) => run.sessionId === sessionId)
      .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.runId.localeCompare(right.runId, "en"))
      .map(clone);
  }

  async append(runId: string, event: AppendAgentStageInput): Promise<SafeAgentRunView> {
    return this.exclusive(runId, async () => {
      const current = await this.read(runId);
      if (current === undefined) throw new AgentRunRepositoryError("agent_run_not_found", "Agent运行不存在");
      const sequence = current.stages.length + 1;
      const parsedEvent = parseSafeAgentStageView({
        ...event,
        eventId: `${runId}.evt-${sequence}`,
        sequence,
        metrics: event.metrics ?? [],
        issueCategories: event.issueCategories ?? [],
        sourceClaimIds: event.sourceClaimIds ?? [],
      });
      const updated = appendSafeAgentStage(current, parsedEvent);
      await this.write(updated);
      this.emit(updated);
      return clone(updated);
    });
  }

  async complete(runId: string, input: CompleteAgentRunInput): Promise<SafeAgentRunView> {
    return this.exclusive(runId, async () => {
      const current = await this.read(runId);
      if (current === undefined) throw new AgentRunRepositoryError("agent_run_not_found", "Agent运行不存在");
      if (["succeeded", "failed", "fallback"].includes(current.status)) {
        const same = current.status === input.status && current.resultOrigin === input.resultOrigin
          && current.questionCount === input.questionCount && current.artifactSha256 === input.artifactSha256
          && current.fallbackReasonCode === input.fallbackReasonCode;
        if (!same) throw new AgentRunRepositoryError("agent_run_conflict", "终态Agent运行不能改写");
        return clone(current);
      }
      const durationMs = Math.max(0, Date.parse(input.finishedAt) - Date.parse(current.startedAt));
      const updated = parseSafeAgentRunView({
        ...current,
        ...input,
        durationMs,
      });
      await this.write(updated);
      this.emit(updated);
      return clone(updated);
    });
  }

  subscribe(runId: string, listener: AgentRunListener): () => void {
    const listeners = this.#listeners.get(runId) ?? new Set<AgentRunListener>();
    listeners.add(listener);
    this.#listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(runId);
    };
  }

  private emit(run: SafeAgentRunView): void {
    for (const listener of this.#listeners.get(run.runId) ?? []) listener(clone(run));
  }

  private async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    const tail = previous.then(() => current);
    this.#locks.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }
}

export class InMemoryAgentRunRepository extends BaseAgentRunRepository {
  readonly #runs = new Map<string, SafeAgentRunView>();

  constructor(now?: () => Date) {
    super(now);
  }

  protected async read(runId: string): Promise<SafeAgentRunView | undefined> {
    const value = this.#runs.get(runId);
    return value === undefined ? undefined : clone(value);
  }

  protected async write(run: SafeAgentRunView): Promise<void> {
    this.#runs.set(run.runId, clone(run));
  }
  protected async readAll(): Promise<SafeAgentRunView[]> { return [...this.#runs.values()].map(clone); }
}

export class FileAgentRunRepository extends BaseAgentRunRepository {
  readonly #root: string;

  constructor(options: { dataRoot: string; now?: () => Date }) {
    super(options.now);
    this.#root = resolveInside(resolve(options.dataRoot), "agent-runs");
  }

  protected async read(runId: string): Promise<SafeAgentRunView | undefined> {
    try {
      return parseSafeAgentRunView(JSON.parse(await readFile(this.path(runId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  protected async write(run: SafeAgentRunView): Promise<void> {
    await writeJsonAtomic(this.path(run.runId), parseSafeAgentRunView(run));
  }

  protected async readAll(): Promise<SafeAgentRunView[]> {
    const directory = resolveInside(this.#root, "runs");
    let names: string[];
    try { names = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    return Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => parseSafeAgentRunView(JSON.parse(await readFile(resolveInside(directory, name), "utf8")))));
  }

  private path(runId: string): string {
    const name = createHash("sha256").update(runId, "utf8").digest("hex");
    return resolveInside(this.#root, "runs", `${name}.json`);
  }
}
