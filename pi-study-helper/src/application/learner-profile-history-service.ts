import { attachLearnerProfileAgentResult, buildLearnerProfile, diagnosticSkippedKnowledgePointIdsFromPath, type LearnerProfileSafeView } from "../domain/learner-profile.js";
import type { LearningSessionRepository, SessionBindingReader } from "../repositories/learning-session-repository.js";
import type {
  LearnerProfileHistoryEntry,
  LearnerProfileHistoryRepository,
  LearnerProfileHistoryTrigger,
} from "../infrastructure/learner-profile-history-repository.js";
import type { LearnerProfileAgentPort } from "./learner-profile-agent-service.js";

export interface LearnerProfileHistoryCapturePort {
  enqueue(input: { sessionId: string; trigger: LearnerProfileHistoryTrigger }): void;
  capture(input: { sessionId: string; trigger: LearnerProfileHistoryTrigger }): Promise<LearnerProfileHistoryEntry>;
  getLatest(sessionId: string): Promise<LearnerProfileHistoryEntry | undefined>;
}

export interface LearnerProfileHistoryServiceOptions {
  sessions: LearningSessionRepository & SessionBindingReader;
  repository: LearnerProfileHistoryRepository;
  profileAgent?: LearnerProfileAgentPort;
  now?: () => Date;
}

export class LearnerProfileHistoryService implements LearnerProfileHistoryCapturePort {
  readonly #inFlight = new Set<Promise<unknown>>();
  readonly #now: () => Date;

  constructor(private readonly options: LearnerProfileHistoryServiceOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  enqueue(input: { sessionId: string; trigger: LearnerProfileHistoryTrigger }): void {
    const task = this.capture(input).catch(() => undefined);
    this.#inFlight.add(task);
    void task.finally(() => this.#inFlight.delete(task));
  }

  async capture(input: { sessionId: string; trigger: LearnerProfileHistoryTrigger }): Promise<LearnerProfileHistoryEntry> {
    const snapshot = await this.options.sessions.getBoundSnapshot(input.sessionId);
    const existing = await this.options.repository.getLatest(snapshot.sessionId);
    if (existing?.sessionVersion === snapshot.sessionVersion
        && existing.evidenceVersion === snapshot.latestCommit.evidenceVersion
        && existing.trigger === input.trigger) {
      return existing;
    }
    const deterministic = buildLearnerProfile({
      sessionId: snapshot.sessionId,
      profileRevision: snapshot.profileRevision,
      evidenceVersion: snapshot.latestCommit.evidenceVersion,
      evidence: snapshot.evidence,
      knowledgeStates: snapshot.knowledgeStates,
      latestDiagnostic: snapshot.latestDiagnostic,
      activityProgress: snapshot.activityProgress,
      diagnosticSkippedKnowledgePointIds: diagnosticSkippedKnowledgePointIdsFromPath(snapshot.path?.nodes),
    });
    const profile = await this.enrich(deterministic);
    return this.options.repository.append({
      sessionId: snapshot.sessionId,
      sessionVersion: snapshot.sessionVersion,
      profileRevision: snapshot.profileRevision,
      evidenceVersion: snapshot.latestCommit.evidenceVersion,
      trigger: input.trigger,
      capturedAt: this.#now().toISOString(),
      profile,
    });
  }

  getLatest(sessionId: string): Promise<LearnerProfileHistoryEntry | undefined> {
    return this.options.repository.getLatest(sessionId);
  }

  async waitForIdle(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight]);
  }

  private async enrich(profile: LearnerProfileSafeView): Promise<LearnerProfileSafeView> {
    const result = this.options.profileAgent === undefined
      ? undefined
      : await this.options.profileAgent.summarize({ profile }).catch(() => undefined);
    return result?.status === "accepted" && result.explanation !== undefined && result.evidenceRefs !== undefined
      ? attachLearnerProfileAgentResult(profile, { explanation: result.explanation, evidenceRefs: result.evidenceRefs, runId: result.runId })
      : profile;
  }
}
