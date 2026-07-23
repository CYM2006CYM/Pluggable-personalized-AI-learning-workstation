import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ActivityReferenceDefinition,
  KnowledgePointDefinition,
  KnowledgePointsAsset,
  LearningActivitiesAsset,
  LearningGoalDefinition,
  LearningGoalsAsset,
  LearningRuntimeErrorCode,
  ProfileCapabilitiesV2,
  ProfileManifestV2,
  ProfileModality,
  ProfilePathsV2,
  ProfileStatus,
} from "./v2-types.js";
import { ProfileValidationError } from "./profile-schema.js";
import { assertPathInside, assertSafeRelativePath } from "../infrastructure/safe-files.js";

const ROOT_KEYS = new Set([
  "subjectId",
  "name",
  "schemaVersion",
  "status",
  "version",
  "revision",
  "revisionOf",
  "capabilities",
  "paths",
]);

const CAPABILITY_KEYS = new Set(["modalities", "runtimes", "diagnostic"]);
const REQUIRED_PATH_KEYS = ["subject", "chapters", "knowledge", "goals", "sources", "quality"] as const;
const OPTIONAL_PATH_KEYS = [
  "cards",
  "activities",
  "diagnostic",
  "assessments",
  "rubrics",
  "datasets",
  "referenceSolutions",
  "environments",
  "taskGeneration",
] as const;
const PATH_KEYS = new Set<string>([...REQUIRED_PATH_KEYS, ...OPTIONAL_PATH_KEYS]);
const MODALITIES = new Set<ProfileModality>(["reading", "quiz", "code", "practice"]);
const STATUSES = new Set<ProfileStatus>(["active", "draft", "archived"]);

const GOALS_ASSET_KEYS = new Set(["goals"]);
const KNOWLEDGE_ASSET_KEYS = new Set(["knowledgePoints"]);
const ACTIVITIES_ASSET_KEYS = new Set(["activities"]);
const GOAL_KEYS = new Set([
  "goalId",
  "title",
  "targetKnowledgePointIds",
  "requiredActivityIds",
  "finalActivityId",
]);
const KNOWLEDGE_POINT_KEYS = new Set([
  "id",
  "title",
  "chapterId",
  "sectionId",
  "prerequisiteIds",
  "relatedKnowledgePointIds",
  "sourceAnchorIds",
  "activityIds",
  "importance",
]);
const ACTIVITY_BASE_KEYS = [
  "activityId",
  "profileRevision",
  "kind",
  "allowedSources",
  "primaryKnowledgePointId",
  "supportingKnowledgePointIds",
  "goalIds",
  "title",
  "prompt",
  "difficulty",
  "estimatedMinutes",
  "sourceAnchorIds",
  "templateVersion",
  "fallbackId",
  "leakagePolicyId",
  "runtimePolicyId",
  "allowedScaffolds",
] as const;
const MCQ_ACTIVITY_KEYS = new Set([...ACTIVITY_BASE_KEYS, "subtype", "options", "evaluatorRef"]);
const EXPLAIN_ACTIVITY_KEYS = new Set([
  ...ACTIVITY_BASE_KEYS,
  "responseContract",
  "deterministicRubricRef",
]);
const CODE_ACTIVITY_KEYS = [
  ...ACTIVITY_BASE_KEYS,
  "starterCode",
  "editableRegions",
  "entryPoint",
  "outputContract",
  "datasetRefs",
  "publicTestRefs",
  "hiddenTestRefs",
  "rubricRef",
  "referenceSolutionRef",
  "knownWrongSolutionRefs",
  "environmentRef",
  "allowedLibraries",
] as const;
const CODE_COMPLETION_ACTIVITY_KEYS = new Set(CODE_ACTIVITY_KEYS);
const CODING_PRACTICAL_ACTIVITY_KEYS = new Set([...CODE_ACTIVITY_KEYS, "businessAcceptanceCriteria"]);
const DEBUG_ACTIVITY_KEYS = new Set([...CODE_ACTIVITY_KEYS, "defectCategory"]);
const EDITABLE_REGION_KEYS = new Set(["regionId", "startMarker", "endMarker", "required", "maxCharacters"]);

