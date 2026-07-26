import { Type, codeNode, connect, defineGraph, entry, finish, firstMatch } from "pi-loop-graph-sdk";
import type { AgentRunRequest, Graph, JsonSchema, NodeCompletion } from "pi-loop-graph-sdk";
import type { Static, TSchema } from "typebox";
import type { DifficultyLevel, GradeResult, ReviewQuestion } from "../domain/types.js";
import type { LearningProfileCandidate } from "../domain/learning-profile-evidence.js";
import type { ProfileBuildFragment } from "../domain/profile-build.js";
import type {
  ProfileRevisionPatch,
  ProfileRevisionPlan,
  ProfileRevisionQualityReview,
} from "../domain/profile-revision.js";
import {
  assertValidRevisionPatch,
  assertValidRevisionPlan,
} from "../domain/profile-revision.js";
import { loadActiveStudyTargetContext, type StudyTargetKind } from "../domain/study-profile.js";
import { getDifficultyPolicy, getReviewModePolicy } from "../domain/study-policy.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

/**
 * 0.1 由 SDK 导出的业务校验结果类型；0.2 不再提供 `CompletionValidationResult`，
 * 由本包自己定义并在 Code Node 内驱动 Agent 重试。
 */
export interface CompletionValidationResult {
  readonly isValid: boolean;
  readonly reason?: string;
}

const DIFFICULTY_LEVELS = ["S-R", "S-U", "M-U", "M-A", "C-A"] as const;
const QUESTION_TYPES = ["choice", "judgment", "short_answer"] as const;

const DifficultyLiteral = Type.Union(DIFFICULTY_LEVELS.map((level) => Type.Literal(level)));
const QuestionTypeLiteral = Type.Union(QUESTION_TYPES.map((value) => Type.Literal(value)));
const StringArray = Type.Array(Type.String());
const AnyJson = Type.Unknown();

/** Graph/Node Schema 由 Runtime 实际校验，未知结构统一走 JSON 兼容检查。 */
function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

const questionOutputSchema = Type.Object({
  question_id: Type.String(),
  knowledge_points: StringArray,
  difficulty: Type.String(),
  type: QuestionTypeLiteral,
  question_text: Type.String(),
  options: Type.Optional(StringArray),
  correct_answer: Type.String(),
  explanation_l1: Type.String(),
  source_basis: Type.String(),
  related_knowledge_chain: StringArray,
}, { additionalProperties: false });

const gradeOutputSchema = Type.Object({
  is_correct: Type.Boolean(),
  correct_answer: Type.String(),
  explanation_l1: Type.String(),
  knowledge_chain_l3: StringArray,
  suggestion_next: Type.String(),
  grading: Type.String(),
}, { additionalProperties: false });

const summaryOutputSchema = Type.Object({
  summary_markdown: Type.String(),
  observed_facts: StringArray,
  mastery_evidence: StringArray,
  unverified_topics: StringArray,
  recommendations: StringArray,
}, { additionalProperties: false });

const discussionOutputSchema = Type.Object({
  reply: Type.String(),
  clarified_points: StringArray,
  lingering_questions: StringArray,
}, { additionalProperties: false });

const learningProfileOutputSchema = Type.Object({
  profile_summary: Type.String(),
  weak_points: StringArray,
  strengths: StringArray,
  unverified_topics: StringArray,
  recommendations: StringArray,
}, { additionalProperties: false });

const profileBuildPointSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  aliases: StringArray,
  tags: StringArray,
  definition: Type.String(),
  key_points: StringArray,
  common_misconceptions: StringArray,
  related: StringArray,
  question_types: Type.Array(QuestionTypeLiteral),
  difficulty_baseline: DifficultyLiteral,
  source_ids: StringArray,
}, { additionalProperties: false });

const profileBuildFragmentSchema = Type.Object({
  subject_overview: Type.String(),
  chapters: Type.Array(Type.Object({
    title: Type.String(),
    source_ids: StringArray,
    sections: Type.Array(Type.Object({
      title: Type.String(),
      markdown: Type.String(),
      source_ids: StringArray,
      knowledge_points: Type.Array(profileBuildPointSchema),
    }, { additionalProperties: false })),
  }, { additionalProperties: false })),
  warnings: StringArray,
}, { additionalProperties: false });

const profileRevisionPlanSchema = Type.Object({
  summary: Type.String(),
  requires_clarification: Type.Boolean(),
  clarification_question: Type.String(),
  operations: Type.Array(Type.Object({
    path: Type.String(),
    operation: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    reason: Type.String(),
  }, { additionalProperties: false })),
  warnings: StringArray,
}, { additionalProperties: false });

const profileRevisionPatchSchema = Type.Object({
  summary: Type.String(),
  changes: Type.Array(Type.Object({
    path: Type.String(),
    operation: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    content: Type.Optional(Type.String()),
    reason: Type.String(),
  }, { additionalProperties: false })),
  unresolved: StringArray,
}, { additionalProperties: false });

const profileRevisionQualitySchema = Type.Object({
  report_markdown: Type.String(),
  blocking_issues: StringArray,
  warnings: StringArray,
  recommendation: Type.Union([Type.Literal("enable"), Type.Literal("revise")]),
}, { additionalProperties: false });

