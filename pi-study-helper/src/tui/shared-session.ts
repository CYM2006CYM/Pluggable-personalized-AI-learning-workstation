import type {
  ActivityAttemptSafeView,
  ActivityDraftOutput,
  ActivityRecoveryOutput,
  ActivitySubmissionOutput,
  GetNextStepInput,
  LearningRuntimeFacade,
  NextStepOutput,
  SaveActivityDraftInput,
  SubmitActivityInput,
} from "../contracts/facade.js";
import type {
  AppBootstrapFacade,
  AppBootstrapSafeView,
  SessionRecoverySafeView,
} from "../contracts/index.js";

const PENDING_KEYS = [
  "sessionId", "sessionVersion", "profileRevision", "pathVersion", "nodeId",
  "activityId", "attemptId", "draftVersion", "savedAt",
] as const;
const LINK_KEYS = ["sessionId", "nodeId", "activityId"] as const;

export interface PendingActivityState {
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  pathVersion: number;
  nodeId: string;
  activityId: string;
  attemptId?: string;
  draftVersion?: number;
  savedAt: string;
}

export interface PendingActivityStore {
  load(): string | undefined;
  save(value: string): void;
  clear(): void;
}

export interface SafeStudyLink {
  sessionId: string;
  nodeId?: string;
  activityId?: string;
}

type SharedFacade = Pick<
  LearningRuntimeFacade,
  "getNextStep" | "getActivityAttempt" | "recoverActivity" | "saveActivityDraft" | "submitActivity"
>;

export type ResumeReason =
  | "profile_revision_conflict"
  | "session_not_found"
  | "activity_lifecycle_conflict"
  | "deep_link_invalid"
  | "recovery_unavailable";

export type RestorePendingResult =
  | { status: "restored"; nextStep: NextStepOutput; recovery?: ActivityRecoveryOutput; bootstrap: SessionRecoverySafeView }
  | { status: "session_version_conflict" | "path_version_conflict"; nextStep?: NextStepOutput; bootstrap: SessionRecoverySafeView }
  | { status: "resume_from_web"; reason: ResumeReason; startPath: "/"; bootstrap?: SessionRecoverySafeView };

export type TuiWriteResult<T> =
  | { status: "saved"; output: T }
  | { status: "conflict"; reason: "session_version_conflict" | "draft_version_conflict" | "idempotency_conflict"; bootstrap?: SessionRecoverySafeView }
  | { status: "resume_from_web"; reason: ResumeReason; startPath: "/"; bootstrap?: SessionRecoverySafeView };

export type PrepareSharedActivityResult =
  | { status: "ready"; pending: PendingActivityState; nextStep: NextStepOutput; deepLink: string }
  | { status: "resume_from_web"; reason: ResumeReason; startPath: "/" };

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const value = (error as { errorCode?: unknown }).errorCode;
  return typeof value === "string" ? value : undefined;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\\/\0\r\n]/u.test(value);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function assertLinkPart(value: string, field: string): void {
  if (!isIdentifier(value)) throw new Error(`Invalid ${field}`);
}

function recoveredSession(view: AppBootstrapSafeView): SessionRecoverySafeView | undefined {
  return view.session;
}

export function parsePendingActivity(value: string): PendingActivityState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid pending activity JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid pending activity");
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!(PENDING_KEYS as readonly string[]).includes(key)) throw new Error("Unknown pending activity field");
  if (!isIdentifier(record.sessionId) || !isVersion(record.sessionVersion) || !isVersion(record.profileRevision)
    || !isVersion(record.pathVersion) || !isIdentifier(record.nodeId) || !isIdentifier(record.activityId)
    || !isIsoDateTime(record.savedAt)) throw new Error("Invalid pending activity binding");
  if (record.attemptId !== undefined && !isIdentifier(record.attemptId)) throw new Error("Invalid attemptId");
  if (record.draftVersion !== undefined && !isVersion(record.draftVersion)) throw new Error("Invalid draftVersion");
  if ((record.attemptId === undefined) !== (record.draftVersion === undefined)) throw new Error("Attempt and draft versions must be paired");
  return record as unknown as PendingActivityState;
}

export function serializePendingActivity(state: PendingActivityState): string {
  const value = JSON.stringify(state);
  parsePendingActivity(value);
  return value;
}

export function buildStudyDeepLink(baseUrl: string, link: SafeStudyLink): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Deep links must target localhost");
  if (url.username || url.password || url.hash) throw new Error("Deep link base URL contains unsafe data");
  assertLinkPart(link.sessionId, "sessionId");
  if (link.nodeId !== undefined) assertLinkPart(link.nodeId, "nodeId");
  if (link.activityId !== undefined) assertLinkPart(link.activityId, "activityId");
  url.pathname = "/study";
  url.search = "";
  url.searchParams.set("sessionId", link.sessionId);
  if (link.nodeId !== undefined) url.searchParams.set("nodeId", link.nodeId);
  if (link.activityId !== undefined) url.searchParams.set("activityId", link.activityId);
  return url.toString();
}

