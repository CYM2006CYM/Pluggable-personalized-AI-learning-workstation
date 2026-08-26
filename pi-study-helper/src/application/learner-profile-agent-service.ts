import { createHash } from "node:crypto";
import type { LearnerProfileSafeView } from "../contracts/index.js";
import type { ModelExecutionPort } from "../infrastructure/model-execution-port.js";

export interface LearnerProfileAgentResult {
  status: "accepted" | "unavailable";
  explanation?: string;
  evidenceRefs?: string[];
  runId: string;
  errorCode?: string;
}

export interface LearnerProfileAgentPort {
  summarize(input: { profile: LearnerProfileSafeView }): Promise<LearnerProfileAgentResult>;
}

export interface LearnerProfileAgentServiceOptions {
  modelExecutionPort: ModelExecutionPort;
  modelId: string;
  promptVersion: string;
  now?: () => Date;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FORBIDDEN = /(?:sk|api)[-_][A-Za-z0-9]{12,}|[A-Za-z]:[\\/]|(?:hidden tests?|reference solutions?|private csv|rubric)|Bearer\s+\S+/iu;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2_000 && /[\u3400-\u9fff]/u.test(value) && !FORBIDDEN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function claimsNonEmptySection(summary: string, marker: RegExp): boolean {
  return summary.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).some((line) => {
    const match = marker.exec(line);
    marker.lastIndex = 0;
    if (match?.index === undefined) return false;
    const before = line.slice(0, match.index).trim();
    const after = line.slice(match.index + match[0].length).replace(/^[\s:：*\-]+/u, "");
    if (/(?:无|没有|暂无|不存在)$/u.test(before)) return false;
    return !/^(?:无|没有|暂无|不存在|不需要|0(?:个|项)?)(?:[。；，,]|$)/u.test(after);
  });
}

function conflictsWithDeterministicFacts(summary: string, profile: LearnerProfileSafeView): boolean {
  if (profile.supportNeeded.length === 0
      && claimsNonEmptySection(summary, /仍需支持(?:点|的知识点)?|薄弱(?:点|知识点)?/u)) return true;
  if ((profile.diagnosticSkippedKnowledgePointIds ?? []).length > 0
      && /(?:待处理|pending|尚未(?:执行|开始|开展|进行)|无证据支撑|后续(?:需要)?继续|需要继续(?:推进|完成|学习)|建议继续(?:推进|完成|学习))/iu.test(summary)) return true;
  return profile.skippedActivityIds.length === 0
    && claimsNonEmptySection(summary, /带缺口活动/u);
}

function runId(profile: LearnerProfileSafeView, modelId: string, promptVersion: string): string {
  return `w6-profile-${createHash("sha256").update(JSON.stringify({
    sessionId: profile.sessionId, profileRevision: profile.profileRevision, evidenceVersion: profile.evidenceVersion,
    evidenceIds: profile.evidenceIds, modelId, promptVersion,
  })).digest("hex").slice(0, 24)}`;
}

export class LearnerProfileAgentService implements LearnerProfileAgentPort {
  readonly #options: LearnerProfileAgentServiceOptions;

  constructor(options: LearnerProfileAgentServiceOptions) {
    if (!SAFE_ID.test(options.modelId) || !SAFE_ID.test(options.promptVersion)) throw new TypeError("modelId and promptVersion must be stable IDs");
    this.#options = options;
  }

  async summarize(input: { profile: LearnerProfileSafeView }): Promise<LearnerProfileAgentResult> {
    const profile = clone(input.profile);
    const executionRunId = runId(profile, this.#options.modelId, this.#options.promptVersion);
    const safeContext = {
      sessionId: profile.sessionId,
      profileRevision: profile.profileRevision,
      evidenceVersion: profile.evidenceVersion,
      sourceIds: [...profile.evidenceIds],
      initialKnowledgeStates: profile.initialKnowledgeStates,
      currentKnowledgeStates: profile.currentKnowledgeStates,
      progress: profile.progress,
      deterministicSummary: profile.deterministicSummary,
      strengths: [...profile.strengths],
      supportNeeded: [...profile.supportNeeded],
      skippedActivityIds: [...profile.skippedActivityIds],
      diagnosticSkippedKnowledgePointIds: [...(profile.diagnosticSkippedKnowledgePointIds ?? [])],
      activities: profile.activities,
      evidenceIds: [...profile.evidenceIds],
    };
    let result;
    try {
      result = await this.#options.modelExecutionPort.execute({
        graphId: "learner-profile", runId: executionRunId, profileRevision: profile.profileRevision,
        promptVersion: this.#options.promptVersion, safeContext, budget: { timeoutMs: 30_000 },
      }, new AbortController().signal);
    } catch {
      return { status: "unavailable", runId: executionRunId, errorCode: "provider_error" };
    }
    if (result.status !== "ok" || result.modelId !== this.#options.modelId || result.promptVersion !== this.#options.promptVersion
        || !isRecord(result.payload) || Object.keys(result.payload).some((key) => key !== "summary" && key !== "evidenceRefs")
        || !safeText(result.payload.summary) || !Array.isArray(result.payload.evidenceRefs)
        || !result.payload.evidenceRefs.every((id) => typeof id === "string" && SAFE_ID.test(id) && profile.evidenceIds.includes(id))) {
      return { status: "unavailable", runId: executionRunId, errorCode: result.status === "ok" ? "invalid_schema" : result.status };
    }
    const evidenceRefs = [...new Set(result.payload.evidenceRefs as string[])];
    if (evidenceRefs.length === 0 || new Set(result.sourceRefs).size !== result.sourceRefs.length
        || result.sourceRefs.some((id) => !profile.evidenceIds.includes(id))) {
      return { status: "unavailable", runId: executionRunId, errorCode: "unbound_evidence" };
    }
    if (conflictsWithDeterministicFacts(result.payload.summary, profile)) {
      return { status: "unavailable", runId: executionRunId, errorCode: "semantic_conflict" };
    }
    return { status: "accepted", runId: executionRunId, explanation: result.payload.summary, evidenceRefs };
  }
}