const ACTIVITY_KINDS = new Set(["mcq", "code_completion", "coding_practical", "explain", "debug"]);
const TASK_SOURCES = new Set(["profile_fixed", "ai_generated"]);
const SCAFFOLD_LEVELS = new Set(["none", "hint", "worked_example"]);
const DIFFICULTIES = new Set(["S-R", "S-U", "M-U", "M-A", "C-A"]);
const MCQ_SUBTYPES = new Set(["single_choice", "judgment"]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

class ProfileV2ValidationError extends ProfileValidationError {
  readonly errorCode: LearningRuntimeErrorCode = "invalid_profile";
}

function failInvalidProfile(issues: string[]): never {
  throw new ProfileV2ValidationError(issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addUnknownKeyIssues(
  value: Record<string, unknown>,
  allowed: Set<string>,
  location: string,
  issues: string[],
  allowExtensions = true,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && !(allowExtensions && key.startsWith("x-"))) {
      issues.push(`${location}.${key} is an unknown core field`);
    }
  }
}

function requireNonEmptyString(value: Record<string, unknown>, key: string, location: string, issues: string[]): void {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    issues.push(`${location}.${key} must be a non-empty string`);
  }
}

function requireOptionalNonEmptyString(
  value: Record<string, unknown>,
  key: string,
  location: string,
  issues: string[],
): void {
  if (value[key] !== undefined) requireNonEmptyString(value, key, location, issues);
}

function requireStableId(value: Record<string, unknown>, key: string, location: string, issues: string[]): void {
  const identifier = value[key];
  if (typeof identifier !== "string" || !STABLE_ID.test(identifier)) {
    issues.push(`${location}.${key} must be a stable ASCII identifier`);
  }
}

function requireOptionalStableId(
  value: Record<string, unknown>,
  key: string,
  location: string,
  issues: string[],
): void {
  if (value[key] !== undefined) requireStableId(value, key, location, issues);
}

function requireStringArray(
  value: Record<string, unknown>,
  key: string,
  location: string,
  issues: string[],
  stableIds = false,
): void {
  const items = value[key];
  if (!Array.isArray(items) || items.some((item) => typeof item !== "string" || (stableIds && !STABLE_ID.test(item)))) {
    issues.push(`${location}.${key} must be an array of ${stableIds ? "stable ASCII identifiers" : "strings"}`);
  }
}

function requireEnumArray(
  value: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
  location: string,
  issues: string[],
): void {
  const items = value[key];
  if (!Array.isArray(items) || items.some((item) => typeof item !== "string" || !allowed.has(item))) {
    issues.push(`${location}.${key} contains an unsupported value`);
  }
}

function validateCapabilities(value: unknown, issues: string[]): ProfileCapabilitiesV2 | undefined {
  if (!isRecord(value)) {
    issues.push("profile.capabilities must be an object");
    return undefined;
  }

  addUnknownKeyIssues(value, CAPABILITY_KEYS, "profile.capabilities", issues);

  if (!Array.isArray(value.modalities) || value.modalities.some((item) => typeof item !== "string" || !MODALITIES.has(item as ProfileModality))) {
    issues.push("profile.capabilities.modalities must contain only reading, quiz, code, or practice");
  }
  if (!Array.isArray(value.runtimes) || value.runtimes.some((item) => typeof item !== "string" || item.length === 0)) {
    issues.push("profile.capabilities.runtimes must be an array of non-empty strings");
  }
  if (typeof value.diagnostic !== "boolean") {
    issues.push("profile.capabilities.diagnostic must be a boolean");
  }

  return value as unknown as ProfileCapabilitiesV2;
}