export function parseStudyDeepLink(value: string): SafeStudyLink {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.pathname !== "/study" || url.username || url.password || url.hash) throw new Error("Unsafe study deep link");
  const keys = [...url.searchParams.keys()];
  for (const key of keys) if (!(LINK_KEYS as readonly string[]).includes(key)) throw new Error("Unknown deep link field");
  for (const key of LINK_KEYS) if (url.searchParams.getAll(key).length > 1) throw new Error("Duplicate deep link field");
  const sessionId = url.searchParams.get("sessionId");
  const nodeId = url.searchParams.get("nodeId") ?? undefined;
  const activityId = url.searchParams.get("activityId") ?? undefined;
  if (sessionId === null) throw new Error("Deep link requires sessionId");
  assertLinkPart(sessionId, "sessionId");
  if (nodeId !== undefined) assertLinkPart(nodeId, "nodeId");
  if (activityId !== undefined) assertLinkPart(activityId, "activityId");
  return { sessionId, ...(nodeId === undefined ? {} : { nodeId }), ...(activityId === undefined ? {} : { activityId }) };
}

export class TuiSharedSessionBridge {
  constructor(
    private readonly facade: SharedFacade,
    private readonly bootstrapFacade: Pick<AppBootstrapFacade, "getBootstrap">,
    private readonly store: PendingActivityStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  savePending(state: Omit<PendingActivityState, "savedAt">): PendingActivityState {
    const next = { ...state, savedAt: this.now().toISOString() };
    this.store.save(serializePendingActivity(next));
    return next;
  }

  loadPending(): PendingActivityState | undefined {
    const raw = this.store.load();
    if (raw === undefined) return undefined;
    try {
      return parsePendingActivity(raw);
    } catch {
      this.store.clear();
      return undefined;
    }
  }

  clearPending(): void {
    this.store.clear();
  }

  async readCurrent(sessionId: string): Promise<SessionRecoverySafeView | undefined> {
    return recoveredSession(await this.bootstrapFacade.getBootstrap({ recoverSessionId: sessionId }));
  }

  async readCurrentStep(current: SessionRecoverySafeView): Promise<NextStepOutput | undefined> {
    if (current.path === undefined) return undefined;
    return this.facade.getNextStep({
      sessionId: current.sessionId,
      sessionVersion: current.sessionVersion,
      profileRevision: current.profileRevision,
      pathVersion: current.path.pathVersion,
    });
  }

  async readActivityAttempt(
    current: SessionRecoverySafeView,
    activityId: string,
    attemptId: string,
  ): Promise<ActivityAttemptSafeView> {
    return this.facade.getActivityAttempt({
      sessionId: current.sessionId,
      sessionVersion: current.sessionVersion,
      profileRevision: current.profileRevision,
      activityId,
      attemptId,
    });
  }

  async restorePending(pending: PendingActivityState): Promise<RestorePendingResult> {
    let current: SessionRecoverySafeView | undefined;
    try {
      current = await this.readCurrent(pending.sessionId);
    } catch (error) {
      return { status: "resume_from_web", reason: errorCode(error) === "session_not_found" ? "session_not_found" : "recovery_unavailable", startPath: "/" };
    }
    if (current === undefined || current.sessionId !== pending.sessionId) return { status: "resume_from_web", reason: "session_not_found", startPath: "/" };
    if (current.profileRevision !== pending.profileRevision) return { status: "resume_from_web", reason: "profile_revision_conflict", startPath: "/", bootstrap: current };
    if (current.path === undefined) return { status: "resume_from_web", reason: "recovery_unavailable", startPath: "/", bootstrap: current };

    const input: GetNextStepInput = {
      sessionId: current.sessionId,
      sessionVersion: current.sessionVersion,
      profileRevision: current.profileRevision,
      pathVersion: current.path.pathVersion,
    };
    let nextStep: NextStepOutput | undefined;
    try {
      nextStep = await this.facade.getNextStep(input);
    } catch (error) {
      const code = errorCode(error);
      if (code === "session_not_found") return { status: "resume_from_web", reason: "session_not_found", startPath: "/" };
      if (code === "profile_revision_conflict") return { status: "resume_from_web", reason: "profile_revision_conflict", startPath: "/", bootstrap: current };
      return { status: "resume_from_web", reason: "recovery_unavailable", startPath: "/", bootstrap: current };
    }
    if (nextStep.errorCode === "path_version_conflict") return { status: "path_version_conflict", nextStep, bootstrap: current };
    if (pending.sessionVersion !== current.sessionVersion) return { status: "session_version_conflict", nextStep, bootstrap: current };
    if (pending.pathVersion !== current.path.pathVersion) return { status: "path_version_conflict", nextStep, bootstrap: current };
    if (nextStep.node?.nodeId !== pending.nodeId || nextStep.activity?.activityId !== pending.activityId) {
      return { status: "resume_from_web", reason: "activity_lifecycle_conflict", startPath: "/", bootstrap: current };
    }

    let recovery: ActivityRecoveryOutput | undefined;
    if (pending.attemptId !== undefined) {
      try {
        recovery = await this.facade.recoverActivity({
          sessionId: current.sessionId,
          sessionVersion: current.sessionVersion,
          profileRevision: current.profileRevision,
          activityId: pending.activityId,
          attemptId: pending.attemptId,
        });
      } catch (error) {
        const code = errorCode(error);
        if (code === "session_version_conflict") return { status: "session_version_conflict", nextStep, bootstrap: current };
        if (code === "profile_revision_conflict") return { status: "resume_from_web", reason: "profile_revision_conflict", startPath: "/", bootstrap: current };
        return { status: "resume_from_web", reason: "activity_lifecycle_conflict", startPath: "/", bootstrap: current };
      }
    }
    return { status: "restored", nextStep, ...(recovery === undefined ? {} : { recovery }), bootstrap: current };
  }

  async restoreFromDeepLink(value: string): Promise<RestorePendingResult> {
    let link: SafeStudyLink;
    try {
      link = parseStudyDeepLink(value);
    } catch {
      return { status: "resume_from_web", reason: "deep_link_invalid", startPath: "/" };
    }
    const pending = this.loadPending();
    if (pending === undefined || pending.sessionId !== link.sessionId || (link.nodeId !== undefined && pending.nodeId !== link.nodeId)
      || (link.activityId !== undefined && pending.activityId !== link.activityId)) {
      return { status: "resume_from_web", reason: "deep_link_invalid", startPath: "/" };
    }
    return this.restorePending(pending);
  }

  async saveDraft(input: SaveActivityDraftInput): Promise<TuiWriteResult<ActivityDraftOutput>> {
    try {
      return { status: "saved", output: await this.facade.saveActivityDraft(input) };
    } catch (error) {
      return this.writeFailure(input.sessionId, error);
    }
  }

  async submit(input: SubmitActivityInput): Promise<TuiWriteResult<ActivitySubmissionOutput>> {
    try {
      const output = await this.facade.submitActivity(input);
      if (output.committed) this.clearPending();
      return { status: "saved", output };
    } catch (error) {
      return this.writeFailure(input.sessionId, error);
    }
  }

  private async writeFailure<T>(sessionId: string, error: unknown): Promise<TuiWriteResult<T>> {
    const code = errorCode(error);
    let bootstrap: SessionRecoverySafeView | undefined;
    try {
      bootstrap = await this.readCurrent(sessionId);
    } catch {
      // The explicit recovery result below remains authoritative.
    }
    if (code === "session_version_conflict" || code === "draft_version_conflict" || code === "idempotency_conflict") {
      return { status: "conflict", reason: code, ...(bootstrap === undefined ? {} : { bootstrap }) };
    }
    if (code === "profile_revision_conflict") return { status: "resume_from_web", reason: "profile_revision_conflict", startPath: "/", ...(bootstrap === undefined ? {} : { bootstrap }) };
    if (code === "session_not_found") return { status: "resume_from_web", reason: "session_not_found", startPath: "/" };
    return { status: "resume_from_web", reason: "recovery_unavailable", startPath: "/", ...(bootstrap === undefined ? {} : { bootstrap }) };
  }
}

export class TuiSharedSessionEntry {
  constructor(private readonly bridge: TuiSharedSessionBridge, private readonly webBaseUrl: string) {}

