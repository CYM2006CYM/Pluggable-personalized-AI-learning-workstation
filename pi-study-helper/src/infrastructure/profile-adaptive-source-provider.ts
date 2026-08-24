import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AdaptiveContentSourceContext,
  AdaptiveContentSourceProvider,
} from "../application/adaptive-content-service.js";
import type { LessonVariantId } from "../contracts/index.js";
import { assertPathInside } from "./safe-files.js";

export interface ProfileAdaptiveSourceProviderOptions {
  resolveProfileRoot(profileRevision: number): Promise<string> | string;
}

interface KnowledgePointRecord {
  id: string;
  title: string;
  sourceAnchorIds: string[];
  contentEstimatedMinutes?: number;
}

interface ActivityRecord {
  activityId: string;
  profileRevision: number;
  primaryKnowledgePointId: string;
  title: string;
  sourceAnchorIds: string[];
}

interface SourceRecord {
  sourceId: string;
  title: string;
  excerptRange: string;
  summaryHash: string;
}

interface RichLessonCardRecord {
  knowledgePointId: string;
  richLesson?: {
    canonicalRules?: Array<{ ruleId: string; statement: string }>;
    variants?: Record<string, {
      variantId?: string;
      label?: string;
      learningObjectives?: { understand?: string[]; master?: string[] };
      modules?: Array<{
        moduleId?: string;
        title?: string;
        summary?: string;
        blocks?: Array<{
          kind?: string;
          title?: string;
          text?: string;
          code?: string;
          items?: string[];
        }>;
      }>;
      termNotes?: Array<{ term?: string; explanation?: string }>;
    }>;
  };
}

async function readJson(root: string, relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(assertPathInside(root, resolve(root, relativePath)), "utf8")) as unknown;
}

