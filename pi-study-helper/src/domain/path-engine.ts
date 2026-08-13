import { createHash } from "node:crypto";
import type {
  ActivityReferenceDefinition,
  Difficulty,
  KnowledgePointDefinition,
  KnowledgeState,
  LearningGoalDefinition,
} from "./v2-types.js";
import type { ScaffoldLevel } from "../contracts/domain.js";
export type { ScaffoldLevel } from "../contracts/domain.js";

export type PathMode = "chapter" | "recommended";
export type PathStatus = "draft" | "confirmed" | "superseded";
export type PathNodeStatus = "locked" | "available" | "in_progress" | "completed" | "skipped";
export type PathReasonCode =
  | "prerequisite_gap"
  | "low_mastery"
  | "goal_required"
  | "review_due"
  | "user_selected"
  | "error_remediation"
  | "time_compressed"
  | "evidence_insufficient";

export interface PathActivityDefinition extends ActivityReferenceDefinition {
  title?: string;
  prompt?: string;
  difficulty?: Difficulty;
  estimatedMinutes?: number;
  allowedScaffolds?: ScaffoldLevel[];
  kind?: "mcq" | "code_completion" | "coding_practical" | "explain" | "debug";
  starterCode?: string;
  profileRevision?: number;
}

export interface PathEngineProfile {
  subjectId?: string;
  profileRevision: number;
  goals: LearningGoalDefinition[];
  knowledgePoints: KnowledgePointDefinition[];
  activities: PathActivityDefinition[];
}

export interface LearningPathNode {
  nodeId: string;
  knowledgePointId: string;
  activityIds: string[];
  status: PathNodeStatus;
  positionLocked: boolean;
  required: boolean;
  difficulty: Difficulty;
  scaffold: ScaffoldLevel;
  estimatedMinutes: number;
  reasonCodes: PathReasonCode[];
}

export interface LearningPath {
  pathId: string;
  sessionId: string;
  profileRevision: number;
  evidenceVersion: number;
  pathVersion: number;
  engineVersion: "path-engine-v1";
  status: PathStatus;
  mode: PathMode;
  goalId: string;
  availableMinutes: number;
  estimatedMinutes: number;
  nodes: LearningPathNode[];
  positionLockedNodeIds: string[];
  changeReasons: PathReasonCode[];
  createdAt: string;
}

export interface PathFailure {
  code: "path_infeasible";
  missingPrerequisiteIds: string[];
  minimumRequiredMinutes: number;
  suggestions: Array<"increase_time" | "change_goal" | "run_probe">;
}

export type PathBuildResult =
  | { status: "ok"; path: LearningPath }
  | { status: "infeasible"; failure: PathFailure };

export interface PathEngineInput {
  sessionId: string;
  profileRevision: number;
  evidenceVersion: number;
  goalId: string;
  mode: PathMode;
  chapterId?: string;
  availableMinutes: number;
  selectedKnowledgePointIds: string[];
  lockedNodeIds: string[];
  knowledgeStates: KnowledgeState[];
  pathVersion?: number;
  createdAt?: string;
}

export interface PathEngineReplanInput extends PathEngineInput {
  previousPath: LearningPath;
  trigger: "knowledge_state_changed" | "skip_eligibility_changed" | "error_remediation" | "user_constraint_changed";
}

export class PathEngineError extends Error {
  constructor(readonly errorCode: "invalid_profile" | "path_infeasible", message: string) {
    super(message);
    this.name = "PathEngineError";
  }
}

const DIFFICULTIES: readonly Difficulty[] = ["S-R", "S-U", "M-U", "M-A", "C-A"];
const SCAFFOLDS: readonly ScaffoldLevel[] = ["none", "hint", "worked_example"];

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 24);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new PathEngineError("path_infeasible", `${label} must be a positive integer`);
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function isLowMastery(state: KnowledgeState | undefined): boolean {
  return state?.mastery !== null && state?.mastery !== undefined && state.mastery < 0.6;
}

function canSkip(_point: KnowledgePointDefinition, state: KnowledgeState | undefined): boolean {
  // KnowledgeState 聚合器是 skipEligible 的唯一权威来源。PathEngine 不得
  // 根据 mastery、confidence 或代码证据字段再次推导跳过资格。
  return state?.skipEligible === true;
}

