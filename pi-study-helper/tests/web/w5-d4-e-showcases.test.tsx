// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ShowcasePage } from "../../src/web/pages/ShowcasePage.js";
import {
  FORMAL_DIFFERENCES,
  FORMAL_SHOWCASES,
  FORMAL_SHOWCASE_SEAL,
  type FormalShowcase,
} from "../../src/web/showcase/formal-showcase-data.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en")).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function actualDifferences(left: FormalShowcase, right: FormalShowcase) {
  const values: Array<{ observable: string; key: string; left: unknown; right: unknown }> = [];
  const add = (observable: string, key: string, leftValue: unknown, rightValue: unknown) => {
    if (stableJson(leftValue) !== stableJson(rightValue)) values.push({ observable, key, left: leftValue, right: rightValue });
  };
  add("background", "explanation_preference", left.semantic.background.explanation_preference, right.semantic.background.explanation_preference);
  add("diagnostic", "insufficientKnowledgePointIds", left.semantic.diagnostic.insufficientKnowledgePointIds, right.semantic.diagnostic.insufficientKnowledgePointIds);
  const rightStates = new Map(right.semantic.diagnostic.knowledgeStates.map((state) => [state.knowledgePointId, state]));
  for (const state of left.semantic.diagnostic.knowledgeStates) {
    const other = rightStates.get(state.knowledgePointId) as Record<string, unknown> | undefined;
    for (const field of ["mastery", "confidence", "status", "validEvidenceCount", "skipEligible"]) {
      add("knowledge_state", `${state.knowledgePointId}.${field}`, (state as unknown as Record<string, unknown>)[field], other?.[field]);
    }
  }
  const rightNodes = new Map(right.semantic.path.nodes.map((node) => [node.knowledgePointId, node]));
  for (const node of left.semantic.path.nodes) {
    const other = rightNodes.get(node.knowledgePointId) as unknown as Record<string, unknown> | undefined;
    for (const field of ["difficulty", "scaffold", "reasonCodes", "estimatedMinutes", "status"]) {
      add("path_node", `${node.knowledgePointId}.${field}`, (node as unknown as Record<string, unknown>)[field], other?.[field]);
    }
  }
  return values;
}

describe("W5 D4 E formal showcase consumption", () => {
  it("uses A-D4 formal JSON as the only page data source", async () => {
    const paths = JSON.parse(await readFile(resolve("scripts/w5-a-d4/showcase-path-results.json"), "utf8")) as { results: unknown[] };
    const differences = JSON.parse(await readFile(resolve("scripts/w5-a-d4/showcase-differences.json"), "utf8")) as { pairs: unknown[] };
    const generated = JSON.parse(await readFile(resolve("src/web/showcase/formal-showcase-data.json"), "utf8")) as {
      pathResults: { results: unknown[] };
      differences: { pairs: unknown[] };
    };
    expect(generated.pathResults.results).toEqual(paths.results);
    expect(generated.differences.pairs).toEqual(differences.pairs);
    expect(FORMAL_SHOWCASES).toEqual(paths.results);
    expect(FORMAL_DIFFERENCES).toEqual(differences.pairs);
    expect(FORMAL_SHOWCASE_SEAL).toBe("ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d");
  });

  it("independently validates all three paths against the public Profile topology", async () => {
    const knowledge = JSON.parse(await readFile(resolve("fixtures/profiles/pandas-cleaning-revision-3-draft/knowledge/knowledge-points.json"), "utf8")) as {
      knowledgePoints: Array<{ id: string; prerequisiteIds: string[]; activityIds: string[] }>;
    };
    const activities = JSON.parse(await readFile(resolve("fixtures/profiles/pandas-cleaning-revision-3-draft/activities/learning-activities.json"), "utf8")) as {
      activities: Array<{ activityId: string; primaryKnowledgePointId: string; allowedScaffolds: string[] }>;
    };
    const pointById = new Map(knowledge.knowledgePoints.map((point) => [point.id, point]));
    const activityById = new Map(activities.activities.map((activity) => [activity.activityId, activity]));

    for (const item of FORMAL_SHOWCASES) {
      const positions = new Map(item.semantic.path.nodes.map((node, index) => [node.knowledgePointId, index]));
      expect(new Set(item.semantic.path.nodes.map((node) => node.nodeId)).size).toBe(item.semantic.path.nodes.length);
      expect(new Set(item.semantic.path.nodes.map((node) => node.knowledgePointId)).size).toBe(item.semantic.path.nodes.length);
      for (const node of item.semantic.path.nodes) {
        const point = pointById.get(node.knowledgePointId);
        expect(point, node.knowledgePointId).toBeDefined();
        expect(point!.prerequisiteIds.every((id) => (positions.get(id) ?? -1) < positions.get(node.knowledgePointId)!)).toBe(true);
        expect(node.activityIds.length).toBeGreaterThan(0);
        for (const activityId of node.activityIds) {
          expect(point!.activityIds).toContain(activityId);
          expect(activityById.get(activityId)?.primaryKnowledgePointId).toBe(node.knowledgePointId);
        }
        expect(node.activityIds.every((activityId) => activityById.get(activityId)?.allowedScaffolds.includes(node.scaffold))).toBe(true);
      }
      const firstAvailable = item.semantic.path.nodes.find((node) => node.status === "available");
      expect(item.semantic.nextStep).toMatchObject({
        completed: false,
        nodeId: firstAvailable?.nodeId,
        activityId: firstAvailable?.activityIds[0],
      });
      expect(sha256(stableJson(item.semantic.path))).toBe(item.pathSha256);
      expect(sha256(stableJson(item.semantic))).toBe(item.outputSha256);
    }
  });

  it("recalculates the three pairwise differences from A actual outputs", () => {
    const byId = new Map(FORMAL_SHOWCASES.map((item) => [item.input.caseId, item]));
    const counts = FORMAL_DIFFERENCES.map((pair) => {
      const actual = actualDifferences(byId.get(pair.leftCaseId)!, byId.get(pair.rightCaseId)!);
      expect(actual).toEqual(pair.differences);
      expect(actual.length).toBeGreaterThanOrEqual(3);
      return actual.length;
    });
    expect(counts).toEqual([32, 12, 21]);
  });

  it("renders a selected formal case and its actual differences", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<MemoryRouter initialEntries={["/showcases?case=showcase-practice-oriented"]}><Routes><Route path="/showcases" element={<ShowcasePage />} /></Routes></MemoryRouter>);
    });
    expect(host.querySelector('[data-formal-source="w5-a-d4"]')).not.toBeNull();
    expect(host.textContent).toContain("showcase-practice-oriented");
    expect(host.textContent).toContain(FORMAL_SHOWCASES[2]!.pathSha256);
    expect(host.textContent).toContain("12");
    expect(host.textContent).toContain("21");
  });
});
