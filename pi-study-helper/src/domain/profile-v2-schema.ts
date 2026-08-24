import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
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
  "requiresCodeEvidence",
  "activityPolicy",
  "contentEstimatedMinutes",
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
const MCQ_ACTIVITY_KEYS = new Set([...ACTIVITY_BASE_KEYS, "subtype", "options", "evaluatorRef", "fixedQuestionGroupId", "supplementalQuestionGroupId"]);
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
  "publicAcceptanceCriteria",
  "datasetRefs",
  "publicTestRefs",
  "hiddenTestRefs",
  "rubricRef",
  "referenceSolutionRef",
  "knownWrongSolutionRefs",
  "environmentRef",
  "allowedLibraries",
  "problemStatement",
] as const;
const CODE_COMPLETION_ACTIVITY_KEYS = new Set(CODE_ACTIVITY_KEYS);
const CODING_PRACTICAL_ACTIVITY_KEYS = new Set([...CODE_ACTIVITY_KEYS, "businessAcceptanceCriteria"]);
const DEBUG_ACTIVITY_KEYS = new Set([...CODE_ACTIVITY_KEYS, "defectCategory"]);
const EDITABLE_REGION_KEYS = new Set(["regionId", "startMarker", "endMarker", "required", "maxCharacters"]);
const CODE_PROBLEM_KEYS = new Set(["background", "inputDescription", "outputDescription", "rules", "prohibitedActions", "sample"]);
const CODE_SAMPLE_KEYS = new Set(["inputFileName", "inputCsv", "outputFileName", "outputCsv", "explanation"]);
const CARD_CONTAINER_KEYS = new Set(["cards"]);
const CARD_KEYS = new Set(["cardId", "knowledgePointId", "title", "objective", "explanation", "example", "commonMistake", "sourceAnchorIds", "estimatedMinutes", "richLesson"]);
const RICH_LESSON_KEYS = new Set(["sourceDocument", "sourceDocumentSha256", "canonicalRules", "sourceClaims", "variants"]);
const CANONICAL_RULE_KEYS = new Set(["ruleId", "statement", "sourceClaimIds"]);
const SOURCE_CLAIM_KEYS = new Set(["claimId", "statement", "sourceAnchorIds"]);
const VARIANT_KEYS = new Set(["variantId", "label", "learningObjectives", "modules", "termNotes", "coveredRuleIds", "chineseCharacterCount"]);
const OBJECTIVE_KEYS = new Set(["understand", "master"]);
const MODULE_KEYS = new Set(["moduleId", "title", "summary", "blocks"]);
const TERM_NOTE_KEYS = new Set(["term", "explanation"]);
const BLOCK_COMMON_KEYS = ["blockId", "kind"] as const;
const BLOCK_KEYS = {
  paragraph: new Set([...BLOCK_COMMON_KEYS, "text"]),
  subheading: new Set([...BLOCK_COMMON_KEYS, "text"]),
  code: new Set([...BLOCK_COMMON_KEYS, "language", "code"]),
  list: new Set([...BLOCK_COMMON_KEYS, "ordered", "items"]),
  callout: new Set([...BLOCK_COMMON_KEYS, "tone", "title", "text"]),
};
const LESSON_VARIANT_IDS = ["guided", "concise", "practice"] as const;
const LESSON_MODULE_IDS = ["intuition", "concepts", "walkthrough", "mistakes", "final-task", "terms-sources"] as const;
const GROUP_CONTAINER_KEYS = new Set(["groups"]);
const PUBLIC_GROUP_KEYS = new Set(["groupId", "role", "activityId", "knowledgePointId", "questions"]);
const PRIVATE_GROUP_KEYS = new Set(["groupId", "answers"]);
const PUBLIC_QUESTION_KEYS = new Set(["questionId", "kind", "prompt", "options"]);
const PRIVATE_QUESTION_KEYS = new Set([...PUBLIC_QUESTION_KEYS, "correctAnswer", "explanation", "sourceAnchorIds"]);

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
    if (point.requiresCodeEvidence !== undefined && typeof point.requiresCodeEvidence !== "boolean") {
      issues.push(`${location}.requiresCodeEvidence must be boolean when present`);
    }
    if (point.activityPolicy !== undefined && point.activityPolicy !== "select_one" && point.activityPolicy !== "all_in_order") {
      issues.push(`${location}.activityPolicy must be select_one or all_in_order`);
    }
    if (point.contentEstimatedMinutes !== undefined
        && (!Number.isInteger(point.contentEstimatedMinutes) || (point.contentEstimatedMinutes as number) < 1)) {
      issues.push(`${location}.contentEstimatedMinutes must be a positive integer when present`);
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
    const hasLegacyShape = activity.subtype !== undefined || activity.options !== undefined;
    const hasGroupShape = activity.fixedQuestionGroupId !== undefined || activity.supplementalQuestionGroupId !== undefined;
    if (hasLegacyShape && hasGroupShape) issues.push(`${location} cannot mix legacy single-question and W4 question-group fields`);
    if (!hasLegacyShape && !hasGroupShape) issues.push(`${location} must declare legacy single-question or W4 question-group fields`);
    if (hasLegacyShape && (typeof activity.subtype !== "string" || !MCQ_SUBTYPES.has(activity.subtype))) {
      issues.push(`${location}.subtype must be single_choice or judgment`);
    }
    if (hasLegacyShape) requireStringArray(activity, "options", location, issues);
    if (hasGroupShape) {
      requireStableId(activity, "fixedQuestionGroupId", location, issues);
      if (activity.supplementalQuestionGroupId !== undefined) requireStableId(activity, "supplementalQuestionGroupId", location, issues);
    }
    requireNonEmptyString(activity, "evaluatorRef", location, issues);
  } else if (kind === "explain") {
    requireNonEmptyString(activity, "responseContract", location, issues);
    requireOptionalNonEmptyString(activity, "deterministicRubricRef", location, issues);
  } else if (kind === "code_completion" || kind === "coding_practical" || kind === "debug") {
    requireNonEmptyString(activity, "starterCode", location, issues);
    validateEditableRegions(activity.editableRegions, `${location}.editableRegions`, issues);
    requireNonEmptyString(activity, "entryPoint", location, issues);
    requireNonEmptyString(activity, "outputContract", location, issues);
    if (activity.profileRevision === 3) {
      requireStringArray(activity, "publicAcceptanceCriteria", location, issues);
      if (Array.isArray(activity.publicAcceptanceCriteria) && activity.publicAcceptanceCriteria.length < 4) {
        issues.push(`${location}.publicAcceptanceCriteria must contain at least four public checks`);
      }
    }
    for (const key of ["datasetRefs", "publicTestRefs", "hiddenTestRefs", "knownWrongSolutionRefs", "allowedLibraries"] as const) {
      requireStringArray(activity, key, location, issues);
    }
    for (const key of ["rubricRef", "referenceSolutionRef", "environmentRef"] as const) {
      requireNonEmptyString(activity, key, location, issues);
    }
    if (activity.profileRevision === 3 && activity.problemStatement === undefined) {
      issues.push(`${location}.problemStatement must be present for revision 3 code activities`);
    }
    if (activity.problemStatement !== undefined) {
      const statement = isRecord(activity.problemStatement) ? activity.problemStatement : undefined;
      if (statement === undefined) issues.push(`${location}.problemStatement must be an object`);
      else {
        addUnknownKeyIssues(statement, CODE_PROBLEM_KEYS, `${location}.problemStatement`, issues, false);
        for (const key of ["background", "inputDescription", "outputDescription"] as const) requireNonEmptyString(statement, key, `${location}.problemStatement`, issues);
        for (const key of ["rules", "prohibitedActions"] as const) requireStringArray(statement, key, `${location}.problemStatement`, issues);
        const sample = isRecord(statement.sample) ? statement.sample : undefined;
        if (sample === undefined) issues.push(`${location}.problemStatement.sample must be an object`);
        else {
          addUnknownKeyIssues(sample, CODE_SAMPLE_KEYS, `${location}.problemStatement.sample`, issues, false);
          for (const key of ["inputFileName", "inputCsv", "outputFileName", "outputCsv", "explanation"] as const) requireNonEmptyString(sample, key, `${location}.problemStatement.sample`, issues);
        }
      }
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

async function jsonDocuments(root: string): Promise<Array<{ path: string; value: unknown }>> {
  const rootEntry = await lstat(root);
  if (rootEntry.isFile()) return [{ path: relative(resolve(root, ".."), root).replaceAll("\\", "/"), value: parseJson(await readFile(root, "utf8"), root) }];
  const documents: Array<{ path: string; value: unknown }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = assertPathInside(root, resolve(directory, entry.name));
      if (entry.isSymbolicLink()) failInvalidProfile([`${relative(root, absolute).replaceAll("\\", "/")} must not be a symbolic link`]);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        documents.push({ path: relative(root, absolute).replaceAll("\\", "/"), value: parseJson(await readFile(absolute, "utf8"), absolute) });
      }
    }
  };
  await visit(root);
  return documents;
}

