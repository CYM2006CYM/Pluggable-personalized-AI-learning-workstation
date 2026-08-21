import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActivityResult, LearningRuntimeErrorCode } from "../domain/v2-types.js";
import {
  EvaluationPreparationError,
  EvaluationRunError,
  type CodeEvaluationPort,
  type PrepareEvaluationInput,
  type PreparedEvaluation,
  type RunEvaluationInput,
} from "./code-evaluation-port.js";
import {
  evaluatorFailure,
  learnerFailure,
  summarizeRubric,
  type ActivityRubricDefinition,
  type InternalTestResult,
  validateRubricDefinition,
} from "./activity-rubric.js";

export interface MeasuredNodeEnvironment {
  environmentId: string;
  schemaVersion: 1;
  status: "measured_node_submit";
  nodeVersion: string;
  pythonVersion: string;
  pandasVersion: string;
  platform: string;
  evaluatorVersion: string;
  environmentHash: string;
  allowedLibraries: readonly { name: string; version: string }[];
  limits: {
    wallClockMs: number;
    stdoutBytes: number;
    stderrBytes: number;
    sourceBytes: number;
    datasetBytes: number;
  };
  capabilityFlags: {
    reliableMemoryLimit: boolean;
    networkIsolation: boolean;
    processTreeTermination: boolean;
  };
  pyodideVersion: null;
  prototypeEvidenceRef: string;
  createdAt: string;
}

export interface PythonProcessCodeEvaluationAdapterOptions {
  profileRoot: string;
  pythonExecutable: string;
  runnerScript?: string;
  now?: () => Date;
  preparedTtlMs?: number;
}

interface DatasetFixture {
  fixtureId: string;
  fileRef: string;
  assetHash: string;
}

interface TaskTest {
  testId: string;
  fileRef: string;
  fixtureRefs: string[];
  dimensionId: string;
  assetHash: string;
  blocking: boolean;
}

interface TaskBundle {
  activity: {
    activityId: string;
    profileRevision: number;
    kind: "code_completion" | "coding_practical";
    templateVersion: string;
    environmentRef: string;
    datasetRefs: string[];
    allowedLibraries: string[];
  };
  contract: { entryPoint: { name: string; argumentFixtureIds: string[] } };
  publicTests: TaskTest[];
  hiddenTests: TaskTest[];
  rubric: ActivityRubricDefinition;
  environmentRef: string;
  assetBundleHash: string;
}

interface PrivatePreparedState {
  prepared: PreparedEvaluation;
  bundle: TaskBundle;
  fixtures: ReadonlyMap<string, DatasetFixture>;
  environment: MeasuredNodeEnvironment;
}

interface RunRecord {
  requestId: string;
  attemptId: string;
  fingerprint: string;
  result: ActivityResult;
}

interface HarnessResult {
  status: "ok" | "failed";
  category?: "learner" | "evaluator";
  errorCode?: LearningRuntimeErrorCode;
  tests?: InternalTestResult[];
}

type StageOutcome =
  | { kind: "ok"; tests: InternalTestResult[] }
  | { kind: "cancelled" }
  | { kind: "learner"; errorCode: LearningRuntimeErrorCode; feedback: string }
  | { kind: "evaluator"; errorCode: LearningRuntimeErrorCode; feedback: string };

