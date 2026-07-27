import type { ActivitySafeView } from "../application/learning-runtime-facade.js";

export type ReviewGraphId = "generator" | "hunter" | "defender" | "judge";

export interface ReviewActivityContext {
  activityId: string;
  activityVersion: number;
  kind: ActivitySafeView["kind"];
  title: string;
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
}

export interface ReviewSafeContext {
  activity: ReviewActivityContext;
  safeFeedback: string;
  sourceIds: string[];
  sourceSummary: string;
}

export interface GeneratorInput {
  context: ReviewSafeContext;
  allowedSourcesSummary: string;
}

export interface GeneratorOutput {
  artifactId: string;
  candidateFeedback: string;
  rationale: string;
  citedSourceIds: string[];
  riskFlags: string[];
}

export interface HunterIssue {
  issueId: string;
  severity: "low" | "medium" | "high";
  message: string;
  disputed: boolean;
}

export interface HunterInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
}

export interface HunterOutput {
  issues: HunterIssue[];
  requiresDefender: boolean;
  recommendedVerdict: "accepted" | "revise";
}

export interface DefenderInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
  hunter: HunterOutput;
}

export interface DefenderOutput {
  defenseSummary: string;
  acceptedIssueIds: string[];
  rebuttedIssueIds: string[];
  residualRisks: string[];
}

export interface JudgeInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
  hunter: HunterOutput;
  defender?: DefenderOutput;
}

export interface JudgeOutput {
  verdict: "accepted" | "revise" | "rejected";
  finalSafeFeedback: string;
  summary: string;
  blockedIssueIds: string[];
}

export interface ReviewRoleDefinition<Input, Output> {
  graphId: ReviewGraphId;
  validateInput(value: unknown): value is Input;
  validateOutput(value: unknown): value is Output;
  buildSystemPrompt(input: Input): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return keys.every((key) => allowed.has(key)) && required.every((key) => key in value);
}

function isActivityContext(value: unknown): value is ReviewActivityContext {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, [
    "activityId",
    "activityVersion",
    "kind",
    "title",
    "primaryKnowledgePointId",
    "supportingKnowledgePointIds",
  ])
    && isNonEmptyString(value.activityId)
    && typeof value.activityVersion === "number"
    && isNonEmptyString(value.kind)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.primaryKnowledgePointId)
    && isStringArray(value.supportingKnowledgePointIds);
}

function isReviewSafeContext(value: unknown): value is ReviewSafeContext {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, [
    "activity",
    "safeFeedback",
    "sourceIds",
    "sourceSummary",
  ])
    && isActivityContext(value.activity)
    && isNonEmptyString(value.safeFeedback)
    && isStringArray(value.sourceIds)
    && isNonEmptyString(value.sourceSummary);
}

function isGeneratorInput(value: unknown): value is GeneratorInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "allowedSourcesSummary"])
    && isReviewSafeContext(value.context)
    && isNonEmptyString(value.allowedSourcesSummary);
}

function isGeneratorOutput(value: unknown): value is GeneratorOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["artifactId", "candidateFeedback", "rationale", "citedSourceIds", "riskFlags"])
    && isNonEmptyString(value.artifactId)
    && isNonEmptyString(value.candidateFeedback)
    && isNonEmptyString(value.rationale)
    && isStringArray(value.citedSourceIds)
    && isStringArray(value.riskFlags);
}

function isHunterIssue(value: unknown): value is HunterIssue {
  return isRecord(value)
    && hasOnlyKeys(value, ["issueId", "severity", "message", "disputed"])
    && isNonEmptyString(value.issueId)
    && (value.severity === "low" || value.severity === "medium" || value.severity === "high")
    && isNonEmptyString(value.message)
    && (value.disputed === true || value.disputed === false);
}

function isHunterInput(value: unknown): value is HunterInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "generator"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator);
}

