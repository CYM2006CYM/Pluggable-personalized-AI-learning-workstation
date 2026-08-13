/** Public W4 contracts. Runtime internals must not be exposed through these types. */
import type { ActivitySafeViewBase } from "./facade.js";
export * from "./facade.js";
export * from "./domain.js";

export interface Revision3KnowledgePointFields {
  activityPolicy?: import("./domain.js").ActivityPolicy;
  contentEstimatedMinutes?: number;
}

export interface LearningCardSafeView {
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
  retryNumber: 0 | 1;
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

export interface QuizActivityResult {
  kind: "quiz";
  verdict: "pass" | "partial" | "fail" | "insufficient";
  correctCount: number;
  totalCount: number;
  requiredCorrectCount: number;
  retryAllowed: boolean;
  safeFeedback: string;
  answerReview?: Array<{
    questionId: string;
    correct: boolean;
    correctAnswer: string | boolean;
    explanation: string;
    sourceAnchorIds: string[];
  }>;
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
  quizRetryCount: 0 | 1;
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
}

export type CurrentAttemptSafeReference =
  | { kind: "code"; activityId: string; attemptId: string; status: "draft" | "submitted" | "evaluator_error"; draftVersion: number }
  | { kind: "quiz"; activityId: string; attemptId: string; status: "draft" | "submitted" | "evaluator_error"; retryNumber: 0 | 1 };

export interface AdaptiveContentPort {
  prepareCard(input: { profileRevision: number; knowledgePointId: string; excludedArtifactIds: string[] }): Promise<{
    status: "accepted" | "unavailable";
    card?: LearningCardSafeView;
  }>;
  prepareQuiz(input: { profileRevision: number; activityId: string; retryNumber: 0 | 1; excludedQuestionIds: string[] }): Promise<{
    status: "accepted" | "unavailable";
    questions?: QuizQuestionPrivate[];
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
