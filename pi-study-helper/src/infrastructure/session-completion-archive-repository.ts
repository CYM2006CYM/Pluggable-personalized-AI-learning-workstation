import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompleteSessionOutput } from "../contracts/index.js";
import { resolveInside, writeJsonAtomic } from "./safe-files.js";

export interface SessionCompletionArchive {
  schemaVersion: 1;
  completionId: string;
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  evidenceVersion: number;
  createdAt: string;
  output: CompleteSessionOutput;
  unresolvedFacts: string[];
  agentRunIds: string[];
  payloadSha256: string;
}

export interface CreateSessionCompletionArchiveInput {
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  evidenceVersion: number;
  createdAt: string;
  output: CompleteSessionOutput;
  unresolvedFacts: string[];
  agentRunIds: string[];
}

export interface SessionCompletionArchiveRepository {
  get(sessionId: string): Promise<SessionCompletionArchive | undefined>;
  create(input: CreateSessionCompletionArchiveInput): Promise<SessionCompletionArchive>;
}

export class SessionCompletionArchiveError extends Error {
  constructor(readonly code: "completion_archive_conflict" | "completion_archive_invalid", message: string) {
    super(message);
    this.name = "SessionCompletionArchiveError";
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FORBIDDEN = /(?:\bsk-[A-Za-z0-9_-]{12,}|\bBearer\s+\S+|api[_ -]?key\s*[:=]|(?:system|developer|hidden)\s*prompt|系统提示词|开发者提示词|正确答案\s*[:：=]|标准答案\s*[:：=]|[A-Za-z]:[\\/]|\/(?:Users|home|root|etc|var|tmp)\/)/iu;

function clone<T>(value: T): T { return structuredClone(value); }
function canonical(value: unknown): string { return JSON.stringify(value); }
function hash(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function completionId(sessionId: string): string { return `completion-${createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 32)}`; }

function assertId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new SessionCompletionArchiveError("completion_archive_invalid", `${field}格式非法`);
}

function assertVersion(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new SessionCompletionArchiveError("completion_archive_invalid", `${field}非法`);
}

function assertPublicValue(value: unknown, field: string): void {
  const serialized = canonical(value);
  if (serialized.length > 1_000_000 || FORBIDDEN.test(serialized)) throw new SessionCompletionArchiveError("completion_archive_invalid", `${field}包含非公开内容`);
}

function build(input: CreateSessionCompletionArchiveInput): SessionCompletionArchive {
  assertId(input.sessionId, "sessionId");
  assertVersion(input.sessionVersion, "sessionVersion");
  assertVersion(input.profileRevision, "profileRevision");
  assertVersion(input.evidenceVersion, "evidenceVersion");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new SessionCompletionArchiveError("completion_archive_invalid", "createdAt非法");
  if (input.output.sessionId !== input.sessionId || input.output.sessionVersion !== input.sessionVersion || input.output.profileRevision !== input.profileRevision) {
    throw new SessionCompletionArchiveError("completion_archive_invalid", "完成输出与Session绑定不一致");
  }
  if (input.output.completedAt !== input.createdAt) throw new SessionCompletionArchiveError("completion_archive_invalid", "完成时间未冻结到输出");
  for (const id of input.agentRunIds) assertId(id, "agentRunId");
  if (new Set(input.agentRunIds).size !== input.agentRunIds.length || new Set(input.unresolvedFacts).size !== input.unresolvedFacts.length) {
    throw new SessionCompletionArchiveError("completion_archive_invalid", "完成归档不允许重复事实或run");
  }
  assertPublicValue(input.output, "output");
  assertPublicValue(input.unresolvedFacts, "unresolvedFacts");
  const payload = {
    schemaVersion: 1 as const,
    completionId: completionId(input.sessionId),
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    profileRevision: input.profileRevision,
    evidenceVersion: input.evidenceVersion,
    createdAt: input.createdAt,
    output: clone(input.output),
    unresolvedFacts: [...input.unresolvedFacts],
    agentRunIds: [...input.agentRunIds],
  };
  return { ...payload, payloadSha256: hash(payload) };
}

function parse(value: unknown): SessionCompletionArchive {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SessionCompletionArchiveError("completion_archive_invalid", "完成归档必须是对象");
  const candidate = value as SessionCompletionArchive;
  const rebuilt = build(candidate);
  if (candidate.schemaVersion !== 1 || candidate.completionId !== rebuilt.completionId || !SHA256.test(candidate.payloadSha256) || candidate.payloadSha256 !== rebuilt.payloadSha256) {
    throw new SessionCompletionArchiveError("completion_archive_invalid", "完成归档标识或哈希不一致");
  }
  return rebuilt;
}

abstract class BaseSessionCompletionArchiveRepository implements SessionCompletionArchiveRepository {
  readonly #locks = new Map<string, Promise<void>>();
  protected abstract read(sessionId: string): Promise<SessionCompletionArchive | undefined>;
  protected abstract write(archive: SessionCompletionArchive): Promise<void>;

  async get(sessionId: string): Promise<SessionCompletionArchive | undefined> {
    assertId(sessionId, "sessionId");
    const value = await this.read(sessionId);
    return value === undefined ? undefined : clone(value);
  }

  async create(input: CreateSessionCompletionArchiveInput): Promise<SessionCompletionArchive> {
    const candidate = build(input);
    const previous = this.#locks.get(input.sessionId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    const tail = previous.then(() => current);
    this.#locks.set(input.sessionId, tail);
    await previous;
    try {
      const existing = await this.read(input.sessionId);
      if (existing !== undefined) {
        if (canonical(existing) !== canonical(candidate)) throw new SessionCompletionArchiveError("completion_archive_conflict", "完成归档不能改写");
        return clone(existing);
      }
      await this.write(candidate);
      return clone(candidate);
    } finally {
      release();
      if (this.#locks.get(input.sessionId) === tail) this.#locks.delete(input.sessionId);
    }
  }
}

export class InMemorySessionCompletionArchiveRepository extends BaseSessionCompletionArchiveRepository {
  readonly #archives = new Map<string, SessionCompletionArchive>();
  protected async read(sessionId: string): Promise<SessionCompletionArchive | undefined> { return this.#archives.get(sessionId); }
  protected async write(archive: SessionCompletionArchive): Promise<void> { this.#archives.set(archive.sessionId, clone(archive)); }
}

export class FileSessionCompletionArchiveRepository extends BaseSessionCompletionArchiveRepository {
  readonly #root: string;
  constructor(options: { dataRoot: string }) { super(); this.#root = resolveInside(resolve(options.dataRoot), "session-completions"); }
  protected async read(sessionId: string): Promise<SessionCompletionArchive | undefined> {
    try { return parse(JSON.parse(await readFile(this.path(sessionId), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  protected async write(archive: SessionCompletionArchive): Promise<void> { await writeJsonAtomic(this.path(archive.sessionId), archive); }
  private path(sessionId: string): string { return resolveInside(this.#root, `${createHash("sha256").update(sessionId, "utf8").digest("hex")}.json`); }
}
