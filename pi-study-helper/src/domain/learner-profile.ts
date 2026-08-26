import type { Evidence, KnowledgeState, LearnerDiagnostic, NodeActivityProgress } from "../contracts/index.js";

export type LearnerProfileAgentStatus = "deterministic_fallback" | "agent_pending" | "agent_complete";

export interface LearnerProfileProgressItem {
  knowledgePointId: string;
  beforeStatus: KnowledgeState["status"] | "unverified";
  afterStatus: KnowledgeState["status"] | "unverified";
  improved: boolean;
  evidenceIds: string[];
}

export interface LearnerProfileActivityItem {
  activityId: string;
  status: NodeActivityProgress["activities"][number]["status"];
  result?: NodeActivityProgress["activities"][number]["result"];
  attemptCount: number;
  continuedWithGap: boolean;
}

/** Public-safe facts used by both the summary page and later profile Agent prompts. */
export interface LearnerProfileSafeView {
  sessionId: string;
  profileRevision: number;
  evidenceVersion: number;
  agentStatus: LearnerProfileAgentStatus;
  initialKnowledgeStates: KnowledgeState[];
  currentKnowledgeStates: KnowledgeState[];
  progress: LearnerProfileProgressItem[];
  strengths: string[];
  supportNeeded: string[];
  skippedActivityIds: string[];
  diagnosticSkippedKnowledgePointIds?: string[];
  activities: LearnerProfileActivityItem[];
  evidenceIds: string[];
  deterministicSummary: string;
  agentExplanation?: string;
  agentEvidenceRefs?: string[];
  agentRunId?: string;
}

export function attachLearnerProfileAgentResult(
  profile: LearnerProfileSafeView,
  result: { explanation: string; evidenceRefs: string[]; runId: string },
): LearnerProfileSafeView {
  return {
    ...clone(profile),
    agentStatus: "agent_complete",
    agentExplanation: result.explanation,
    agentEvidenceRefs: [...result.evidenceRefs],
    agentRunId: result.runId,
  };
}

interface LearnerProfileInput {
  sessionId: string;
  profileRevision: number;
  evidenceVersion: number;
  evidence: readonly Evidence[];
  knowledgeStates: readonly KnowledgeState[];
  latestDiagnostic?: LearnerDiagnostic;
  activityProgress: readonly NodeActivityProgress[];
  diagnosticSkippedKnowledgePointIds?: readonly string[];
}

const STATUS_RANK: Record<KnowledgeState["status"], number> = {
  unverified: 0,
  support_needed: 1,
  learning: 2,
  ready: 3,
  mastered: 4,
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function statusOf(state: KnowledgeState | undefined): KnowledgeState["status"] {
  return state?.status ?? "unverified";
}

export function diagnosticSkippedKnowledgePointIdsFromPath(
  nodes: readonly { knowledgePointId: string; reasonCodes: readonly string[]; status?: string }[] | undefined,
): string[] {
  return [...new Set((nodes ?? [])
    .filter((node) => node.reasonCodes.includes("diagnostic_skip_selected"))
    .map((node) => node.knowledgePointId))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function buildLearnerProfile(input: LearnerProfileInput): LearnerProfileSafeView {
  const initialKnowledgeStates = (input.latestDiagnostic?.states ?? []).map((state) => clone(state));
  const currentKnowledgeStates = (input.knowledgeStates ?? []).map((state) => clone(state));
  const initialById = new Map(initialKnowledgeStates.map((state) => [state.knowledgePointId, state]));
  const progress = currentKnowledgeStates.map((state): LearnerProfileProgressItem => {
    const beforeStatus = statusOf(initialById.get(state.knowledgePointId));
    return {
      knowledgePointId: state.knowledgePointId,
      beforeStatus,
      afterStatus: state.status,
      improved: STATUS_RANK[state.status] > STATUS_RANK[beforeStatus],
      evidenceIds: [...state.evidenceIds],
    };
  });
  const activities = (input.activityProgress ?? []).flatMap((node) => node.activities.map((activity): LearnerProfileActivityItem => ({
    activityId: activity.activityId,
    status: activity.status,
    ...(activity.result === undefined ? {} : { result: activity.result }),
    attemptCount: activity.attemptIds.length,
    continuedWithGap: activity.continuedWithGap === true,
  })));
  const skippedActivityIds = activities.filter((activity) => activity.continuedWithGap || activity.status === "insufficient").map((activity) => activity.activityId);
  const diagnosticSkippedKnowledgePointIds = [...new Set(input.diagnosticSkippedKnowledgePointIds ?? [])]
    .sort((left, right) => left.localeCompare(right, "en"));
  const latestMasteryEvidence = new Map<string, Evidence>();
  for (const item of [...input.evidence].sort((left, right) => (left.evidenceVersion ?? 0) - (right.evidenceVersion ?? 0)
      || Date.parse(left.createdAt) - Date.parse(right.createdAt))) {
    if (item.impact === "mastery") latestMasteryEvidence.set(item.knowledgePointId, item);
  }
  const unresolvedKnowledgePointIds = new Set([...latestMasteryEvidence.values()]
    .filter((item) => item.outcome !== "correct")
    .map((item) => item.knowledgePointId));
  const strengths = currentKnowledgeStates
    .filter((state) => (state.status === "ready" || state.status === "mastered") && !unresolvedKnowledgePointIds.has(state.knowledgePointId))
    .map((state) => state.knowledgePointId);
  const supportNeeded = currentKnowledgeStates
    .filter((state) => state.status === "support_needed" || state.status === "unverified" || state.status === "learning" || unresolvedKnowledgePointIds.has(state.knowledgePointId))
    .map((state) => state.knowledgePointId);
  const evidenceIds = [...new Set((input.evidence ?? []).map((item) => item.evidenceId))].sort((left, right) => left.localeCompare(right, "en"));
  const improvedCount = progress.filter((item) => item.improved).length;
  const deterministicSummary = `本次会话形成 ${currentKnowledgeStates.length} 个知识状态，${strengths.length} 个已有基础或掌握，${supportNeeded.length} 个仍需支持；${improvedCount} 个知识点相较初始诊断有进步，记录 ${evidenceIds.length} 条正式 Evidence。${skippedActivityIds.length > 0 ? `有 ${skippedActivityIds.length} 个活动带缺口继续，未将其记为掌握。` : "没有活动被标记为带缺口继续。"}`;
  return {
    sessionId: input.sessionId,
    profileRevision: input.profileRevision,
    evidenceVersion: input.evidenceVersion,
    agentStatus: "deterministic_fallback",
    initialKnowledgeStates,
    currentKnowledgeStates,
    progress,
    strengths,
    supportNeeded,
    skippedActivityIds,
    diagnosticSkippedKnowledgePointIds,
    activities,
    evidenceIds,
    deterministicSummary,
  };
}
