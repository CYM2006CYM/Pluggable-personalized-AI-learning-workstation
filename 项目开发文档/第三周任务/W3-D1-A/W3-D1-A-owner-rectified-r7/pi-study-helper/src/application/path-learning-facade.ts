import type {
  BuildPathInput,
  ConfirmPathInput,
  ConfirmedPathOutput,
  FacadeResponseMeta,
  GetNextStepInput,
  NextStepOutput,
  PathCandidateOutput,
  PathNodeSafeView,
  ReadRequestMeta,
  RecoverSessionInput,
  RecoverSessionOutput,
  ReplanPathInput,
  ReplanPathOutput,
  LearningRuntimeFacade,
} from "./learning-runtime-facade.js";
import {
  PathEngine,
  type LearningPath,
  type LearningPathNode,
  type PathActivityDefinition,
  type PathEngineProfile,
} from "../domain/path-engine.js";
import {
  LearningSessionRepositoryError,
  type LearningSessionRepository,
  type SessionSnapshot,
} from "../repositories/learning-session-repository.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import {
  toPathSafeSnapshot,
  type InternalPathSessionPort,
  type InternalPersistedPathSnapshot,
} from "../repositories/internal-path-session-port.js";

export interface PathProfileResolver {
  load(subjectId: string, profileRevision: number): Promise<PathEngineProfile>;
}

/** Uses the revision bound to the session; it never silently follows current active. */
export class ProfileFamilyPathResolver implements PathProfileResolver {
  constructor(private readonly profiles: ProfileFamilyRepository) {}

  async load(subjectId: string, profileRevision: number): Promise<PathEngineProfile> {
    const manifest = await this.profiles.loadProfileV2Revision(subjectId, profileRevision);
    const [goalsRaw, knowledgeRaw, activitiesRaw] = await Promise.all([
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.goals),
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.knowledge),
      manifest.paths.activities === undefined
        ? Promise.resolve('{"activities":[]}')
        : this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.activities),
    ]);
    const goals = JSON.parse(goalsRaw) as { goals: PathEngineProfile["goals"] };
    const knowledge = JSON.parse(knowledgeRaw) as { knowledgePoints: PathEngineProfile["knowledgePoints"] };
    const activities = JSON.parse(activitiesRaw) as { activities: PathEngineProfile["activities"] };
    return {
      subjectId: manifest.subjectId,
      profileRevision: manifest.revision,
      goals: goals.goals,
      knowledgePoints: knowledge.knowledgePoints,
      activities: activities.activities,
    };
  }
}

export interface PathRuntimeOptions {
  sessions: LearningSessionRepository & InternalPathSessionPort;
  profile: PathProfileResolver;
  now?: () => Date;
}

type PathMethods = Pick<LearningRuntimeFacade, "buildPath" | "confirmPath" | "getNextStep" | "replanPath" | "recoverSession">;
type PersistedPathSnapshot = InternalPersistedPathSnapshot;

function asSafeNode(node: LearningPathNode): PathNodeSafeView {
  return {
    nodeId: node.nodeId,
    knowledgePointId: node.knowledgePointId,
    activityIds: [...node.activityIds],
    status: node.status,
    estimatedMinutes: node.estimatedMinutes,
    reasonCodes: [...node.reasonCodes],
  };
}

function pathSnapshot(path: LearningPath, status: PersistedPathSnapshot["status"]): PersistedPathSnapshot {
  return { ...structuredClone(path), status };
}

function meta(snapshot: SessionSnapshot): FacadeResponseMeta {
  return { sessionId: snapshot.sessionId, sessionVersion: snapshot.sessionVersion, profileRevision: snapshot.profileRevision };
}

function assertSnapshotVersion(snapshot: SessionSnapshot, input: ReadRequestMeta): void {
  if (snapshot.profileRevision !== input.profileRevision) {
    throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
  }
  if (snapshot.sessionVersion !== input.sessionVersion) {
    throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
  }
}

function activityView(activity: PathActivityDefinition | undefined) {
  if (activity === undefined) return undefined;
  return {
    activityId: activity.activityId,
    activityVersion: activity.profileRevision ?? 1,
    kind: activity.kind ?? "explain" as const,
    title: activity.title ?? activity.activityId,
    prompt: activity.prompt ?? "",
    primaryKnowledgePointId: activity.primaryKnowledgePointId,
    supportingKnowledgePointIds: [...activity.supportingKnowledgePointIds],
    ...(activity.starterCode === undefined ? {} : { starterCode: activity.starterCode }),
  };
}

