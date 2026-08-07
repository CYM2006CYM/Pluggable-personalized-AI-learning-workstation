import { describe, expect, it } from "vitest";
import type { KnowledgeState } from "../src/domain/v2-types.js";
import { PathEngine, type PathEngineProfile } from "../src/domain/path-engine.js";

const profile: PathEngineProfile = {
  subjectId: "demo",
  profileRevision: 2,
  goals: [{
    goalId: "goal-main",
    title: "主目标",
    targetKnowledgePointIds: ["c"],
    requiredActivityIds: ["act-a", "act-b", "act-c"],
  }],
  knowledgePoints: [
    { id: "a", title: "基础", chapterId: "ch", sectionId: "s", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["src-a"], activityIds: ["act-a"], importance: 0.1 },
    { id: "b", title: "中间", chapterId: "ch", sectionId: "s", prerequisiteIds: ["a"], relatedKnowledgePointIds: [], sourceAnchorIds: ["src-b"], activityIds: ["act-b"], importance: 0.2 },
    { id: "c", title: "目标", chapterId: "ch", sectionId: "s", prerequisiteIds: ["b"], relatedKnowledgePointIds: [], sourceAnchorIds: ["src-c"], activityIds: ["act-c"], importance: 0.3 },
  ],
  activities: [
    { activityId: "act-a", primaryKnowledgePointId: "a", supportingKnowledgePointIds: [], goalIds: ["goal-main"], estimatedMinutes: 5, difficulty: "S-R", allowedScaffolds: ["hint", "worked_example"] },
    { activityId: "act-b", primaryKnowledgePointId: "b", supportingKnowledgePointIds: [], goalIds: ["goal-main"], estimatedMinutes: 10, difficulty: "S-U", allowedScaffolds: ["hint", "worked_example"] },
    { activityId: "act-c", primaryKnowledgePointId: "c", supportingKnowledgePointIds: [], goalIds: ["goal-main"], estimatedMinutes: 20, difficulty: "M-U", allowedScaffolds: ["none", "hint"] },
  ],
};

