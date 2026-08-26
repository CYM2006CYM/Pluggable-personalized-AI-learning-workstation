import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPathRuntimeMethods, type PathProfileResolver } from "../src/application/path-learning-facade.js";
import { lessonVariantForPreference, projectLearningCardForSession } from "../src/application/rich-lesson-selection.js";
import type { LearningCardAsset, LearningCardSafeView } from "../src/contracts/index.js";
import type { PathEngineProfile } from "../src/domain/path-engine.js";
import { validateProfileV2Directory } from "../src/domain/profile-v2-schema.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { materialViewFromLearningCard } from "../src/tui/study-tui-gateway.js";

const PROFILE_ROOT = resolve("fixtures/profiles/pandas-cleaning-revision-3-draft");
const CARDS_PATH = resolve(PROFILE_ROOT, "cards/learning-cards.json");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function cards(): Promise<LearningCardAsset[]> {
  return (JSON.parse(await readFile(CARDS_PATH, "utf8")) as { cards: LearningCardAsset[] }).cards;
}

async function writeCards(root: string, value: LearningCardAsset[]): Promise<void> {
  await writeFile(resolve(root, "cards/learning-cards.json"), `${JSON.stringify({ cards: value }, null, 2)}\n`, "utf8");
}

describe("W6 RichLesson assets", () => {
  it("binds six Pandas lessons, eighteen complete variants and reproducible source documents", async () => {
    const allCards = await cards();
    expect(allCards).toHaveLength(6);
    for (const card of allCards) {
      const lesson = card.richLesson;
      expect(lesson).toBeDefined();
      expect(Object.keys(lesson!.variants).sort()).toEqual(["concise", "guided", "practice"]);
      const expectedRules = lesson!.canonicalRules.map((rule) => rule.ruleId);
      for (const variant of Object.values(lesson!.variants)) {
        expect(variant.chineseCharacterCount).toBeGreaterThanOrEqual(2000);
        expect(variant.chineseCharacterCount).toBeLessThanOrEqual(3000);
        expect(variant.modules.map((module) => module.moduleId)).toEqual([
          "intuition", "concepts", "walkthrough", "mistakes", "final-task", "terms-sources",
        ]);
        expect(variant.learningObjectives.understand.length).toBeGreaterThan(0);
        expect(variant.learningObjectives.master.length).toBeGreaterThan(0);
        expect(variant.coveredRuleIds).toEqual(expectedRules);
      }
      const source = await readFile(resolve("..", lesson!.sourceDocument));
      expect(createHash("sha256").update(source).digest("hex")).toBe(lesson!.sourceDocumentSha256);
    }
  });

  it.each([
    ["missing variant", (allCards: LearningCardAsset[]) => { delete (allCards[0]!.richLesson!.variants as unknown as { practice?: unknown }).practice; }, "variants.practice must be an object"],
    ["missing module", (allCards: LearningCardAsset[]) => { allCards[0]!.richLesson!.variants.guided.modules.pop(); }, "modules must contain six modules"],
    ["unknown field", (allCards: LearningCardAsset[]) => { (allCards[0]!.richLesson as unknown as Record<string, unknown>).unexpected = true; }, "unexpected is an unknown core field"],
    ["duplicate block", (allCards: LearningCardAsset[]) => {
      const blocks = allCards[0]!.richLesson!.variants.guided.modules[0]!.blocks;
      blocks[1]!.blockId = blocks[0]!.blockId;
    }, "blockId must be unique"],
    ["dangling rule claim", (allCards: LearningCardAsset[]) => { allCards[0]!.richLesson!.canonicalRules[0]!.sourceClaimIds = ["missing-claim"]; }, "contains a missing claim"],
    ["source outside point", (allCards: LearningCardAsset[]) => { allCards[0]!.richLesson!.sourceClaims[0]!.sourceAnchorIds = ["outside-source"]; }, "must stay inside knowledge point sources"],
    ["illegal code language", (allCards: LearningCardAsset[]) => {
      const block = allCards[0]!.richLesson!.variants.guided.modules.flatMap((module) => module.blocks).find((item) => item.kind === "code");
      if (block?.kind === "code") (block as { language: string }).language = "javascript";
    }, "language is unsupported"],
  ])("rejects %s deterministically", async (_label, mutate, message) => {
    const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-rich-schema-"));
    roots.push(root);
    await cp(PROFILE_ROOT, root, { recursive: true });
    const allCards = await cards();
    mutate(allCards);
    await writeCards(root, allCards);
    await expect(validateProfileV2Directory(root, "draft")).rejects.toThrow(message);
  });

  it("rejects a revision 3 code activity without its public problem statement", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-problem-schema-"));
    roots.push(root);
    await cp(PROFILE_ROOT, root, { recursive: true });
    const path = resolve(root, "activities/learning-activities.json");
    const document = JSON.parse(await readFile(path, "utf8")) as { activities: Array<Record<string, unknown>> };
    const code = document.activities.find((activity) => activity.kind === "code_completion");
    delete code?.problemStatement;
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await expect(validateProfileV2Directory(root, "draft")).rejects.toThrow("problemStatement must be present for revision 3 code activities");
  });

  it("rejects incomplete public acceptance criteria for revision 3 code activities", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-acceptance-schema-"));
    roots.push(root);
    await cp(PROFILE_ROOT, root, { recursive: true });
    const path = resolve(root, "activities/learning-activities.json");
    const document = JSON.parse(await readFile(path, "utf8")) as { activities: Array<Record<string, unknown>> };
    const code = document.activities.find((activity) => activity.kind === "code_completion");
    code!.publicAcceptanceCriteria = ["只有一项，不能完整说明公开验收合同。"];
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await expect(validateProfileV2Directory(root, "draft")).rejects.toThrow("publicAcceptanceCriteria must contain at least four public checks");
  });

  it("maps only the questionnaire preference and keeps old uncertain compatible", () => {
    expect(lessonVariantForPreference("step_by_step")).toBe("guided");
    expect(lessonVariantForPreference("concise")).toBe("concise");
    expect(lessonVariantForPreference("example_first")).toBe("practice");
    expect(lessonVariantForPreference("uncertain")).toBe("guided");
  });

  it("projects one fixed authority variant and converts a dynamic card to a safe tip", async () => {
    const fixed = (await cards())[0]!;
    const dynamic: LearningCardSafeView = {
      ...projectLearningCardForSession({ fixed, preference: "step_by_step" }),
      cardId: "dynamic-safe-tip",
      selectedLesson: undefined,
      objective: "先关注读取边界。",
      explanation: ["结合你当前的进度，先核对列名再继续。"],
    };
    const projected = projectLearningCardForSession({ fixed, preference: "example_first", dynamicTipSource: dynamic });
    expect(projected.cardId).toBe(fixed.cardId);
    expect(projected.selectedLesson?.variantId).toBe("practice");
    expect(projected.personalizedTip?.text).toContain("先核对列名");
    expect(projected.personalizedTipStatus).toEqual({ state: "generated", reasonCode: "agent_reviewed" });
    expect(JSON.stringify(projected)).not.toContain('"variants"');
    expect(JSON.stringify(projected)).not.toContain("sourceDocumentSha256");
    const tui = materialViewFromLearningCard(projected, { kind: "section", id: fixed.knowledgePointId, label: fixed.title });
    expect(tui.body).toContain("版本：案例优先");
    expect(tui.body).not.toContain("版本：逐步讲解");

    const withoutTip = projectLearningCardForSession({ fixed, preference: "example_first" });
    expect(withoutTip.personalizedTip).toBeUndefined();
    expect(withoutTip.personalizedTipStatus).toEqual({ state: "unavailable", reasonCode: "not_generated" });
  });

  it("snapshots one selected variant through confirmation, restart and recovery reads", async () => {
    const fixed = (await cards())[0]!;
    const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-rich-session-"));
    roots.push(root);
    const sessions = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-08-23T00:00:00.000Z") });
    const profile: PathEngineProfile = {
      subjectId: "pandas-cleaning",
      profileRevision: 3,
      goals: [{ goalId: "goal", title: "读取CSV", targetKnowledgePointIds: [fixed.knowledgePointId], requiredActivityIds: ["activity-read"] }],
      knowledgePoints: [{
        id: fixed.knowledgePointId, title: fixed.title, chapterId: "chapter", sectionId: "section",
        prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: fixed.sourceAnchorIds,
        activityIds: ["activity-read"], importance: 1, contentEstimatedMinutes: fixed.estimatedMinutes,
      }],
      activities: [{
        activityId: "activity-read", primaryKnowledgePointId: fixed.knowledgePointId,
        supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5,
        kind: "mcq", title: "读取练习", prompt: "完成练习",
      }],
    };
    const resolver: PathProfileResolver = {
      load: async () => structuredClone(profile),
      loadCard: async () => structuredClone(fixed),
    };
    const view = await sessions.create({
      requestId: "create-rich", subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal",
      availableMinutes: 20, profileRevision: 3, diagnosticRequired: false,
    });
    await sessions.saveDiagnosticDraftState({
      requestId: "save-preference", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 3,
      diagnosticDraftVersion: 0, draft: {},
      background: { python_experience: "basic", pandas_experience: "basic", explanation_preference: "concise" },
    });
    const runtime = createPathRuntimeMethods({ sessions, profile: resolver });
    const candidate = await runtime.buildPath({
      requestId: "build-rich", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 3,
      goalId: "goal", mode: "recommended", availableMinutes: 20, evidenceVersion: 0,
      selectedKnowledgePointIds: [], lockedNodeIds: [],
    });
    if (candidate.status !== "candidate") throw new Error("expected candidate");
    await runtime.confirmPath({
      requestId: "confirm-rich", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 3,
      pathId: candidate.pathId!, pathVersion: candidate.pathVersion!,
    });
    const restarted = createPathRuntimeMethods({ sessions, profile: resolver });
    const next = await restarted.getNextStep({
      sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, pathVersion: candidate.pathVersion!,
    });
    expect(next.contentReadiness).toBe("ready");
    expect(next.card?.selectedLesson?.variantId).toBe("concise");
    expect(JSON.stringify(next.card)).not.toContain('"variants"');
    const bound = await sessions.getBoundLearningCards({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3 });
    expect(bound[0]?.source).toBe("fixed");
    expect(bound[0]?.card.selectedLesson?.variantId).toBe("concise");
    expect(JSON.stringify(bound)).not.toContain('"variants"');
  });
});