function difficultyRange(state: KnowledgeState | undefined): readonly [number, number] {
  switch (state?.status) {
    case "support_needed": return [0, 1];
    case "learning": return [1, 2];
    case "ready": return [2, 3];
    case "mastered": return [3, 4];
    default: return [0, 1];
  }
}

function scaffoldPreference(state: KnowledgeState | undefined): readonly ScaffoldLevel[] {
  switch (state?.status) {
    case "support_needed": return ["worked_example", "hint", "none"];
    case "learning": return ["hint", "worked_example", "none"];
    case "ready":
    case "mastered": return ["none", "hint", "worked_example"];
    default: return ["worked_example", "hint", "none"];
  }
}

function activityMinutes(activity: PathActivityDefinition): number {
  return Number.isInteger(activity.estimatedMinutes) && (activity.estimatedMinutes as number) > 0
    ? activity.estimatedMinutes as number
    : 10;
}

function contentMinutes(point: KnowledgePointDefinition): number {
  return Number.isInteger(point.contentEstimatedMinutes) && (point.contentEstimatedMinutes as number) > 0
    ? point.contentEstimatedMinutes as number
    : 0;
}

function activityDifficulty(activity: PathActivityDefinition): Difficulty {
  return activity.difficulty && DIFFICULTIES.includes(activity.difficulty) ? activity.difficulty : "S-U";
}

function addReasons(target: PathReasonCode[], ...reasons: PathReasonCode[]): void {
  for (const reason of reasons) if (!target.includes(reason)) target.push(reason);
}

export class PathEngine {
  constructor(readonly profile: PathEngineProfile) {
    if (!Number.isInteger(profile.profileRevision) || profile.profileRevision < 1) {
      throw new PathEngineError("invalid_profile", "profileRevision must be a positive integer");
    }
    const pointIds = new Set<string>();
    for (const point of profile.knowledgePoints) {
      if (pointIds.has(point.id)) throw new PathEngineError("invalid_profile", `Duplicate knowledge point: ${point.id}`);
      pointIds.add(point.id);
    }
    const activityIds = new Set<string>();
    for (const activity of profile.activities) {
      if (activityIds.has(activity.activityId)) throw new PathEngineError("invalid_profile", `Duplicate activity: ${activity.activityId}`);
      activityIds.add(activity.activityId);
    }
    const goalIds = new Set<string>();
    for (const goal of profile.goals) {
      if (goalIds.has(goal.goalId)) throw new PathEngineError("invalid_profile", `Duplicate goal: ${goal.goalId}`);
      goalIds.add(goal.goalId);
      for (const pointId of goal.targetKnowledgePointIds) {
        if (!pointIds.has(pointId)) throw new PathEngineError("invalid_profile", `Goal ${goal.goalId} references missing point: ${pointId}`);
      }
      for (const activityId of goal.requiredActivityIds) {
        if (!activityIds.has(activityId)) throw new PathEngineError("invalid_profile", `Goal ${goal.goalId} references missing activity: ${activityId}`);
      }
      if (goal.finalActivityId !== undefined && !activityIds.has(goal.finalActivityId)) {
        throw new PathEngineError("invalid_profile", `Goal ${goal.goalId} references missing final activity: ${goal.finalActivityId}`);
      }
    }
    for (const point of profile.knowledgePoints) {
      for (const prerequisite of point.prerequisiteIds) {
        if (!pointIds.has(prerequisite)) throw new PathEngineError("invalid_profile", `Point ${point.id} references missing prerequisite: ${prerequisite}`);
      }
      for (const activityId of point.activityIds) {
        if (!activityIds.has(activityId)) throw new PathEngineError("invalid_profile", `Point ${point.id} references missing activity: ${activityId}`);
      }
    }
    for (const activity of profile.activities) {
      if (!pointIds.has(activity.primaryKnowledgePointId)) {
        throw new PathEngineError("invalid_profile", `Activity ${activity.activityId} references missing primary point`);
      }
      if (activity.supportingKnowledgePointIds.includes(activity.primaryKnowledgePointId)) {
        throw new PathEngineError("invalid_profile", `Activity ${activity.activityId} repeats its primary point as supporting point`);
      }
      for (const pointId of [...activity.supportingKnowledgePointIds]) {
        if (!pointIds.has(pointId)) throw new PathEngineError("invalid_profile", `Activity ${activity.activityId} references missing supporting point: ${pointId}`);
      }
      for (const goalId of activity.goalIds) {
        if (!goalIds.has(goalId)) throw new PathEngineError("invalid_profile", `Activity ${activity.activityId} references missing goal: ${goalId}`);
      }
    }
    this.assertAcyclicProfilePrerequisites();
  }