function validString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validString);
}

export function validateQuestionResult(result: Record<string, unknown>): CompletionValidationResult {
  const types = new Set(QUESTION_TYPES as readonly string[]);
  const difficulties = new Set(DIFFICULTY_LEVELS as readonly string[]);
  const requiredStrings = ["question_id", "difficulty", "type", "question_text", "correct_answer", "explanation_l1", "source_basis"];
  for (const key of requiredStrings) {
    if (!validString(result[key])) return { isValid: false, reason: `${key} 必须是非空字符串` };
  }
  if (!types.has(String(result.type))) return { isValid: false, reason: "type 不是支持的题型" };
  if (!difficulties.has(String(result.difficulty))) return { isValid: false, reason: "difficulty 不是支持的难度" };
  if (!validStringArray(result.knowledge_points)) return { isValid: false, reason: "knowledge_points 必须是非空字符串数组" };
  if (!Array.isArray(result.related_knowledge_chain) || result.related_knowledge_chain.some((item) => typeof item !== "string")) {
    return { isValid: false, reason: "related_knowledge_chain 必须是字符串数组" };
  }
  if (result.type === "choice" && (!validStringArray(result.options) || result.options.length < 2 || result.options.length > 6)) {
    return { isValid: false, reason: "choice 必须提供 2 到 6 个非空选项" };
  }
  return { isValid: true };
}

export function validateQuestionResultForRequest(
  result: Record<string, unknown>,
  expectedDifficulty: string,
  expectedType: string,
  allowedKnowledgePointIds: readonly string[] = [],
  exactKnowledgePointId?: string,
): CompletionValidationResult {
  const base = validateQuestionResult(result);
  if (!base.isValid) return base;
  if (result.difficulty !== expectedDifficulty) {
    return { isValid: false, reason: `difficulty 必须与用户选择一致：${expectedDifficulty}` };
  }
  if (result.type !== expectedType) {
    return { isValid: false, reason: `type 必须与用户选择一致：${expectedType}` };
  }
  const actualKnowledgePoints = result.knowledge_points as string[];
  if (allowedKnowledgePointIds.length > 0 && actualKnowledgePoints.some((item) => !allowedKnowledgePointIds.includes(item))) {
    return { isValid: false, reason: "knowledge_points 超出当前学习目标" };
  }
  if (exactKnowledgePointId !== undefined && (
    actualKnowledgePoints.length !== 1 || actualKnowledgePoints[0] !== exactKnowledgePointId
  )) {
    return { isValid: false, reason: `卡片练习必须只考查当前卡片：${exactKnowledgePointId}` };
  }
  return { isValid: true };
}

export function validateGradeResult(result: Record<string, unknown>): CompletionValidationResult {
  if (typeof result.is_correct !== "boolean") return { isValid: false, reason: "is_correct 必须是布尔值" };
  for (const key of ["correct_answer", "explanation_l1", "suggestion_next", "grading"]) {
    if (!validString(result[key])) return { isValid: false, reason: `${key} 必须是非空字符串` };
  }
  if (!Array.isArray(result.knowledge_chain_l3) || result.knowledge_chain_l3.some((item) => typeof item !== "string")) {
    return { isValid: false, reason: "knowledge_chain_l3 必须是字符串数组" };
  }
  return { isValid: true };
}

export function validateSummaryResult(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.summary_markdown)) return { isValid: false, reason: "summary_markdown 不能为空" };
  for (const key of ["observed_facts", "mastery_evidence", "unverified_topics", "recommendations"]) {
    if (!Array.isArray(result[key]) || (result[key] as unknown[]).some((item) => typeof item !== "string")) {
      return { isValid: false, reason: `${key} 必须是字符串数组` };
    }
  }
  return { isValid: true };
}

export function validateDiscussionResult(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.reply)) return { isValid: false, reason: "reply 不能为空" };
  for (const key of ["clarified_points", "lingering_questions"]) {
    if (!Array.isArray(result[key]) || (result[key] as unknown[]).some((item) => typeof item !== "string")) {
      return { isValid: false, reason: `${key} 必须是字符串数组` };
    }
  }
  return { isValid: true };
}

export function validateLearningProfileResult(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.profile_summary)) return { isValid: false, reason: "profile_summary 不能为空" };
  if (String(result.profile_summary).length > 2_000) return { isValid: false, reason: "profile_summary 过长" };
  for (const key of ["weak_points", "strengths", "unverified_topics", "recommendations"]) {
    const values = result[key];
    if (!Array.isArray(values) || values.some((item) => typeof item !== "string" || item.trim() === "")) {
      return { isValid: false, reason: `${key} 必须是非空字符串数组` };
    }
    if (values.length > 20 || values.some((item) => item.length > 200)) {
      return { isValid: false, reason: `${key} 超出画像长度限制` };
    }
  }
  return { isValid: true };
}

