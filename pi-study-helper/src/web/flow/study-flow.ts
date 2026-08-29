import type { PathNodeSafeView } from "../../contracts/index.js";

/**
 * 全站学习动线的唯一事实来源。
 *
 * 页面只声明「我是哪个环节」，不再各自拼流程、也不再自己判断环节状态。
 *
 * 动线形状：准备 → 诊断 → 分析 →〔学习 ⇄ 测试〕× N → 总结
 * 其中学习与测试构成循环体，N 由路径引擎运行时决定。
 */

export type StudyStepId = "prepare" | "diagnostic" | "analysis" | "lesson" | "activity" | "summary";

/**
 * 环节状态。「跳过」有两个值，不是笔误：
 * - skipped：整节跳过，没有遗留活动，计入进度。
 * - teaching-skipped：只跳过教材正文，最终综合实操仍必做，不计入进度。
 *
 * 后端用「带诊断跳过标记但节点状态不是 skipped」表达后者。两者语义不同，
 * 合并会让用户以为整节已经结束，实际还有没做的实操。
 */
export type LessonStatus = "completed" | "current" | "locked" | "skipped" | "teaching-skipped";

export const DIAGNOSTIC_SKIP_REASON = "diagnostic_skip_selected";

/** 动线模块只需要节点的这几个字段，因此用结构类型而不是具体视图类型。 */
export interface FlowPathNode {
  nodeId: string;
  knowledgePointId: string;
  status: PathNodeSafeView["status"];
  reasonCodes: readonly string[];
}

export interface FlowContext {
  /** 服务端认定的当前节点。来自 next-step 的 currentNodeId，比节点自身状态更权威。 */
  activeNodeId?: string;
  /**
   * 绑定了教材正文的节点集合。不在这个集合里的节点没有正文可读，
   * 会被归到循环体之前的「准备」环节。
   *
   * 刻意不认具体知识点 id —— 后端不保证那个辅助节点一定出现、一定排第一、
   * 且是唯一一个。按章节学习时路径是子集，它可能压根不在。
   */
  materialNodeIds?: ReadonlySet<string>;
  /** 当前是否有已确认的路径。 */
  hasPath?: boolean;
  /** 会话是否已产生总结。 */
  hasSummary?: boolean;
  /** 当前环节是否挂着一个可做的活动。 */
  hasActivity?: boolean;
  /** 会话是否已完成诊断。 */
  hasDiagnostic?: boolean;
  /**
   * 当前所在环节。给了就以它为准；没给则由 buildStudyFlow 取第一个未完成的
   * 环节兜底，避免整条动线全是「尚未解锁」。
   */
  currentStep?: StudyStepId;
}

export interface StudyStep {
  id: StudyStepId;
  /** 学习与测试属于循环体，在步骤条中折叠为一项。 */
  inCycle: boolean;
}

export interface LessonCycle {
  /** 第几节，从 1 起。 */
  index: number;
  /** 共几节，排除没有教材正文的节点。 */
  total: number;
  nodeId: string;
  knowledgePointId: string;
  status: LessonStatus;
}

/**
 * 环节顺序。准备环节是否渲染由运行时数据决定。
 *
 * 刻意不带中文名——环节文案归语义层所有，这里只描述动线形状。
 */
export const STUDY_STEPS: readonly StudyStep[] = [
  { id: "prepare", inCycle: false },
  { id: "diagnostic", inCycle: false },
  { id: "analysis", inCycle: false },
  { id: "lesson", inCycle: true },
  { id: "activity", inCycle: true },
  { id: "summary", inCycle: false },
];

/**
 * 顺序投影：诊断跳过后，路径引擎可能把多个独立节点标为 available，
 * 但学习者侧的路径仍按顺序走，所以只有第一个未完成节点可以宣称「可以开始」。
 *
 * 这个函数从 PathPage 搬迁而来，行为未改动——它已经解决了步骤条要解决的核心
 * 问题，重写一份只会让两份实现漂移。
 */
export function projectSequentialPathNodes<T extends FlowPathNode>(nodes: readonly T[]): T[] {
  let startableClaimed = false;
  let blockedByPrerequisite = false;
  return nodes.map((node) => {
    if (node.status === "skipped" || node.status === "completed") return node;
    if (node.status === "in_progress") {
      blockedByPrerequisite = true;
      return node;
    }
    if (node.status === "locked") {
      blockedByPrerequisite = true;
      return node;
    }
    if (node.status === "available" && !startableClaimed && !blockedByPrerequisite) {
      startableClaimed = true;
      return node;
    }
    return { ...node, status: "locked" as const };
  });
}

function hasDiagnosticSkip(node: FlowPathNode): boolean {
  return node.reasonCodes.includes(DIAGNOSTIC_SKIP_REASON);
}

/** 该节点是否属于「准备」环节——没有教材正文可读。 */
export function isPrepareNode(node: FlowPathNode, context: FlowContext | undefined): boolean {
  const materialNodeIds = context?.materialNodeIds;
  if (materialNodeIds === undefined) return false;
  return !materialNodeIds.has(node.nodeId);
}