  private assertAcyclicProfilePrerequisites(): void {
    const points = new Map(this.profile.knowledgePoints.map((point) => [point.id, point]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new PathEngineError("invalid_profile", `Prerequisite cycle at ${id}`);
      visiting.add(id);
      for (const prerequisite of points.get(id)?.prerequisiteIds ?? []) visit(prerequisite);
      visiting.delete(id);
      visited.add(id);
    };
    for (const point of this.profile.knowledgePoints) visit(point.id);
  }

  build(input: PathEngineInput): PathBuildResult {
    return this.buildInternal(input, new Set());
  }

  replan(input: PathEngineReplanInput): PathBuildResult {
    const completedIds = new Set(input.previousPath.nodes.filter((node) => node.status === "completed").map((node) => node.knowledgePointId));
    const result = this.buildInternal({ ...input, pathVersion: input.previousPath.pathVersion + 1 }, completedIds);
    if (result.status === "infeasible") return result;
    const fixed = new Map<string, { index: number; node: LearningPathNode }>();
    input.previousPath.nodes.forEach((node, index) => {
      if (node.status === "completed" || node.status === "in_progress" || node.positionLocked || input.lockedNodeIds.includes(node.nodeId)) {
        fixed.set(node.nodeId, { index, node: structuredClone(node) });
      }
    });
    const mutable = result.path.nodes.filter((node) => !fixed.has(node.nodeId));
    const merged: Array<LearningPathNode | undefined> = [];
    for (const item of fixed.values()) merged[item.index] = item.node;
    let cursor = 0;
    for (let index = 0; index < Math.max(merged.length, result.path.nodes.length); index += 1) {
      if (merged[index] !== undefined) continue;
      const next = mutable[cursor++];
      if (next) merged[index] = next;
    }
    for (; cursor < mutable.length; cursor += 1) merged.push(mutable[cursor]);
    result.path.nodes = merged.filter((node): node is LearningPathNode => node !== undefined);
    result.path.estimatedMinutes = result.path.nodes.filter((node) => node.status !== "skipped")
      .reduce((total, node) => total + node.estimatedMinutes, 0);
    result.path.positionLockedNodeIds = result.path.nodes.filter((node) => node.positionLocked).map((node) => node.nodeId);
    const finalFailure = this.validateReplannedPath(result.path, input, fixed);
    if (finalFailure !== undefined) return { status: "infeasible", failure: finalFailure };
    result.path.changeReasons = this.changeReasons(input.previousPath, result.path, input);
    return result;
  }

  private buildInternal(input: PathEngineInput, completedIds: ReadonlySet<string>): PathBuildResult {
    this.validateInput(input);
    const goal = this.profile.goals.find((item) => item.goalId === input.goalId);
    if (!goal) throw new PathEngineError("invalid_profile", `Unknown goal: ${input.goalId}`);
    const points = new Map(this.profile.knowledgePoints.map((point) => [point.id, point]));
    const activities = new Map(this.profile.activities.map((activity) => [activity.activityId, activity]));
    const requiredActivityIds = this.requiredActivityIds(goal);
    const targetIds = new Set(goal.targetKnowledgePointIds);
    for (const activityId of requiredActivityIds) targetIds.add(activities.get(activityId)!.primaryKnowledgePointId);
    const closure = this.prerequisiteClosure(targetIds, points);
    const selectedIds = new Set(input.selectedKnowledgePointIds);
    const unsupportedSelections = [...selectedIds].filter((id) => !closure.has(id));
    if (unsupportedSelections.length > 0) return this.failure(unsupportedSelections, 0, "change_goal");
    const states = new Map(input.knowledgeStates.map((state) => [state.knowledgePointId, state]));
    const missingPrerequisiteIds = [...closure].filter((id) => !targetIds.has(id) && !this.isPrerequisiteSatisfied(id, states, points, completedIds));
    const orderedIds = this.stableTopologicalOrder([...closure], points, targetIds, new Set(missingPrerequisiteIds));
    const nodes: LearningPathNode[] = [];
    for (const pointId of orderedIds) {
      const point = points.get(pointId)!;
      const state = states.get(pointId);
      const required = targetIds.has(pointId) || selectedIds.has(pointId) || (!canSkip(point, state) && this.isRequiredForTarget(pointId, targetIds, points));
      const pointActivityIds = point.activityIds.filter((id) => activities.has(id));
      const nodeActivities = this.selectNodeActivities(
        pointId,
        pointActivityIds,
        requiredActivityIds,
        activities,
        state,
        targetIds.has(pointId) || selectedIds.has(pointId),
      );
      if (nodeActivities.length === 0) throw new PathEngineError("invalid_profile", `Knowledge point ${pointId} has no usable activity`);
      const reasons: PathReasonCode[] = [];
      if (required) addReasons(reasons, "goal_required");
      if (missingPrerequisiteIds.includes(pointId)) addReasons(reasons, "prerequisite_gap");
      if (isLowMastery(state)) addReasons(reasons, "low_mastery");
      if (!state || state.status === "unverified") addReasons(reasons, "evidence_insufficient");
      if (selectedIds.has(pointId)) addReasons(reasons, "user_selected");
      const skipped = !required && canSkip(point, state);
      const status: PathNodeStatus = skipped ? "skipped" : completedIds.has(pointId) ? "completed" : this.initialStatus(point, closure, states, points, completedIds);
      nodes.push({
        nodeId: `node-${pointId}`, knowledgePointId: pointId,
        activityIds: nodeActivities.map((activity) => activity.activityId), status,
        positionLocked: input.lockedNodeIds.includes(`node-${pointId}`) || input.lockedNodeIds.includes(pointId),
        required, difficulty: nodeActivities.map(activityDifficulty).sort((left, right) => DIFFICULTIES.indexOf(right) - DIFFICULTIES.indexOf(left))[0]!,
        scaffold: this.chooseNodeScaffold(nodeActivities, state),
        estimatedMinutes: contentMinutes(point) + nodeActivities.reduce((total, activity) => total + activityMinutes(activity), 0), reasonCodes: reasons,
      });
    }
    let estimatedMinutes = nodes.filter((node) => node.status !== "skipped").reduce((total, node) => total + node.estimatedMinutes, 0);
    if (estimatedMinutes > input.availableMinutes) {
      // 只压缩真实 Profile 活动中、且不属于 required/final 的可选活动。
      // 节点本身仍保留；必做节点、最终活动和不可跳过先修不可删除。
      const mandatoryActivityIds = new Set(requiredActivityIds);
      const optionalNodes = nodes.filter((node) => node.status !== "skipped" && node.required
          && this.profile.knowledgePoints.find((point) => point.id === node.knowledgePointId)?.activityPolicy !== "all_in_order")
        .map((node) => ({ node, optionalIds: node.activityIds.filter((id) => !mandatoryActivityIds.has(id)) }))
        .filter((item) => item.optionalIds.length > 0)
        .reverse();
      for (const { node, optionalIds } of optionalNodes) {
        const retained = node.activityIds.filter((id) => !optionalIds.includes(id));
        if (retained.length === 0) continue;
        const selected = retained.map((id) => activities.get(id)).filter((activity): activity is PathActivityDefinition => activity !== undefined);
        const before = node.estimatedMinutes;
        node.activityIds = retained;
        node.estimatedMinutes = contentMinutes(this.profile.knowledgePoints.find((point) => point.id === node.knowledgePointId)!)
          + selected.reduce((total, activity) => total + activityMinutes(activity), 0);
        node.difficulty = selected.map(activityDifficulty).sort((left, right) => DIFFICULTIES.indexOf(right) - DIFFICULTIES.indexOf(left))[0]!;
        node.scaffold = this.chooseNodeScaffold(selected, states.get(node.knowledgePointId));
        addReasons(node.reasonCodes, "time_compressed");
        estimatedMinutes -= before - node.estimatedMinutes;
        if (estimatedMinutes <= input.availableMinutes) break;
      }
    }
    if (estimatedMinutes > input.availableMinutes) return this.failure(missingPrerequisiteIds, estimatedMinutes, "increase_time");
    const canonicalInput = { sessionId: input.sessionId, profileRevision: input.profileRevision, evidenceVersion: input.evidenceVersion, goalId: input.goalId, mode: input.mode, chapterId: input.chapterId, availableMinutes: input.availableMinutes, selectedKnowledgePointIds: [...input.selectedKnowledgePointIds].sort(compareIds), lockedNodeIds: [...input.lockedNodeIds].sort(compareIds), knowledgeStates: [...input.knowledgeStates].map((state) => ({ knowledgePointId: state.knowledgePointId, mastery: state.mastery, status: state.status, skipEligible: state.skipEligible, evidenceVersion: state.evidenceVersion })).sort((a, b) => compareIds(a.knowledgePointId, b.knowledgePointId)) };
    return { status: "ok", path: { pathId: `path-${hash(canonicalInput)}`, sessionId: input.sessionId, profileRevision: input.profileRevision, evidenceVersion: input.evidenceVersion, pathVersion: input.pathVersion ?? 1, engineVersion: "path-engine-v1", status: "draft", mode: input.mode, goalId: input.goalId, availableMinutes: input.availableMinutes, estimatedMinutes, nodes, positionLockedNodeIds: nodes.filter((node) => node.positionLocked).map((node) => node.nodeId), changeReasons: [], createdAt: input.createdAt ?? "1970-01-01T00:00:00.000Z" } };
  }

  private validateInput(input: PathEngineInput): void {
    if (!input.sessionId || input.profileRevision !== this.profile.profileRevision) {
      throw new PathEngineError("invalid_profile", "Session or profile revision is invalid");
    }
    assertPositiveInteger(input.availableMinutes, "availableMinutes");
    if (!Number.isInteger(input.evidenceVersion) || input.evidenceVersion < 0) {
      throw new PathEngineError("path_infeasible", "evidenceVersion must be a non-negative integer");
    }
    if (input.mode === "chapter" && (!input.chapterId || !this.profile.knowledgePoints.some((point) => point.chapterId === input.chapterId))) {
      throw new PathEngineError("invalid_profile", "chapterId is not present in the bound Profile");
    }
    const points = new Set(this.profile.knowledgePoints.map((point) => point.id));
    for (const id of [...input.selectedKnowledgePointIds, ...input.lockedNodeIds.map((item) => item.replace(/^node-/u, ""))]) {
      if (!points.has(id)) throw new PathEngineError("invalid_profile", `Unknown knowledge point constraint: ${id}`);
    }
  }

  private prerequisiteClosure(targetIds: Set<string>, points: Map<string, KnowledgePointDefinition>): Set<string> {
    const closure = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (closure.has(id)) return;
      if (visiting.has(id)) throw new PathEngineError("invalid_profile", `Prerequisite cycle at ${id}`);
      const point = points.get(id);
      if (!point) throw new PathEngineError("invalid_profile", `Unknown knowledge point: ${id}`);
      visiting.add(id);
      for (const prerequisite of point.prerequisiteIds) visit(prerequisite);
      visiting.delete(id);
      closure.add(id);
    };
    for (const id of targetIds) visit(id);
    return closure;
  }

