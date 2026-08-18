import { createHash } from "node:crypto";
import type {
  PublicExecutionBundle,
  PublicExecutionFile,
} from "../contracts/facade.js";
import { ActivityRepositoryError } from "../repositories/activity-repository.js";
import { LearningSessionRepositoryError } from "../repositories/learning-session-repository.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PUBLIC_BUNDLE_KEYS = new Set([
  "activityId",
  "bundleHash",
  "environmentId",
  "expiresAt",
  "profileRevision",
  "publicDatasetFiles",
  "publicTestSources",
  "runId",
  "sessionId",
  "starterCodeHash",
]);
const PUBLIC_FILE_KEYS = new Set(["content", "hash", "name"]);

export interface PublicExecutionProjectionInput {
  run: {
    runId: string;
    sessionId: string;
    activityId: string;
    createdAt: string;
  };
  profileRevision: number;
  environmentId: string;
  starterCode: string;
  publicDatasetFiles: readonly PublicExecutionFile[];
  publicTestSources: readonly string[];
}

export interface PublicExecutionBundleBinding {
  sessionId: string;
  activityId: string;
  profileRevision: number;
  environmentId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Public execution bundle contains an unsupported value");
  return encoded;
}

export function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function bundlePayload(bundle: Omit<PublicExecutionBundle, "bundleHash"> | PublicExecutionBundle): Omit<PublicExecutionBundle, "bundleHash"> {
  return {
    runId: bundle.runId,
    sessionId: bundle.sessionId,
    activityId: bundle.activityId,
    profileRevision: bundle.profileRevision,
    environmentId: bundle.environmentId,
    starterCodeHash: bundle.starterCodeHash,
    publicDatasetFiles: bundle.publicDatasetFiles.map((file) => ({ ...file })),
    publicTestSources: [...bundle.publicTestSources],
    expiresAt: bundle.expiresAt,
  };
}

export function hashPublicExecutionBundle(bundle: Omit<PublicExecutionBundle, "bundleHash"> | PublicExecutionBundle): string {
  return sha256Text(canonicalJson(bundlePayload(bundle)));
}

function lifecycleConflict(message: string): never {
  throw new LearningSessionRepositoryError("activity_lifecycle_conflict", message);
}

function validateFile(value: unknown): value is PublicExecutionFile {
  if (!isRecord(value) || Object.keys(value).some((key) => !PUBLIC_FILE_KEYS.has(key))) return false;
  return typeof value.name === "string"
    && value.name.length > 0
    && !value.name.includes("/")
    && !value.name.includes("\\")
    && typeof value.content === "string"
    && typeof value.hash === "string"
    && HASH_PATTERN.test(value.hash)
    && sha256Text(value.content) === value.hash;
}

export function validatePublicExecutionBundle(
  value: unknown,
  binding: PublicExecutionBundleBinding,
  now: Date,
): asserts value is PublicExecutionBundle {
  if (!isRecord(value) || Object.keys(value).some((key) => !PUBLIC_BUNDLE_KEYS.has(key))
      || Object.keys(value).length !== PUBLIC_BUNDLE_KEYS.size) {
    lifecycleConflict("Public execution bundle shape is invalid");
  }
  const bundle = value as unknown as PublicExecutionBundle;
  if (!SAFE_ID_PATTERN.test(bundle.runId)
      || !SAFE_ID_PATTERN.test(bundle.sessionId)
      || !SAFE_ID_PATTERN.test(bundle.activityId)
      || !Number.isSafeInteger(bundle.profileRevision)
      || bundle.profileRevision < 1
      || !SAFE_ID_PATTERN.test(bundle.environmentId)
      || !HASH_PATTERN.test(bundle.starterCodeHash)
      || !Array.isArray(bundle.publicDatasetFiles)
      || !bundle.publicDatasetFiles.every(validateFile)
      || !Array.isArray(bundle.publicTestSources)
      || !bundle.publicTestSources.every((source) => typeof source === "string")
      || typeof bundle.expiresAt !== "string"
      || !Number.isFinite(Date.parse(bundle.expiresAt))
      || typeof bundle.bundleHash !== "string"
      || !HASH_PATTERN.test(bundle.bundleHash)) {
    lifecycleConflict("Public execution bundle fields are invalid");
  }
  const names = bundle.publicDatasetFiles.map((file) => file.name);
  if (new Set(names).size !== names.length) lifecycleConflict("Public execution bundle contains duplicate dataset names");
  if (bundle.sessionId !== binding.sessionId
      || bundle.activityId !== binding.activityId
      || bundle.profileRevision !== binding.profileRevision) {
    lifecycleConflict("Public execution bundle does not match the current session and Activity");
  }
  if (bundle.environmentId !== binding.environmentId) {
    throw new ActivityRepositoryError("environment_mismatch", "Public execution environment does not match the prepared Activity");
  }
  if (now.getTime() >= Date.parse(bundle.expiresAt)) lifecycleConflict("Public execution bundle has expired");
  if (hashPublicExecutionBundle(bundle) !== bundle.bundleHash) lifecycleConflict("Public execution bundle digest is invalid");
}

export function projectPublicExecutionBundle(input: PublicExecutionProjectionInput): PublicExecutionBundle {
  const preparedAt = Date.parse(input.run.createdAt);
  const ttlMs = 5 * 60_000;
  if (!Number.isFinite(preparedAt)) {
    throw new ActivityRepositoryError("test_asset_invalid", "Public execution preparation time is invalid");
  }
  const withoutHash: Omit<PublicExecutionBundle, "bundleHash"> = {
    runId: input.run.runId,
    sessionId: input.run.sessionId,
    activityId: input.run.activityId,
    profileRevision: input.profileRevision,
    environmentId: input.environmentId,
    starterCodeHash: sha256Text(input.starterCode),
    publicDatasetFiles: input.publicDatasetFiles.map((file) => ({ ...file })),
    publicTestSources: [...input.publicTestSources],
    expiresAt: new Date(preparedAt + ttlMs).toISOString(),
  };
  const bundle: PublicExecutionBundle = {
    ...withoutHash,
    bundleHash: hashPublicExecutionBundle(withoutHash),
  };
  validatePublicExecutionBundle(bundle, {
    sessionId: input.run.sessionId,
    activityId: input.run.activityId,
    profileRevision: input.profileRevision,
    environmentId: input.environmentId,
  }, new Date(preparedAt));
  return bundle;
}
