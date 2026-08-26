import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LearnerProfileSafeView } from "../contracts/index.js";
import { resolveInside, writeJsonAtomic } from "./safe-files.js";

export const LEARNER_PROFILE_HISTORY_TRIGGERS = [
  "diagnostic_completed",
  "quiz_submitted",
  "code_submitted",
  "continued_with_gap",
  "session_completed",
] as const;

export type LearnerProfileHistoryTrigger = typeof LEARNER_PROFILE_HISTORY_TRIGGERS[number];

export interface LearnerProfileHistoryEntry {
  historyId: string;
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  evidenceVersion: number;
  trigger: LearnerProfileHistoryTrigger;
  capturedAt: string;
  profile: LearnerProfileSafeView;
  profileSha256: string;
}

export interface AppendLearnerProfileHistoryInput {
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  evidenceVersion: number;
  trigger: LearnerProfileHistoryTrigger;
  capturedAt: string;
  profile: LearnerProfileSafeView;
}

export interface LearnerProfileHistoryRepository {
  append(input: AppendLearnerProfileHistoryInput): Promise<LearnerProfileHistoryEntry>;
  list(sessionId: string): Promise<LearnerProfileHistoryEntry[]>;
  getLatest(sessionId: string): Promise<LearnerProfileHistoryEntry | undefined>;
}

export class LearnerProfileHistoryRepositoryError extends Error {
  constructor(readonly code: "profile_history_conflict" | "profile_history_invalid", message: string) {
    super(message);
    this.name = "LearnerProfileHistoryRepositoryError";
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FORBIDDEN_TEXT = /(?:\bsk-[A-Za-z0-9_-]{12,}|\bBearer\s+\S+|api[_ -]?key\s*[:=]|(?:system|developer|hidden)\s*prompt|系统提示词|开发者提示词|[A-Za-z]:[\\/]|\/(?:Users|home|root|etc|var|tmp)\/)/iu;
const TRIGGERS = new Set<string>(LEARNER_PROFILE_HISTORY_TRIGGERS);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function learnerProfileHistoryId(input: Pick<AppendLearnerProfileHistoryInput, "sessionId" | "sessionVersion" | "evidenceVersion">): string {
  return `profile-${createHash("sha256").update(`${input.sessionId}:${input.sessionVersion}:${input.evidenceVersion}`, "utf8").digest("hex").slice(0, 32)}`;
}

function assertSafeId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", `${field}格式非法`);
}

function assertVersion(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) {
    throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", `${field}版本非法`);
  }
}

function assertSafeText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_000 || FORBIDDEN_TEXT.test(value)) {
    throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", `${field}包含非法或非公开文本`);
  }
}

function validateProfile(profile: LearnerProfileSafeView, binding: Pick<AppendLearnerProfileHistoryInput, "sessionId" | "profileRevision" | "evidenceVersion">): LearnerProfileSafeView {
  if (profile.sessionId !== binding.sessionId || profile.profileRevision !== binding.profileRevision || profile.evidenceVersion !== binding.evidenceVersion) {
    throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", "画像与Session版本绑定不一致");
  }
  assertSafeText(profile.deterministicSummary, "profile.deterministicSummary");
  if (profile.agentExplanation !== undefined) assertSafeText(profile.agentExplanation, "profile.agentExplanation");
  for (const id of [...profile.evidenceIds, ...(profile.agentEvidenceRefs ?? []), ...(profile.agentRunId === undefined ? [] : [profile.agentRunId])]) assertSafeId(id, "profile reference");
  if ((profile.agentEvidenceRefs ?? []).some((id) => !profile.evidenceIds.includes(id))) {
    throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", "画像Agent引用了未绑定Evidence");
  }
  if (profile.agentStatus === "agent_complete" && (profile.agentExplanation === undefined || profile.agentEvidenceRefs === undefined || profile.agentRunId === undefined)) {
    throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", "Agent完成画像缺少公开解释绑定");
  }
  return clone(profile);
}

