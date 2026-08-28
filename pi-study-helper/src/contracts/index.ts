/** Public W4 contracts. Runtime internals must not be exposed through these types. */
import type { ActivitySafeViewBase } from "./facade.js";
export * from "./facade.js";
export * from "./domain.js";
export * from "./agent-run.js";
export * from "./agent-run-runtime.js";

export interface Revision3KnowledgePointFields {
  activityPolicy?: import("./domain.js").ActivityPolicy;
  contentEstimatedMinutes?: number;
}

export type LessonVariantId = "guided" | "concise" | "practice";
export type LessonModuleId = "intuition" | "concepts" | "walkthrough" | "mistakes" | "final-task" | "terms-sources";

export type LessonContentBlock =
  | { blockId: string; kind: "paragraph"; text: string }
  | { blockId: string; kind: "subheading"; text: string }
  | { blockId: string; kind: "code"; language: "python" | "csv" | "text"; code: string }
  | { blockId: string; kind: "list"; ordered: boolean; items: string[] }
  | { blockId: string; kind: "callout"; tone: "info" | "warning" | "term"; title: string; text: string };

export interface LessonModule {
  moduleId: LessonModuleId;
  title: string;
  summary: string;
  blocks: LessonContentBlock[];
}

export interface LessonLearningObjectives {
  understand: string[];
  master: string[];
}

export interface LessonCanonicalRule {
  ruleId: string;
  statement: string;
  sourceClaimIds: string[];
}

export interface LessonSourceClaim {
  claimId: string;
  statement: string;
  sourceAnchorIds: string[];
}

export interface LessonTermNote {
  term: string;
  explanation: string;
}

export interface LessonVariantAsset {
  variantId: LessonVariantId;
  label: string;
  learningObjectives: LessonLearningObjectives;
  modules: LessonModule[];
  termNotes: LessonTermNote[];
  coveredRuleIds: string[];
  chineseCharacterCount: number;
}

export interface RichLessonAsset {
  sourceDocument: string;
  sourceDocumentSha256: string;
  canonicalRules: LessonCanonicalRule[];
  sourceClaims: LessonSourceClaim[];
  variants: Record<LessonVariantId, LessonVariantAsset>;
}

export interface SelectedLessonSafeView {
  variantId: LessonVariantId;
  label: string;
  learningObjectives: LessonLearningObjectives;
  modules: LessonModule[];
  termNotes: LessonTermNote[];
  canonicalRules: LessonCanonicalRule[];
  sourceClaims: LessonSourceClaim[];
  coveredRuleIds: string[];
}

export interface PersonalizedLessonTip {
  text: string;
  lessonVariantId?: LessonVariantId;
  lessonVariantLabel?: string;
  lessonOverview?: string;
  priorConnection?: string;
  learningFocus?: string;
  nextConnection?: string;
  studyAdvice?: string;
  guidingQuestion?: string;
  sourceAnchorIds: string[];
}

export interface PersonalizedLessonTipStatus {
  state: "generated" | "unavailable";
  reasonCode: "agent_reviewed" | "not_generated";
}

/** Answer-free learner facts used only to choose the emphasis of an optional lesson tip. */
export interface LessonJourneyItem {
  knowledgePointId: string;
  title: string;
  objective: string;
}

export interface LessonJourneyContext {
  currentPosition: number;
  totalLessons: number;
  lessons: LessonJourneyItem[];
}

export interface LessonPersonalizationContext {
  knowledgeStatus: import("./domain.js").KnowledgeStatus;
  mastery: number | null;
  confidence: number;
  validEvidenceCount: number;
  evidenceFormCount: number;
  explanationPreference: BackgroundQuestionnaire["explanation_preference"];
  journey?: LessonJourneyContext;
}

export interface LearningCardBase {
  cardId: string;
  knowledgePointId: string;
  title: string;
  objective: string;
  explanation: string[];
  example: string;
  commonMistake: string;
  sourceAnchorIds: string[];
  estimatedMinutes: number;
}

/** Profile-only card asset. All variants stay server-side. */
export interface LearningCardAsset extends LearningCardBase {
  richLesson?: RichLessonAsset;
}

/** Public/session-safe card. It contains at most one selected lesson variant. */
export interface LearningCardSafeView extends LearningCardBase {
  selectedLesson?: SelectedLessonSafeView;
  personalizedTip?: PersonalizedLessonTip;
  personalizedTipStatus?: PersonalizedLessonTipStatus;
  /** Safe reference used to restore the public Agent pipeline after navigation or refresh. */
  personalizedTipAgentRunId?: string;
}