export function validateProfileBuildFragment(
  result: Record<string, unknown>,
  allowedSourceIds: readonly string[] = [],
): CompletionValidationResult {
  if (!validString(result.subject_overview)) return { isValid: false, reason: "subject_overview 不能为空" };
  if (!Array.isArray(result.warnings) || result.warnings.some((item) => typeof item !== "string")) {
    return { isValid: false, reason: "warnings 必须是字符串数组" };
  }
  if (!Array.isArray(result.chapters) || result.chapters.length === 0) {
    return { isValid: false, reason: "chapters 必须是非空数组" };
  }
  const allowed = new Set(allowedSourceIds);
  const validSources = (value: unknown): value is string[] => Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "string" && (allowed.size === 0 || allowed.has(item)));
  for (const chapter of result.chapters as Array<Record<string, unknown>>) {
    if (!validString(chapter.title) || !validSources(chapter.source_ids)) {
      return { isValid: false, reason: "chapter title/source_ids 无效或超出当前批次" };
    }
    if (!Array.isArray(chapter.sections) || chapter.sections.length === 0) {
      return { isValid: false, reason: "每章至少需要一个 section" };
    }
    for (const section of chapter.sections as Array<Record<string, unknown>>) {
      if (!validString(section.title) || !validString(section.markdown) || !validSources(section.source_ids)) {
        return { isValid: false, reason: "section 字段无效或 source_ids 超出当前批次" };
      }
      if (!Array.isArray(section.knowledge_points) || section.knowledge_points.length === 0) {
        return { isValid: false, reason: "每个 section 至少需要一个 knowledge point" };
      }
      for (const point of section.knowledge_points as Array<Record<string, unknown>>) {
        for (const key of ["id", "name", "definition"]) {
          if (!validString(point[key])) return { isValid: false, reason: `knowledge point ${key} 不能为空` };
        }
        for (const key of ["aliases", "tags", "key_points", "common_misconceptions", "related", "question_types"]) {
          if (!Array.isArray(point[key]) || (point[key] as unknown[]).some((item) => typeof item !== "string")) {
            return { isValid: false, reason: `knowledge point ${key} 必须是字符串数组` };
          }
        }
        if (!validSources(point.source_ids)) return { isValid: false, reason: "knowledge point source_ids 超出当前批次" };
        if (!(new Set(DIFFICULTY_LEVELS as readonly string[])).has(String(point.difficulty_baseline))) {
          return { isValid: false, reason: "knowledge point difficulty_baseline 无效" };
        }
      }
    }
  }
  return { isValid: true };
}