function isHunterOutput(value: unknown): value is HunterOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["issues", "requiresDefender", "recommendedVerdict"])
    && Array.isArray(value.issues)
    && value.issues.every(isHunterIssue)
    && (value.requiresDefender === true || value.requiresDefender === false)
    && (value.recommendedVerdict === "accepted" || value.recommendedVerdict === "revise");
}

function isDefenderInput(value: unknown): value is DefenderInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "generator", "hunter"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator)
    && isHunterOutput(value.hunter);
}

function isDefenderOutput(value: unknown): value is DefenderOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["defenseSummary", "acceptedIssueIds", "rebuttedIssueIds", "residualRisks"])
    && isNonEmptyString(value.defenseSummary)
    && isStringArray(value.acceptedIssueIds)
    && isStringArray(value.rebuttedIssueIds)
    && isStringArray(value.residualRisks);
}

function isJudgeInput(value: unknown): value is JudgeInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "generator", "hunter"], ["defender"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator)
    && isHunterOutput(value.hunter)
    && (value.defender === undefined || isDefenderOutput(value.defender));
}

function isJudgeOutput(value: unknown): value is JudgeOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["verdict", "finalSafeFeedback", "summary", "blockedIssueIds"])
    && (value.verdict === "accepted" || value.verdict === "revise" || value.verdict === "rejected")
    && isNonEmptyString(value.finalSafeFeedback)
    && isNonEmptyString(value.summary)
    && isStringArray(value.blockedIssueIds);
}

function generatorPrompt(input: GeneratorInput): string {
  return [
    "Generator role in the serial review chain.",
    "Use only the supplied safe context and allowed sources.",
    "Do not mention hidden tests, raw learner answers, reference solutions, or host paths.",
    `sources=${input.allowedSourcesSummary}`,
  ].join("\n");
}

function hunterPrompt(input: HunterInput): string {
  return [
    "Hunter role in the serial review chain.",
    "Find concrete defects, leakage risks, and boundary problems.",
    "Do not change score or rewrite the candidate.",
    `generator=${input.generator.artifactId}`,
  ].join("\n");
}

function defenderPrompt(input: DefenderInput): string {
  return [
    "Defender role in the serial review chain.",
    "Respond only to disputed Hunter issues using the safe context.",
    "Do not invent facts from hidden assets.",
    `issues=${input.hunter.issues.length}`,
  ].join("\n");
}

function judgePrompt(input: JudgeInput): string {
  return [
    "Judge role in the serial review chain.",
    "Choose accepted, revise, or rejected from the provided evidence.",
    "Do not modify rubric, path, or answers.",
    `recommended=${input.hunter.recommendedVerdict}`,
    `defender=${input.defender ? "yes" : "no"}`,
  ].join("\n");
}

export interface StudyReviewGraphs {
  generator: ReviewRoleDefinition<GeneratorInput, GeneratorOutput>;
  hunter: ReviewRoleDefinition<HunterInput, HunterOutput>;
  defender: ReviewRoleDefinition<DefenderInput, DefenderOutput>;
  judge: ReviewRoleDefinition<JudgeInput, JudgeOutput>;
}

export function createStudyReviewGraphs(): StudyReviewGraphs {
  return {
    generator: {
      graphId: "generator",
      validateInput: isGeneratorInput,
      validateOutput: isGeneratorOutput,
      buildSystemPrompt: generatorPrompt,
    },
    hunter: {
      graphId: "hunter",
      validateInput: isHunterInput,
      validateOutput: isHunterOutput,
      buildSystemPrompt: hunterPrompt,
    },
    defender: {
      graphId: "defender",
      validateInput: isDefenderInput,
      validateOutput: isDefenderOutput,
      buildSystemPrompt: defenderPrompt,
    },
    judge: {
      graphId: "judge",
      validateInput: isJudgeInput,
      validateOutput: isJudgeOutput,
      buildSystemPrompt: judgePrompt,
    },
  };
}