export interface QuizQuestionSafeView {
  questionId: string;
  kind: "single_choice" | "judgment";
  prompt: string;
  options: string[];
}

export interface QuizQuestionPrivate extends QuizQuestionSafeView {
  correctAnswer: string | boolean;
  explanation: string;
  sourceAnchorIds: string[];
}

export interface QuizActivitySafeView extends ActivitySafeViewBase {
  kind: "mcq";
  questions: QuizQuestionSafeView[];
  retryNumber: number;
  agentRunId?: string;
  questionSource?: "ai_recorded" | "ai_live" | "ai_supplemented" | "profile_fixed" | "insufficient";
  targetKnowledgePointIds?: string[];
}

export interface QuizQuestionGroupAsset {
  groups: Array<{
    groupId: string;
    role: "fixed" | "supplemental";
    activityId: string;
    knowledgePointId: string;
    questions: QuizQuestionSafeView[];
  }>;
}

export interface QuizAnswerKeyAsset {
  groups: Array<{
    groupId: string;
    answers: QuizQuestionPrivate[];
  }>;
}

interface McqActivityAssetBase {
  activityId: string;
  profileRevision: number;
  kind: "mcq";
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
  goalIds: string[];
  title: string;
  prompt: string;
  evaluatorRef: string;
}

export interface LegacySingleQuestionActivityAsset extends McqActivityAssetBase {
  subtype: "single_choice" | "judgment";
  options: string[];
  fixedQuestionGroupId?: never;
  supplementalQuestionGroupId?: never;
}

export interface W4QuestionGroupActivityAsset extends McqActivityAssetBase {
  fixedQuestionGroupId: string;
  supplementalQuestionGroupId?: string;
  subtype?: never;
  options?: never;
}

export type McqActivityAsset = LegacySingleQuestionActivityAsset | W4QuestionGroupActivityAsset;

export interface QuizAnswerInput {
  questionId: string;
  answer: string | boolean;
}

export interface QuizRemediationMissedQuestion {
  questionId: string;
  prompt: string;
  explanation: string;
  sourceAnchorIds: string[];
}

/** Private, answer-free retry context sent only to the reviewed generation chain. */
export interface QuizRemediationContext {
  previousAttemptId: string;
  excludedQuestionIds: string[];
  excludedQuestionPrompts: string[];
  missedQuestions: QuizRemediationMissedQuestion[];
  learnerProfileSummary: string;
  learnerProfileEvidenceRefs: string[];
  learnerProfileSource: "agent" | "deterministic";
}

export interface QuizActivityResult {
  kind: "quiz";
  verdict: "pass" | "partial" | "fail" | "insufficient";
  correctCount: number;
  totalCount: number;
  requiredCorrectCount: number;
  retryAllowed: boolean;
  safeFeedback: string;
  remediationOutcome?: {
    status: "improved" | "unchanged" | "regressed";
    previousMissedQuestionCount: number;
    currentMissedQuestionCount: number;
    targetKnowledgePointIds: string[];
    improvedKnowledgePointIds: string[];
    stillWeakKnowledgePointIds: string[];
  };
  answerReview?: Array<{
    questionId: string;
    prompt: string;
    correct: boolean;
    correctAnswer: string | boolean;
    explanation: string;
    sourceAnchorIds: string[];
  }>;
}

export interface ContinueActivityWithGapInput {
  requestId: string;
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  activityId: string;
  attemptId: string;
}

export interface ContinueActivityWithGapOutput {
  requestId: string;
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  activityId: string;
  status: "insufficient";
  result: "partial" | "fail" | "insufficient";
  attemptCount: number;
}

export interface QuizSubmitActivityInput {
  requestId: string;
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  kind: "quiz";
  activityId: string;
  activityVersion: number;
  attemptId: string;
  answers: QuizAnswerInput[];
}

export type ActivityProgressStatus = "pending" | "in_progress" | "completed" | "insufficient";

export interface ActivityProgressEntry {
  activityId: string;
  status: ActivityProgressStatus;
  attemptIds: string[];
  result?: "pass" | "partial" | "fail" | "insufficient";
  quizRetryCount: number;
  bestResult?: "pass" | "partial" | "fail" | "insufficient";
  continuedWithGap?: boolean;
  updatedAt: string;
}

export interface NodeActivityProgress {
  nodeId: string;
  card?: { cardId: string; status: "pending" | "acknowledged"; acknowledgedAt?: string };
  activities: ActivityProgressEntry[];
}

