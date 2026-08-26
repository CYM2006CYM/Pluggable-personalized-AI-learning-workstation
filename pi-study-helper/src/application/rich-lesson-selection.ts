import type {
  BackgroundQuestionnaire,
  LearningCardAsset,
  LearningCardSafeView,
  LessonVariantId,
  PersonalizedLessonTip,
  SelectedLessonSafeView,
} from "../contracts/index.js";
import { isSelfContainedGuidingQuestion, normalizeGuidingQuestion } from "../domain/personalized-lesson-guide.js";

export function lessonVariantForPreference(
  preference: BackgroundQuestionnaire["explanation_preference"] | undefined,
): LessonVariantId {
  if (preference === "concise") return "concise";
  if (preference === "example_first") return "practice";
  return "guided";
}

function projectSelectedLesson(asset: LearningCardAsset, variantId: LessonVariantId): SelectedLessonSafeView | undefined {
  const richLesson = asset.richLesson;
  if (richLesson === undefined) return undefined;
  const variant = richLesson.variants[variantId];
  return structuredClone({
    variantId: variant.variantId,
    label: variant.label,
    learningObjectives: variant.learningObjectives,
    modules: variant.modules,
    termNotes: variant.termNotes,
    canonicalRules: richLesson.canonicalRules,
    sourceClaims: richLesson.sourceClaims,
    coveredRuleIds: variant.coveredRuleIds,
  });
}

function projectPersonalizedTip(
  dynamic: LearningCardSafeView | undefined,
  lesson?: SelectedLessonSafeView,
): PersonalizedLessonTip | undefined {
  if (dynamic === undefined) return undefined;
  const [priorConnection, learningFocus, nextConnection] = dynamic.explanation;
  const guidingQuestion = normalizeGuidingQuestion(dynamic.example);
  const guidingQuestionReady = isSelfContainedGuidingQuestion(guidingQuestion);
  const text = priorConnection === undefined
    ? dynamic.objective
    : [dynamic.objective, ...dynamic.explanation, dynamic.commonMistake, ...(guidingQuestionReady ? [guidingQuestion] : [])].join(" ");
  if (!/[\u3400-\u9fff]/u.test(text)) return undefined;
  const hasStructuredGuide = priorConnection !== undefined
    && learningFocus !== undefined
    && nextConnection !== undefined
    && guidingQuestionReady;
  return {
    text,
    ...(lesson === undefined ? {} : {
      lessonVariantId: lesson.variantId,
      lessonVariantLabel: lesson.label,
    }),
    ...(hasStructuredGuide ? {
      lessonOverview: dynamic.objective,
      priorConnection,
      learningFocus,
      nextConnection,
      studyAdvice: dynamic.commonMistake,
      guidingQuestion,
    } : {}),
    sourceAnchorIds: [...dynamic.sourceAnchorIds],
  };
}

export function attachPersonalizedTip(
  fixedSessionCard: LearningCardSafeView,
  dynamicTipSource: LearningCardSafeView,
  agentRunId?: string,
): LearningCardSafeView {
  const personalizedTip = projectPersonalizedTip(dynamicTipSource, fixedSessionCard.selectedLesson);
  if (personalizedTip === undefined) return structuredClone(fixedSessionCard);
  return structuredClone({
    ...fixedSessionCard,
    personalizedTip,
    personalizedTipStatus: { state: "generated" as const, reasonCode: "agent_reviewed" as const },
    ...(agentRunId === undefined ? {} : { personalizedTipAgentRunId: agentRunId }),
  });
}

/** Project a Profile-only card to a session-safe snapshot containing one variant at most. */
export function projectLearningCardForSession(input: {
  fixed: LearningCardAsset;
  preference: BackgroundQuestionnaire["explanation_preference"] | undefined;
  dynamicTipSource?: LearningCardSafeView;
}): LearningCardSafeView {
  const { richLesson: _privateVariants, ...base } = input.fixed;
  const selectedLesson = projectSelectedLesson(input.fixed, lessonVariantForPreference(input.preference));
  const personalizedTip = projectPersonalizedTip(input.dynamicTipSource, selectedLesson);
  return structuredClone({
    ...base,
    ...(selectedLesson === undefined ? {} : { selectedLesson }),
    ...(personalizedTip === undefined ? {} : { personalizedTip }),
    ...(selectedLesson === undefined ? {} : {
      personalizedTipStatus: personalizedTip === undefined
        ? { state: "unavailable" as const, reasonCode: "not_generated" as const }
        : { state: "generated" as const, reasonCode: "agent_reviewed" as const },
    }),
  });
}
