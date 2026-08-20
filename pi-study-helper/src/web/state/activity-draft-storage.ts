export interface ActivityDraftBinding {
  sessionId: string;
  activityId: string;
  attemptId: string;
  profileRevision: number;
  draftVersion: number;
}

interface StoredActivityDraft extends ActivityDraftBinding {
  schemaVersion: 1;
  userText: string;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY_PREFIX = "pi-study-helper.activity-draft.v1:";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "sessionId",
  "activityId",
  "attemptId",
  "profileRevision",
  "draftVersion",
  "userText",
]);

function key(attemptId: string): string {
  return `${KEY_PREFIX}${attemptId}`;
}

function validBinding(value: Partial<ActivityDraftBinding>): value is ActivityDraftBinding {
  return typeof value.sessionId === "string" && IDENTIFIER.test(value.sessionId)
    && typeof value.activityId === "string" && IDENTIFIER.test(value.activityId)
    && typeof value.attemptId === "string" && IDENTIFIER.test(value.attemptId)
    && Number.isInteger(value.profileRevision) && value.profileRevision! >= 0
    && Number.isInteger(value.draftVersion) && value.draftVersion! >= 0;
}

function sameBinding(left: ActivityDraftBinding, right: ActivityDraftBinding): boolean {
  return left.sessionId === right.sessionId
    && left.activityId === right.activityId
    && left.attemptId === right.attemptId
    && left.profileRevision === right.profileRevision
    && left.draftVersion === right.draftVersion;
}

export function readActivityDraft(storage: DraftStorage, binding: ActivityDraftBinding): string | undefined {
  if (!validBinding(binding)) return undefined;
  const raw = storage.getItem(key(binding.attemptId));
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Object.keys(parsed).some((field) => !ALLOWED_KEYS.has(field))) return undefined;
    if (parsed.schemaVersion !== 1 || typeof parsed.userText !== "string" || !validBinding(parsed)) return undefined;
    return sameBinding(parsed, binding) ? parsed.userText : undefined;
  } catch {
    return undefined;
  }
}

export function writeActivityDraft(storage: DraftStorage, binding: ActivityDraftBinding, userText: string): void {
  if (!validBinding(binding)) throw new Error("invalid_activity_draft_binding");
  const value: StoredActivityDraft = { schemaVersion: 1, ...binding, userText };
  storage.setItem(key(binding.attemptId), JSON.stringify(value));
}

export function clearActivityDraft(storage: DraftStorage, attemptId: string): void {
  if (IDENTIFIER.test(attemptId)) storage.removeItem(key(attemptId));
}