function validatePaths(value: unknown, issues: string[]): ProfilePathsV2 | undefined {
  if (!isRecord(value)) {
    issues.push("profile.paths must be an object");
    return undefined;
  }

  addUnknownKeyIssues(value, PATH_KEYS, "profile.paths", issues);

  for (const key of REQUIRED_PATH_KEYS) requireNonEmptyString(value, key, "profile.paths", issues);
  for (const key of OPTIONAL_PATH_KEYS) {
    if (value[key] !== undefined) requireNonEmptyString(value, key, "profile.paths", issues);
  }

  for (const key of [...REQUIRED_PATH_KEYS, ...OPTIONAL_PATH_KEYS]) {
    const path = value[key];
    if (typeof path !== "string" || path.length === 0) continue;
    try {
      assertSafeRelativePath(path);
    } catch {
      issues.push(`profile.paths.${key} must be a safe relative path`);
    }
  }

  return value as unknown as ProfilePathsV2;
}

function requireConditionalPath(paths: ProfilePathsV2 | undefined, key: keyof ProfilePathsV2, reason: string, issues: string[]): void {
  if (paths === undefined || typeof paths[key] !== "string" || paths[key].length === 0) {
    issues.push(`profile.paths.${String(key)} is required when ${reason}`);
  }
}

export function parseProfileManifestV2(raw: string, expectedStatus?: ProfileStatus): ProfileManifestV2 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    failInvalidProfile(["profile.json is not valid JSON"]);
  }

  if (!isRecord(value)) failInvalidProfile(["profile.json must contain an object"]);

  const issues: string[] = [];
  addUnknownKeyIssues(value, ROOT_KEYS, "profile", issues);
  requireNonEmptyString(value, "subjectId", "profile", issues);
  requireNonEmptyString(value, "name", "profile", issues);
  requireNonEmptyString(value, "version", "profile", issues);

  if (value.schemaVersion !== 2) issues.push("profile.schemaVersion must be 2");
  if (typeof value.status !== "string" || !STATUSES.has(value.status as ProfileStatus)) {
    issues.push("profile.status must be active, draft, or archived");
  }
  if (expectedStatus !== undefined && value.status !== expectedStatus) {
    issues.push(`profile.status must be ${expectedStatus}`);
  }
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) {
    issues.push("profile.revision must be a positive integer");
  }
  if (value.revisionOf !== null && (!Number.isInteger(value.revisionOf) || (value.revisionOf as number) < 1)) {
    issues.push("profile.revisionOf must be null or a positive integer");
  }

  const capabilities = validateCapabilities(value.capabilities, issues);
  const paths = validatePaths(value.paths, issues);
  const modalities = Array.isArray(capabilities?.modalities) ? capabilities.modalities : [];

  if (capabilities?.diagnostic === true) {
    requireConditionalPath(paths, "diagnostic", "capabilities.diagnostic is true", issues);
    requireConditionalPath(paths, "assessments", "capabilities.diagnostic is true", issues);
  }
  if (modalities.includes("quiz")) {
    requireConditionalPath(paths, "activities", "quiz modality is declared", issues);
    requireConditionalPath(paths, "assessments", "quiz modality is declared", issues);
  }
  if (modalities.includes("code") || modalities.includes("practice")) {
    for (const key of ["activities", "rubrics", "datasets", "referenceSolutions", "environments"] as const) {
      requireConditionalPath(paths, key, "code or practice modality is declared", issues);
    }
    if (!Array.isArray(capabilities?.runtimes) || capabilities.runtimes.length === 0) {
      issues.push("profile.capabilities.runtimes must not be empty for code or practice modality");
    }
  }

  if (issues.length > 0) failInvalidProfile(issues);
  return value as unknown as ProfileManifestV2;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    failInvalidProfile([`${label} is not valid JSON`]);
  }
}

function validateAssetContainer(
  value: unknown,
  containerKey: string,
  allowed: Set<string>,
  label: string,
  issues: string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    issues.push(`${label} must contain an object`);
    return undefined;
  }
  addUnknownKeyIssues(value, allowed, label, issues);
  if (!Array.isArray(value[containerKey])) issues.push(`${label}.${containerKey} must be an array`);
  return value;
}