function records(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${key} asset is not an object`);
  const list = (value as Record<string, unknown>)[key];
  if (!Array.isArray(list)) throw new Error(`${key} asset is not an array`);
  return list;
}

function sourceSummary(sourceIds: readonly string[], sources: readonly SourceRecord[]): string {
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  return sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (source === undefined) throw new Error(`Public source summary is missing: ${sourceId}`);
    return `${source.sourceId}: ${source.title}; ${source.excerptRange}; ${source.summaryHash}`;
  }).join("\n");
}

const FORBIDDEN_LESSON_TEXT = /(?:hidden tests?|reference solutions?|private csv|rubric|api[_ -]?key|authorization|bearer|secret|password|[A-Za-z]:[\\/]|\\\\|\/(?:home|Users|tmp)\b)/iu;

function safeLessonLine(value: unknown, maximum = 2_400): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || FORBIDDEN_LESSON_TEXT.test(normalized)) return undefined;
  return normalized;
}

function teachingContext(base: string, card: RichLessonCardRecord | undefined, requestedVariantId: LessonVariantId = "guided"): string {
  const rules = card?.richLesson?.canonicalRules ?? [];
  const variants = card?.richLesson?.variants;
  const variant = variants?.[requestedVariantId] ?? variants?.guided;
  const lines: string[] = [];
  const add = (label: string, value: unknown, maximum = 2_400) => {
    const safe = safeLessonLine(value, maximum);
    if (safe !== undefined) lines.push(`${label}: ${safe}`);
  };
  add("公开来源摘要", base, 4_000);
  lines.push("当前教学正文仅用于出题依据；只可引用下列公开 sourceAnchorId，不得补造来源。");
  for (const rule of rules) {
    add(`教学规则 ${rule.ruleId}`, rule.statement);
  }
  if (variant !== undefined) {
    add("教学版本", variant.label ?? requestedVariantId, 200);
    for (const item of variant.learningObjectives?.understand ?? []) add("学习目标（了解）", item);
    for (const item of variant.learningObjectives?.master ?? []) add("学习目标（掌握）", item);
    for (const module of variant.modules ?? []) {
      add(`正文模块 ${module.moduleId ?? "module"} 标题`, module.title, 240);
      add("正文模块说明", module.summary);
      for (const block of module.blocks ?? []) {
        if (block.kind === "code") add("正文代码示例", block.code, 3_000);
        else if (block.kind === "list") {
          for (const item of block.items ?? []) add("正文要点", item);
        } else add(`正文${block.kind ?? "段落"}`, block.text ?? block.title);
      }
    }
    for (const note of variant.termNotes ?? []) {
      const term = safeLessonLine(note.term, 240);
      const explanation = safeLessonLine(note.explanation);
      if (term !== undefined && explanation !== undefined) lines.push(`术语 ${term}: ${explanation}`);
    }
  }
  return lines.join("\n").slice(0, 12_000);
}

/** Reads only B's public knowledge/activity/source projections, never private answer assets. */
export class ProfileAdaptiveContentSourceProvider implements AdaptiveContentSourceProvider {
  readonly #options: ProfileAdaptiveSourceProviderOptions;

  constructor(options: ProfileAdaptiveSourceProviderOptions) {
    this.#options = options;
  }

  async forCard(input: { profileRevision: number; knowledgePointId: string; lessonVariantId?: LessonVariantId }): Promise<AdaptiveContentSourceContext> {
    const root = resolve(await this.#options.resolveProfileRoot(input.profileRevision));
    const [knowledgeRaw, sourcesRaw, cardsRaw] = await Promise.all([
      readJson(root, "knowledge/knowledge-points.json"),
      readJson(root, "sources/source-map.json"),
      readJson(root, "cards/learning-cards.json"),
    ]);
    const points = records(knowledgeRaw, "knowledgePoints") as KnowledgePointRecord[];
    const sources = records(sourcesRaw, "sources") as SourceRecord[];
    const cards = records(cardsRaw, "cards") as RichLessonCardRecord[];
    const point = points.find((item) => item.id === input.knowledgePointId);
    if (point === undefined || !Array.isArray(point.sourceAnchorIds)) throw new Error("Knowledge point public projection is unavailable");
    return {
      profileRevision: input.profileRevision,
      knowledgePointId: point.id,
      targetId: point.id,
      title: point.title,
      sourceAnchorIds: [...point.sourceAnchorIds],
      publicSourceSummary: teachingContext(sourceSummary(point.sourceAnchorIds, sources), cards.find((card) => card.knowledgePointId === point.id), input.lessonVariantId),
      ...(point.contentEstimatedMinutes === undefined ? {} : { estimatedMinutes: point.contentEstimatedMinutes }),
      ...(input.lessonVariantId === undefined ? {} : { lessonVariantId: input.lessonVariantId }),
    };
  }

  async forQuiz(input: { profileRevision: number; activityId: string; lessonVariantId?: LessonVariantId }): Promise<AdaptiveContentSourceContext> {
    const root = resolve(await this.#options.resolveProfileRoot(input.profileRevision));
    const [knowledgeRaw, activitiesRaw, sourcesRaw, cardsRaw] = await Promise.all([
      readJson(root, "knowledge/knowledge-points.json"),
      readJson(root, "activities/learning-activities.json"),
      readJson(root, "sources/source-map.json"),
      readJson(root, "cards/learning-cards.json"),
    ]);
    const points = records(knowledgeRaw, "knowledgePoints") as KnowledgePointRecord[];
    const activities = records(activitiesRaw, "activities") as ActivityRecord[];
    const sources = records(sourcesRaw, "sources") as SourceRecord[];
    const cards = records(cardsRaw, "cards") as RichLessonCardRecord[];
    const activity = activities.find((item) => item.activityId === input.activityId && item.profileRevision === input.profileRevision);
    if (activity === undefined || !Array.isArray(activity.sourceAnchorIds)) throw new Error("Activity public projection is unavailable");
    const point = points.find((item) => item.id === activity.primaryKnowledgePointId);
    if (point === undefined) throw new Error("Activity knowledge point public projection is unavailable");
    const sourceIds = [...new Set([...activity.sourceAnchorIds, ...point.sourceAnchorIds])];
    return {
      profileRevision: input.profileRevision,
      knowledgePointId: point.id,
      targetId: activity.activityId,
      title: activity.title,
      sourceAnchorIds: sourceIds,
      publicSourceSummary: teachingContext(sourceSummary(sourceIds, sources), cards.find((card) => card.knowledgePointId === point.id), input.lessonVariantId),
      ...(input.lessonVariantId === undefined ? {} : { lessonVariantId: input.lessonVariantId }),
    };
  }
}