export function validateProfileRevisionPlan(
  result: Record<string, unknown>,
  existingPaths: readonly string[],
): CompletionValidationResult {
  try {
    assertValidRevisionPlan(result as unknown as ProfileRevisionPlan, existingPaths);
    return { isValid: true };
  } catch (error) {
    return { isValid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function validateProfileRevisionPatch(
  result: Record<string, unknown>,
  plan: ProfileRevisionPlan,
): CompletionValidationResult {
  try {
    assertValidRevisionPatch(result as unknown as ProfileRevisionPatch, plan);
    return { isValid: true };
  } catch (error) {
    return { isValid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function validateProfileRevisionQuality(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.report_markdown)) return { isValid: false, reason: "report_markdown 不能为空" };
  for (const key of ["blocking_issues", "warnings"]) {
    if (!Array.isArray(result[key]) || (result[key] as unknown[]).some((item) => typeof item !== "string" || item.trim() === "")) {
      return { isValid: false, reason: `${key} 必须是非空字符串数组` };
    }
  }
  if (result.recommendation !== "enable" && result.recommendation !== "revise") {
    return { isValid: false, reason: "recommendation 必须是 enable 或 revise" };
  }
  if ((result.blocking_issues as unknown[]).length > 0 && result.recommendation !== "revise") {
    return { isValid: false, reason: "存在 blocking_issues 时 recommendation 必须为 revise" };
  }
  return { isValid: true };
}

/** Code Node 内的 Agent Run 网关：0.2 用 runAgent + 业务校验重试替代 0.1 的 validateCompletion。 */
export const AGENT_VALIDATION_ATTEMPTS = 3;

interface ValidatedAgentRun {
  readonly runAgent: (request: AgentRunRequest) => Promise<NodeCompletion>;
  readonly prompt: string;
  readonly output: JsonSchema;
  readonly validate: (result: Record<string, unknown>) => CompletionValidationResult;
  readonly attempts?: number;
}

export async function runValidatedAgent(run: ValidatedAgentRun): Promise<Record<string, unknown>> {
  const attempts = run.attempts ?? AGENT_VALIDATION_ATTEMPTS;
  let lastReason = "结果未通过业务校验";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const prompt = attempt === 1
      ? run.prompt
      : `${run.prompt}\n\n上一次提交未通过业务校验：${lastReason}\n请按上述要求修正后重新调用 __graph_complete__ 提交。`;
    const completion = await run.runAgent({ prompt, output: run.output });
    const result = (completion.result ?? {}) as Record<string, unknown>;
    const validation = run.validate(result);
    if (validation.isValid) return result;
    lastReason = validation.reason ?? lastReason;
  }
  throw new Error(`Agent 结果未通过业务校验：${lastReason}`);
}

const GenerateQuestionInput = Type.Object({
  subjectId: Type.String(),
  scopeId: Type.String(),
  targetKind: Type.Optional(Type.String()),
  targetId: Type.Optional(Type.String()),
  difficulty: Type.Optional(Type.String()),
  questionType: Type.Optional(Type.String()),
  mode: Type.Optional(Type.String()),
});

const PreparedQuestionContext = Type.Object({
  subjectId: Type.String(),
  profileName: Type.String(),
  scopeId: Type.String(),
  scopeLabel: Type.String(),
  target: AnyJson,
  knowledgePointIds: StringArray,
  difficulty: Type.String(),
  difficultyPolicy: AnyJson,
  questionType: Type.String(),
  mode: Type.String(),
  modePolicy: AnyJson,
  material: Type.String(),
});

const GradeAnswerInput = Type.Object({
  question: AnyJson,
  userAnswer: Type.String(),
});

const DiscussQuestionInput = Type.Object({
  question: AnyJson,
  grade: Type.Optional(AnyJson),
  userAnswer: Type.Optional(Type.String()),
  userMessage: Type.String(),
  revealAnswer: Type.Optional(Type.Boolean()),
  completionAttempt: Type.Optional(Type.Number()),
});

const SummarizeSessionInput = Type.Object({
  evidence: AnyJson,
  difficultyCatalog: AnyJson,
  summaryKind: Type.Optional(Type.String()),
  completionAttempt: Type.Optional(Type.Number()),
});

const UpdateLearningProfileInput = Type.Object({
  evidence: AnyJson,
});

const BuildProfileFragmentInput = Type.Object({
  subjectName: Type.String(),
  batchIndex: Type.Number(),
  batchCount: Type.Number(),
  allowedSourceIds: StringArray,
  sources: Type.Array(AnyJson),
});

const PlanProfileRevisionInput = Type.Object({
  feedback: Type.String(),
  profile: AnyJson,
  existingPaths: StringArray,
  catalog: Type.Array(AnyJson),
  coreFiles: AnyJson,
});

const ReviseProfileDraftInput = Type.Object({
  feedback: Type.String(),
  profile: AnyJson,
  plan: AnyJson,
  currentFiles: Type.Array(AnyJson),
});

const ReviewProfileDraftInput = Type.Object({
  feedback: Type.String(),
  plan: AnyJson,
  patchSummary: Type.String(),
  structureInspection: AnyJson,
  coreFiles: AnyJson,
  changedFiles: Type.Array(AnyJson),
});

export interface StudyWalkingSkeletonGraphs {
  generateQuestion: Graph;
  gradeAnswer: Graph;
  discussQuestion: Graph;
  summarizeSession: Graph;
  updateLearningProfile: Graph;
  buildProfileFragment: Graph;
  planProfileRevision: Graph;
  reviseProfileDraft: Graph;
  reviewProfileDraft: Graph;
}

/** Entry 的 guard/mapInput 以 Graph Input 为准，这里显式带上契约类型。 */
function mainEntry<S extends TSchema>(_input: S, to: string) {
  return entry<Static<S>>("main", { to });
}

/** 0.2 的终点连接必须显式产出符合 Graph output 契约的值。 */
function finishWithResult(stageId: string) {
  return firstMatch({
    [`${stageId}_to_end`]: finish({
      frame: ({ completion }) => ({ [`${stageId}Result`]: completion.result }),
      output: ({ completion }) => completion.result,
    }),
  });
}

export function createStudyWalkingSkeletonGraphs(
  profiles: ProfileFamilyRepository,
): StudyWalkingSkeletonGraphs {
  const prepareNode = codeNode({
    identity: { name: "prepare_question_context" },
    subGoal: "从 active Profile 准备出题上下文",
    tools: [],
    input: GenerateQuestionInput,
    output: PreparedQuestionContext,
    async execute({ input, complete }) {
      const subjectId = String(input.subjectId ?? "");
      const scopeId = String(input.scopeId ?? "");
      const targetKind = String(input.targetKind ?? "scope") as StudyTargetKind;
      if (!(["scope", "card", "section"] as const).includes(targetKind)) {
        throw new Error(`Unsupported study target kind: ${targetKind}`);
      }
      const targetId = String(input.targetId ?? scopeId);
      const difficulty = String(input.difficulty ?? "S-U");
      const mode = String(input.mode ?? "practice");
      const context = await loadActiveStudyTargetContext(profiles, subjectId, scopeId, targetKind, targetId);
      const difficultyPolicy = getDifficultyPolicy(difficulty);
      const modePolicy = getReviewModePolicy(mode);
      return complete(toJson({
        subjectId,
        profileName: context.profile.name,
        scopeId,
        scopeLabel: context.scope.label,
        target: context.target,
        knowledgePointIds: context.target.knowledgePointIds,
        difficulty,
        difficultyPolicy,
        questionType: String(input.questionType ?? "short_answer"),
        mode,
        modePolicy,
        material: context.material,
      }));
    },
  });

  const generateNode = codeNode({
    identity: { name: "generate_question" },
    subGoal: "严格依据 active Profile 生成一道可判定的学习题",
    tools: [],
    input: PreparedQuestionContext,
    output: questionOutputSchema,
    async execute({ input, complete, runAgent }) {
      const expectedDifficulty = String(input.difficulty);
      const expectedType = String(input.questionType);
      const allowedKnowledgePointIds = Array.isArray(input.knowledgePointIds)
        ? input.knowledgePointIds.filter((item): item is string => typeof item === "string")
        : [];
      const target = input.target as { kind?: unknown; id?: unknown } | undefined;
      const exactKnowledgePointId = target?.kind === "card" && typeof target.id === "string" ? target.id : undefined;
      const result = await runValidatedAgent({
        runAgent,
        output: questionOutputSchema,
        validate: (value) => validateQuestionResultForRequest(
          value,
          expectedDifficulty,
          expectedType,
          allowedKnowledgePointIds,
          exactKnowledgePointId,
        ),
        prompt: `你是学习出题者。只依据下面资料和固定策略生成一道题，不得引入资料外事实。\n\n固定难度策略：${JSON.stringify(input.difficultyPolicy)}\n固定学习方式策略：${JSON.stringify(input.modePolicy)}\n当前学习目标：${JSON.stringify(input.target)}\n\n要求：\n1. 难度必须为 ${expectedDifficulty}，题型必须为 ${expectedType}。\n2. 题目必须遵守上述策略，有明确答案和简洁解析。\n3. knowledge_points 只能使用当前目标允许的 ID；卡片练习只能使用当前卡片 ID。\n4. source_basis 写实际使用的资料依据。\n5. 不得逐字复用资料中的现成题目或答案。\n6. 完成后调用 __graph_complete__，结果严格符合输出 schema。\n\n可用知识点：${JSON.stringify(input.knowledgePointIds)}\n范围：${String(input.scopeLabel)}\n\n资料：\n${String(input.material)}`,
      });
      return complete(result as never);
    },
  });

  const generateQuestion = defineGraph({
    id: "study_generate_question",
    version: "1",
    goal: "从 active Profile 生成一道学习题",
    input: GenerateQuestionInput,
    output: questionOutputSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(GenerateQuestionInput, "prepare_question_context")],
    stages: {
      prepare_question_context: {
        node: prepareNode,
        route: firstMatch({
          prepare_to_generate: connect("generate_question", {
            frame: ({ completion }) => ({
              preparedQuestionContext: {
                ...(completion.result as Record<string, unknown>),
                material: "[已传给出题节点]",
              },
            }),
            map: ({ completion }) => completion.result,
          }),
        }),
      },
      generate_question: {
        node: generateNode,
        route: finishWithResult("generate_question"),
      },
    },
  });

  const gradeNode = codeNode({
    identity: { name: "grade_answer" },
    subGoal: "根据题目标准答案和资料语义判断用户回答",
    tools: [],
    input: GradeAnswerInput,
    output: gradeOutputSchema,
    async execute({ input, complete, runAgent }) {
      const result = await runValidatedAgent({
        runAgent,
        output: gradeOutputSchema,
        validate: validateGradeResult,
        prompt: `请判定用户提交的答案。不要只做字面匹配；根据题目、标准答案和解析判断核心意思是否正确。\n\n业务约束：\n1. 传入文本一定是 submitted_answer，不是放弃动作。\n2. 即使回答是“不知道”、空泛回答或答非所问，也只能判为错误，不能描述为“用户放弃”。\n3. 只评价这次回答的知识内容，不推断信心、焦虑、态度、习惯或长期能力。\n4. 完成后调用 __graph_complete__。\n\n题目：${JSON.stringify(input.question)}\n用户回答：${String(input.userAnswer)}`,
      });
      return complete(result as never);
    },
  });

  const gradeAnswer = defineGraph({
    id: "study_grade_answer",
    version: "1",
    goal: "语义判断一次学习回答",
    input: GradeAnswerInput,
    output: gradeOutputSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(GradeAnswerInput, "grade_answer")],
    stages: {
      grade_answer: { node: gradeNode, route: finishWithResult("grade_answer") },
    },
  });

  const discussionNode = codeNode({
    identity: { name: "discuss_question" },
    subGoal: "围绕当前题目帮助用户澄清概念，不脱离 active Profile 证据",
    tools: [],
    input: DiscussQuestionInput,
    output: discussionOutputSchema,
    async execute({ input, complete, runAgent }) {
      const revealAnswer = input.revealAnswer === true;
      const completionAttempt = Number(input.completionAttempt ?? 1);
      const policy = revealAnswer
        ? "本题已经结束，可以使用给定的参考答案和解析进行完整解释。"
        : "本题仍在订正中。只能提供渐进提示、追问或指出思考方向；不得给出完整答案、参考答案、解析、判分点组合，也不得复述任何未提供的隐藏答案。即使用户直接询问答案，也要引导其继续作答。";
      const retryReminder = completionAttempt > 1
        ? "这是结构化提交重试。上一次没有形成节点结果，本次不得只输出普通正文。"
        : "";
      const result = await runValidatedAgent({
        runAgent,
        output: discussionOutputSchema,
        validate: validateDiscussionResult,
        prompt: `你正在执行一个必须结构化完成的学习讨论节点。${policy}\n\n${retryReminder}\n最高优先级输出要求：无论是否拒绝直接给答案，都必须调用 __graph_complete__；把面向用户的内容写入 reply，并同时提交 clarified_points 与 lingering_questions 两个字符串数组。不要在普通正文中结束本轮。\n\n不要另起无关话题，不要虚构资料依据，不推断用户心理或长期能力。\n\n题目上下文：${JSON.stringify(input.question)}\n最近判题上下文：${JSON.stringify(input.grade)}\n用户最近提交：${String(input.userAnswer ?? "")}\n用户追问：${String(input.userMessage)}`,
      });
      return complete(result as never);
    },
  });

  const discussQuestion = defineGraph({
    id: "study_discuss_question",
    version: "1",
    goal: "围绕当前题目完成一次知识消化讨论",
    input: DiscussQuestionInput,
    output: discussionOutputSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(DiscussQuestionInput, "discuss_question")],
    stages: {
      discuss_question: { node: discussionNode, route: finishWithResult("discuss_question") },
    },
  });

  const summaryNode = codeNode({
    identity: { name: "summarize_session" },
    subGoal: "生成必须持久化的本次学习情况总结",
    tools: [],
    input: SummarizeSessionInput,
    output: summaryOutputSchema,
    async execute({ input, complete, runAgent }) {
      const retryReminder = Number(input.completionAttempt ?? 1) > 1
        ? "这是一次全新隔离会话中的总结重试。上一次没有形成节点结果，本次必须调用 __graph_complete__ 提交结构化总结。\n\n"
        : "";
      const result = await runValidatedAgent({
        runAgent,
        output: summaryOutputSchema,
        validate: validateSummaryResult,
        prompt: `${retryReminder}根据代码生成的 SessionEvidence 生成中文 Markdown 学习情况总结。必须包含：学习范围、可观察事实、掌握证据、未获得掌握证据的内容、下一步建议。\n\n证据规则：\n1. 只能使用 evidence 中的字段，不得补写原始答案、心理状态、习惯或长期能力。\n2. mastery_evidence 才能支持掌握结论；clarified_points 只表示讨论涉及的内容。\n3. unverified_topics 只表示没有获得掌握证据，不能改写为薄弱点或错误知识。\n4. 建议只能使用给定的有效难度目录，不得发明等级。\n5. 输出数组必须分别对应可观察事实、掌握证据、未验证主题和建议。\n6. 完成后调用 __graph_complete__。\n\n总结类型：${String(input.summaryKind ?? "final")}\n有效难度目录：${JSON.stringify(input.difficultyCatalog)}\nSessionEvidence：${JSON.stringify(input.evidence)}`,
      });
      return complete(result as never);
    },
  });

  const summarizeSession = defineGraph({
    id: "study_summarize_session",
    version: "1",
    goal: "形成一次学习会话的学习情况总结",
    input: SummarizeSessionInput,
    output: summaryOutputSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(SummarizeSessionInput, "summarize_session")],
    stages: {
      summarize_session: { node: summaryNode, route: finishWithResult("summarize_session") },
    },
  });

  const learningProfileNode = codeNode({
    identity: { name: "update_learning_profile" },
    subGoal: "根据用户选中的学习记录更新长期学习画像候选",
    tools: [],
    input: UpdateLearningProfileInput,
    output: learningProfileOutputSchema,
    async execute({ input, complete, runAgent }) {
      const result = await runValidatedAgent({
        runAgent,
        output: learningProfileOutputSchema,
        validate: validateLearningProfileResult,
        prompt: `根据代码提供的 LearningProfileEvidence 生成中文长期学习画像候选。

规则：
1. 只使用 existing_profile、selected_batches 及其中的 summary_excerpt/session_evidence，不读取或猜测原始回答。
2. strengths 只能来自 mastery_evidence；unverified_topics 表示尚未获得掌握证据，不能自动等同于 weak_points。
3. weak_points 只能保留 existing_profile 已有项，或由多个已选会话中的重复订正/重复未验证证据支持；单次放弃不能直接定性为薄弱。
4. profile_summary 概括累计画像，不写心理、性格、信心、习惯或长期能力猜测。
5. recommendations 必须具体但保守，优先使用 evidence 中已经出现的范围、目标、知识点和有效难度。
6. 不要计算累计题数、正确数或正确率，这些字段由代码确定。
7. 完成后调用 __graph_complete__，严格提交五个字段。

LearningProfileEvidence：${JSON.stringify(input.evidence)}`,
      });
      return complete(result as never);
    },
  });

  const updateLearningProfile = defineGraph({
    id: "study_update_learning_profile",
    version: "1",
    goal: "从用户选中的学习记录生成长期学习画像候选",
    input: UpdateLearningProfileInput,
    output: learningProfileOutputSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(UpdateLearningProfileInput, "update_learning_profile")],
    stages: {
      update_learning_profile: { node: learningProfileNode, route: finishWithResult("update_learning_profile") },
    },
  });

  const profileBuildNode = codeNode({
    identity: { name: "build_profile_fragment" },
    subGoal: "从代码提供的 Markdown/txt 批次提取 canonical Profile 语义单元",
    tools: [],
    input: BuildProfileFragmentInput,
    output: profileBuildFragmentSchema,
    async execute({ input, complete, runAgent }) {
      const allowedSourceIds = Array.isArray(input.allowedSourceIds)
        ? input.allowedSourceIds.filter((item): item is string => typeof item === "string")
        : [];
      const result = await runValidatedAgent({
        runAgent,
        output: profileBuildFragmentSchema,
        validate: (value) => validateProfileBuildFragment(value, allowedSourceIds),
        prompt: `你正在从一批用户提供的 Markdown/txt 构建 canonical 学习资料包语义片段。

要求：
1. 只能使用 sources 中的内容，不得自行读取文件、调用工具或引入资料外事实。
2. chapters/sections 按资料本身的主题组织；每个 section 至少提取一个可学习知识点。
3. knowledge point id 使用简短稳定的英文/数字 kebab-case；name 使用资料中的可读名称。
4. markdown 是该小节的自包含学习正文，不包含 frontmatter、来源路径、出题提示或虚构内容。
5. source_ids 只能使用 allowedSourceIds，并准确标记实际依据。
6. question_types 只使用 choice、judgment、short_answer；difficulty_baseline 只使用五档固定等级。
7. 不确定或资料缺失写入 warnings，不要补造。
8. 完成后调用 __graph_complete__，严格提交 schema。

科目：${String(input.subjectName)}
批次：${String(input.batchIndex)} / ${String(input.batchCount)}
allowedSourceIds：${JSON.stringify(allowedSourceIds)}
sources：${JSON.stringify(input.sources)}`,
      });
      return complete(result as never);
    },
  });

  const buildProfileFragment = defineGraph({
    id: "study_build_profile_fragment",
    version: "1",
    goal: "从受控源文件批次提取 canonical Profile 语义片段",
    input: BuildProfileFragmentInput,
    output: profileBuildFragmentSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(BuildProfileFragmentInput, "build_profile_fragment")],
    stages: {
      build_profile_fragment: { node: profileBuildNode, route: finishWithResult("build_profile_fragment") },
    },
  });

  const planProfileRevisionNode = codeNode({
    identity: { name: "plan_profile_revision" },
    subGoal: "根据用户反馈确定 canonical draft 的最小受影响文件集合",
    tools: [],
    input: PlanProfileRevisionInput,
    output: profileRevisionPlanSchema,
    async execute({ input, complete, runAgent }) {
      const existingPaths = Array.isArray(input.existingPaths)
        ? input.existingPaths.filter((item): item is string => typeof item === "string")
        : [];
      const result = await runValidatedAgent({
        runAgent,
        output: profileRevisionPlanSchema,
        validate: (value) => validateProfileRevisionPlan(value, existingPaths),
        prompt: `为一个 canonical 学习资料包 draft 制定最小修订计划。

规则：
1. 只根据用户反馈和代码提供的 catalog/coreFiles 规划，不读取文件或调用工具。
2. 只修改确实受影响的文件；关联的 index、卡片、章节、考点或 source_map 必须同步列入。
3. 不得修改 profile.json、quality_report.md、_user、active 或 archived。
4. update/delete 只能选择 existingPaths；create 只能使用 cards/、chapters/、exam_points/ 下安全的 .md/.json 路径。
5. 反馈含糊或缺少关键内容时，requires_clarification=true、给出一个具体问题并保持 operations 为空。
6. 资料没有证据支持的内容写入 warnings，不要计划虚构内容。
7. operations 最多 12 项；完成后调用 __graph_complete__。

用户反馈：${String(input.feedback)}
Profile：${JSON.stringify(input.profile)}
existingPaths：${JSON.stringify(existingPaths)}
catalog：${JSON.stringify(input.catalog)}
coreFiles：${JSON.stringify(input.coreFiles)}`,
      });
      return complete(result as never);
    },
  });

  const planProfileRevision = defineGraph({
    id: "study_plan_profile_revision",
    version: "1",
    goal: "确定资料包修订的最小影响范围",
    input: PlanProfileRevisionInput,
    output: profileRevisionPlanSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(PlanProfileRevisionInput, "plan_profile_revision")],
    stages: {
      plan_profile_revision: { node: planProfileRevisionNode, route: finishWithResult("plan_profile_revision") },
    },
  });

  const reviseProfileDraftNode = codeNode({
    identity: { name: "revise_profile_draft" },
    subGoal: "在计划白名单内生成 canonical draft 文件补丁",
    tools: [],
    input: ReviseProfileDraftInput,
    output: profileRevisionPatchSchema,
    async execute({ input, complete, runAgent }) {
      const plan = input.plan as ProfileRevisionPlan;
      const result = await runValidatedAgent({
        runAgent,
        output: profileRevisionPatchSchema,
        validate: (value) => validateProfileRevisionPatch(value, plan),
        prompt: `根据已批准的修订计划生成完整文件替换内容。

规则：
1. 只能提交 plan 中列出的 path 和 operation，不得扩大影响范围。
2. update/create 必须给出完整文件 content；delete 不得给出内容。
3. 保留资料中未被反馈否定的事实，不引入 currentFiles 或用户反馈以外的知识。
4. 修改知识点时同步维护计划内的 index、卡片、章节、考点和 source_map。
5. JSON 必须是合法完整 JSON；Markdown 必须保持 canonical frontmatter 和正文结构。
6. 资料不足时写入 unresolved；不要猜测。完成后调用 __graph_complete__。

用户反馈：${String(input.feedback)}
Profile：${JSON.stringify(input.profile)}
plan：${JSON.stringify(plan)}
currentFiles（新文件的 content 为 null）：${JSON.stringify(input.currentFiles)}`,
      });
      return complete(result as never);
    },
  });

  const reviseProfileDraft = defineGraph({
    id: "study_revise_profile_draft",
    version: "1",
    goal: "在受控影响范围内修订 canonical draft",
    input: ReviseProfileDraftInput,
    output: profileRevisionPatchSchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(ReviseProfileDraftInput, "revise_profile_draft")],
    stages: {
      revise_profile_draft: { node: reviseProfileDraftNode, route: finishWithResult("revise_profile_draft") },
    },
  });

  const reviewProfileDraftNode = codeNode({
    identity: { name: "review_profile_draft" },
    subGoal: "独立审查修订后的 draft 并生成质量报告",
    tools: [],
    input: ReviewProfileDraftInput,
    output: profileRevisionQualitySchema,
    async execute({ input, complete, runAgent }) {
      const result = await runValidatedAgent({
        runAgent,
        output: profileRevisionQualitySchema,
        validate: validateProfileRevisionQuality,
        prompt: `独立审查刚完成修订的 canonical Profile draft。

规则：
1. 代码给出的 structureInspection.blockingIssues 必须原样计入 blocking_issues，不得降低级别。
2. 检查用户反馈是否在 changedFiles 中得到满足，关联文件是否语义一致。
3. 不使用 snapshot 以外的事实，不声称检查了未提供的文件正文。
4. report_markdown 必须包含整体评估、结构指标、严重问题、待改进项、修订摘要和明确启用建议。
5. blocking_issues 非空时 recommendation 必须为 revise；无阻塞项时可以建议 enable。
6. 完成后调用 __graph_complete__。

用户反馈：${String(input.feedback)}
修订计划：${JSON.stringify(input.plan)}
补丁摘要：${JSON.stringify(input.patchSummary)}
structureInspection：${JSON.stringify(input.structureInspection)}
coreFiles：${JSON.stringify(input.coreFiles)}
changedFiles：${JSON.stringify(input.changedFiles)}`,
      });
      return complete(result as never);
    },
  });

  const reviewProfileDraft = defineGraph({
    id: "study_review_profile_draft",
    version: "1",
    goal: "形成修订 draft 的独立质量结论",
    input: ReviewProfileDraftInput,
    output: profileRevisionQualitySchema,
    context: { background: { select: "none" } },
    entries: [mainEntry(ReviewProfileDraftInput, "review_profile_draft")],
    stages: {
      review_profile_draft: { node: reviewProfileDraftNode, route: finishWithResult("review_profile_draft") },
    },
  });

  return {
    generateQuestion,
    gradeAnswer,
    discussQuestion,
    summarizeSession,
    updateLearningProfile,
    buildProfileFragment,
    planProfileRevision,
    reviseProfileDraft,
    reviewProfileDraft,
  };
}