function parseLearningGoalsAsset(raw: string): LearningGoalsAsset {
  const value = parseJson(raw, "goals asset");
  const issues: string[] = [];
  const asset = validateAssetContainer(value, "goals", GOALS_ASSET_KEYS, "goals asset", issues);
  const goals = Array.isArray(asset?.goals) ? asset.goals : [];

  if (goals.length === 0) issues.push("goals asset.goals must be a non-empty array");
  goals.forEach((goal, index) => {
    const location = `goals asset.goals[${index}]`;
    if (!isRecord(goal)) {
      issues.push(`${location} must be an object`);
      return;
    }
    addUnknownKeyIssues(goal, GOAL_KEYS, location, issues, false);
    requireStableId(goal, "goalId", location, issues);
    requireNonEmptyString(goal, "title", location, issues);
    requireStringArray(goal, "targetKnowledgePointIds", location, issues, true);
    requireStringArray(goal, "requiredActivityIds", location, issues, true);
    requireOptionalStableId(goal, "finalActivityId", location, issues);
  });

  if (issues.length > 0) failInvalidProfile(issues);
  return value as LearningGoalsAsset;
}

function parseKnowledgePointsAsset(raw: string): KnowledgePointsAsset {
  const value = parseJson(raw, "knowledge asset");
  const issues: string[] = [];
  const asset = validateAssetContainer(value, "knowledgePoints", KNOWLEDGE_ASSET_KEYS, "knowledge asset", issues);
  const points = Array.isArray(asset?.knowledgePoints) ? asset.knowledgePoints : [];

  if (points.length === 0) issues.push("knowledge asset.knowledgePoints must be a non-empty array");
  points.forEach((point, index) => {
    const location = `knowledge asset.knowledgePoints[${index}]`;
    if (!isRecord(point)) {
      issues.push(`${location} must be an object`);
      return;
    }
    addUnknownKeyIssues(point, KNOWLEDGE_POINT_KEYS, location, issues, false);
    requireStableId(point, "id", location, issues);
    requireNonEmptyString(point, "title", location, issues);
    requireStableId(point, "chapterId", location, issues);
    requireStableId(point, "sectionId", location, issues);
    requireStringArray(point, "prerequisiteIds", location, issues, true);
    requireStringArray(point, "relatedKnowledgePointIds", location, issues, true);
    requireStringArray(point, "sourceAnchorIds", location, issues, true);
    requireStringArray(point, "activityIds", location, issues, true);
    if (typeof point.importance !== "number" || !Number.isFinite(point.importance)) {
      issues.push(`${location}.importance must be a finite number`);
    }
  });

  if (issues.length > 0) failInvalidProfile(issues);
  return value as KnowledgePointsAsset;
}