function validateRichLesson(value: unknown, point: KnowledgePointDefinition, location: string, issues: string[]): void {
  if (!isRecord(value)) { issues.push(`${location} must be an object`); return; }
  addUnknownKeyIssues(value, RICH_LESSON_KEYS, location, issues, false);
  requireNonEmptyString(value, "sourceDocument", location, issues);
  if (typeof value.sourceDocumentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sourceDocumentSha256)) {
    issues.push(`${location}.sourceDocumentSha256 must be a SHA-256 hex digest`);
  }
  const rules = Array.isArray(value.canonicalRules) ? value.canonicalRules : [];
  const claims = Array.isArray(value.sourceClaims) ? value.sourceClaims : [];
  if (rules.length === 0) issues.push(`${location}.canonicalRules must be non-empty`);
  if (claims.length === 0) issues.push(`${location}.sourceClaims must be non-empty`);
  const ruleIds = new Set<string>();
  const claimIds = new Set<string>();
  for (const [index, claim] of claims.entries()) {
    const claimLocation = `${location}.sourceClaims[${index}]`;
    if (!isRecord(claim)) { issues.push(`${claimLocation} must be an object`); continue; }
    addUnknownKeyIssues(claim, SOURCE_CLAIM_KEYS, claimLocation, issues, false);
    requireStableId(claim, "claimId", claimLocation, issues);
    requireNonEmptyString(claim, "statement", claimLocation, issues);
    requireStringArray(claim, "sourceAnchorIds", claimLocation, issues, true);
    if (typeof claim.claimId === "string") {
      if (claimIds.has(claim.claimId)) issues.push(`${claimLocation}.claimId must be unique`);
      claimIds.add(claim.claimId);
    }
    if (Array.isArray(claim.sourceAnchorIds) && claim.sourceAnchorIds.some((sourceId) => typeof sourceId !== "string" || !point.sourceAnchorIds.includes(sourceId))) {
      issues.push(`${claimLocation}.sourceAnchorIds must stay inside knowledge point sources`);
    }
  }
  for (const [index, rule] of rules.entries()) {
    const ruleLocation = `${location}.canonicalRules[${index}]`;
    if (!isRecord(rule)) { issues.push(`${ruleLocation} must be an object`); continue; }
    addUnknownKeyIssues(rule, CANONICAL_RULE_KEYS, ruleLocation, issues, false);
    requireStableId(rule, "ruleId", ruleLocation, issues);
    requireNonEmptyString(rule, "statement", ruleLocation, issues);
    requireStringArray(rule, "sourceClaimIds", ruleLocation, issues, true);
    if (typeof rule.ruleId === "string") {
      if (ruleIds.has(rule.ruleId)) issues.push(`${ruleLocation}.ruleId must be unique`);
      ruleIds.add(rule.ruleId);
    }
  }
  for (const [index, rule] of rules.entries()) {
    if (isRecord(rule) && Array.isArray(rule.sourceClaimIds) && rule.sourceClaimIds.some((claimId) => typeof claimId !== "string" || !claimIds.has(claimId))) {
      issues.push(`${location}.canonicalRules[${index}].sourceClaimIds contains a missing claim`);
    }
  }
  if (!isRecord(value.variants)) { issues.push(`${location}.variants must be an object`); return; }
  addUnknownKeyIssues(value.variants, new Set(LESSON_VARIANT_IDS), `${location}.variants`, issues, false);
  const expectedRuleIds = [...ruleIds];
  for (const variantId of LESSON_VARIANT_IDS) {
    const variant = value.variants[variantId];
    const variantLocation = `${location}.variants.${variantId}`;
    if (!isRecord(variant)) { issues.push(`${variantLocation} must be an object`); continue; }
    addUnknownKeyIssues(variant, VARIANT_KEYS, variantLocation, issues, false);
    if (variant.variantId !== variantId) issues.push(`${variantLocation}.variantId must equal ${variantId}`);
    requireNonEmptyString(variant, "label", variantLocation, issues);
    if (!Number.isInteger(variant.chineseCharacterCount) || (variant.chineseCharacterCount as number) < 2000 || (variant.chineseCharacterCount as number) > 3000) {
      issues.push(`${variantLocation}.chineseCharacterCount must be within 2000..3000`);
    }
    requireStringArray(variant, "coveredRuleIds", variantLocation, issues, true);
    if (Array.isArray(variant.coveredRuleIds) && JSON.stringify(variant.coveredRuleIds) !== JSON.stringify(expectedRuleIds)) {
      issues.push(`${variantLocation}.coveredRuleIds must exactly match canonicalRules`);
    }
    if (!isRecord(variant.learningObjectives)) issues.push(`${variantLocation}.learningObjectives must be an object`);
    else {
      addUnknownKeyIssues(variant.learningObjectives, OBJECTIVE_KEYS, `${variantLocation}.learningObjectives`, issues, false);
      requireStringArray(variant.learningObjectives, "understand", `${variantLocation}.learningObjectives`, issues);
      requireStringArray(variant.learningObjectives, "master", `${variantLocation}.learningObjectives`, issues);
    }
    const modules = Array.isArray(variant.modules) ? variant.modules : [];
    if (modules.length !== LESSON_MODULE_IDS.length) issues.push(`${variantLocation}.modules must contain six modules`);
    const blockIds = new Set<string>();
    modules.forEach((module, moduleIndex) => {
      const moduleLocation = `${variantLocation}.modules[${moduleIndex}]`;
      if (!isRecord(module)) { issues.push(`${moduleLocation} must be an object`); return; }
      addUnknownKeyIssues(module, MODULE_KEYS, moduleLocation, issues, false);
      if (module.moduleId !== LESSON_MODULE_IDS[moduleIndex]) issues.push(`${moduleLocation}.moduleId is out of order`);
      requireNonEmptyString(module, "title", moduleLocation, issues);
      requireNonEmptyString(module, "summary", moduleLocation, issues);
      const blocks = Array.isArray(module.blocks) ? module.blocks : [];
      if (blocks.length === 0) issues.push(`${moduleLocation}.blocks must be non-empty`);
      blocks.forEach((block, blockIndex) => {
        const blockLocation = `${moduleLocation}.blocks[${blockIndex}]`;
        if (!isRecord(block) || typeof block.kind !== "string" || !Object.hasOwn(BLOCK_KEYS, block.kind)) {
          issues.push(`${blockLocation} has an unsupported kind`);
          return;
        }
        const blockKind = block.kind as keyof typeof BLOCK_KEYS;
        addUnknownKeyIssues(block, BLOCK_KEYS[blockKind], blockLocation, issues, false);
        requireStableId(block, "blockId", blockLocation, issues);
        if (typeof block.blockId === "string") {
          if (blockIds.has(block.blockId)) issues.push(`${blockLocation}.blockId must be unique inside the variant`);
          blockIds.add(block.blockId);
        }
        if (block.kind === "paragraph" || block.kind === "subheading") requireNonEmptyString(block, "text", blockLocation, issues);
        else if (block.kind === "code") {
          if (block.language !== "python" && block.language !== "csv" && block.language !== "text") issues.push(`${blockLocation}.language is unsupported`);
          requireNonEmptyString(block, "code", blockLocation, issues);
        } else if (block.kind === "list") {
          if (typeof block.ordered !== "boolean") issues.push(`${blockLocation}.ordered must be boolean`);
          requireStringArray(block, "items", blockLocation, issues);
        } else {
          if (block.tone !== "info" && block.tone !== "warning" && block.tone !== "term") issues.push(`${blockLocation}.tone is unsupported`);
          requireNonEmptyString(block, "title", blockLocation, issues);
          requireNonEmptyString(block, "text", blockLocation, issues);
        }
      });
    });
    const terms = Array.isArray(variant.termNotes) ? variant.termNotes : [];
    if (terms.length === 0) issues.push(`${variantLocation}.termNotes must be non-empty`);
    const rendered = JSON.stringify(modules);
    terms.forEach((term, termIndex) => {
      const termLocation = `${variantLocation}.termNotes[${termIndex}]`;
      if (!isRecord(term)) { issues.push(`${termLocation} must be an object`); return; }
      addUnknownKeyIssues(term, TERM_NOTE_KEYS, termLocation, issues, false);
      requireNonEmptyString(term, "term", termLocation, issues);
      requireNonEmptyString(term, "explanation", termLocation, issues);
      if (typeof term.term === "string" && !rendered.includes(term.term)) issues.push(`${termLocation}.term must appear in module content`);
    });
  }
}