// W3-C1.3 scoped W3 formal evaluation to two activities. Revision 3 declares a
// code activity on five knowledge points and 41号 requires the W5 V5-1 trajectory
// to walk all of them, so every revision 3 code activity carries an approved
// digest below. Revision 2 keeps exactly its two historically frozen activities.
const FORMAL_ACTIVITY_IDS = new Set([
  "act-inspect-dataframe", "act-missing", "act-duplicates", "act-types", "act-practical",
]);
const HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/u;
const ENVIRONMENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PREPARED_ID_PATTERN = /^prepared-[a-f0-9]{64}$/u;
const FORMAL_ENVIRONMENT_ID = "env-python-pandas-candidate";
const FORMAL_NODE_VERSION = "v22.23.1";
const FORMAL_PYTHON_VERSION = "3.13.7";
const FORMAL_PANDAS_VERSION = "3.0.5";
const FORMAL_PLATFORM = "win32-10.0.26100-x64";
const FORMAL_EVALUATOR_VERSION = "node-python-evaluator-w3-c1";
const FORMAL_CREATED_AT = "2026-08-08T01:30:21+08:00";
// The formal bundle digest covers activity.profileRevision, so each approved
// revision has its own expected value. The formal evaluation scope stays the two
// activities frozen by W3-C1.3; only the revision binding is added here.
const FORMAL_ASSET_BUNDLE_HASHES: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  2: {
    "act-inspect-dataframe": "bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c",
    "act-practical": "3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c",
  },
  3: {
    "act-inspect-dataframe": "737b0d6ae618f98b5c3e7bd5b67c2f5342559decd7436dbed57a046ef4c97be6",
    "act-missing": "1a42dfe66391ea56d11b7c8b525ac2da19146c3fc7d4401a3439e6b7b793125b",
    "act-duplicates": "dd88d60ef3320f7eba10fbba7cddc76ee96859e3f7fd7f7a9139fe9ed96d4886",
    "act-types": "cfa703b189cb49cfa2e56ce3b0790a0412e58c996c82aa93ca459596d71c1880",
    "act-practical": "7731912ed0f6ec7596cbfbf3b7d029a3d354503c4b28a6ddcf623493df9c74a9",
  },
};