  private isRequiredForTarget(id: string, targets: Set<string>, points: Map<string, KnowledgePointDefinition>): boolean {
    for (const target of targets) {
      const seen = new Set<string>();
      const walk = (current: string): boolean => {
        if (current === id) return true;
        if (seen.has(current)) return false;
        seen.add(current);
        return (points.get(current)?.prerequisiteIds ?? []).some(walk);
      };
      if (walk(target)) return true;
    }
    return false;
  }

  private stableTopologicalOrder(
    ids: string[],
    points: Map<string, KnowledgePointDefinition>,
    targets: Set<string>,
    gaps: ReadonlySet<string>,
  ): string[] {
    const declaration = new Map(this.profile.knowledgePoints.map((point, index) => [point.id, index]));
    const remaining = new Set(ids);
    const result: string[] = [];
    while (remaining.size > 0) {
      const ready = [...remaining].filter((id) => (points.get(id)?.prerequisiteIds ?? []).every((prerequisite) => !remaining.has(prerequisite)));
      if (ready.length === 0) throw new PathEngineError("invalid_profile", "Prerequisite graph contains a cycle");
      ready.sort((left, right) => {
        const lp = points.get(left)!;
        const rp = points.get(right)!;
        const targetCompare = Number(targets.has(right)) - Number(targets.has(left));
        if (targetCompare !== 0) return targetCompare;
        const gapCompare = Number(gaps.has(right)) - Number(gaps.has(left));
        if (gapCompare !== 0) return gapCompare;
        const importanceCompare = rp.importance - lp.importance;
        if (importanceCompare !== 0) return importanceCompare;
        return (declaration.get(left) ?? Number.MAX_SAFE_INTEGER) - (declaration.get(right) ?? Number.MAX_SAFE_INTEGER)
          || compareIds(left, right);
      });
      for (const id of ready) {
        remaining.delete(id);
        result.push(id);
      }
    }
    return result;
  }