/** Internal collaborator. The public boundary remains LearningRuntimeFacade's 17-method contract. */
class PathRuntimeCollaborator implements PathMethods {
  private readonly now: () => Date;

  constructor(private readonly options: PathRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private async snapshot(input: ReadRequestMeta): Promise<SessionSnapshot> {
    const snapshot = await this.options.sessions.getSnapshot(input);
    assertSnapshotVersion(snapshot, input);
    return snapshot;
  }

  private async internalPath(input: ReadRequestMeta): Promise<PersistedPathSnapshot | undefined> {
    return this.options.sessions.getInternalPathSnapshot(input);
  }

  private async engine(snapshot: SessionSnapshot): Promise<{ engine: PathEngine; profile: PathEngineProfile }> {
    const profile = await this.options.profile.load(snapshot.view.subjectId, snapshot.profileRevision);
    return { engine: new PathEngine(profile), profile };
  }

  async buildPath(input: BuildPathInput): Promise<PathCandidateOutput> {
    const snapshot = await this.snapshot(input);
    if (input.evidenceVersion !== snapshot.latestCommit.evidenceVersion) {
      throw new LearningSessionRepositoryError("path_version_conflict", "Path input evidenceVersion is stale");
    }
    const { engine } = await this.engine(snapshot);
    const result = engine.build({
      sessionId: input.sessionId,
      profileRevision: input.profileRevision,
      evidenceVersion: input.evidenceVersion,
      goalId: input.goalId,
      mode: input.mode,
      chapterId: input.chapterId,
      availableMinutes: input.availableMinutes,
      selectedKnowledgePointIds: [...input.selectedKnowledgePointIds],
      lockedNodeIds: [...input.lockedNodeIds],
      knowledgeStates: snapshot.knowledgeStates,
      pathVersion: (snapshot.path?.pathVersion ?? 0) + 1,
      createdAt: this.now().toISOString(),
    });
    if (result.status === "infeasible") {
      return {
        ...meta(snapshot), requestId: input.requestId, status: "infeasible", nodes: [],
        missingPrerequisiteIds: result.failure.missingPrerequisiteIds,
        minimumRequiredMinutes: result.failure.minimumRequiredMinutes,
        errorCode: "path_infeasible",
      };
    }
    const commitInput = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      candidate: {
        requestId: input.requestId,
        knowledgeStates: snapshot.knowledgeStates,
        pathCandidate: toPathSafeSnapshot(pathSnapshot(result.path, "candidate")),
      },
    };
    const committed = await this.options.sessions.commitInternalPath(commitInput, pathSnapshot(result.path, "candidate"));
    assertSnapshotVersion(committed, { sessionId: input.sessionId, sessionVersion: input.sessionVersion + 1, profileRevision: input.profileRevision });
    return {
      ...meta(committed), requestId: input.requestId, status: "candidate",
      pathId: result.path.pathId, pathVersion: result.path.pathVersion,
      nodes: result.path.nodes.map(asSafeNode),
      missingPrerequisiteIds: result.path.nodes.filter((node) => node.reasonCodes.includes("prerequisite_gap"))
        .map((node) => node.knowledgePointId),
    };
  }