function validateRevision3CardAsset(
  documents: readonly { path: string; value: unknown }[],
  points: readonly KnowledgePointDefinition[],
): void {
  const issues: string[] = [];
  const containers = documents.filter((document) => isRecord(document.value) && Array.isArray(document.value.cards));
  if (containers.length !== 1) issues.push("revision 3 cards path must contain exactly one { cards: [...] } container");
  const container = containers[0];
  if (container === undefined || !isRecord(container.value)) failInvalidProfile(issues);
  addUnknownKeyIssues(container.value, CARD_CONTAINER_KEYS, `cards asset ${container.path}`, issues, false);
  const cards = container.value.cards as unknown[];
  const pointIndex = new Map(points.map((point) => [point.id, point]));
  const seenCards = new Set<string>();
  const seenPoints = new Set<string>();
  cards.forEach((card, index) => {
    const location = `cards asset.cards[${index}]`;
    if (!isRecord(card)) { issues.push(`${location} must be an object`); return; }
    addUnknownKeyIssues(card, CARD_KEYS, location, issues, false);
    requireStableId(card, "cardId", location, issues);
    requireStableId(card, "knowledgePointId", location, issues);
    requireNonEmptyString(card, "title", location, issues);
    requireNonEmptyString(card, "objective", location, issues);
    requireStringArray(card, "explanation", location, issues);
    requireNonEmptyString(card, "example", location, issues);
    requireNonEmptyString(card, "commonMistake", location, issues);
    requireStringArray(card, "sourceAnchorIds", location, issues, true);
    if (!Number.isInteger(card.estimatedMinutes) || (card.estimatedMinutes as number) < 1) issues.push(`${location}.estimatedMinutes must be a positive integer`);
    if (typeof card.cardId === "string" && seenCards.has(card.cardId)) issues.push(`${location}.cardId must be unique`);
    if (typeof card.cardId === "string") seenCards.add(card.cardId);
    if (typeof card.knowledgePointId === "string" && seenPoints.has(card.knowledgePointId)) issues.push(`${location}.knowledgePointId must be unique`);
    if (typeof card.knowledgePointId === "string") seenPoints.add(card.knowledgePointId);
    const point = typeof card.knowledgePointId === "string" ? pointIndex.get(card.knowledgePointId) : undefined;
    if (point === undefined) issues.push(`${location}.knowledgePointId references a missing knowledge point`);
    else {
      if (card.estimatedMinutes !== point.contentEstimatedMinutes) issues.push(`${location}.estimatedMinutes must equal knowledge point contentEstimatedMinutes`);
      if (point.id.startsWith("pandas.clean.")) validateRichLesson(card.richLesson, point, `${location}.richLesson`, issues);
      else if (card.richLesson !== undefined) validateRichLesson(card.richLesson, point, `${location}.richLesson`, issues);
    }
  });
  for (const point of points) if (!seenPoints.has(point.id)) issues.push(`knowledge point ${point.id} must have exactly one fixed card`);
  if (cards.length !== points.length) issues.push("revision 3 card count must equal knowledge point count");
  if (issues.length > 0) failInvalidProfile(issues);
}