  private requiredActivityIds(goal: LearningGoalDefinition): string[] {
    const ids = [...goal.requiredActivityIds];
    if (goal.finalActivityId !== undefined && !ids.includes(goal.finalActivityId)) ids.push(goal.finalActivityId);
    return ids;
  }

  private selectNodeActivities(
    pointId: string,
    pointActivityIds: string[],
    requiredActivityIds: string[],
    activities: Map<string, PathActivityDefinition>,
    state: KnowledgeState | undefined,
    allowOptional: boolean,
  ): PathActivityDefinition[] {
    const point = this.profile.knowledgePoints.find((item) => item.id === pointId);
    if (point?.activityPolicy === "all_in_order") {
      const orderedIds = [...pointActivityIds];
      for (const requiredId of requiredActivityIds) {
        const required = activities.get(requiredId);
        if (required?.primaryKnowledgePointId === pointId && !orderedIds.includes(requiredId)) orderedIds.push(requiredId);
      }
      return orderedIds
        .map((id) => activities.get(id))
        .filter((activity): activity is PathActivityDefinition => activity !== undefined);
    }
    const required = requiredActivityIds
      .map((id) => activities.get(id))
      .filter((activity): activity is PathActivityDefinition => activity !== undefined && activity.primaryKnowledgePointId === pointId);
    if (required.length > 0) {
      if (!allowOptional) return required;
      const declaration = new Map(this.profile.activities.map((activity, index) => [activity.activityId, index]));
      const optional = pointActivityIds.map((id) => activities.get(id))
        .filter((activity): activity is PathActivityDefinition => activity !== undefined && !required.some((item) => item.activityId === activity.activityId));
      const [minimum, maximum] = difficultyRange(state);
      const distance = (activity: PathActivityDefinition): number => {
        const rank = DIFFICULTIES.indexOf(activityDifficulty(activity));
        return rank < minimum ? minimum - rank : rank > maximum ? rank - maximum : 0;
      };
      optional.sort((left, right) => distance(left) - distance(right)
        || (declaration.get(left.activityId) ?? Number.MAX_SAFE_INTEGER) - (declaration.get(right.activityId) ?? Number.MAX_SAFE_INTEGER)
        || compareIds(left.activityId, right.activityId));
      return optional[0] === undefined ? required : [...required, optional[0]];
    }
    const declaration = new Map(this.profile.activities.map((activity, index) => [activity.activityId, index]));
    const candidates = pointActivityIds.map((id) => activities.get(id)).filter((activity): activity is PathActivityDefinition => activity !== undefined);
    const [minimum, maximum] = difficultyRange(state);
    const distance = (activity: PathActivityDefinition): number => {
      const rank = DIFFICULTIES.indexOf(activityDifficulty(activity));
      return rank < minimum ? minimum - rank : rank > maximum ? rank - maximum : 0;
    };
    const fallback = candidates.sort((left, right) => distance(left) - distance(right)
      || (declaration.get(left.activityId) ?? Number.MAX_SAFE_INTEGER) - (declaration.get(right.activityId) ?? Number.MAX_SAFE_INTEGER)
      || compareIds(left.activityId, right.activityId))[0];
    return fallback === undefined ? [] : [fallback];
  }

