import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AdaptiveContentSourceContext,
  AdaptiveContentSourceProvider,
} from "../application/adaptive-content-service.js";
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

/** Reads only B's public knowledge/activity/source projections, never private answer assets. */
export class ProfileAdaptiveContentSourceProvider implements AdaptiveContentSourceProvider {
  readonly #options: ProfileAdaptiveSourceProviderOptions;

  constructor(options: ProfileAdaptiveSourceProviderOptions) {
    this.#options = options;
  }

  async forCard(input: { profileRevision: number; knowledgePointId: string }): Promise<AdaptiveContentSourceContext> {
    const root = resolve(await this.#options.resolveProfileRoot(input.profileRevision));
    const [knowledgeRaw, sourcesRaw] = await Promise.all([
      readJson(root, "knowledge/knowledge-points.json"),
      readJson(root, "sources/source-map.json"),
    ]);
    const points = records(knowledgeRaw, "knowledgePoints") as KnowledgePointRecord[];
    const sources = records(sourcesRaw, "sources") as SourceRecord[];
    const point = points.find((item) => item.id === input.knowledgePointId);
    if (point === undefined || !Array.isArray(point.sourceAnchorIds)) throw new Error("Knowledge point public projection is unavailable");
    return {
      profileRevision: input.profileRevision,
      knowledgePointId: point.id,
      targetId: point.id,
      title: point.title,
      sourceAnchorIds: [...point.sourceAnchorIds],
      publicSourceSummary: sourceSummary(point.sourceAnchorIds, sources),
      ...(point.contentEstimatedMinutes === undefined ? {} : { estimatedMinutes: point.contentEstimatedMinutes }),
    };
  }

  async forQuiz(input: { profileRevision: number; activityId: string }): Promise<AdaptiveContentSourceContext> {
    const root = resolve(await this.#options.resolveProfileRoot(input.profileRevision));
    const [knowledgeRaw, activitiesRaw, sourcesRaw] = await Promise.all([
      readJson(root, "knowledge/knowledge-points.json"),
      readJson(root, "activities/learning-activities.json"),
      readJson(root, "sources/source-map.json"),
    ]);
    const points = records(knowledgeRaw, "knowledgePoints") as KnowledgePointRecord[];
    const activities = records(activitiesRaw, "activities") as ActivityRecord[];
    const sources = records(sourcesRaw, "sources") as SourceRecord[];
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
      publicSourceSummary: sourceSummary(sourceIds, sources),
    };
  }
}