/**
 * 计算循环体进度。
 *
 * 总数运行时读取并排除没有教材正文的节点，界面上不允许出现写死的节数。
 */
export function lessonProgress(
  nodes: readonly FlowPathNode[],
  context?: FlowContext,
): LessonCycle[] {
  const projected = projectSequentialPathNodes(nodes);
  const lessonNodes = projected.filter((node) => !isPrepareNode(node, context));
  const total = lessonNodes.length;

  // 当前节位置：
  // - 如果调用方显式给了 activeNodeId，用它所在位置；
  // - 否则取第一个不是已完成/已跳过的节点。
  // 它之前的节在学习者视角里都已经走过，应显示为已完成。
  const activeIndex = lessonNodes.findIndex((node) => node.nodeId === context?.activeNodeId);
  const currentPos = activeIndex >= 0
    ? activeIndex
    : lessonNodes.findIndex((node) => node.status !== "completed" && node.status !== "skipped");

  return lessonNodes.map((node, position) => ({
    index: position + 1,
    total,
    nodeId: node.nodeId,
    knowledgePointId: node.knowledgePointId,
    status: lessonStatusOf(node, context, position, currentPos),
  }));
}

function lessonStatusOf(
  node: FlowPathNode,
  context: FlowContext | undefined,
  position: number,
  currentPos: number,
): LessonStatus {
  if (node.nodeId === context?.activeNodeId) return "current";
  if (node.status === "completed") return "completed";
  // 带诊断跳过标记但状态不是 skipped —— 教学跳过，实操保留。
  if (hasDiagnosticSkip(node) && node.status !== "skipped") return "teaching-skipped";
  if (node.status === "skipped") return "skipped";
  if (node.status === "in_progress") return "current";
  /*
   * 前沿节：它是第一个未完成的节。
   * 即使后端暂时把它标成 locked（常见：刚进活动页、还没回写状态），
   * 也要显示成「进行中」，否则整片节次会全变成格栅，让人以为没走过。
   */
  if (currentPos === position) return "current";
  // 真被锁住的节不会因为排在前面就变成已完成——学习者没走过它。
  if (node.status === "locked") return "locked";
  // 后端仍标为 available，但已经排在当前节前面 —— 学习者已经走过。
  if (currentPos >= 0 && position < currentPos) return "completed";
  // 全部完成，没有当前节。
  if (currentPos === -1) return "completed";
  return "locked";
}

/** 已完成、已跳过的节数。teaching-skipped 不算完成。 */
export function completedLessonCount(cycles: readonly LessonCycle[]): number {
  return cycles.filter((cycle) => cycle.status === "completed" || cycle.status === "skipped").length;
}

/** 还有必做实操没做的节（跳过教学但保留实操）。 */
export function pendingPracticalCount(cycles: readonly LessonCycle[]): number {
  return cycles.filter((cycle) => cycle.status === "teaching-skipped").length;
}

/**
 * 某个环节现在能不能进。返回 false 的步骤条置灰且不可点击，
 * 这是「导航可点但会冲突」的直接修复。
 */
export function canEnter(step: StudyStepId, context: FlowContext): boolean {
  switch (step) {
    case "prepare":
      return true;
    case "diagnostic":
      return true;
    case "analysis":
      return context.hasPath === true;
    case "lesson":
      return context.hasPath === true;
    case "activity":
      return context.hasPath === true && context.hasActivity === true;
    case "summary":
      return context.hasSummary === true;
    default:
      return false;
  }
}

/**
 * 从会话快照推导动线上下文。
 *
 * 页面只需把 bootstrap 里的 session 原样传进来，不需要各自判断
 * 「有没有路径」「诊断做没做」这类问题。
 */
export interface FlowSessionSnapshot {
  path?: { status?: string; nodes?: readonly FlowPathNode[] };
  knowledgeStates?: readonly { knowledgePointId?: string }[];
  /** 已绑定教材正文的节点。它的补集就是「准备」环节。 */
  learningCards?: readonly { nodeId?: string }[];
  completedSummary?: unknown;
}

const ACTIVE_PATH_STATUSES: readonly string[] = ["active", "confirmed", "completed"];

/**
 * 哪些节点有教材正文可读。
 *
 * 判定依据是「会话有没有给它绑定教材」，不认任何知识点 id——后端不保证
 * 辅助节点一定出现、一定排第一、且是唯一一个。
 *
 * 只有排在最前且没绑定教材的节点才算「准备」：这样即使后面还有节点尚未
 * 绑定教材，也不会被误判成准备环节。
 */
export function materialNodeIdsOf(
  nodes: readonly FlowPathNode[],
  learningCards: readonly { nodeId?: string }[],
): Set<string> {
  const bound = new Set(learningCards.map((card) => card.nodeId));
  return new Set(
    nodes
      .filter((node, index) => bound.has(node.nodeId) || index > 0)
      .map((node) => node.nodeId),
  );
}

export interface FlowContextInput {
  currentStep?: StudyStepId;
  activeNodeId?: string;
  /** 当前是否挂着一个可做的活动。AppShell 由路由推断，页面可给准确值。 */
  hasActivity?: boolean;
}