  private chooseNodeScaffold(activities: readonly PathActivityDefinition[], state: KnowledgeState | undefined): ScaffoldLevel {
    const allowedSets = activities.map((activity) => new Set(activity.allowedScaffolds?.filter((item): item is ScaffoldLevel => SCAFFOLDS.includes(item)) ?? ["none"]));
    const common = SCAFFOLDS.filter((level) => allowedSets.every((allowed) => allowed.has(level)));
    if (common.length === 0) throw new PathEngineError("invalid_profile", "Required activities do not share an allowed scaffold");
    return scaffoldPreference(state).find((item) => common.includes(item)) ?? common[0]!;
  }

  private initialStatus(
    point: KnowledgePointDefinition,
    closure: Set<string>,
    states: Map<string, KnowledgeState>,
    points: Map<string, KnowledgePointDefinition>,
    completedIds: ReadonlySet<string>,
  ): PathNodeStatus {
    const blocked = point.prerequisiteIds.some((id) => closure.has(id) && !this.isPrerequisiteSatisfied(id, states, points, completedIds));
    return blocked ? "locked" : "available";
  }

  private isPrerequisiteSatisfied(id: string, states: Map<string, KnowledgeState>, points: Map<string, KnowledgePointDefinition>, completedIds: ReadonlySet<string>): boolean {
    return completedIds.has(id) || canSkip(points.get(id)!, states.get(id));
  }