function validateEditableRegions(value: unknown, location: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${location} must be an array`);
    return;
  }
  value.forEach((region, index) => {
    const regionLocation = `${location}[${index}]`;
    if (!isRecord(region)) {
      issues.push(`${regionLocation} must be an object`);
      return;
    }
    addUnknownKeyIssues(region, EDITABLE_REGION_KEYS, regionLocation, issues, false);
    requireStableId(region, "regionId", regionLocation, issues);
    requireNonEmptyString(region, "startMarker", regionLocation, issues);
    requireNonEmptyString(region, "endMarker", regionLocation, issues);
    if (typeof region.required !== "boolean") issues.push(`${regionLocation}.required must be a boolean`);
    if (region.maxCharacters !== undefined && (!Number.isInteger(region.maxCharacters) || (region.maxCharacters as number) < 1)) {
      issues.push(`${regionLocation}.maxCharacters must be a positive integer when present`);
    }
  });
}

function validateActivityEntry(activity: unknown, index: number, issues: string[]): void {
  const location = `activities asset.activities[${index}]`;
  if (!isRecord(activity)) {
    issues.push(`${location} must be an object`);
    return;
  }

  const kind = activity.kind;
  const allowedKeys = kind === "mcq"
    ? MCQ_ACTIVITY_KEYS
    : kind === "explain"
      ? EXPLAIN_ACTIVITY_KEYS
      : kind === "code_completion"
        ? CODE_COMPLETION_ACTIVITY_KEYS
        : kind === "coding_practical"
          ? CODING_PRACTICAL_ACTIVITY_KEYS
          : kind === "debug"
            ? DEBUG_ACTIVITY_KEYS
            : new Set<string>(ACTIVITY_BASE_KEYS);
  addUnknownKeyIssues(activity, allowedKeys, location, issues, false);

  requireStableId(activity, "activityId", location, issues);
  if (!Number.isInteger(activity.profileRevision) || (activity.profileRevision as number) < 1) {
    issues.push(`${location}.profileRevision must be a positive integer`);
  }
  if (typeof kind !== "string" || !ACTIVITY_KINDS.has(kind)) {
    issues.push(`${location}.kind must be one of the five frozen activity kinds`);
  }
  requireEnumArray(activity, "allowedSources", TASK_SOURCES, location, issues);
  requireStableId(activity, "primaryKnowledgePointId", location, issues);
  requireStringArray(activity, "supportingKnowledgePointIds", location, issues, true);
  requireStringArray(activity, "goalIds", location, issues, true);
  requireNonEmptyString(activity, "title", location, issues);
  requireNonEmptyString(activity, "prompt", location, issues);
  if (typeof activity.difficulty !== "string" || !DIFFICULTIES.has(activity.difficulty)) {
    issues.push(`${location}.difficulty must be one of the five frozen levels`);
  }
  if (!Number.isInteger(activity.estimatedMinutes) || (activity.estimatedMinutes as number) < 1) {
    issues.push(`${location}.estimatedMinutes must be a positive integer`);
  }
  requireStringArray(activity, "sourceAnchorIds", location, issues, true);
  requireNonEmptyString(activity, "templateVersion", location, issues);
  requireOptionalStableId(activity, "fallbackId", location, issues);
  requireNonEmptyString(activity, "leakagePolicyId", location, issues);
  requireOptionalNonEmptyString(activity, "runtimePolicyId", location, issues);
  requireEnumArray(activity, "allowedScaffolds", SCAFFOLD_LEVELS, location, issues);

  if (kind === "mcq") {
    if (typeof activity.subtype !== "string" || !MCQ_SUBTYPES.has(activity.subtype)) {
      issues.push(`${location}.subtype must be single_choice or judgment`);
    }
    requireStringArray(activity, "options", location, issues);
    requireNonEmptyString(activity, "evaluatorRef", location, issues);
  } else if (kind === "explain") {
    requireNonEmptyString(activity, "responseContract", location, issues);
    requireOptionalNonEmptyString(activity, "deterministicRubricRef", location, issues);
  } else if (kind === "code_completion" || kind === "coding_practical" || kind === "debug") {
    requireNonEmptyString(activity, "starterCode", location, issues);
    validateEditableRegions(activity.editableRegions, `${location}.editableRegions`, issues);
    requireNonEmptyString(activity, "entryPoint", location, issues);
    requireNonEmptyString(activity, "outputContract", location, issues);
    for (const key of ["datasetRefs", "publicTestRefs", "hiddenTestRefs", "knownWrongSolutionRefs", "allowedLibraries"] as const) {
      requireStringArray(activity, key, location, issues);
    }
    for (const key of ["rubricRef", "referenceSolutionRef", "environmentRef"] as const) {
      requireNonEmptyString(activity, key, location, issues);
    }
    if (kind === "coding_practical") requireStringArray(activity, "businessAcceptanceCriteria", location, issues);
    if (kind === "debug") requireNonEmptyString(activity, "defectCategory", location, issues);
  }
}

function parseLearningActivitiesAsset(raw: string, requireNonEmpty: boolean): LearningActivitiesAsset {
  const value = parseJson(raw, "activities asset");
  const issues: string[] = [];
  const asset = validateAssetContainer(value, "activities", ACTIVITIES_ASSET_KEYS, "activities asset", issues);
  const activities = Array.isArray(asset?.activities) ? asset.activities : [];

  if (requireNonEmpty && activities.length === 0) {
    issues.push("activities asset.activities must be non-empty for quiz, code, or practice modality");
  }
  activities.forEach((activity, index) => validateActivityEntry(activity, index, issues));

  if (issues.length > 0) failInvalidProfile(issues);
  return value as LearningActivitiesAsset;
}

function buildUniqueIndex<T>(items: T[], idOf: (item: T) => string, label: string): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) {
    const identifier = idOf(item);
    if (index.has(identifier)) failInvalidProfile([`${label} contains duplicate ID ${identifier}`]);
    index.set(identifier, item);
  }
  return index;
}

function assertNoDuplicateReferences(values: string[], location: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) failInvalidProfile([`${location} contains duplicate reference ${value}`]);
    seen.add(value);
  }
}

function assertReferencesExist(values: string[], index: ReadonlyMap<string, unknown>, location: string): void {
  for (const value of values) {
    if (!index.has(value)) failInvalidProfile([`${location} references missing ID ${value}`]);
  }
}

function assertAcyclicPrerequisites(points: KnowledgePointDefinition[], pointIndex: ReadonlyMap<string, KnowledgePointDefinition>): void {
  const state = new Map<string, "visiting" | "visited">();

  const visit = (pointId: string): void => {
    const current = state.get(pointId);
    if (current === "visiting") failInvalidProfile([`knowledge prerequisites contain a cycle at ${pointId}`]);
    if (current === "visited") return;
    state.set(pointId, "visiting");
    const point = pointIndex.get(pointId);
    if (point !== undefined) {
      for (const prerequisiteId of point.prerequisiteIds) visit(prerequisiteId);
    }
    state.set(pointId, "visited");
  };

  for (const point of points) visit(point.id);
}

function validateCrossFileClosure(
  goalsAsset: LearningGoalsAsset,
  knowledgeAsset: KnowledgePointsAsset,
  activitiesAsset: LearningActivitiesAsset,
): void {
  const goals = goalsAsset.goals;
  const points = knowledgeAsset.knowledgePoints;
  const activities = activitiesAsset.activities;

  // W1-C3 D.2.2 step 2: build the three unique indexes.
  const goalIndex = buildUniqueIndex(goals, (goal) => goal.goalId, "goals asset");
  const pointIndex = buildUniqueIndex(points, (point) => point.id, "knowledge asset");
  const activityIndex = buildUniqueIndex(activities, (activity) => activity.activityId, "activities asset");

  // Step 3: reject duplicates inside the seven frozen reference arrays.
  for (const goal of goals) {
    assertNoDuplicateReferences(goal.targetKnowledgePointIds, `goal ${goal.goalId}.targetKnowledgePointIds`);
    assertNoDuplicateReferences(goal.requiredActivityIds, `goal ${goal.goalId}.requiredActivityIds`);
  }
  for (const point of points) {
    assertNoDuplicateReferences(point.prerequisiteIds, `knowledge point ${point.id}.prerequisiteIds`);
    assertNoDuplicateReferences(point.relatedKnowledgePointIds, `knowledge point ${point.id}.relatedKnowledgePointIds`);
    assertNoDuplicateReferences(point.activityIds, `knowledge point ${point.id}.activityIds`);
  }
  for (const activity of activities) {
    assertNoDuplicateReferences(activity.supportingKnowledgePointIds, `activity ${activity.activityId}.supportingKnowledgePointIds`);
    assertNoDuplicateReferences(activity.goalIds, `activity ${activity.activityId}.goalIds`);
  }

  // Steps 4-5: goal references.
  for (const goal of goals) {
    assertReferencesExist(goal.targetKnowledgePointIds, pointIndex, `goal ${goal.goalId}.targetKnowledgePointIds`);
  }
  for (const goal of goals) {
    assertReferencesExist(goal.requiredActivityIds, activityIndex, `goal ${goal.goalId}.requiredActivityIds`);
    if (goal.finalActivityId !== undefined) {
      assertReferencesExist([goal.finalActivityId], activityIndex, `goal ${goal.goalId}.finalActivityId`);
    }
  }

  // Steps 6-7: knowledge-point references. Related points are not made symmetric.
  for (const point of points) {
    assertReferencesExist(point.prerequisiteIds, pointIndex, `knowledge point ${point.id}.prerequisiteIds`);
    assertReferencesExist(point.relatedKnowledgePointIds, pointIndex, `knowledge point ${point.id}.relatedKnowledgePointIds`);
    if (point.prerequisiteIds.includes(point.id)) {
      failInvalidProfile([`knowledge point ${point.id}.prerequisiteIds must not reference itself`]);
    }
  }
  for (const point of points) {
    assertReferencesExist(point.activityIds, activityIndex, `knowledge point ${point.id}.activityIds`);
  }

  // Steps 8-9: activity references. Supporting points never become scored points.
  for (const activity of activities) {
    assertReferencesExist([activity.primaryKnowledgePointId], pointIndex, `activity ${activity.activityId}.primaryKnowledgePointId`);
    assertReferencesExist(activity.supportingKnowledgePointIds, pointIndex, `activity ${activity.activityId}.supportingKnowledgePointIds`);
    if (activity.supportingKnowledgePointIds.includes(activity.primaryKnowledgePointId)) {
      failInvalidProfile([`activity ${activity.activityId}.supportingKnowledgePointIds must not contain its primary knowledge point`]);
    }
  }
  for (const activity of activities) {
    assertReferencesExist(activity.goalIds, goalIndex, `activity ${activity.activityId}.goalIds`);
  }

  // Step 10: only prerequisiteIds participate in the deterministic cycle check.
  assertAcyclicPrerequisites(points, pointIndex);
}

async function assertDeclaredAsset(root: string, relativePath: string, label: string, issues: string[]): Promise<void> {
  try {
    assertSafeRelativePath(relativePath);
    const normalized = relativePath.replaceAll("\\", "/");
    let current = resolve(root);
    for (const segment of normalized.split("/")) {
      current = assertPathInside(root, resolve(current, segment));
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        issues.push(`${label} must not traverse a symbolic link`);
        return;
      }
    }
  } catch {
    issues.push(`${label} is missing, unreadable, or outside the Profile root`);
  }
}

async function readDeclaredJsonAsset(root: string, relativePath: string, label: string): Promise<string> {
  try {
    return await readFile(assertPathInside(root, resolve(root, relativePath)), "utf8");
  } catch {
    failInvalidProfile([`${label} is missing or unreadable`]);
  }
}

/**
 * Validates the W1-C3 manifest, conditional assets, containment, the three core
 * JSON assets, and their frozen cross-file closure. Professional validation of
 * sources, datasets, tests, rubrics, reference solutions, and environments is
 * intentionally owned by their later contracts and is not performed here.
 */
export async function validateProfileV2Directory(
  directory: string,
  expectedStatus?: ProfileStatus,
): Promise<ProfileManifestV2> {
  let manifest: ProfileManifestV2;
  try {
    manifest = parseProfileManifestV2(await readFile(resolve(directory, "profile.json"), "utf8"), expectedStatus);
  } catch (error) {
    if (error instanceof ProfileValidationError) throw error;
    failInvalidProfile(["profile.json is missing or unreadable"]);
  }

  const issues: string[] = [];
  for (const key of [...REQUIRED_PATH_KEYS, ...OPTIONAL_PATH_KEYS]) {
    const path = manifest.paths[key];
    if (typeof path === "string") await assertDeclaredAsset(directory, path, `profile.paths.${key}`, issues);
  }
  if (issues.length > 0) failInvalidProfile(issues);

  const goalsAsset = parseLearningGoalsAsset(
    await readDeclaredJsonAsset(directory, manifest.paths.goals, "goals asset"),
  );
  const knowledgeAsset = parseKnowledgePointsAsset(
    await readDeclaredJsonAsset(directory, manifest.paths.knowledge, "knowledge asset"),
  );
  const scoringActivityDeclared = manifest.capabilities.modalities.some((modality) =>
    modality === "quiz" || modality === "code" || modality === "practice"
  );
  const activitiesAsset = manifest.paths.activities === undefined
    ? { activities: [] }
    : parseLearningActivitiesAsset(
        await readDeclaredJsonAsset(directory, manifest.paths.activities, "activities asset"),
        scoringActivityDeclared,
      );

  validateCrossFileClosure(goalsAsset, knowledgeAsset, activitiesAsset);
  return manifest;
}
