import type { LearningPath, LearningPathNode } from "../domain/path-engine.js";
import type {
  CommitLearningSessionInput,
  CommittedSessionSnapshot,
  GetSessionSnapshotInput,
  PathSafeSnapshot,
} from "./learning-session-repository.js";

/** A-only persistence detail. It is deliberately separate from public contract 21. */
export type InternalPersistedPathSnapshot = Omit<LearningPath, "status" | "nodes"> & {
  status: "candidate" | "confirmed" | "active" | "superseded" | "completed";
  nodes: LearningPathNode[];
};

/** Required by PathRuntime in addition to the public LearningSessionRepository contract. */
export interface InternalPathSessionPort {
  getInternalPathSnapshot(input: GetSessionSnapshotInput): Promise<InternalPersistedPathSnapshot | undefined>;
  commitInternalPath(
    input: CommitLearningSessionInput,
    path: InternalPersistedPathSnapshot,
  ): Promise<CommittedSessionSnapshot>;
}

export function toPathSafeSnapshot(path: InternalPersistedPathSnapshot): PathSafeSnapshot {
  return {
    pathId: path.pathId,
    pathVersion: path.pathVersion,
    status: path.status,
    goalId: path.goalId,
    mode: path.mode,
    nodes: path.nodes.map((node) => ({
      nodeId: node.nodeId,
      knowledgePointId: node.knowledgePointId,
      activityIds: [...node.activityIds],
      status: node.status,
      estimatedMinutes: node.estimatedMinutes,
      reasonCodes: [...node.reasonCodes],
    })),
  };
}
