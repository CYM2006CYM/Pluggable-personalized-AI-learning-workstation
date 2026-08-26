export const AGENT_STAGE_ROLES = [
  "source",
  "profile",
  "generator",
  "safety",
  "hunter",
  "defender",
  "judge",
  "publish",
] as const;

/**
 * 学情画像建议的公共展示上限。
 * 画像 Agent 的安全摘要同样限制为 2000 个字符，保持两层合同一致，避免在页面中途截断。
 */
export const PUBLIC_RECOMMENDATION_MAX_LENGTH = 2_000;

export type AgentStageRole = typeof AGENT_STAGE_ROLES[number];
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "fallback";
export type AgentStageStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "revised"
  | "rejected"
  | "failed"
  | "fallback"
  | "skipped";

export type AgentResultOrigin = "ai_live" | "ai_recorded" | "profile_fixed" | "unknown";

export interface SafeAgentMetricView {
  metricId: string;
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

/** One append-only public event. Multiple events may belong to the same role. */
export interface SafeAgentStageView {
  eventId: string;
  sequence: number;
  role: AgentStageRole;
  label: string;
  status: AgentStageStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  attemptNumber: number;
  publicSummary: string;
  metrics: SafeAgentMetricView[];
  issueCategories: string[];
  decision?: "accepted" | "revise" | "rejected";
  sourceClaimIds: string[];
}

export interface SafeAgentRunView {
  runId: string;
  requestId: string;
  sessionId: string;
  activityId: string;
  profileRevision: number;
  pathVersion: number;
  evidenceVersion: number;
  status: AgentRunStatus;
  currentStage: AgentStageRole;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  resultOrigin: AgentResultOrigin;
  questionCount: number;
  artifactSha256?: string;
  fallbackReasonCode?: string;
  remediation?: QuizRemediationSafeView;
  stages: SafeAgentStageView[];
}

export interface QuizRemediationSafeView {
  lessonVariantId: "guided" | "concise" | "practice";
  previousAttemptId: string;
  missedQuestionCount: number;
  weakKnowledgePointIds: string[];
  learnerProfileSource: "agent" | "deterministic";
  publicRecommendation: string;
  evidenceVersion: number;
  evidenceRefCount: number;
}

export interface SafeAgentRunExport {
  schemaVersion: 1;
  exportedAt: string;
  run: SafeAgentRunView;
  exportSha256: string;
}