export type DiagnosticDraftVersion = number;

export type DiagnosticCompletion =
  | { mode: "fixed"; diagnosticId: string; diagnosticVersion: number }
  | { mode: "background_only"; background: BackgroundQuestionnaire; diagnosticDraftVersion: DiagnosticDraftVersion };

export interface BackgroundQuestionnaire {
  python_experience: "none" | "basic" | "comfortable" | "uncertain";
  pandas_experience: "none" | "basic" | "comfortable" | "uncertain";
  explanation_preference: "concise" | "step_by_step" | "example_first" | "uncertain";
}

export interface DiagnosticQuestionSafeView {
  questionId: string;
  knowledgePointId: string;
  kind: "single_choice" | "judgment";
  difficulty: import("./domain.js").Difficulty;
  prompt: string;
  options?: string[];
  required: boolean;
  evidenceForm?: "selected_response" | "code_reasoning";
}

export interface DiagnosticSafeEnvelope {
  diagnosticId: string;
  diagnosticVersion: number;
  estimatedMinutes: number;
  questions: DiagnosticQuestionSafeView[];
}

export interface DiagnosticDraftSafeView {
  diagnosticDraftVersion: number;
  background?: BackgroundQuestionnaire;
  currentQuestionId?: string;
  processedQuestionIds: string[];
  answers?: Array<{
    questionId: string;
    status: "answered" | "skipped";
    submittedAnswer?: string | boolean;
  }>;
}

export type CurrentAttemptSafeReference =
  | { kind: "code"; activityId: string; attemptId: string; status: "draft" | "submitted" | "evaluator_error"; draftVersion: number }
  | { kind: "quiz"; activityId: string; attemptId: string; status: "draft" | "submitted" | "evaluator_error"; retryNumber: number };

export type AdaptiveContentUnavailableReason =
  | "model_unavailable"
  | "review_rejected"
  | "repair_exhausted"
  | "generation_timeout";

export interface AdaptiveContentPort {
  prepareCard(input: { profileRevision: number; knowledgePointId: string; excludedArtifactIds: string[]; lessonVariantId?: LessonVariantId; personalizationContext?: LessonPersonalizationContext; agentRunId?: string }): Promise<{
    status: "accepted" | "unavailable";
    reasonCode?: AdaptiveContentUnavailableReason;
    card?: LearningCardSafeView;
    origin?: "recorded_response" | "live_model";
    reviewBinding?: {
      generationRunId: string;
      acceptedCardSha256: string;
    };
  }>;
  prepareQuiz(input: { profileRevision: number; activityId: string; retryNumber: number; excludedQuestionIds: string[]; lessonVariantId?: LessonVariantId; targetKnowledgePointIds?: string[]; remediationContext?: QuizRemediationContext; agentRunId?: string }): Promise<{
    status: "accepted" | "unavailable";
    reasonCode?: AdaptiveContentUnavailableReason;
    questions?: QuizQuestionPrivate[];
    origin?: "recorded_response" | "live_model";
    reviewBinding?: {
      generationRunId: string;
      acceptedQuestionSetSha256: string;
    };
  }>;
}

export interface CapabilityTaskPort {
  enqueue(input: {
    trigger: "diagnostic_completed" | "node_completed";
    sessionId: string;
    profileRevision: number;
    evidenceVersion: number;
    knowledgePointId?: string;
    evidenceIds: string[];
  }): Promise<{ taskStatus: "not_updated" | "stale" | "failed" }>;
}

export interface AppBootstrapSafeView {
  profiles: Array<{ subjectId: string; name: string; revision: number; modalities: string[] }>;
  goals: Array<{ goalId: string; title: string }>;
  chapters: Array<{ chapterId: string; title: string }>;
  diagnostic: DiagnosticSafeEnvelope;
  recoverableSessions: import("./facade.js").SessionSafeView[];
  session?: import("./facade.js").SessionRecoverySafeView;
}

export interface AppBootstrapFacade {
  getBootstrap(input: { recoverSessionId?: string }): Promise<AppBootstrapSafeView>;
}

export function createDeterministicContentPort(): AdaptiveContentPort {
  return {
    async prepareCard() { return { status: "unavailable" }; },
    async prepareQuiz() { return { status: "unavailable" }; },
  };
}

export function createEmptyCapabilityTaskPort(): CapabilityTaskPort {
  return { async enqueue() { return { taskStatus: "not_updated" }; } };
}
