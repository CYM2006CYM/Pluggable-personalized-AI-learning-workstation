import type { StartSessionInput, StartSessionOutput } from "./learning-runtime-facade.js";
import type { ProfileManifestV2 } from "../domain/v2-types.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import type { LearningSessionRepository, SessionBindingReader } from "../repositories/learning-session-repository.js";

export interface ProfileBoundSessionRuntimeDependencies {
  profiles: ProfileFamilyRepository;
  sessions: LearningSessionRepository & SessionBindingReader;
}

/**
 * D3 session entry point. Profile revision is deliberately resolved by the
 * server-side repository rather than accepted from a browser or TUI request.
 */
export class ProfileBoundSessionRuntime {
  constructor(private readonly dependencies: ProfileBoundSessionRuntimeDependencies) {}

  async startSession(input: StartSessionInput): Promise<StartSessionOutput> {
    const active = await this.dependencies.profiles.loadActiveProfileV2(input.subjectId);
    const view = await this.dependencies.sessions.create({
      requestId: input.requestId,
      subjectId: input.subjectId,
      mode: input.mode,
      goalId: input.goalId,
      ...(input.chapterId === undefined ? {} : { chapterId: input.chapterId }),
      availableMinutes: input.availableMinutes,
      profileRevision: active.revision,
      diagnosticRequired: active.capabilities.diagnostic,
    });
    return { ...view, requestId: input.requestId };
  }

  async resolveSessionProfile(input: { sessionId: string; sessionVersion?: number }): Promise<ProfileManifestV2> {
    const snapshot = await this.dependencies.sessions.getBoundSnapshot(input.sessionId);
    if (input.sessionVersion !== undefined && input.sessionVersion !== snapshot.sessionVersion) {
      throw new Error("session_version_conflict");
    }
    return this.dependencies.profiles.loadProfileV2Revision(snapshot.view.subjectId, snapshot.profileRevision);
  }
}