  async confirmPath(input: ConfirmPathInput): Promise<ConfirmedPathOutput> {
    const snapshot = await this.snapshot(input);
    const path = await this.internalPath(input);
    if (!path || path.status !== "candidate" || path.pathId !== input.pathId || path.pathVersion !== input.pathVersion
        || path.sessionId !== input.sessionId || path.profileRevision !== input.profileRevision
        || path.evidenceVersion !== snapshot.latestCommit.evidenceVersion) {
      throw new LearningSessionRepositoryError("path_version_conflict", "Path candidate does not belong to the current session snapshot");
    }
    const commitInput = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      candidate: {
        requestId: input.requestId,
        knowledgeStates: snapshot.knowledgeStates,
        pathCandidate: toPathSafeSnapshot({ ...structuredClone(path), status: "active" }),
        nextStage: "learning" as const,
      },
    };
    const committed = await this.options.sessions.commitInternalPath(commitInput, { ...structuredClone(path), status: "active" });
    assertSnapshotVersion(committed, { sessionId: input.sessionId, sessionVersion: input.sessionVersion + 1, profileRevision: input.profileRevision });
    return { ...meta(committed), requestId: input.requestId, pathId: path.pathId, pathVersion: path.pathVersion, status: "active" };
  }

  async getNextStep(input: GetNextStepInput): Promise<NextStepOutput> {
    const snapshot = await this.snapshot(input);
    const path = await this.internalPath(input);
    if (!path || path.pathVersion !== input.pathVersion || path.status === "candidate") {
      return { ...meta(snapshot), pathVersion: input.pathVersion, completed: false, errorCode: "path_version_conflict" };
    }
    const node = path.nodes.find((item) => item.status === "in_progress") ?? path.nodes.find((item) => item.status === "available");
    if (node === undefined) return { ...meta(snapshot), pathVersion: path.pathVersion, completed: true };
    const profile = await this.options.profile.load(snapshot.view.subjectId, snapshot.profileRevision);
    const activity = activityView(profile.activities.find((item) => item.activityId === node.activityIds[0]));
    return { ...meta(snapshot), pathVersion: path.pathVersion, completed: false, node: asSafeNode(node), ...(activity === undefined ? {} : { activity }) };
  }

  async replanPath(input: ReplanPathInput): Promise<ReplanPathOutput> {
    const snapshot = await this.snapshot(input);
    const previous = await this.internalPath(input);
    if (!previous || previous.pathVersion !== input.pathVersion || previous.status === "candidate") {
      throw new LearningSessionRepositoryError("path_version_conflict", "Current path cannot be replanned");
    }
    if (input.evidenceVersion !== snapshot.latestCommit.evidenceVersion) {
      throw new LearningSessionRepositoryError("path_version_conflict", "Replan evidenceVersion is stale");
    }
    const { engine } = await this.engine(snapshot);
    const result = engine.replan({
      sessionId: input.sessionId,
      profileRevision: input.profileRevision,
      evidenceVersion: input.evidenceVersion,
      goalId: previous.goalId,
      mode: previous.mode,
      chapterId: snapshot.view.chapterId,
      availableMinutes: input.availableMinutes,
      selectedKnowledgePointIds: [...input.selectedKnowledgePointIds],
      lockedNodeIds: [...input.lockedNodeIds],
      knowledgeStates: snapshot.knowledgeStates,
      pathVersion: previous.pathVersion + 1,
      createdAt: this.now().toISOString(),
      previousPath: { ...structuredClone(previous), status: "confirmed" },
      trigger: input.trigger,
    });
    if (result.status === "infeasible") {
      return { ...meta(snapshot), requestId: input.requestId, changed: false, pathId: previous.pathId, pathVersion: previous.pathVersion, nodes: previous.nodes.map(asSafeNode), fallbackToPrevious: true, errorCode: "path_infeasible" };
    }
    const commitInput = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      // Replan publishes the already calculated and repository-validated replacement
      // directly as active in one transaction; the old active is archived by CAS.
      candidate: { requestId: input.requestId, knowledgeStates: snapshot.knowledgeStates, pathCandidate: toPathSafeSnapshot(pathSnapshot(result.path, "active")) },
    };
    const committed = await this.options.sessions.commitInternalPath(commitInput, pathSnapshot(result.path, "active"));
    assertSnapshotVersion(committed, { sessionId: input.sessionId, sessionVersion: input.sessionVersion + 1, profileRevision: input.profileRevision });
    return { ...meta(committed), requestId: input.requestId, changed: true, pathId: result.path.pathId, pathVersion: result.path.pathVersion, nodes: result.path.nodes.map(asSafeNode), fallbackToPrevious: false };
  }

  async recoverSession(input: RecoverSessionInput): Promise<RecoverSessionOutput> {
    const recovered = await this.options.sessions.recover(input);
    return { ...meta(recovered), requestId: input.requestId, view: recovered.view, recoveryAction: recovered.recoveryAction };
  }
}

/** The main LearningRuntimeFacade composes these methods; this helper creates no second public Facade contract. */
export function createPathRuntimeMethods(options: PathRuntimeOptions): PathMethods {
  return new PathRuntimeCollaborator(options);
}