  private validateReplannedPath(
    path: LearningPath,
    input: PathEngineReplanInput,
    fixed: ReadonlyMap<string, { index: number; node: LearningPathNode }>,
  ): PathFailure | undefined {
    const points = new Map(this.profile.knowledgePoints.map((point) => [point.id, point]));
    const activities = new Map(this.profile.activities.map((activity) => [activity.activityId, activity]));
    const goal = this.profile.goals.find((item) => item.goalId === path.goalId);
    if (goal === undefined) throw new PathEngineError("invalid_profile", `Unknown goal: ${path.goalId}`);
    const required = this.requiredActivityIds(goal);
    const nodeIds = new Set<string>();
    const pointIds = new Set<string>();
    const positions = new Map<string, number>();
    let estimatedMinutes = 0;
    for (const [index, node] of path.nodes.entries()) {
      if (nodeIds.has(node.nodeId) || pointIds.has(node.knowledgePointId)) return this.failureDetails([], path.estimatedMinutes, "change_goal");
      nodeIds.add(node.nodeId);
      pointIds.add(node.knowledgePointId);
      positions.set(node.knowledgePointId, index);
      const point = points.get(node.knowledgePointId);
      if (!point || node.activityIds.length === 0) return this.failureDetails([], path.estimatedMinutes, "change_goal");
      const selected = node.activityIds.map((id) => activities.get(id));
      if (selected.some((activity) => activity === undefined || activity.primaryKnowledgePointId !== node.knowledgePointId)) {
        return this.failureDetails([], path.estimatedMinutes, "change_goal");
      }
      const actualMinutes = contentMinutes(point) + selected.reduce((total, activity) => total + activityMinutes(activity!), 0);
      if (node.estimatedMinutes !== actualMinutes) return this.failureDetails([], path.estimatedMinutes, "change_goal");
      if (node.status !== "skipped") estimatedMinutes += node.estimatedMinutes;
      if (point.prerequisiteIds.some((id) => (positions.get(id) ?? Number.MAX_SAFE_INTEGER) >= index)) {
        return this.failureDetails([], path.estimatedMinutes, "change_goal");
      }
    }
    for (const [nodeId, item] of fixed) {
      const node = path.nodes[item.index];
      if (node?.nodeId !== nodeId || stableJson(node) !== stableJson(item.node)) {
        return this.failureDetails([], path.estimatedMinutes, "change_goal");
      }
    }
    if (required.some((activityId) => !path.nodes.some((node) => node.activityIds.includes(activityId)))) {
      return this.failureDetails([], path.estimatedMinutes, "change_goal");
    }
    const states = new Map(input.knowledgeStates.map((state) => [state.knowledgePointId, state]));
    const completed = new Set(path.nodes.filter((node) => node.status === "completed").map((node) => node.knowledgePointId));
    for (const node of path.nodes) {
      const point = points.get(node.knowledgePointId)!;
      const prerequisitesSatisfied = point.prerequisiteIds.every((id) => this.isPrerequisiteSatisfied(id, states, points, completed));
      if (node.status === "locked" && prerequisitesSatisfied) return this.failureDetails([], path.estimatedMinutes, "change_goal");
      if ((node.status === "available" || node.status === "in_progress") && !prerequisitesSatisfied) {
        return this.failureDetails([], path.estimatedMinutes, "change_goal");
      }
      if (node.status === "skipped" && !canSkip(point, states.get(point.id)) && !completed.has(point.id)) {
        return this.failureDetails([], path.estimatedMinutes, "change_goal");
      }
    }
    if (estimatedMinutes !== path.estimatedMinutes || path.estimatedMinutes > input.availableMinutes) {
      const missing = path.nodes.filter((node) => node.reasonCodes.includes("prerequisite_gap")).map((node) => node.knowledgePointId);
      return this.failureDetails(missing, estimatedMinutes, "increase_time");
    }
    return undefined;
  }