function buildEntry(input: AppendLearnerProfileHistoryInput): LearnerProfileHistoryEntry {
  assertSafeId(input.sessionId, "sessionId");
  assertVersion(input.sessionVersion, "sessionVersion");
  assertVersion(input.profileRevision, "profileRevision");
  assertVersion(input.evidenceVersion, "evidenceVersion");
  if (!TRIGGERS.has(input.trigger)) throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", "画像历史触发类型非法");
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", "画像历史时间非法");
  const profile = validateProfile(input.profile, input);
  return {
    historyId: learnerProfileHistoryId(input),
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    profileRevision: input.profileRevision,
    evidenceVersion: input.evidenceVersion,
    trigger: input.trigger,
    capturedAt: input.capturedAt,
    profile,
    profileSha256: sha256(profile),
  };
}

function parseEntry(value: unknown): LearnerProfileHistoryEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", "画像历史必须是对象");
  const candidate = value as LearnerProfileHistoryEntry;
  const entry = buildEntry(candidate);
  if (candidate.historyId !== entry.historyId || candidate.profileSha256 !== entry.profileSha256) {
    throw new LearnerProfileHistoryRepositoryError("profile_history_invalid", "画像历史标识或哈希不一致");
  }
  return entry;
}

abstract class BaseLearnerProfileHistoryRepository implements LearnerProfileHistoryRepository {
  readonly #locks = new Map<string, Promise<void>>();

  protected abstract readAll(sessionId: string): Promise<LearnerProfileHistoryEntry[]>;
  protected abstract write(entry: LearnerProfileHistoryEntry): Promise<void>;

  async append(input: AppendLearnerProfileHistoryInput): Promise<LearnerProfileHistoryEntry> {
    const candidate = buildEntry(input);
    return this.exclusive(candidate.sessionId, async () => {
      const existing = (await this.readAll(candidate.sessionId)).find((entry) => entry.historyId === candidate.historyId);
      if (existing !== undefined) {
        if (canonical(existing) !== canonical(candidate)) throw new LearnerProfileHistoryRepositoryError("profile_history_conflict", "同一Session版本的画像历史不能改写");
        return clone(existing);
      }
      await this.write(candidate);
      return clone(candidate);
    });
  }

  async list(sessionId: string): Promise<LearnerProfileHistoryEntry[]> {
    assertSafeId(sessionId, "sessionId");
    return (await this.readAll(sessionId))
      .sort((left, right) => left.sessionVersion - right.sessionVersion || left.evidenceVersion - right.evidenceVersion)
      .map(clone);
  }

  async getLatest(sessionId: string): Promise<LearnerProfileHistoryEntry | undefined> {
    return (await this.list(sessionId)).at(-1);
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

export class InMemoryLearnerProfileHistoryRepository extends BaseLearnerProfileHistoryRepository {
  readonly #entries = new Map<string, LearnerProfileHistoryEntry[]>();

  protected async readAll(sessionId: string): Promise<LearnerProfileHistoryEntry[]> {
    return clone(this.#entries.get(sessionId) ?? []);
  }

  protected async write(entry: LearnerProfileHistoryEntry): Promise<void> {
    const entries = this.#entries.get(entry.sessionId) ?? [];
    entries.push(clone(entry));
    this.#entries.set(entry.sessionId, entries);
  }
}

export class FileLearnerProfileHistoryRepository extends BaseLearnerProfileHistoryRepository {
  readonly #root: string;

  constructor(options: { dataRoot: string }) {
    super();
    this.#root = resolveInside(resolve(options.dataRoot), "learner-profile-history");
  }

  protected async readAll(sessionId: string): Promise<LearnerProfileHistoryEntry[]> {
    const directory = this.sessionDirectory(sessionId);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => parseEntry(JSON.parse(await readFile(resolveInside(directory, name), "utf8")))));
  }

  protected async write(entry: LearnerProfileHistoryEntry): Promise<void> {
    await writeJsonAtomic(resolveInside(this.sessionDirectory(entry.sessionId), `${String(entry.sessionVersion).padStart(10, "0")}-${entry.historyId}.json`), entry);
  }

  private sessionDirectory(sessionId: string): string {
    const sessionHash = createHash("sha256").update(sessionId, "utf8").digest("hex");
    return resolveInside(this.#root, sessionHash);
  }
}