export function asReviewQuestion(result: Record<string, unknown>): ReviewQuestion & { question_id: string } {
  const validation = validateQuestionResult(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ReviewQuestion & { question_id: string };
}

export function asGradeResult(result: Record<string, unknown>): GradeResult {
  const validation = validateGradeResult(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as GradeResult;
}

export function asLearningProfileCandidate(result: Record<string, unknown>): LearningProfileCandidate {
  const validation = validateLearningProfileResult(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as LearningProfileCandidate;
}

export function asProfileBuildFragment(result: Record<string, unknown>, allowedSourceIds: readonly string[]): ProfileBuildFragment {
  const validation = validateProfileBuildFragment(result, allowedSourceIds);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileBuildFragment;
}

export function asProfileRevisionPlan(result: Record<string, unknown>, existingPaths: readonly string[]): ProfileRevisionPlan {
  const validation = validateProfileRevisionPlan(result, existingPaths);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileRevisionPlan;
}

export function asProfileRevisionPatch(result: Record<string, unknown>, plan: ProfileRevisionPlan): ProfileRevisionPatch {
  const validation = validateProfileRevisionPatch(result, plan);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileRevisionPatch;
}

export function asProfileRevisionQuality(result: Record<string, unknown>): ProfileRevisionQualityReview {
  const validation = validateProfileRevisionQuality(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileRevisionQualityReview;
}

export function difficultyFrom(value: string): DifficultyLevel {
  const allowed = new Set<DifficultyLevel>(DIFFICULTY_LEVELS as readonly DifficultyLevel[]);
  if (!allowed.has(value as DifficultyLevel)) throw new Error(`Unsupported difficulty: ${value}`);
  return value as DifficultyLevel;
}
