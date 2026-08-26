const GUIDING_QUESTION_PREFIX = /^(?:带着(?:这个)?问题(?:去)?进入正文)[：:\s]*/u;
const CONTEXT_DEPENDENT_REFERENCE = /(?:这|该|那)(?:一)?(?:张|个|组|份)?(?:表|数据|结果|代码|示例|样例|列|行)|(?:上|下|前)文|上述|前述|如下|这里|刚才/u;
const CODE_SHAPED_DETAIL = /[`=()[\]{}]|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|\b(?:df|dataframe)\s*\./iu;
const GUIDING_VERB = /为什么|为何|如何|怎样|怎么/u;
const CHINESE_TEXT = /[\u3400-\u9fff]/u;

export type GuidingQuestionFailure =
  | "empty"
  | "length"
  | "not_chinese"
  | "not_a_question"
  | "missing_guiding_verb"
  | "context_dependent";

export function normalizeGuidingQuestion(value: string): string {
  return value.trim().replace(GUIDING_QUESTION_PREFIX, "").trim();
}

/** A pre-lesson question must make sense before the learner sees any sample or code. */
export function guidingQuestionFailure(value: unknown): GuidingQuestionFailure | undefined {
  if (typeof value !== "string") return "empty";
  const question = normalizeGuidingQuestion(value);
  if (question.length === 0) return "empty";
  if (question.length < 18 || question.length > 120) return "length";
  if (!CHINESE_TEXT.test(question)) return "not_chinese";
  if (!/[？?]$/u.test(question)) return "not_a_question";
  if (!GUIDING_VERB.test(question)) return "missing_guiding_verb";
  if (/\d/u.test(question) || CONTEXT_DEPENDENT_REFERENCE.test(question) || CODE_SHAPED_DETAIL.test(question)) {
    return "context_dependent";
  }
  return undefined;
}

export function isSelfContainedGuidingQuestion(value: unknown): value is string {
  return guidingQuestionFailure(value) === undefined;
}