function formalAssetBundleHash(profileRevision: number, activityId: string): string | undefined {
  return FORMAL_ASSET_BUNDLE_HASHES[profileRevision]?.[activityId];
}
const LEARNER_ERROR_CODES = new Set([
  "syntax_error", "runtime_error", "test_failed", "timeout", "output_limit",
  "disallowed_import", "submission_contract_error",
]);
const EVALUATOR_ERROR_CODES = new Set([
  "environment_mismatch", "evaluator_error", "evaluator_start_failed", "evaluator_timeout",
  "dependency_missing", "test_asset_invalid", "result_protocol_invalid", "runner_crash",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneResult(result: ActivityResult): ActivityResult {
  return {
    ...result,
    ...(result.dimensionResults ? { dimensionResults: { ...result.dimensionResults } } : {}),
  };
}

function normalizeHash(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function safeRelativePath(value: string): boolean {
  return value.length > 0
    && !isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function safeResolve(root: string, reference: string): string {
  if (!safeRelativePath(reference)) throw new Error("unsafe relative asset path");
  const path = resolve(root, reference);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("asset path escapes Profile root");
  return path;
}

async function sha256File(path: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

async function assertRegularAsset(root: string, reference: string, expectedHash: string): Promise<string> {
  const path = safeResolve(root, reference);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("asset is not a regular file");
  const canonicalRoot = await realpath(root);
  const canonicalPath = await realpath(path);
  if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`)) throw new Error("asset resolves outside Profile root");
  if (await sha256File(path) !== normalizeHash(expectedHash)) throw new Error("asset hash mismatch");
  return path;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("unsupported canonical JSON value");
  return encoded;
}

function environmentHash(value: Omit<MeasuredNodeEnvironment, "environmentHash">): string {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

function measuredEnvironmentValid(value: MeasuredNodeEnvironment): boolean {
  const { environmentHash: actualHash, ...withoutHash } = value;
  return value.environmentId === FORMAL_ENVIRONMENT_ID
    && value.schemaVersion === 1
    && value.status === "measured_node_submit"
    && value.nodeVersion === FORMAL_NODE_VERSION
    && value.pythonVersion === FORMAL_PYTHON_VERSION
    && value.pandasVersion === FORMAL_PANDAS_VERSION
    && value.platform === FORMAL_PLATFORM
    && value.evaluatorVersion === FORMAL_EVALUATOR_VERSION
    && value.createdAt === FORMAL_CREATED_AT
    && value.prototypeEvidenceRef === "scripts/w3-code-evaluation/environment-prototype-evidence.json"
    && value.pyodideVersion === null
    && ENVIRONMENT_HASH_PATTERN.test(actualHash)
    && actualHash === environmentHash(withoutHash)
    && value.allowedLibraries.length === 1
    && value.allowedLibraries[0]?.name === "pandas"
    && value.allowedLibraries[0].version === FORMAL_PANDAS_VERSION
    && value.limits.wallClockMs === 4000
    && value.limits.stdoutBytes === 8192
    && value.limits.stderrBytes === 8192
    && value.limits.sourceBytes === 8000
    && value.limits.datasetBytes === 65536
    && value.capabilityFlags.reliableMemoryLimit === false
    && value.capabilityFlags.networkIsolation === false
    && value.capabilityFlags.processTreeTermination === true;
}

export function isRuntimePlatformCompatible(
  environment: Pick<MeasuredNodeEnvironment, "capabilityFlags">,
  platform: string,
  arch: string,
): boolean {
  return platform === "win32"
    && arch === "x64"
    && environment.capabilityFlags.processTreeTermination === true;
}

function parseTaskBundle(value: unknown): TaskBundle | null {
  if (!isRecord(value)
    || !isRecord(value.activity)
    || !isRecord(value.contract)
    || !isRecord(value.contract.entryPoint)
    || !isRecord(value.rubric)
    || !Array.isArray(value.publicTests)
    || !Array.isArray(value.hiddenTests)) return null;
  const activity = value.activity;
  const entryPoint = value.contract.entryPoint;
  const publicTests = value.publicTests.map(parseTaskTest);
  const hiddenTests = value.hiddenTests.map(parseTaskTest);
  const tests = [...publicTests, ...hiddenTests];
  if (publicTests.some((test) => test === null) || hiddenTests.some((test) => test === null)
    || !validateRubricDefinition(value.rubric, tests.filter((test): test is TaskTest => test !== null))) return null;
  if (typeof activity.activityId !== "string"
    || !FORMAL_ACTIVITY_IDS.has(activity.activityId)
    || (activity.kind !== "code_completion" && activity.kind !== "coding_practical")
    || !Number.isSafeInteger(activity.profileRevision)
    || typeof activity.templateVersion !== "string"
    || typeof activity.environmentRef !== "string"
    || !Array.isArray(activity.datasetRefs)
    || !activity.datasetRefs.every((item) => typeof item === "string")
    || !Array.isArray(activity.allowedLibraries)
    || !activity.allowedLibraries.every((item) => typeof item === "string")
    || typeof entryPoint.name !== "string"
    || !Array.isArray(entryPoint.argumentFixtureIds)
    || !entryPoint.argumentFixtureIds.every((item) => typeof item === "string")
    || typeof value.environmentRef !== "string"
    || value.environmentRef !== activity.environmentRef
    || typeof value.assetBundleHash !== "string"
    || !HASH_PATTERN.test(value.assetBundleHash)
    || !value.publicTests.every((test) => isRecord(test) && typeof test.testId === "string" && typeof test.fileRef === "string" && typeof test.dimensionId === "string" && typeof test.assetHash === "string" && HASH_PATTERN.test(test.assetHash) && Array.isArray(test.fixtureRefs) && test.fixtureRefs.every((id) => typeof id === "string") && typeof test.blocking === "boolean")
    || !value.hiddenTests.every((test) => isRecord(test) && typeof test.testId === "string" && typeof test.fileRef === "string" && typeof test.dimensionId === "string" && typeof test.assetHash === "string" && HASH_PATTERN.test(test.assetHash) && Array.isArray(test.fixtureRefs) && test.fixtureRefs.every((id) => typeof id === "string") && typeof test.blocking === "boolean")) return null;
  return value as unknown as TaskBundle;
}

function parseTaskTest(value: unknown): TaskTest | null {
  if (!isRecord(value)
    || typeof value.testId !== "string"
    || typeof value.fileRef !== "string"
    || !Array.isArray(value.fixtureRefs)
    || !value.fixtureRefs.every((id) => typeof id === "string")
    || typeof value.dimensionId !== "string"
    || typeof value.assetHash !== "string"
    || !HASH_PATTERN.test(value.assetHash)
    || typeof value.blocking !== "boolean") return null;
  return value as unknown as TaskTest;
}

function parseFixture(value: unknown): DatasetFixture | null {
  if (!isRecord(value)
    || typeof value.fixtureId !== "string"
    || typeof value.fileRef !== "string"
    || typeof value.assetHash !== "string"
    || !HASH_PATTERN.test(value.assetHash)) return null;
  return value as unknown as DatasetFixture;
}

function safeEnvironment(stageDirectory: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PYTHONHASHSEED: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUTF8: "1",
    TZ: "UTC",
    TEMP: stageDirectory,
    TMP: stageDirectory,
  };
  for (const name of ["SystemRoot", "WINDIR"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolveTermination) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        shell: false,
        stdio: "ignore",
      });
      killer.once("error", () => resolveTermination());
      killer.once("close", () => resolveTermination());
    });
    return;
  }
  child.kill("SIGKILL");
}

function validHarnessResult(value: unknown): value is HarnessResult {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "failed")) return false;
  if (value.status === "ok") {
    return Object.keys(value).sort().join(",") === "status,tests"
      && Array.isArray(value.tests)
      && value.tests.every((test) => isRecord(test)
        && Object.keys(test).sort().join(",") === "blocking,dimensionId,passed,testId"
        && typeof test.testId === "string"
        && typeof test.dimensionId === "string"
        && typeof test.blocking === "boolean"
        && typeof test.passed === "boolean");
  }
  if (Object.keys(value).sort().join(",") !== "category,errorCode,status"
    || (value.category !== "learner" && value.category !== "evaluator")
    || typeof value.errorCode !== "string") return false;
  return value.category === "learner"
    ? LEARNER_ERROR_CODES.has(value.errorCode)
    : EVALUATOR_ERROR_CODES.has(value.errorCode);
}

export class PythonProcessCodeEvaluationAdapter implements CodeEvaluationPort {
  readonly #profileRoot: string;
  readonly #pythonExecutable: string;
  readonly #runnerScript: string;
  readonly #now: () => Date;
  readonly #preparedTtlMs: number;
  #preflightPromise: Promise<MeasuredNodeEnvironment | null> | undefined;
  readonly #states = new Map<string, PrivatePreparedState>();
  readonly #requestRuns = new Map<string, RunRecord>();
  readonly #attemptRuns = new Map<string, RunRecord>();

  constructor(options: PythonProcessCodeEvaluationAdapterOptions) {
    this.#profileRoot = resolve(options.profileRoot);
    this.#pythonExecutable = resolve(options.pythonExecutable);
    this.#runnerScript = resolve(options.runnerScript ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/python-evaluator.py"));
    this.#now = options.now ?? (() => new Date());
    this.#preparedTtlMs = options.preparedTtlMs ?? 5 * 60_000;
  }

  async #loadApprovedEnvironment(): Promise<MeasuredNodeEnvironment> {
    this.#preflightPromise ??= (async () => {
      try {
        const lockPath = safeResolve(this.#profileRoot, "environments/environment-lock.json");
        const raw = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
        if (!isRecord(raw)
          || raw.environmentId !== FORMAL_ENVIRONMENT_ID
          || raw.schemaVersion !== 1
          || raw.status !== "measured_node_submit"
          || typeof raw.environmentHash !== "string"
          || typeof raw.nodeVersion !== "string"
          || typeof raw.pythonVersion !== "string"
          || typeof raw.pandasVersion !== "string"
          || typeof raw.platform !== "string"
          || typeof raw.evaluatorVersion !== "string"
          || !Array.isArray(raw.allowedLibraries)
          || !isRecord(raw.limits)
          || !isRecord(raw.capabilityFlags)
          || raw.pyodideVersion !== null
          || typeof raw.prototypeEvidenceRef !== "string"
          || typeof raw.createdAt !== "string") return null;
        const environment = raw as unknown as MeasuredNodeEnvironment;
        if (!measuredEnvironmentValid(environment)
          || environment.nodeVersion !== process.version
          || !isRuntimePlatformCompatible(environment, process.platform, process.arch)) return null;
        if (!await this.#runtimeEnvironmentMatches(environment)) return null;
        return environment;
      } catch {
        return null;
      }
    })();
    const environment = await this.#preflightPromise;
    if (!environment) {
      throw new EvaluationPreparationError("environment_mismatch", "The approved Node submit environment is unavailable or does not match this runtime.");
    }
    return environment;
  }

  async prepare(input: PrepareEvaluationInput): Promise<PreparedEvaluation> {
    const environment = await this.#loadApprovedEnvironment();
    if (input.mode !== "submit") {
      throw new EvaluationPreparationError("submission_contract_error", "The measured Node adapter only accepts formal submissions.");
    }
    if (input.environment.status !== "measured_node_submit"
      || input.environment.environmentHash !== environment.environmentHash
      || input.environment.environmentId !== environment.environmentId
      || input.environment.environmentId !== input.activity.environmentRef
      || input.environment.prototypeEvidenceRef !== environment.prototypeEvidenceRef) {
      throw new EvaluationPreparationError("environment_mismatch", "The measured Node submit environment is unavailable or does not match the approved lock.");
    }
    if (!FORMAL_ACTIVITY_IDS.has(input.activity.activityId)
      || input.activity.kind === "debug"
      || input.profileRevision !== input.activity.profileRevision) {
      throw new EvaluationPreparationError("profile_revision_conflict", "The activity is outside the W3 formal evaluation scope or revision.");
    }
    if (input.taskVersion !== input.activity.templateVersion) {
      throw new EvaluationPreparationError("activity_version_conflict", "The activity task version changed before preparation.");
    }
    if (!HASH_PATTERN.test(input.assetBundleHash)) {
      throw new EvaluationPreparationError("test_asset_invalid", "The task asset bundle hash is invalid.");
    }

    let bundle: TaskBundle | undefined;
    const fixtures = new Map<string, DatasetFixture>();
    try {
      const bundleDocument = JSON.parse(await readFile(resolve(this.#profileRoot, "assessments/private/task-bundles.json"), "utf8")) as unknown;
      const fixtureDocument = JSON.parse(await readFile(resolve(this.#profileRoot, "datasets/fixtures.json"), "utf8")) as unknown;
      if (!isRecord(bundleDocument) || !Array.isArray(bundleDocument.bundles)
        || !isRecord(fixtureDocument) || !Array.isArray(fixtureDocument.fixtures)) throw new Error("asset document shape is invalid");
      bundle = bundleDocument.bundles.map(parseTaskBundle).find((item) => item?.activity.activityId === input.activity.activityId) ?? undefined;
      if (!bundle) throw new Error("formal task bundle is missing");
      const { assetBundleHash: selfReportedHash, ...bundleWithoutHash } = bundle as unknown as Record<string, unknown>;
      const fixtureEntries = fixtureDocument.fixtures.map(parseFixture);
      if (fixtureEntries.some((fixture) => fixture === null)) throw new Error("fixture record is invalid");
      const resolvedFixtures = fixtureEntries
        .filter((fixture): fixture is DatasetFixture => fixture !== null)
        .filter((fixture) => bundle?.activity.datasetRefs.includes(fixture.fixtureId));
      const recomputedHash = createHash("sha256")
        .update(canonicalize({ ...bundleWithoutHash, resolvedFixtures }), "utf8")
        .digest("hex");
      if (selfReportedHash !== recomputedHash
        || recomputedHash !== formalAssetBundleHash(input.profileRevision, input.activity.activityId)
        || normalizeHash(bundle.assetBundleHash) !== normalizeHash(input.assetBundleHash)) throw new Error("asset bundle hash differs");
      if (bundle.activity.profileRevision !== input.profileRevision
        || bundle.activity.templateVersion !== input.taskVersion
        || bundle.activity.kind !== input.activity.kind
        || bundle.environmentRef !== input.activity.environmentRef) throw new Error("bundle binding differs");
      const approvedLibraries = environment.allowedLibraries.map((library) => `${library.name}`);
      if (bundle.activity.allowedLibraries.length !== approvedLibraries.length
        || bundle.activity.allowedLibraries.some((library, index) => library !== approvedLibraries[index])) throw new Error("allowed library policy differs");
      for (const fixture of fixtureEntries) {
        if (!fixture || fixtures.has(fixture.fixtureId)) throw new Error("fixture record is invalid");
        fixtures.set(fixture.fixtureId, fixture);
      }
      for (const fixtureId of bundle.activity.datasetRefs) {
        const fixture = fixtures.get(fixtureId);
        if (!fixture) throw new Error("bundle fixture is missing");
        await assertRegularAsset(this.#profileRoot, fixture.fileRef, fixture.assetHash);
      }
      for (const test of [...bundle.publicTests, ...bundle.hiddenTests]) {
        await assertRegularAsset(this.#profileRoot, test.fileRef, test.assetHash);
        if (test.fixtureRefs.some((fixtureId) => !bundle?.activity.datasetRefs.includes(fixtureId))) throw new Error("test fixture authorization is invalid");
      }
    } catch {
      throw new EvaluationPreparationError("test_asset_invalid", "The formal task bundle or its bound assets are invalid.");
    }

    const preparedId = `prepared-${createHash("sha256").update([
      input.activity.activityId,
      String(input.profileRevision),
      input.taskVersion,
      input.mode,
      environment.environmentHash,
      normalizeHash(input.assetBundleHash),
    ].join("\n"), "utf8").digest("hex")}`;
    const prepared: PreparedEvaluation = {
      preparedId,
      mode: input.mode,
      activityId: input.activity.activityId,
      profileRevision: input.profileRevision,
      environmentHash: environment.environmentHash,
      assetBundleHash: normalizeHash(input.assetBundleHash),
      expiresAt: new Date(this.#now().getTime() + this.#preparedTtlMs).toISOString(),
    };
    this.#states.set(preparedId, { prepared, bundle, fixtures, environment });
    return { ...prepared };
  }

  async run(input: RunEvaluationInput, signal: AbortSignal): Promise<ActivityResult> {
    const state = PREPARED_ID_PATTERN.test(input.prepared?.preparedId ?? "")
      ? this.#states.get(input.prepared.preparedId)
      : undefined;
    if (!state
      || JSON.stringify(state.prepared) !== JSON.stringify(input.prepared)
      || this.#now().getTime() >= Date.parse(state.prepared.expiresAt)) {
      return evaluatorFailure({
        errorCode: "test_asset_invalid",
        safeFeedback: "Prepared evaluation state is unavailable; the draft remains available.",
        evaluatorVersion: state?.environment.evaluatorVersion ?? FORMAL_EVALUATOR_VERSION,
        environmentHash: state?.prepared.environmentHash ?? "unavailable",
        assetBundleHash: state?.prepared.assetBundleHash ?? "unavailable",
      });
    }
    if (signal.aborted) {
      return {
        executionStatus: "cancelled",
        verdict: "not_graded",
        safeFeedback: "Evaluation cancelled; the draft remains available.",
        evaluatorVersion: state.environment.evaluatorVersion,
        environmentHash: state.prepared.environmentHash,
        assetBundleHash: state.prepared.assetBundleHash,
      };
    }
    if (typeof input.requestId !== "string" || input.requestId.trim().length === 0
      || typeof input.attemptId !== "string" || input.attemptId.trim().length === 0
      || typeof input.code !== "string") {
      return learnerFailure({
        errorCode: "submission_contract_error",
        safeFeedback: "Submission identifiers and code do not satisfy the activity contract.",
        evaluatorVersion: state.environment.evaluatorVersion,
        environmentHash: state.prepared.environmentHash,
        assetBundleHash: state.prepared.assetBundleHash,
      });
    }

    const fingerprint = createHash("sha256").update([state.prepared.preparedId, input.code].join("\n"), "utf8").digest("hex");
    const requestRecord = this.#requestRuns.get(input.requestId);
    const attemptRecord = this.#attemptRuns.get(input.attemptId);
    if ((requestRecord && (requestRecord.attemptId !== input.attemptId || requestRecord.fingerprint !== fingerprint))
      || (attemptRecord && attemptRecord.fingerprint !== fingerprint)) {
      throw new EvaluationRunError("idempotency_conflict", "The requestId or attemptId was already used for different evaluation content.");
    }
    const existing = requestRecord ?? attemptRecord;
    if (existing) {
      this.#requestRuns.set(input.requestId, existing);
      return cloneResult(existing.result);
    }

    const sourceBytes = Buffer.byteLength(input.code, "utf8");
    if (sourceBytes > state.environment.limits.sourceBytes) {
      return this.#recordRun(input, fingerprint, learnerFailure({
        errorCode: "submission_contract_error",
        safeFeedback: "The submitted source exceeds the activity limit.",
        evaluatorVersion: state.environment.evaluatorVersion,
        environmentHash: state.prepared.environmentHash,
        assetBundleHash: state.prepared.assetBundleHash,
      }));
    }

    const runRoot = await mkdtemp(join(tmpdir(), "pi-w3-evaluation-"));
    try {
      const submission = resolve(runRoot, "submission.py");
      await writeFile(submission, input.code, { encoding: "utf8", flag: "wx" });
      const allTests: InternalTestResult[] = [];
      for (const [stage, tests] of [
        ["user_code", []],
        ["public_tests", state.bundle.publicTests],
        ["hidden_tests", state.bundle.hiddenTests],
      ] as const) {
        const outcome = await this.#runStage(runRoot, submission, state, stage, tests, signal);
        if (outcome.kind === "cancelled") {
          return {
            executionStatus: "cancelled",
            verdict: "not_graded",
            safeFeedback: "Evaluation cancelled; the draft remains available.",
            evaluatorVersion: state.environment.evaluatorVersion,
            environmentHash: state.prepared.environmentHash,
            assetBundleHash: state.prepared.assetBundleHash,
          };
        }
        if (outcome.kind === "learner") {
          return this.#recordRun(input, fingerprint, learnerFailure({
            errorCode: outcome.errorCode as Parameters<typeof learnerFailure>[0]["errorCode"],
            safeFeedback: outcome.feedback,
            evaluatorVersion: state.environment.evaluatorVersion,
            environmentHash: state.prepared.environmentHash,
            assetBundleHash: state.prepared.assetBundleHash,
          }));
        }
        if (outcome.kind === "evaluator") {
          return this.#recordRun(input, fingerprint, evaluatorFailure({
            errorCode: outcome.errorCode as Parameters<typeof evaluatorFailure>[0]["errorCode"],
            safeFeedback: outcome.feedback,
            evaluatorVersion: state.environment.evaluatorVersion,
            environmentHash: state.prepared.environmentHash,
            assetBundleHash: state.prepared.assetBundleHash,
          }));
        }
        allTests.push(...outcome.tests);
      }
      const result = summarizeRubric({
        rubric: state.bundle.rubric,
        tests: allTests,
        evaluatorVersion: state.environment.evaluatorVersion,
        environmentHash: state.prepared.environmentHash,
        assetBundleHash: state.prepared.assetBundleHash,
      });
      return this.#recordRun(input, fingerprint, result);
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  }

  #recordRun(input: RunEvaluationInput, fingerprint: string, result: ActivityResult): ActivityResult {
    const record = {
      requestId: input.requestId,
      attemptId: input.attemptId,
      fingerprint,
      result: cloneResult(result),
    };
    this.#requestRuns.set(input.requestId, record);
    this.#attemptRuns.set(input.attemptId, record);
    return cloneResult(record.result);
  }

  async #runStage(
    runRoot: string,
    submission: string,
    state: PrivatePreparedState,
    stage: "user_code" | "public_tests" | "hidden_tests",
    tests: readonly TaskTest[],
    signal: AbortSignal,
  ): Promise<StageOutcome> {
    const stageDirectory = resolve(runRoot, stage);
    const privateDirectory = resolve(runRoot, "node-private", stage);
    await mkdir(stageDirectory, { recursive: true });
    await mkdir(privateDirectory, { recursive: true });
    const resultPath = resolve(privateDirectory, "result.json");
    const manifestPath = resolve(privateDirectory, "tests.json");
    const statePath = resolve(privateDirectory, "state.json");
    const manifest = [];
    let datasetBytes = 0;
    const copiedFixtures = new Map<string, string>();
    for (const test of tests) {
      const fixturePaths = [];
      for (const fixtureId of test.fixtureRefs) {
        const fixture = state.fixtures.get(fixtureId);
        if (!fixture) return { kind: "evaluator", errorCode: "test_asset_invalid", feedback: "A required evaluation asset is unavailable." };
        let target = copiedFixtures.get(fixtureId);
        if (!target) {
          const source = safeResolve(this.#profileRoot, fixture.fileRef);
          target = resolve(stageDirectory, `${fixtureId}-${basename(fixture.fileRef)}`);
          const bytes = await readFile(source);
          datasetBytes += bytes.byteLength;
          if (datasetBytes > state.environment.limits.datasetBytes) {
            return { kind: "evaluator", errorCode: "test_asset_invalid", feedback: "The bound dataset exceeds the approved evaluator limit." };
          }
          await writeFile(target, bytes, { flag: "wx" });
          copiedFixtures.set(fixtureId, target);
        }
        fixturePaths.push(target);
      }
      manifest.push({
        testId: test.testId,
        dimensionId: test.dimensionId,
        blocking: test.blocking,
        filePath: safeResolve(this.#profileRoot, test.fileRef),
        fixturePaths,
      });
    }
    await writeFile(manifestPath, JSON.stringify(manifest), { encoding: "utf8", flag: "wx" });

    const args = [
      this.#runnerScript,
      "--stage", stage,
      "--submission", submission,
      "--entry-point", state.bundle.contract.entryPoint.name,
      "--result", resultPath,
      "--state", statePath,
      ...state.environment.allowedLibraries.flatMap((library) => ["--allowed-library", library.name]),
      ...(stage === "user_code" ? [] : ["--test-manifest", manifestPath]),
    ];
    let child: ChildProcess;
    try {
      child = spawn(this.#pythonExecutable, args, {
        cwd: stageDirectory,
        env: safeEnvironment(stageDirectory),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return { kind: "evaluator", errorCode: "evaluator_start_failed", feedback: "The evaluator process could not start." };
    }

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      void terminateProcessTree(child);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > state.environment.limits.stdoutBytes && !outputExceeded) {
        outputExceeded = true;
        void terminateProcessTree(child);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > state.environment.limits.stderrBytes && !outputExceeded) {
        outputExceeded = true;
        void terminateProcessTree(child);
      }
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
    }, state.environment.limits.wallClockMs);
    const exit = await new Promise<{ code: number | null; failedToStart: boolean }>((resolveExit) => {
      child.once("error", () => resolveExit({ code: null, failedToStart: true }));
      child.once("close", (code) => resolveExit({ code, failedToStart: false }));
    });
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    if (aborted) return { kind: "cancelled" };
    if (outputExceeded) return { kind: "learner", errorCode: "output_limit", feedback: "Program output exceeded the approved limit." };
    if (timedOut) {
      let phase = "unknown";
      try {
        const state = JSON.parse(await readFile(statePath, "utf8")) as unknown;
        if (isRecord(state) && typeof state.phase === "string") phase = state.phase;
      } catch {
        // A missing state marker is an evaluator-side protocol failure.
      }
      if (stage !== "user_code" && phase !== "candidate_running") {
        return { kind: "evaluator", errorCode: "evaluator_timeout", feedback: "The evaluation harness exceeded the approved time limit." };
      }
      return { kind: "learner", errorCode: "timeout", feedback: "Program execution exceeded the approved time limit." };
    }
    if (exit.failedToStart) return { kind: "evaluator", errorCode: "evaluator_start_failed", feedback: "The evaluator process could not start." };
    if (exit.code !== 0) return { kind: "evaluator", errorCode: "runner_crash", feedback: "The evaluator process ended unexpectedly." };
    let result: unknown;
    try {
      result = JSON.parse(await readFile(resultPath, "utf8"));
    } catch {
      return { kind: "evaluator", errorCode: "result_protocol_invalid", feedback: "The evaluator returned an invalid result protocol." };
    }
    if (!validHarnessResult(result)) {
      return { kind: "evaluator", errorCode: "result_protocol_invalid", feedback: "The evaluator returned an invalid result protocol." };
    }
    if (result.status === "ok") {
      const actualTests = result.tests ?? [];
      if (actualTests.length !== tests.length
        || actualTests.some((actual, index) => {
          const expected = tests[index];
          return !expected
            || actual.testId !== expected.testId
            || actual.dimensionId !== expected.dimensionId
            || actual.blocking !== expected.blocking;
        })) {
        return { kind: "evaluator", errorCode: "result_protocol_invalid", feedback: "The evaluator returned an invalid result protocol." };
      }
      return { kind: "ok", tests: actualTests };
    }
    if (result.category === "learner") {
      return { kind: "learner", errorCode: result.errorCode ?? "runtime_error", feedback: "The submitted program did not complete the deterministic evaluation." };
    }
    return { kind: "evaluator", errorCode: result.errorCode ?? "evaluator_error", feedback: "The evaluator could not complete the deterministic checks." };
  }

  async #runtimeEnvironmentMatches(environment: MeasuredNodeEnvironment): Promise<boolean> {
    return new Promise<boolean>((resolvePreflight) => {
      const child = spawn(this.#pythonExecutable, [
        "-c",
        "import json, platform, pandas; print(json.dumps({'python': platform.python_version(), 'pandas': pandas.__version__}, sort_keys=True))",
      ], {
        cwd: tmpdir(),
        env: safeEnvironment(tmpdir()),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        resolvePreflight(value);
      };
      const timer = setTimeout(() => {
        void terminateProcessTree(child);
        finish(false);
      }, 10_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout, "utf8") > 1_024) {
          void terminateProcessTree(child);
          finish(false);
        }
      });
      child.once("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return finish(false);
        try {
          const actual = JSON.parse(stdout) as unknown;
          finish(isRecord(actual)
            && actual.python === environment.pythonVersion
            && actual.pandas === environment.pandasVersion);
        } catch {
          finish(false);
        }
      });
    });
  }
}
