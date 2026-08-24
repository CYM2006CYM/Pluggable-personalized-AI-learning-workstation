import type {
  BackgroundQuestionnaire,
  LearningCardAsset,
  LearningCardSafeView,
  LessonVariantId,
  PersonalizedLessonTip,
  SelectedLessonSafeView,
} from "../contracts/index.js";

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

function projectPersonalizedTip(dynamic: LearningCardSafeView | undefined): PersonalizedLessonTip | undefined {
  if (dynamic === undefined) return undefined;
  const explanation = dynamic.explanation[0];
  const text = explanation === undefined
    ? dynamic.objective
    : `${dynamic.objective} ${explanation}`;
  if (!/[\u3400-\u9fff]/u.test(text)) return undefined;
  return { text, sourceAnchorIds: [...dynamic.sourceAnchorIds] };
}

/** Project a Profile-only card to a session-safe snapshot containing one variant at most. */
export function projectLearningCardForSession(input: {
  fixed: LearningCardAsset;
  preference: BackgroundQuestionnaire["explanation_preference"] | undefined;
  dynamicTipSource?: LearningCardSafeView;
}): LearningCardSafeView {
  const { richLesson: _privateVariants, ...base } = input.fixed;
  const selectedLesson = projectSelectedLesson(input.fixed, lessonVariantForPreference(input.preference));
  const personalizedTip = projectPersonalizedTip(input.dynamicTipSource);
  return structuredClone({
    ...base,
    ...(selectedLesson === undefined ? {} : { selectedLesson }),
    ...(personalizedTip === undefined ? {} : { personalizedTip }),
  });
}