  async prepareCurrentActivity(sessionId: string): Promise<PrepareSharedActivityResult> {
    let current: SessionRecoverySafeView | undefined;
    try {
      current = await this.bridge.readCurrent(sessionId);
    } catch (error) {
      return { status: "resume_from_web", reason: errorCode(error) === "session_not_found" ? "session_not_found" : "recovery_unavailable", startPath: "/" };
    }
    if (current?.path === undefined) return { status: "resume_from_web", reason: current === undefined ? "session_not_found" : "recovery_unavailable", startPath: "/" };
    let nextStep: NextStepOutput | undefined;
    try {
      nextStep = await this.bridge.readCurrentStep(current);
    } catch (error) {
      const code = errorCode(error);
      return { status: "resume_from_web", reason: code === "session_not_found" ? "session_not_found" : code === "profile_revision_conflict" ? "profile_revision_conflict" : "recovery_unavailable", startPath: "/" };
    }
    if (nextStep?.errorCode === "path_version_conflict" || nextStep?.node === undefined || nextStep.activity === undefined) {
      return { status: "resume_from_web", reason: "recovery_unavailable", startPath: "/" };
    }
    const pending = this.bridge.savePending({
      sessionId: current.sessionId,
      sessionVersion: current.sessionVersion,
      profileRevision: current.profileRevision,
      pathVersion: current.path.pathVersion,
      nodeId: nextStep.node.nodeId,
      activityId: nextStep.activity.activityId,
      ...(current.currentAttempt?.kind === "code" ? { attemptId: current.currentAttempt.attemptId, draftVersion: current.currentAttempt.draftVersion } : {}),
    });
    return {
      status: "ready",
      pending,
      nextStep,
      deepLink: buildStudyDeepLink(this.webBaseUrl, { sessionId, nodeId: pending.nodeId, activityId: pending.activityId }),
    };
  }
}
