import type { KnowledgeState } from "../domain/v2-types.js";
import { PathEngine, type LearningPath, type PathEngineProfile } from "../domain/path-engine.js";
import type { InternalPathSessionPort, InternalPersistedPathSnapshot } from "../repositories/internal-path-session-port.js";
import type { SessionSnapshot } from "../repositories/learning-session-repository.js";
import { projectPathNodes } from "./path-progress-projection.js";

export interface ActivityPathSuffixReplanner {
  replan(input: {
    snapshot: SessionSnapshot;
    knowledgeStates: KnowledgeState[];
    evidenceVersion: number;
    trigger: "knowledge_state_changed" | "skip_eligibility_changed" | "error_remediation";
  }): Promise<{ path?: InternalPersistedPathSnapshot; changeReasons: string[] }>;
}

export interface ActivityPathSuffixReplannerOptions {
  sessions: InternalPathSessionPort;
  profile: { load(subjectId: string, profileRevision: number): Promise<PathEngineProfile> };
  now?: () => Date;
}

function projectPathProgress(path: InternalPersistedPathSnapshot, snapshot: SessionSnapshot): InternalPersistedPathSnapshot {
  return {
    ...structuredClone(path),
    status: "confirmed",
    nodes: projectPathNodes(path.nodes, snapshot.activityProgress),
  };
}

/** Reuses PathEngine's frozen suffix algorithm inside an activity commit. */
export function createActivityPathSuffixReplanner(options: ActivityPathSuffixReplannerOptions): ActivityPathSuffixReplanner {
  const now = options.now ?? (() => new Date());
  return {
    async replan(input) {
      const internal = await options.sessions.getInternalPathSnapshot({
        sessionId: input.snapshot.sessionId,
        sessionVersion: input.snapshot.sessionVersion,
        profileRevision: input.snapshot.profileRevision,
      });
      if (internal === undefined || internal.status !== "active") return { changeReasons: [] };
      const previous = projectPathProgress(internal, input.snapshot);
      const previousPath: LearningPath = {
        pathId: previous.pathId,
        sessionId: previous.sessionId,
        profileRevision: previous.profileRevision,
        evidenceVersion: previous.evidenceVersion,
        pathVersion: previous.pathVersion,
        engineVersion: previous.engineVersion,
        status: "confirmed",
        mode: previous.mode,
        goalId: previous.goalId,
        availableMinutes: previous.availableMinutes,
        estimatedMinutes: previous.estimatedMinutes,
        nodes: structuredClone(previous.nodes),
        positionLockedNodeIds: [...previous.positionLockedNodeIds],
        changeReasons: [...previous.changeReasons],
        createdAt: previous.createdAt,
      };
      const profile = await options.profile.load(input.snapshot.view.subjectId, input.snapshot.profileRevision);
      const engine = new PathEngine(profile);
      const result = engine.replan({
        sessionId: input.snapshot.sessionId,
        profileRevision: input.snapshot.profileRevision,
        evidenceVersion: input.evidenceVersion,
        goalId: previous.goalId,
        mode: previous.mode,
        chapterId: input.snapshot.view.chapterId,
        availableMinutes: previous.availableMinutes,
        selectedKnowledgePointIds: previous.nodes.filter((node) => node.reasonCodes.includes("user_selected")).map((node) => node.knowledgePointId),
        diagnosticSkipKnowledgePointIds: previous.nodes.filter((node) => node.reasonCodes.includes("diagnostic_skip_selected")).map((node) => node.knowledgePointId),
        lockedNodeIds: previous.nodes.filter((node) => node.status === "completed" || node.status === "in_progress" || node.positionLocked).map((node) => node.nodeId),
        knowledgeStates: input.knowledgeStates,
        previousPath,
        trigger: input.trigger,
        createdAt: now().toISOString(),
      });
      if (result.status === "infeasible" || result.path.changeReasons.length === 0) return { changeReasons: [] };
      return { path: { ...result.path, status: "active" } as InternalPersistedPathSnapshot, changeReasons: [...result.path.changeReasons] };
    },
  };
}