  private changeReasons(previous: LearningPath, next: LearningPath, input: PathEngineReplanInput): PathReasonCode[] {
    const pathChanged = stableJson(previous.nodes) !== stableJson(next.nodes)
      || previous.estimatedMinutes !== next.estimatedMinutes
      || previous.availableMinutes !== next.availableMinutes;
    if (!pathChanged) return [];

    const oldCodes = new Set(previous.nodes.flatMap((node) => node.reasonCodes));
    const newCodes = new Set(next.nodes.flatMap((node) => node.reasonCodes));
    const symmetric = (reason: PathReasonCode): boolean => oldCodes.has(reason) !== newCodes.has(reason);
    const optionalActivityRemoved = previous.nodes.some((oldNode) => {
      const nextNode = next.nodes.find((candidate) => candidate.nodeId === oldNode.nodeId);
      return nextNode !== undefined
        && oldNode.required
        && oldNode.activityIds.some((id) => !nextNode.activityIds.includes(id))
        && nextNode.reasonCodes.includes("time_compressed");
    });
    const actualBudgetCompression = input.availableMinutes < previous.availableMinutes
      && optionalActivityRemoved
      && newCodes.has("time_compressed");
    const prerequisiteAvailabilityChanged = previous.nodes.some((oldNode) => {
      const nextNode = next.nodes.find((candidate) => candidate.nodeId === oldNode.nodeId);
      return nextNode !== undefined && (oldNode.status === "locked") !== (nextNode.status === "locked");
    });
    const reasons: PathReasonCode[] = [];
    const candidates: Array<[PathReasonCode, boolean]> = [
      ["error_remediation", input.trigger === "error_remediation" && pathChanged],
      ["time_compressed", actualBudgetCompression],
      ["user_selected", symmetric("user_selected")],
      ["evidence_insufficient", symmetric("evidence_insufficient")],
      ["low_mastery", symmetric("low_mastery")],
      ["prerequisite_gap", symmetric("prerequisite_gap") || prerequisiteAvailabilityChanged],
    ];
    for (const [reason, enabled] of candidates) if (enabled) reasons.push(reason);
    return reasons;
  }

  private failure(missingPrerequisiteIds: string[], minimumRequiredMinutes: number, preferred: "increase_time" | "change_goal"): PathBuildResult {
    return { status: "infeasible", failure: this.failureDetails(missingPrerequisiteIds, minimumRequiredMinutes, preferred) };
  }

  private failureDetails(
    missingPrerequisiteIds: string[],
    minimumRequiredMinutes: number,
    preferred: "increase_time" | "change_goal",
  ): PathFailure {
    return {
      code: "path_infeasible",
      missingPrerequisiteIds: [...new Set(missingPrerequisiteIds)].sort(compareIds),
      minimumRequiredMinutes,
      suggestions: [preferred, preferred === "increase_time" ? "change_goal" : "increase_time", "run_probe"],
    };
  }
}