function validateQuestion(value: unknown, location: string, privateShape: boolean, issues: string[]): void {
  if (!isRecord(value)) { issues.push(`${location} must be an object`); return; }
  addUnknownKeyIssues(value, privateShape ? PRIVATE_QUESTION_KEYS : PUBLIC_QUESTION_KEYS, location, issues, false);
  requireStableId(value, "questionId", location, issues);
  if (value.kind !== "single_choice" && value.kind !== "judgment") issues.push(`${location}.kind must be single_choice or judgment`);
  requireNonEmptyString(value, "prompt", location, issues);
  requireStringArray(value, "options", location, issues);
  if (Array.isArray(value.options) && new Set(value.options).size !== value.options.length) issues.push(`${location}.options must be unique`);
  if (!privateShape) return;
  if (value.kind === "single_choice" && (typeof value.correctAnswer !== "string" || !Array.isArray(value.options) || !value.options.includes(value.correctAnswer))) {
    issues.push(`${location}.correctAnswer must equal one option`);
  }
  if (value.kind === "judgment" && typeof value.correctAnswer !== "boolean") issues.push(`${location}.correctAnswer must be boolean`);
  requireNonEmptyString(value, "explanation", location, issues);
  requireStringArray(value, "sourceAnchorIds", location, issues, true);
}