function state(id: string, partial: Partial<KnowledgeState> = {}): KnowledgeState {
  return {
    knowledgePointId: id,
    profileRevision: 2,
    evidenceVersion: 0,
    aggregationVersion: "knowledge-state-v1",
    mastery: null,
    confidence: 0,
    status: "unverified",
    validEvidenceCount: 0,
    evidenceFormCount: 0,
    evidenceIds: [],
    consideredEvidenceIds: [],
    asOf: "2026-01-01T00:00:00.000Z",
    skipEligible: false,
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("PathEngine path-engine-v1", () => {
  it("builds a stable prerequisite-closed topological path", () => {
    const engine = new PathEngine(profile);
    const input = {
      sessionId: "session-1",
      profileRevision: 2,
      evidenceVersion: 0,
      goalId: "goal-main",
      mode: "recommended" as const,
      availableMinutes: 40,
      selectedKnowledgePointIds: [],
      lockedNodeIds: [],
      knowledgeStates: [state("a"), state("b"), state("c")],
    };
    const first = engine.build(input);
    const second = engine.build(input);
    expect(first).toEqual(second);
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.path.nodes.map((node) => node.knowledgePointId)).toEqual(["a", "b", "c"]);
    expect(first.path.nodes[0]?.status).toBe("available");
    expect(first.path.nodes[1]?.status).toBe("locked");
  });

  it("compresses optional mastered prerequisites and reports budget infeasibility", () => {
    const engine = new PathEngine(profile);
    const mastered = state("a", { mastery: 1, confidence: 1, status: "mastered", skipEligible: true, evidenceFormCount: 1 });
    const result = engine.build({
      sessionId: "session-1",
      profileRevision: 2,
      evidenceVersion: 1,
      goalId: "goal-main",
      mode: "recommended",
      availableMinutes: 20,
      selectedKnowledgePointIds: [],
      lockedNodeIds: [],
      knowledgeStates: [mastered, state("b"), state("c")],
    });
    expect(result.status).toBe("infeasible");
    if (result.status === "infeasible") expect(result.failure.code).toBe("path_infeasible");
  });

  it("keeps completed and in-progress nodes at their original positions during replan", () => {
    const engine = new PathEngine(profile);
    const initial = engine.build({
      sessionId: "session-1", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended",
      availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a"), state("b"), state("c")],
    });
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") return;
    initial.path.nodes[0]!.status = "completed";
    const replanned = engine.replan({
      sessionId: "session-1", profileRevision: 2, evidenceVersion: 1, goalId: "goal-main", mode: "recommended",
      availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: ["node-a"], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b"), state("c")],
      previousPath: initial.path, trigger: "knowledge_state_changed",
    });
    expect(replanned.status).toBe("ok");
    if (replanned.status === "ok") expect(replanned.path.nodes[0]?.nodeId).toBe("node-a");
  });

  it("recomputes only the unfinished suffix when skipEligible changes", () => {
    const engine = new PathEngine(profile);
    const initial = engine.build({ sessionId: "fixed-suffix", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a"), state("b"), state("c")] });
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") return;
    initial.path.nodes[0]!.status = "completed";
    initial.path.nodes[1]!.status = "in_progress";
    initial.path.nodes[2]!.positionLocked = true;
    const fixed = initial.path.nodes.map((node) => structuredClone(node));
    const replanned = engine.replan({ sessionId: "fixed-suffix", profileRevision: 2, evidenceVersion: 1, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: ["node-c"], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b"), state("c")], previousPath: initial.path, trigger: "skip_eligibility_changed" });
    expect(replanned.status).toBe("ok");
    if (replanned.status === "ok") {
      expect(replanned.path.nodes[0]).toEqual(fixed[0]);
      expect(replanned.path.nodes[1]).toEqual(fixed[1]);
      expect(replanned.path.nodes[2]).toEqual(fixed[2]);
    }
  });

  it("treats selected knowledge points as a non-skippable legal constraint", () => {
    const engine = new PathEngine({
      ...profile,
      goals: [{ goalId: "goal-c", title: "目标", targetKnowledgePointIds: ["c"], requiredActivityIds: ["act-c"] }],
      activities: profile.activities.map((activity) => ({ ...activity, goalIds: ["goal-c"] })),
    });
    const result = engine.build({
      sessionId: "selected", profileRevision: 2, evidenceVersion: 1, goalId: "goal-c", mode: "recommended",
      availableMinutes: 40, selectedKnowledgePointIds: ["a"], lockedNodeIds: [],
      knowledgeStates: [state("a", { mastery: 1, confidence: 1, status: "mastered", skipEligible: true }), state("b"), state("c")],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const selected = result.path.nodes.find((node) => node.knowledgePointId === "a")!;
      expect(selected.required).toBe(true);
      expect(selected.status).not.toBe("skipped");
      expect(selected.reasonCodes).toContain("user_selected");
    }
  });

  it("orders ready same-layer prerequisites by exposed gap before importance", () => {
    const orderedProfile: PathEngineProfile = {
      ...profile,
      goals: [{ goalId: "goal-order", title: "排序", targetKnowledgePointIds: ["target"], requiredActivityIds: ["act-target"] }],
      knowledgePoints: [
        { ...profile.knowledgePoints[0]!, id: "mastered-high", prerequisiteIds: [], activityIds: ["act-mastered"], importance: 0.9 },
        { ...profile.knowledgePoints[1]!, id: "gap-low", prerequisiteIds: [], activityIds: ["act-gap"], importance: 0.1 },
        { ...profile.knowledgePoints[2]!, id: "target", prerequisiteIds: ["mastered-high", "gap-low"], activityIds: ["act-target"], importance: 0.5 },
      ],
      activities: [
        { ...profile.activities[0]!, activityId: "act-mastered", primaryKnowledgePointId: "mastered-high", goalIds: ["goal-order"] },
        { ...profile.activities[1]!, activityId: "act-gap", primaryKnowledgePointId: "gap-low", goalIds: ["goal-order"] },
        { ...profile.activities[2]!, activityId: "act-target", primaryKnowledgePointId: "target", goalIds: ["goal-order"] },
      ],
    };
    const result = new PathEngine(orderedProfile).build({
      sessionId: "order", profileRevision: 2, evidenceVersion: 1, goalId: "goal-order", mode: "recommended",
      availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [],
      knowledgeStates: [state("mastered-high", { mastery: 1, confidence: 1, status: "mastered", skipEligible: true }), state("gap-low"), state("target")],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.path.nodes.map((node) => node.knowledgePointId)).toEqual(["gap-low", "mastered-high", "target"]);
  });

  it("retains every required and final activity on its owning node", () => {
    const mandatory: PathEngineProfile = {
      ...profile,
      goals: [{ goalId: "goal-mandatory", title: "必做", targetKnowledgePointIds: ["a"], requiredActivityIds: ["act-required"], finalActivityId: "act-final" }],
      knowledgePoints: [{ ...profile.knowledgePoints[0]!, id: "a", prerequisiteIds: [], activityIds: ["act-extra", "act-required", "act-final"] }],
      activities: [
        { ...profile.activities[0]!, activityId: "act-extra", primaryKnowledgePointId: "a", goalIds: ["goal-mandatory"], estimatedMinutes: 1 },
        { ...profile.activities[0]!, activityId: "act-required", primaryKnowledgePointId: "a", goalIds: ["goal-mandatory"], estimatedMinutes: 10 },
        { ...profile.activities[0]!, activityId: "act-final", primaryKnowledgePointId: "a", goalIds: ["goal-mandatory"], estimatedMinutes: 20 },
      ],
    };
    const result = new PathEngine(mandatory).build({
      sessionId: "mandatory", profileRevision: 2, evidenceVersion: 0, goalId: "goal-mandatory", mode: "recommended",
      availableMinutes: 30, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a")],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.path.nodes[0]?.activityIds).toEqual(["act-required", "act-final"]);
  });

  it("keeps a mastered but non-skippable prerequisite and locks all dependents", () => {
    const result = new PathEngine(profile).build({ sessionId: "skip-false", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { mastery: 1, confidence: 1, status: "mastered", skipEligible: false }), state("b"), state("c")] });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.path.nodes.find((node) => node.knowledgePointId === "a")).toMatchObject({ required: true, status: "available" });
    expect(result.path.nodes.find((node) => node.knowledgePointId === "b")?.status).toBe("locked");
    expect(result.path.nodes.find((node) => node.knowledgePointId === "c")?.status).toBe("locked");
  });

  it("skips a mastered prerequisite only when skipEligible is true", () => {
    const skipProfile = { ...profile, goals: [{ goalId: "goal-c", title: "c", targetKnowledgePointIds: ["c"], requiredActivityIds: ["act-c"] }], activities: profile.activities.map((activity) => ({ ...activity, goalIds: ["goal-c"] })) } satisfies PathEngineProfile;
    const result = new PathEngine(skipProfile).build({ sessionId: "skip-true", profileRevision: 2, evidenceVersion: 0, goalId: "goal-c", mode: "recommended", availableMinutes: 30, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { mastery: 1, confidence: 1, status: "mastered", skipEligible: true }), state("b"), state("c")] });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.path.nodes.find((node) => node.knowledgePointId === "a")?.status).toBe("skipped");
    expect(result.path.nodes.find((node) => node.knowledgePointId === "b")?.status).toBe("available");
  });

  it("treats skipEligible=true as authoritative even when code evidence is required", () => {
    const requiresEvidence = {
      ...profile,
      goals: [{ goalId: "goal-c", title: "c", targetKnowledgePointIds: ["c"], requiredActivityIds: ["act-c"] }],
      knowledgePoints: profile.knowledgePoints.map((point) => point.id === "a" ? { ...point, requiresCodeEvidence: true } : point),
      activities: profile.activities.map((activity) => ({ ...activity, goalIds: ["goal-c"] })),
    } satisfies PathEngineProfile;
    const result = new PathEngine(requiresEvidence).build({ sessionId: "skip-authority", profileRevision: 2, evidenceVersion: 0, goalId: "goal-c", mode: "recommended", availableMinutes: 30, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true, evidenceFormCount: 0 }), state("b"), state("c")] });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.path.nodes.find((node) => node.knowledgePointId === "a")?.status).toBe("skipped");
  });

  it("does not cross a non-skippable middle prerequisite in a multi-level chain", () => {
    const result = new PathEngine(profile).build({ sessionId: "middle-gap", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { mastery: 1, confidence: 1, status: "mastered", skipEligible: true }), state("b", { mastery: 1, confidence: 1, status: "mastered", skipEligible: false }), state("c")] });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.path.nodes.find((node) => node.knowledgePointId === "b")?.required).toBe(true);
    expect(result.path.nodes.find((node) => node.knowledgePointId === "c")?.status).toBe("locked");
  });

  it("rejects a valid knowledge point selection outside the goal closure deterministically", () => {
    const extended = { ...profile, knowledgePoints: [...profile.knowledgePoints, { id: "unrelated", title: "无关", chapterId: "ch", sectionId: "s", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["src"], activityIds: ["act-a"], importance: 0.1 }] };
    const result = new PathEngine(extended).build({ sessionId: "selection-outside", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: ["unrelated"], lockedNodeIds: [], knowledgeStates: [state("a"), state("b"), state("c")] });
    expect(result).toMatchObject({ status: "infeasible", failure: { code: "path_infeasible", missingPrerequisiteIds: ["unrelated"] } });
  });

  it("validates chapterId without changing the goal closure or same-layer order", () => {
    const chapter = new PathEngine(profile).build({ sessionId: "chapter", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "chapter", chapterId: "ch", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a"), state("b"), state("c")] });
    const invalid = () => new PathEngine(profile).build({ sessionId: "chapter-invalid", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "chapter", chapterId: "missing", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a"), state("b"), state("c")] });
    expect(chapter.status).toBe("ok");
    expect(invalid).toThrow("chapterId");
  });

  it("never uses chapterId as a hidden same-layer tie breaker", () => {
    const ordered: PathEngineProfile = {
      profileRevision: 2,
      goals: [{ goalId: "ordered", title: "ordered", targetKnowledgePointIds: ["target"], requiredActivityIds: ["target-act"] }],
      knowledgePoints: [
        { id: "declared-first", title: "first", chapterId: "chapter-z", sectionId: "s", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["s"], activityIds: ["first-act"], importance: 1 },
        { id: "declared-second", title: "second", chapterId: "chapter-a", sectionId: "s", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["s"], activityIds: ["second-act"], importance: 1 },
        { id: "target", title: "target", chapterId: "chapter-a", sectionId: "s", prerequisiteIds: ["declared-first", "declared-second"], relatedKnowledgePointIds: [], sourceAnchorIds: ["s"], activityIds: ["target-act"], importance: 1 },
      ],
      activities: [
        { activityId: "first-act", primaryKnowledgePointId: "declared-first", supportingKnowledgePointIds: [], goalIds: ["ordered"], difficulty: "S-U", allowedScaffolds: ["hint"] },
        { activityId: "second-act", primaryKnowledgePointId: "declared-second", supportingKnowledgePointIds: [], goalIds: ["ordered"], difficulty: "S-U", allowedScaffolds: ["hint"] },
        { activityId: "target-act", primaryKnowledgePointId: "target", supportingKnowledgePointIds: [], goalIds: ["ordered"], difficulty: "M-U", allowedScaffolds: ["hint"] },
      ],
    };
    const result = new PathEngine(ordered).build({ sessionId: "order-chapter", profileRevision: 2, evidenceVersion: 0, goalId: "ordered", mode: "chapter", chapterId: "chapter-a", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("declared-first"), state("declared-second"), state("target")] });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.path.nodes.map((node) => node.knowledgePointId)).toEqual(["declared-first", "declared-second", "target"]);
  });

  it("selects real optional activities by difficulty interval, nearest distance, then declaration order", () => {
    const optional = {
      profileRevision: 2,
      goals: [{ goalId: "optional", title: "optional", targetKnowledgePointIds: ["p"], requiredActivityIds: [] }],
      knowledgePoints: [{ id: "p", title: "p", chapterId: "ch", sectionId: "s", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["src"], activityIds: ["far", "tie-first", "tie-second"], importance: 1 }],
      activities: [
        { activityId: "far", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["optional"], difficulty: "C-A" as const, allowedScaffolds: ["hint" as const] },
        { activityId: "tie-first", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["optional"], difficulty: "M-A" as const, allowedScaffolds: ["hint" as const] },
        { activityId: "tie-second", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["optional"], difficulty: "S-R" as const, allowedScaffolds: ["hint" as const] },
      ],
    } satisfies PathEngineProfile;
    const result = new PathEngine(optional).build({ sessionId: "difficulty", profileRevision: 2, evidenceVersion: 0, goalId: "optional", mode: "recommended", availableMinutes: 10, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("p", { status: "learning", mastery: 0.5 })] });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.path.nodes[0]?.activityIds).toEqual(["tie-first"]);
    const exact = new PathEngine({ ...optional, activities: [...optional.activities, { activityId: "exact", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["optional"], difficulty: "M-U", allowedScaffolds: ["hint"] }], knowledgePoints: [{ ...optional.knowledgePoints[0]!, activityIds: ["far", "tie-first", "tie-second", "exact"] }] }).build({ sessionId: "difficulty-exact", profileRevision: 2, evidenceVersion: 0, goalId: "optional", mode: "recommended", availableMinutes: 10, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("p", { status: "learning", mastery: 0.5 })] });
    expect(exact.status).toBe("ok");
    if (exact.status === "ok") expect(exact.path.nodes[0]?.activityIds).toEqual(["exact"]);
  });

  it("uses the KnowledgeState scaffold recommendation inside the activity allowance", () => {
    const result = new PathEngine(profile).build({ sessionId: "scaffold", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a"), state("b"), state("c")] });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.path.nodes[0]?.scaffold).toBe("worked_example");
  });

  it("derives stable changeReasons from real changes and leaves an unchanged replan empty", () => {
    const engine = new PathEngine(profile);
    const previous = engine.build({ sessionId: "reasons", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("c", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true })] });
    expect(previous.status).toBe("ok");
    if (previous.status !== "ok") return;
    const unchanged = engine.replan({ sessionId: "reasons", profileRevision: 2, evidenceVersion: 0, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("c", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true })], previousPath: previous.path, trigger: "knowledge_state_changed" });
    expect(unchanged.status).toBe("ok");
    if (unchanged.status === "ok") expect(unchanged.path.changeReasons).toEqual([]);
    const changed = engine.replan({ sessionId: "reasons", profileRevision: 2, evidenceVersion: 1, goalId: "goal-main", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: ["a"], lockedNodeIds: [], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b", { status: "support_needed", mastery: 0.2, confidence: 1 }), state("c", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true })], previousPath: previous.path, trigger: "error_remediation" });
    expect(changed.status).toBe("ok");
    if (changed.status === "ok") expect(changed.path.changeReasons).toEqual(["error_remediation", "user_selected", "low_mastery"]);
  });

  it("emits prerequisite, evidence, and time compression reasons only when their path delta exists", () => {
    const skipProfile = { ...profile, goals: [{ goalId: "goal-c", title: "c", targetKnowledgePointIds: ["c"], requiredActivityIds: ["act-c"] }], activities: profile.activities.map((activity) => ({ ...activity, goalIds: ["goal-c"] })) } satisfies PathEngineProfile;
    const engine = new PathEngine(skipProfile);
    const previous = engine.build({ sessionId: "delta-reasons", profileRevision: 2, evidenceVersion: 0, goalId: "goal-c", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("c", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true })] });
    expect(previous.status).toBe("ok");
    if (previous.status !== "ok") return;
    const changed = engine.replan({ sessionId: "delta-reasons", profileRevision: 2, evidenceVersion: 1, goalId: "goal-c", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b"), state("c", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true })], previousPath: previous.path, trigger: "knowledge_state_changed" });
    expect(changed.status).toBe("ok");
    if (changed.status === "ok") expect(changed.path.changeReasons).toEqual(["evidence_insufficient", "prerequisite_gap"]);
  });

  it("keeps real optional Profile activities at high budget and compresses only them", () => {
    const optionalProfile = {
      ...profile,
      goals: [{ goalId: "goal-c", title: "c", targetKnowledgePointIds: ["c"], requiredActivityIds: ["act-c"], finalActivityId: "act-c" }],
      knowledgePoints: profile.knowledgePoints.map((point) => point.id === "c" ? { ...point, activityIds: ["act-c", "optional-c"] } : point),
      activities: [...profile.activities.map((activity) => ({ ...activity, goalIds: ["goal-c"] })), { activityId: "optional-c", primaryKnowledgePointId: "c", supportingKnowledgePointIds: [], goalIds: ["goal-c"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["hint", "worked_example"] }],
    } satisfies PathEngineProfile;
    const engine = new PathEngine(optionalProfile);
    const states = [state("a", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("b", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("c")];
    const high = engine.build({ sessionId: "optional-high", profileRevision: 2, evidenceVersion: 0, goalId: "goal-c", mode: "recommended", availableMinutes: 40, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: states });
    expect(high.status).toBe("ok");
    if (high.status !== "ok") return;
    expect(high.path.nodes.find((node) => node.knowledgePointId === "c")?.activityIds).toContain("optional-c");
    const low = engine.replan({ sessionId: "optional-high", profileRevision: 2, evidenceVersion: 1, goalId: "goal-c", mode: "recommended", availableMinutes: 20, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: states, previousPath: high.path, trigger: "knowledge_state_changed" });
    expect(low.status).toBe("ok");
    if (low.status === "ok") {
      const target = low.path.nodes.find((node) => node.knowledgePointId === "c")!;
      expect(target.activityIds).not.toContain("optional-c");
      expect(target.activityIds).toContain("act-c");
      expect(target.reasonCodes).toContain("time_compressed");
      expect(low.path.changeReasons).toEqual(["time_compressed"]);
      expect(engine.replan({ sessionId: "optional-high", profileRevision: 2, evidenceVersion: 1, goalId: "goal-c", mode: "recommended", availableMinutes: 20, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: states, previousPath: high.path, trigger: "knowledge_state_changed" })).toEqual(low);
    }
  });

  it("rejects a replan when a fixed in-progress node keeps the path over the new budget", () => {
    const fixedProfile: PathEngineProfile = {
      profileRevision: 2,
      goals: [{ goalId: "fixed-budget", title: "fixed", targetKnowledgePointIds: ["p"], requiredActivityIds: ["required-p"], finalActivityId: "required-p" }],
      knowledgePoints: [{ id: "p", title: "p", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source"], activityIds: ["required-p", "optional-p"], importance: 1 }],
      activities: [
        { activityId: "required-p", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["fixed-budget"], estimatedMinutes: 10, difficulty: "S-U", allowedScaffolds: ["none"] },
        { activityId: "optional-p", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["fixed-budget"], estimatedMinutes: 10, difficulty: "M-U", allowedScaffolds: ["none"] },
      ],
    };
    const engine = new PathEngine(fixedProfile);
    const initial = engine.build({ sessionId: "fixed-budget", profileRevision: 2, evidenceVersion: 0, goalId: "fixed-budget", mode: "recommended", availableMinutes: 20, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [state("p")] });
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") return;
    initial.path.nodes[0]!.status = "in_progress";
    const fixedContent = structuredClone(initial.path.nodes[0]);
    const infeasible = engine.replan({ sessionId: "fixed-budget", profileRevision: 2, evidenceVersion: 1, goalId: "fixed-budget", mode: "recommended", availableMinutes: 10, selectedKnowledgePointIds: [], lockedNodeIds: ["node-p"], knowledgeStates: [state("p")], previousPath: initial.path, trigger: "knowledge_state_changed" });
    expect(infeasible).toMatchObject({ status: "infeasible", failure: { code: "path_infeasible", minimumRequiredMinutes: 20 } });
    if (infeasible.status === "infeasible") expect(infeasible.failure.suggestions).toContain("increase_time");
    expect(fixedContent).toEqual(initial.path.nodes[0]);
    const positionLockedPath = structuredClone(initial.path);
    positionLockedPath.nodes[0]!.status = "available";
    positionLockedPath.nodes[0]!.positionLocked = true;
    const positionLockedFailure = engine.replan({ sessionId: "fixed-budget", profileRevision: 2, evidenceVersion: 1, goalId: "fixed-budget", mode: "recommended", availableMinutes: 10, selectedKnowledgePointIds: [], lockedNodeIds: ["node-p"], knowledgeStates: [state("p")], previousPath: positionLockedPath, trigger: "knowledge_state_changed" });
    expect(positionLockedFailure).toMatchObject({ status: "infeasible", failure: { code: "path_infeasible", minimumRequiredMinutes: 20 } });
    const legal = engine.replan({ sessionId: "fixed-budget", profileRevision: 2, evidenceVersion: 1, goalId: "fixed-budget", mode: "recommended", availableMinutes: 20, selectedKnowledgePointIds: [], lockedNodeIds: ["node-p"], knowledgeStates: [state("p")], previousPath: initial.path, trigger: "knowledge_state_changed" });
    expect(legal.status).toBe("ok");
  });
});