export function buildFlowContext(
  session: FlowSessionSnapshot | undefined,
  input: FlowContextInput = {},
): FlowContext {
  const nodes = session?.path?.nodes ?? [];
  const context: FlowContext = {
    materialNodeIds: materialNodeIdsOf(nodes, session?.learningCards ?? []),
    hasPath: session?.path !== undefined
      && ACTIVE_PATH_STATUSES.includes(session.path.status ?? ""),
    hasSummary: session?.completedSummary !== undefined,
    hasDiagnostic: (session?.knowledgeStates ?? []).length > 0,
    hasActivity: input.hasActivity === true,
  };
  if (input.activeNodeId !== undefined) context.activeNodeId = input.activeNodeId;
  if (input.currentStep !== undefined) context.currentStep = input.currentStep;
  return context;
}

/**
 * 环节层面只有三态。五态是「节」的状态，不是「环节」的状态——
 * 把两者混在一起就会造出「本环节已跳过」这种不存在的说法。
 */
export type StepStatus = "completed" | "current" | "locked";

export interface StudyFlowStep {
  id: StudyStepId;
  status: StepStatus;
  /** 现在能不能点进去。false 的步骤条置灰且不可点。 */
  enterable: boolean;
}

export interface StudyFlowView {
  steps: readonly StudyFlowStep[];
  /** 循环体逐节状态，五态。 */
  cycles: readonly LessonCycle[];
  completedLessons: number;
  totalLessons: number;
  /** 跳过教学但仍有必做实操的节数。不为 0 时必须提示用户。 */
  pendingPractical: number;
  /** 「准备」环节的节点 id。没有则准备环节不渲染。 */
  prepareNodeId?: string;
}

function cycleStatus(cycles: readonly LessonCycle[], context: FlowContext): StepStatus {
  if (context.hasPath !== true) return "locked";
  if (context.currentStep === "lesson" || context.currentStep === "activity") return "current";
  const done = completedLessonCount(cycles);
  // 还有跳过教学但保留实操的节 —— 循环体没走完，不能显示成已完成。
  if (done >= cycles.length && pendingPracticalCount(cycles) === 0) return "completed";
  return "current";
}

function rawStatusOf(step: StudyStepId, context: FlowContext, cycles: readonly LessonCycle[]): StepStatus {
  switch (step) {
    case "prepare":
      return context.hasPath === true ? "completed" : "locked";
    case "diagnostic":
      return context.hasDiagnostic === true ? "completed" : "locked";
    case "analysis":
      return context.hasPath === true ? "completed" : "locked";
    case "lesson":
    case "activity":
      return cycleStatus(cycles, context);
    case "summary":
      return context.hasSummary === true ? "completed" : "locked";
    default:
      return "locked";
  }
}

/**
 * 把路径节点与会话状态投影成步骤条可以直接渲染的结构。
 *
 * 循环体（学习 ⇄ 测试）在这里合并成一项，逐节状态仍完整保留在 cycles 里，
 * 由步骤条展开后展示。
 */
export function buildStudyFlow(
  nodes: readonly FlowPathNode[],
  context: FlowContext = {},
): StudyFlowView {
  const cycles = lessonProgress(nodes, context);
  const prepareNode = nodes.find((node) => isPrepareNode(node, context));

  // 循环体的两个环节共用一个状态，步骤条里只渲染「学习」这一项。
  const visibleSteps = STUDY_STEPS.filter((step) => {
    if (step.id === "activity") return false;
    if (step.id === "prepare") return prepareNode !== undefined;
    return true;
  });

  const drafted = visibleSteps.map((step) => ({
    id: step.id,
    status: rawStatusOf(step.id, context, cycles),
  }));

  // 页面声明了当前环节就以页面为准——它可能比节点状态更新，
  // 也可能刚做完一步还没回写。「活动」属于循环体，归到「学习」这一项上。
  const declared = context.currentStep === "activity" ? "lesson" : context.currentStep;
  const declaredTarget = declared === undefined
    ? undefined
    : drafted.find((step) => step.id === declared);

  if (declaredTarget !== undefined
    && declaredTarget.status !== "completed"
    && declaredTarget.status !== "locked") {
    // 页面声明自己在某个环节，且该环节确实还能被当作「进行中」。
    // 已完成/已锁定的环节不往回标，避免用户通过回退产生两个 current。
    declaredTarget.status = "current";
  } else {
    // 页面没声明时，取第一个未完成的环节兜底，避免整条动线全是「尚未解锁」。
    const firstOpen = drafted.find((step) => step.status !== "completed");
    if (firstOpen !== undefined) firstOpen.status = "current";
  }

  return {
    steps: drafted.map((step) => ({
      id: step.id,
      status: step.status,
      enterable: canEnter(step.id, context),
    })),
    cycles,
    completedLessons: completedLessonCount(cycles),
    totalLessons: cycles.length,
    pendingPractical: pendingPracticalCount(cycles),
    ...(prepareNode === undefined ? {} : { prepareNodeId: prepareNode.nodeId }),
  };
}