function validateRevision3QuizAssets(
  documents: readonly { path: string; value: unknown }[],
  points: readonly KnowledgePointDefinition[],
  activities: readonly ActivityReferenceDefinition[],
): void {
  const issues: string[] = [];
  const groupDocuments = documents.filter((document) => isRecord(document.value) && Array.isArray(document.value.groups));
  const publicGroups: Record<string, unknown>[] = [];
  const privateGroups: Record<string, unknown>[] = [];
  for (const document of groupDocuments) {
    const container = document.value as Record<string, unknown>;
    addUnknownKeyIssues(container, GROUP_CONTAINER_KEYS, `question group asset ${document.path}`, issues, false);
    for (const group of container.groups as unknown[]) {
      if (isRecord(group) && Array.isArray(group.questions)) publicGroups.push(group);
      else if (isRecord(group) && Array.isArray(group.answers)) privateGroups.push(group);
      else issues.push(`question group asset ${document.path} contains an unsupported group shape`);
    }
  }
  const publicIndex = new Map<string, Record<string, unknown>>();
  const privateIndex = new Map<string, Record<string, unknown>>();
  const questionIds = new Set<string>();
  for (const [index, group] of publicGroups.entries()) {
    const location = `public quiz groups[${index}]`;
    addUnknownKeyIssues(group, PUBLIC_GROUP_KEYS, location, issues, false);
    requireStableId(group, "groupId", location, issues);
    requireStableId(group, "activityId", location, issues);
    requireStableId(group, "knowledgePointId", location, issues);
    if (group.role !== "fixed" && group.role !== "supplemental") issues.push(`${location}.role must be fixed or supplemental`);
    const questions = Array.isArray(group.questions) ? group.questions : [];
    const expected = group.role === "fixed" ? [4, 6] : [1, 2];
    if (questions.length < expected[0] || questions.length > expected[1]) issues.push(`${location}.questions count is outside the role limit`);
    questions.forEach((question, questionIndex) => {
      validateQuestion(question, `${location}.questions[${questionIndex}]`, false, issues);
      if (isRecord(question) && typeof question.questionId === "string") {
        if (questionIds.has(question.questionId)) issues.push(`questionId ${question.questionId} must not repeat across revision 3 groups`);
        questionIds.add(question.questionId);
      }
    });
    if (typeof group.groupId === "string") {
      if (publicIndex.has(group.groupId)) issues.push(`quiz group ${group.groupId} must be unique`);
      publicIndex.set(group.groupId, group);
    }
  }
  for (const [index, group] of privateGroups.entries()) {
    const location = `private quiz groups[${index}]`;
    addUnknownKeyIssues(group, PRIVATE_GROUP_KEYS, location, issues, false);
    requireStableId(group, "groupId", location, issues);
    const answers = Array.isArray(group.answers) ? group.answers : [];
    answers.forEach((answer, answerIndex) => validateQuestion(answer, `${location}.answers[${answerIndex}]`, true, issues));
    if (typeof group.groupId === "string") {
      if (privateIndex.has(group.groupId)) issues.push(`private quiz group ${group.groupId} must be unique`);
      privateIndex.set(group.groupId, group);
    }
  }
  for (const [groupId, group] of publicIndex) {
    const privateGroup = privateIndex.get(groupId);
    const publicQuestions = (group.questions as Record<string, unknown>[]).map((question) => question.questionId);
    const answers = (privateGroup?.answers as Record<string, unknown>[] | undefined) ?? [];
    if (privateGroup === undefined || answers.length !== publicQuestions.length || answers.some((answer, index) => answer.questionId !== publicQuestions[index])) {
      issues.push(`quiz group ${groupId} must have one ordered private answer for every public question`);
    }
  }
  for (const groupId of privateIndex.keys()) if (!publicIndex.has(groupId)) issues.push(`private quiz group ${groupId} has no public group`);
  const pointIds = new Set(points.map((point) => point.id));
  const activityIds = new Set(activities.map((activity) => activity.activityId));
  for (const group of publicGroups) {
    if (typeof group.knowledgePointId === "string" && !pointIds.has(group.knowledgePointId)) issues.push(`quiz group ${String(group.groupId)} references missing knowledge point`);
    if (typeof group.activityId === "string" && !activityIds.has(group.activityId)) issues.push(`quiz group ${String(group.groupId)} references missing activity`);
  }
  for (const point of points) {
    const quiz = activities.find((activity) => activity.primaryKnowledgePointId === point.id && activity.fixedQuestionGroupId !== undefined);
    if (quiz === undefined) { issues.push(`knowledge point ${point.id} must reference one revision 3 mcq activity`); continue; }
    const fixed = publicIndex.get(quiz.fixedQuestionGroupId!);
    const supplemental = quiz.supplementalQuestionGroupId === undefined ? undefined : publicIndex.get(quiz.supplementalQuestionGroupId);
    if (fixed?.role !== "fixed" || fixed.activityId !== quiz.activityId || fixed.knowledgePointId !== point.id) issues.push(`activity ${quiz.activityId} fixed question group binding is invalid`);
    if (quiz.supplementalQuestionGroupId === undefined || supplemental?.role !== "supplemental" || supplemental.activityId !== quiz.activityId || supplemental.knowledgePointId !== point.id) {
      issues.push(`activity ${quiz.activityId} supplemental question group binding is invalid`);
    }
  }
  if (issues.length > 0) failInvalidProfile(issues);
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
  if (manifest.revision === 3) {
    if (manifest.revisionOf !== 2 || manifest.paths.cards === undefined || manifest.paths.assessments === undefined) {
      failInvalidProfile(["revision 3 must declare revisionOf=2, cards, and assessments paths"]);
    }
    const coreKnowledgePointIds = new Set(
      goalsAsset.goals.flatMap((goal) => goal.targetKnowledgePointIds),
    );
    const coreKnowledgePoints = knowledgeAsset.knowledgePoints.filter((point) => coreKnowledgePointIds.has(point.id));
    for (const point of coreKnowledgePoints) {
      if (point.activityPolicy !== "all_in_order" || point.contentEstimatedMinutes === undefined) {
        failInvalidProfile([`revision 3 knowledge point ${point.id} must declare all_in_order and contentEstimatedMinutes`]);
      }
    }
    const [cardDocuments, assessmentDocuments] = await Promise.all([
      jsonDocuments(assertPathInside(directory, resolve(directory, manifest.paths.cards))),
      jsonDocuments(assertPathInside(directory, resolve(directory, manifest.paths.assessments))),
    ]);
    validateRevision3CardAsset(cardDocuments, coreKnowledgePoints);
    validateRevision3QuizAssets(assessmentDocuments, coreKnowledgePoints, activitiesAsset.activities);
  }
  return manifest;
}
