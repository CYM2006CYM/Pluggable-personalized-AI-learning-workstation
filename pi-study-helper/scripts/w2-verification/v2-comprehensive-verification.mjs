import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { V2_7_SURFACES, validateV27Canaries } from "./v2-7-asset-isolation.mjs";

const W2_START_COMMIT = "f343a6c1c630f362f4686e6f6b0f50c6577d5562";
const V2_IDS = ["V2-1", "V2-2", "V2-3", "V2-4", "V2-5", "V2-6", "V2-7", "V2-8"];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const piRoot = resolve(scriptDirectory, "../..");
const repositoryRoot = resolve(piRoot, "..");
const baselineFiles = [
  "pi-study-helper/scripts/w2-verification/v2-comprehensive-verification.mjs",
  "pi-study-helper/scripts/w2-verification/v2-comprehensive-verification.test.mjs",
  "pi-study-helper/scripts/w2-verification/v2-7-asset-isolation.mjs",
  "pi-study-helper/scripts/w2-verification/v2-6-preconditions.mjs",
  "pi-study-helper/scripts/w2-verification/v2-6-preconditions.test.mjs",
  "pi-study-helper/scripts/evaluation-metrics.mjs",
  "evaluation/claims/claim-split-template.md",
];

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function repoPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error("repository input must be a non-empty relative path");
  }
  const absolutePath = resolve(repositoryRoot, relativePath);
  if (absolutePath !== repositoryRoot && !absolutePath.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error("repository input must not escape the repository root");
  }
  return absolutePath;
}

function normalizedLocation(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !value.split("/").includes("..");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function command(program, args, cwd = piRoot) {
  return { program, args, cwd: cwd === repositoryRoot ? "." : cwd.slice(repositoryRoot.length + 1) };
}

function npmCommand(args) {
  if (process.platform !== "win32") return command("npm", args, piRoot);
  return command(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["npm.cmd", ...args].join(" ")], piRoot);
}

export async function runCommand(commandDefinition, { root = repositoryRoot, captureStdout = false } = {}) {
  const cwd = commandDefinition.cwd === "." ? root : resolve(root, commandDefinition.cwd);
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(commandDefinition.program, commandDefinition.args, {
      cwd,
      windowsHide: true,
      shell: false,
    });
    const stdout = createHash("sha256");
    const stderr = createHash("sha256");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let capturedStdout = "";
    child.stdout.on("data", (chunk) => {
      stdout.update(chunk);
      stdoutBytes += chunk.length;
      if (captureStdout) capturedStdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => { stderr.update(chunk); stderrBytes += chunk.length; });
    child.once("error", rejectCommand);
    child.once("close", (exitCode, signal) => {
      const result = {
        ...commandDefinition,
        exitCode: exitCode ?? 2,
        signal,
        stdoutSha256: stdout.digest("hex"),
        stdoutBytes,
        stderrSha256: stderr.digest("hex"),
        stderrBytes,
      };
      if (captureStdout) result.capturedStdout = capturedStdout;
      resolveCommand(result);
    });
  });
}

function auditCommand(commandDefinition, id) {
  const safeProgram = commandDefinition.program === process.execPath
    ? "node"
    : /(?:cmd|cmd\.exe)$/iu.test(commandDefinition.program)
      ? "cmd"
      : commandDefinition.program;
  if (id !== "V2-7") return { ...commandDefinition, program: safeProgram };
  const args = [];
  let inputNumber = 0;
  for (let index = 0; index < commandDefinition.args.length; index += 1) {
    const value = commandDefinition.args[index];
    if (value === "--input") {
      inputNumber += 1;
      args.push(value, `<explicit-safe-output-${inputNumber}>`);
      index += 1;
    } else if (value === "--canary-file") {
      args.push(value, "<canary-file>");
      index += 1;
    } else {
      args.push(value);
    }
  }
  return { ...commandDefinition, program: safeProgram, args };
}

export async function checkToolBaseline({ root = repositoryRoot } = {}) {
  const files = [];
  for (const relativePath of baselineFiles) {
    const absolutePath = resolve(root, relativePath);
    if (await exists(absolutePath)) files.push({ path: relativePath, status: "present", sha256: await sha256(absolutePath) });
    else files.push({ path: relativePath, status: "missing" });
  }
  return {
    verification: "W2-E-tool-baseline",
    status: files.every((file) => file.status === "present") ? "READY_FOR_OWNER_REGISTRATION" : "BLOCKED",
    files,
  };
}

async function ancestorReason() {
  const result = await runCommand(command("git", ["merge-base", "--is-ancestor", W2_START_COMMIT, "HEAD"], repositoryRoot));
  return result.exitCode === 0 ? null : `W2_START_COMMIT is not an ancestor of HEAD (git exit ${result.exitCode})`;
}

async function w1AncestorReason() {
  const result = await runCommand(command("git", ["merge-base", "--is-ancestor", "8785c6e", W2_START_COMMIT], repositoryRoot));
  return result.exitCode === 0 ? null : "8785c6e is not an ancestor of W2_START_COMMIT";
}

export function validateV21BaselineRecord(text) {
  const errors = [];
  if (typeof text !== "string" || text.trim().length === 0) return ["D1 V2-1 baseline record is empty"];
  const tableRows = text.split(/\r?\n/u)
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 2 && !cells.every((cell) => /^:?-{3,}:?$/u.test(cell)));
  if (tableRows.length > 0) {
    const rows = tableRows.map((cells) => cells.join(" | "));
    const has = (label, value) => rows.some((line) => label.test(line) && value.test(line));
    const pass = (label) => rows.some((line) => label.test(line) && /\bPASS\b/iu.test(line) && !/\b(?:FAIL|FAILED|BLOCKED)\b/iu.test(line));
    if (!has(/负责人登记的\s*`?W2_START_COMMIT`?|\bW2_START_COMMIT\b/iu, new RegExp(W2_START_COMMIT, "u"))) errors.push("D1 record does not bind the fixed W2_START_COMMIT");
    if (!has(/当前\s*HEAD|\bD1_?HEAD\b/iu, new RegExp(W2_START_COMMIT, "u"))) errors.push("D1 record does not state that D1 HEAD equals W2_START_COMMIT");
    if (!has(/8785c6e[0-9a-f]*/iu, /祖先|ancestor|is an ancestor|退出码\s*0|exit\s*(?:code)?\s*0/iu)) errors.push("D1 record does not explicitly confirm the 8785c6e ancestor relationship");
    if (!pass(/\btypecheck\b/iu)) errors.push("D1 record does not explicitly report typecheck as PASS");
    if (!pass(/\b(?:smoke|smoke:extension)\b/iu)) errors.push("D1 record does not explicitly report smoke as PASS");
    if (!pass(/\bverify\b/iu)) errors.push("D1 record does not explicitly report verify as PASS");
    const fullTests = rows.filter((line) => /\bnpm(?:\.cmd)?\s+test\b|\btest\s+--|全量测试/iu.test(line));
    if (fullTests.length === 0) errors.push("D1 record is missing full-test result");
    else if (fullTests.some((line) => /\b(?:FAIL|FAILED|BLOCKED)\b/iu.test(line))) errors.push("D1 record reports full tests as FAIL or BLOCKED");
    else if (!fullTests.some((line) => /\bPASS\b/iu.test(line) && /\d+\s*(?:\/|个|项|tests?|测试)/iu.test(line))) errors.push("D1 record is missing a real PASS full-test count");
    return errors;
  }
  if (!new RegExp(`W2_START_COMMIT\\s*[=:]\\s*${W2_START_COMMIT}`, "u").test(text)) errors.push("D1 record does not bind the fixed W2_START_COMMIT");
  if (!new RegExp(`(?:D1_)?HEAD\\s*[=:]\\s*${W2_START_COMMIT}`, "u").test(text)) errors.push("D1 record does not state that D1 HEAD equals W2_START_COMMIT");
  if (!/8785c6e[0-9a-f]*/iu.test(text) || !/ancestor|祖先/iu.test(text)) errors.push("D1 record does not preserve the 8785c6e ancestor check");
  for (const commandName of ["typecheck", "test", "smoke", "verify"]) {
    if (!new RegExp(commandName, "iu").test(text)) errors.push(`D1 record is missing ${commandName} result`);
  }
  if (!/(?:tests?|测试).{0,80}(?:\d+|[一二三四五六七八九十]+).{0,80}(?:pass|通过)/iu.test(text)) errors.push("D1 record is missing a real test-count result");
  const lines = text.split(/\r?\n/u);
  if (!lines.some((line) => /8785c6e[0-9a-f]*/iu.test(line) && /ancestor|祖先/iu.test(line) && /\bPASS\b|is an ancestor|为.*祖先/iu.test(line))) {
    errors.push("D1 record does not explicitly confirm the 8785c6e ancestor relationship");
  }
  for (const commandName of ["typecheck", "test", "smoke", "verify"]) {
    const results = lines.filter((line) => new RegExp(`\\b${commandName}\\b`, "iu").test(line));
    if (results.length === 0) continue;
    if (results.some((line) => /\b(?:FAIL|FAILED|BLOCKED)\b/iu.test(line))) {
      errors.push(`D1 record reports ${commandName} as FAIL or BLOCKED`);
    } else if (!results.some((line) => /\bPASS\b/iu.test(line))) {
      errors.push(`D1 record does not explicitly report ${commandName} as PASS`);
    }
  }
  const testLines = lines.filter((line) => /\btest\b|测试/iu.test(line));
  if (!testLines.some((line) => /\bPASS\b/iu.test(line) && /\d+/.test(line))) errors.push("D1 record is missing a real PASS test-count result");
  return errors;
}

async function requireFiles(relativePaths) {
  const missing = [];
  for (const relativePath of relativePaths) {
    if (!await exists(repoPath(relativePath))) missing.push(`missing required input: ${relativePath}`);
  }
  return missing;
}

function sha256Value(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nestedValue(object, names) {
  for (const name of names) {
    if (isPlainObject(object) && object[name] !== undefined) return object[name];
    if (isPlainObject(object?.hashes) && object.hashes[name] !== undefined) return object.hashes[name];
  }
  return undefined;
}

function rejectCandidateShorthand(document, label, errors) {
  if (isPlainObject(document) && Object.hasOwn(document, "candidate")) {
    errors.push(`${label} must use C's formal evidence fields, not a candidate shorthand`);
  }
}

// These checks deliberately follow C's emitted JSON formats.  E does not accept
// a hand-written candidate/entries envelope as proof of V2-3.
export function validateV23FormalBinding(binding) {
  const errors = [];
  if (!isPlainObject(binding)) return ["formal-binding.json must be a JSON object"];
  rejectCandidateShorthand(binding, "formal-binding.json", errors);
  if (binding.status !== "PASS") errors.push("formal-binding.json status must be PASS");
  if (binding.contract !== "W2-C2/W2-R5") errors.push("formal-binding.json contract must be W2-C2/W2-R5");
  if (typeof binding.formalCommit !== "string" || !/^[a-f0-9]{40}$/u.test(binding.formalCommit)) errors.push("formal-binding.json formalCommit is invalid");
  // C's formal binding predates the D33 supplement.  D4-report binding is
  // carried by the D5 contentBinding, not by formal-binding.json.
  const requiredChecks = ["67FileHashes", "assetTree", "final60", "manifestJcs", "diagnosticSummaryJcs"];
  if (!isPlainObject(binding.checks) || requiredChecks.some((name) => binding.checks[name] !== "PASS")) errors.push("formal-binding.json lacks PASS results for all required C binding checks");
  if (!isPlainObject(binding.counts) || binding.counts.manifestEntries !== 67 || binding.counts.missingFiles !== 0 || binding.counts.mismatchedFiles !== 0) errors.push("formal-binding.json does not prove the 67-file manifest result");
  // C issued two historical spellings for the same diagnostic-summary binding.
  // Accept either emitted spelling, but never an absent or internally conflicting
  // binding.  This is compatibility with read-only C evidence, not an E alias.
  const diagnosticSummaryHash = binding.hashes?.diagnosticSummaryJcsSha256 ?? binding.hashes?.diagnosticKnowledgeStateSummarySha256;
  const requiredHashes = ["manifestJcsSha256", "assetTreeSha256", "final60Sha256"];
  if (!isPlainObject(binding.hashes) || requiredHashes.some((name) => !sha256Value(binding.hashes[name])) || !sha256Value(diagnosticSummaryHash)) errors.push("formal-binding.json has incomplete or invalid hashes");
  if (sha256Value(binding.hashes?.diagnosticSummaryJcsSha256) && sha256Value(binding.hashes?.diagnosticKnowledgeStateSummarySha256) && binding.hashes.diagnosticSummaryJcsSha256 !== binding.hashes.diagnosticKnowledgeStateSummarySha256) errors.push("formal-binding.json diagnostic-summary hash spellings conflict");
  if (!Array.isArray(binding.blockers) || binding.blockers.length !== 0) errors.push("formal-binding.json must have an empty blockers array");
  return errors;
}

function normalizeFileResult(result) {
  if (!isPlainObject(result)) return null;
  const path = result.path ?? result.normalizedPath;
  const hashMode = result.hashMode;
  // C D5 evidence carries both the expected and observed values.  E accepts a
  // record only when a PASS record proves the two values agree.
  const expectedSha256 = result.expectedSha256 ?? nestedValue(result, ["sha256"]);
  const actualSha256 = result.actualSha256 ?? nestedValue(result, ["sha256"]);
  const expectedByteLength = result.expectedByteLength ?? result.byteLength ?? result.hashes?.byteLength;
  const actualByteLength = result.actualByteLength ?? result.byteLength ?? result.hashes?.byteLength;
  if (typeof path !== "string" || !normalizedLocation(path) || !["normalized-text", "raw-binary"].includes(hashMode) || !sha256Value(expectedSha256) || !sha256Value(actualSha256) || !Number.isInteger(expectedByteLength) || expectedByteLength < 0 || !Number.isInteger(actualByteLength) || actualByteLength < 0) return null;
  if (result.status !== undefined && result.status !== "PASS") return null;
  if (expectedSha256 !== actualSha256 || expectedByteLength !== actualByteLength) return null;
  return { path, hashMode, sha256: expectedSha256, byteLength: expectedByteLength };
}

function d5ContentFacts(evidence) {
  const binding = evidence.contentBinding;
  if (!isPlainObject(binding)) return null;
  return {
    assetTreeSha256: nestedValue(binding, ["assetTreeSha256"]),
    final60Sha256: nestedValue(binding, ["final60Sha256"]),
    // C emits this D4 report binding at the D5 top level.
    d4ReportNormalizedSha256: nestedValue(evidence, ["d4ReportNormalizedSha256", "d4V23ReportSha256"]) ?? nestedValue(binding, ["d4ReportNormalizedSha256", "d4V23ReportSha256"]),
    v23FormalSha256: nestedValue(binding, ["v23FormalSha256"]),
  };
}

function d5FormalCommit(evidence) {
  if (!isPlainObject(evidence)) return null;
  // C binds the formal commit in either the D5 root or contentBinding.  The
  // execution report is not required to duplicate this binding.
  const value = evidence.formalCommit ?? evidence.contentBinding?.formalCommit;
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value) ? value : null;
}

export function validateV23D5BindingEvidence(evidence) {
  const errors = [];
  if (!isPlainObject(evidence)) return ["d5-binding-evidence.json must be a JSON object"];
  rejectCandidateShorthand(evidence, "d5-binding-evidence.json", errors);
  if (evidence.status !== "PASS") errors.push("d5-binding-evidence.json status must be PASS");
  // C's emitted D5 format deliberately nests its list under contentBinding.
  // Never accept a root-level E-only substitute for this historical evidence.
  const fileResults = evidence.contentBinding?.fileResults;
  if (!Array.isArray(fileResults) || fileResults.length !== 67) errors.push("d5-binding-evidence.json contentBinding must contain exactly 67 fileResults");
  else {
    const paths = new Set();
    for (const result of fileResults) {
      const entry = normalizeFileResult(result);
      if (!entry) {
        errors.push("d5-binding-evidence.json contains an invalid fileResults entry");
        break;
      }
      if (paths.has(entry.path)) {
        errors.push("d5-binding-evidence.json fileResults contains duplicate normalized paths");
        break;
      }
      paths.add(entry.path);
    }
  }
  const content = d5ContentFacts(evidence);
  if (!content || !sha256Value(content.assetTreeSha256) || !sha256Value(content.final60Sha256) || !sha256Value(content.d4ReportNormalizedSha256)) errors.push("d5-binding-evidence.json contentBinding lacks required bound hashes");
  if (!d5FormalCommit(evidence)) errors.push("d5-binding-evidence.json lacks the formalCommit binding");
  if (!isPlainObject(evidence.v23)) errors.push("d5-binding-evidence.json lacks its V2-3 execution evidence");
  return errors;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new Error("freeze record is not JSON-canonicalizable");
}

const normalizedTextExtensions = new Set([".json", ".jsonl", ".md", ".csv", ".txt", ".py", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);

function normalizedBytes(path, bytes) {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (!normalizedTextExtensions.has(extension)) return { hashMode: "raw-binary", bytes };
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.startsWith("\uFEFF")) throw new Error(`normalized text has a BOM: ${path}`);
  return { hashMode: "normalized-text", bytes: Buffer.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8") };
}

export function validateV23ExecutionReport(report) {
  const errors = [];
  if (!isPlainObject(report)) return ["v23-formal.json must be a JSON object"];
  rejectCandidateShorthand(report, "v23-formal.json", errors);
  if (report.status !== "PASS" || report.v23Status !== "PASS") errors.push("v23-formal.json status and v23Status must both be PASS");
  if (report.validationId !== "V2-3" || report.contract !== "W2-C2/W2-R5") errors.push("v23-formal.json does not bind the C formal V2-3 contract");
  // v23-formal.json is an execution report.  The formal commit is authoritatively
  // bound by formal-binding.json and d5-binding-evidence.json, not duplicated here.
  if (!Array.isArray(report.classifications) || report.classifications.includes("environment_mismatch") || report.classifications.includes("b_asset_defect") || report.classifications.includes("c_validator_defect")) errors.push("v23-formal.json does not record a clean C execution");
  if (!Array.isArray(report.blockers) || report.blockers.length !== 0) errors.push("v23-formal.json must have an empty blockers array");
  if (!Array.isArray(report.datasetResults) || report.datasetResults.length !== 3 || report.datasetResults.some((item) => !isPlainObject(item) || item.repeatCount !== 3 || item.status !== "PASS")) errors.push("v23-formal.json does not prove three successful runs for all dataset fixtures");
  if (!Array.isArray(report.knownWrongResults) || report.knownWrongResults.length < 4 || report.knownWrongResults.some((item) => !isPlainObject(item) || item.status !== "PASS" || !Number.isInteger(item.fixtureRepeatRejections) || item.fixtureRepeatRejections < 3)) errors.push("v23-formal.json does not prove all known-wrong implementations were rejected");
  const counts = report.counts;
  if (!isPlainObject(counts) || counts.datasetFixtures !== 3 || counts.knownWrongImplementations < 4 || counts.knownWrongFixtureRepeatChecks < 3 || counts.knownWrongTestRejections < 1) errors.push("v23-formal.json has incomplete execution counts");
  const hashes = report.hashes;
  if (!isPlainObject(hashes) || ["fixtures", "references", "knownWrong", "tests"].some((name) => !isPlainObject(hashes[name]) || Object.keys(hashes[name]).length === 0)) errors.push("v23-formal.json lacks reproducible input hashes");
  return errors;
}

export function validateD33EnvironmentEvidence(v23, { requireExecutionEnvelope, label }) {
  const errors = [];
  if (!isPlainObject(v23)) return [`${label} must be a JSON object`];
  const environment = v23.environment;
  if (v23.contractSupplement !== "W2-V2-3-ENV-1") errors.push(`${label} does not bind W2-V2-3-ENV-1`);
  if (!isPlainObject(environment) || environment.expectedPandas !== "3.0.5" || environment.pandas !== "3.0.5" || typeof environment.python !== "string" || environment.python.length === 0 || typeof environment.platform !== "string" || environment.platform.length === 0) errors.push(`${label} lacks actual Python/Pandas/platform at pandas==3.0.5`);
  const classifications = v23.classifications ?? v23.classification;
  if (!(Array.isArray(classifications) || typeof classifications === "string")) errors.push(`${label} lacks execution classification`);
  else if ((Array.isArray(classifications) && classifications.some((value) => ["environment_mismatch", "b_asset_defect", "c_validator_defect"].includes(value))) || classifications === "environment_mismatch" || classifications === "b_asset_defect" || classifications === "c_validator_defect") errors.push(`${label} has a non-PASS environment classification`);
  if (!Array.isArray(v23.blockers)) errors.push(`${label} lacks blockers field`);
  else if (v23.blockers.length !== 0) errors.push(`${label} has blockers`);
  if (requireExecutionEnvelope) {
    const preflight = v23.environmentPreflight ?? v23.preflight;
    const commandValue = v23.command ?? v23.commands;
    const exitCode = v23.exitCode ?? v23.overallExitCode;
    if (!isPlainObject(preflight) || preflight.status !== "PASS") errors.push(`${label} lacks a PASS environment preflight`);
    if (!(typeof commandValue === "string" && commandValue.trim().length > 0) && !(Array.isArray(commandValue) && commandValue.length > 0 && commandValue.every((value) => typeof value === "string" && value.length > 0))) errors.push(`${label} lacks the executed command`);
    if (exitCode !== 0) errors.push(`${label} exit code is not 0`);
  }
  return errors;
}

function ownerRun(document, name) {
  if (!isPlainObject(document)) return null;
  return document[name] ?? document.runs?.[name] ?? null;
}

function classificationValues(value) {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

export function validateOwnerD33Evidence(document) {
  const errors = [];
  if (!isPlainObject(document)) return ["owner D33 evidence must be a JSON object"];
  if (document.contractSupplement !== "W2-V2-3-ENV-1") errors.push("owner D33 evidence does not bind W2-V2-3-ENV-1");
  if (typeof document.evidenceId !== "string" || document.evidenceId.length === 0) errors.push("owner D33 evidence lacks evidenceId");
  const positive = ownerRun(document, "positiveRun");
  const negative = ownerRun(document, "negativeRun");
  errors.push(...validateD33EnvironmentEvidence(positive, { requireExecutionEnvelope: true, label: "owner D33 positiveRun" }));
  if (!isPlainObject(negative)) return [...errors, "owner D33 evidence lacks negativeRun"];
  const environment = negative.environment;
  if (negative.status !== "BLOCKED" || negative.v23Status !== "BLOCKED") errors.push("owner D33 negativeRun must be BLOCKED/BLOCKED");
  if (!isPlainObject(environment) || environment.expectedPandas !== "3.0.5" || environment.pandas !== "2.3.3" || typeof environment.python !== "string" || environment.python.length === 0 || typeof environment.platform !== "string" || environment.platform.length === 0) errors.push("owner D33 negativeRun lacks the required 2.3.3 environment facts");
  if (negative.exitCode !== 2) errors.push("owner D33 negativeRun exitCode must be 2");
  if (!isPlainObject(negative.environmentPreflight) || negative.environmentPreflight.status !== "BLOCKED") errors.push("owner D33 negativeRun must record a BLOCKED environment preflight");
  if (!classificationValues(negative.classifications ?? negative.classification).every((value) => value === "environment_mismatch") || classificationValues(negative.classifications ?? negative.classification).length !== 1) errors.push("owner D33 negativeRun classification must be only environment_mismatch");
  if (!Array.isArray(negative.blockers) || negative.blockers.length === 0) errors.push("owner D33 negativeRun must have a non-empty blocker");
  if (negative.bAssetReadCount !== 0) errors.push("owner D33 negativeRun must prove B asset read count is 0");
  return errors;
}

function freezeAssetEntries(freeze) {
  const candidate = freeze?.candidate;
  if (!isPlainObject(candidate)) return null;
  // The owner freeze records its normalized manifest as candidate.entries.
  // Keep assets only as a compatibility fallback for an earlier read-only
  // envelope; never accept a root-level substitute.
  const entries = candidate.entries ?? candidate.assets;
  if (!Array.isArray(entries)) return null;
  return entries.map(normalizeFileResult);
}

function freezeContentFacts(freeze) {
  const candidate = freeze?.candidate;
  if (!isPlainObject(candidate)) return null;
  return {
    assetTreeSha256: nestedValue(candidate, ["assetTreeSha256"]),
    final60Sha256: nestedValue(candidate, ["final60Sha256"]),
    // The owner freezes C's D4 report in the independent cD4V23 section,
    // rather than duplicating it in candidate.
    d4ReportNormalizedSha256: freeze.cD4V23?.normalizedTextSha256 ?? nestedValue(candidate, ["d4ReportNormalizedSha256", "d4V23ReportSha256"]),
  };
}

async function evidenceJson(reference, label) {
  if (typeof reference !== "string" || reference.length === 0) throw new Error(`${label} was not supplied`);
  const path = isAbsolute(reference) ? resolve(reference) : repoPath(reference);
  if (!await exists(path)) throw new Error(`${label} is missing`);
  const bytes = await readFile(path);
  try {
    return { document: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    throw new Error(`${label} is not readable JSON`);
  }
}

async function evidenceText(reference, label) {
  if (typeof reference !== "string" || reference.length === 0) throw new Error(`${label} was not supplied`);
  const path = isAbsolute(reference) ? resolve(reference) : repoPath(reference);
  if (!await exists(path)) throw new Error(`${label} is missing`);
  return readFile(path, "utf8");
}

async function validateV23Binding(context) {
  const reasons = [];
  const required = [
    [context.v23FormalBinding, "--v2-3-formal-binding"],
    [context.v23D5BindingEvidence, "--v2-3-d5-binding-evidence"],
    [context.v23FormalReport, "--v2-3-v23-formal"],
    [context.v23GoldInputFreeze, "--v2-3-gold-input-freeze"],
    [context.v23OwnerD33Evidence, "--v2-3-owner-d33-evidence"],
    [context.v23CFinalReport, "--v2-3-c-final-report"],
  ];
  for (const [value, label] of required) if (!value) reasons.push(`${label} was not supplied`);
  if (reasons.length > 0) {
    return {
      reasons,
      ...(reasons.some((reason) => reason.includes("--v2-3-owner-d33-evidence")) ? { classification: "environment_mismatch" } : {}),
    };
  }
  let formalBinding;
  let d5Evidence;
  let formalReport;
  let freeze;
  let ownerD33;
  let cFinalReport;
  try {
    formalBinding = await evidenceJson(context.v23FormalBinding, "formal-binding.json");
    d5Evidence = await evidenceJson(context.v23D5BindingEvidence, "d5-binding-evidence.json");
    formalReport = await evidenceJson(context.v23FormalReport, "v23-formal.json");
    freeze = await evidenceJson(context.v23GoldInputFreeze, "gold-input-freeze.json");
    ownerD33 = await evidenceJson(context.v23OwnerD33Evidence, "owner D33 evidence");
    cFinalReport = await evidenceText(context.v23CFinalReport, "C final V2-3 report");
  } catch (error) {
    const reason = error.message;
    return {
      reasons: [reason],
      ...(reason.includes("owner D33 evidence") ? { classification: "environment_mismatch" } : {}),
    };
  }
  const d33Reasons = validateOwnerD33Evidence(ownerD33.document);
  const ownerEnvironmentReasons = [...d33Reasons];
  const reportReferenceReasons = [];
  if (typeof ownerD33.document.evidenceId === "string" && !cFinalReport.includes(ownerD33.document.evidenceId)) reportReferenceReasons.push("C final V2-3 report does not cite the supplied owner D33 evidenceId");
  // D33 is deliberately an owner-controlled, independent envelope.  C's
  // historical report must cite its evidenceId when it relies on it, but the
  // report is not required to restate a new owner-specific prose label.  That
  // would incorrectly reject an immutable C report solely for wording.
  if (d33Reasons.length > 0) return { reasons: d33Reasons, ...(ownerEnvironmentReasons.length > 0 ? { classification: "environment_mismatch" } : {}) };
  if (reportReferenceReasons.length > 0) return { reasons: reportReferenceReasons };
  reasons.push(...validateV23FormalBinding(formalBinding.document));
  reasons.push(...validateV23D5BindingEvidence(d5Evidence.document));
  reasons.push(...validateV23ExecutionReport(formalReport.document));
  if (reasons.length > 0) return { reasons };
  const binding = formalBinding.document;
  const d5 = d5Evidence.document;
  const report = formalReport.document;
  const content = d5ContentFacts(d5);
  const freezeEntries = freezeAssetEntries(freeze.document);
  const freezeContent = freezeContentFacts(freeze.document);
  const entries = d5.contentBinding.fileResults.map(normalizeFileResult);
  const d5Commit = d5FormalCommit(d5);
  if (binding.formalCommit !== d5Commit) reasons.push("C formal commit differs between formal-binding.json and d5-binding-evidence.json");
  const commitCheck = await runCommand(command("git", ["merge-base", "--is-ancestor", binding.formalCommit, "HEAD"], repositoryRoot));
  if (commitCheck.exitCode !== 0) reasons.push("C binding formalCommit is not an ancestor of current HEAD");
  const freezeHash = createHash("sha256").update(canonicalJson(freeze.document), "utf8").digest("hex");
  if (!Array.isArray(freezeEntries) || freezeEntries.length !== 67 || freezeEntries.some((entry) => entry === null)) reasons.push("gold-input-freeze.json candidate lacks 67 valid normalized asset entries");
  else if (canonicalJson(freezeEntries) !== canonicalJson(entries)) reasons.push("gold-input-freeze.json candidate assets do not match C D5 fileResults");
  if (!freezeContent || freezeContent.assetTreeSha256 !== content.assetTreeSha256 || content.assetTreeSha256 !== binding.hashes.assetTreeSha256) reasons.push("asset-tree hash is not consistently bound across C evidence and freeze");
  if (!freezeContent || freezeContent.final60Sha256 !== content.final60Sha256 || content.final60Sha256 !== binding.hashes.final60Sha256) reasons.push("final-60 hash is not consistently bound across C evidence and freeze");
  if (!freezeContent || freezeContent.d4ReportNormalizedSha256 !== content.d4ReportNormalizedSha256) reasons.push("D4 V2-3 report hash is not consistently bound between C D5 evidence and freeze");
  if (sha256Value(content.v23FormalSha256) && content.v23FormalSha256 !== formalReport.sha256) reasons.push("D5 V2-3 formal-report hash does not match v23-formal.json");
  const actualEntries = [];
  for (const entry of entries) {
    const path = repoPath(entry.path);
    if (!await exists(path)) {
      reasons.push(`C binding asset is missing from current HEAD: ${entry.path}`);
      continue;
    }
    try {
      const normalized = normalizedBytes(entry.path, await readFile(path));
      const actual = createHash("sha256").update(normalized.bytes).digest("hex");
      if (normalized.hashMode !== entry.hashMode) reasons.push(`C binding hashMode mismatch: ${entry.path}`);
      if (normalized.bytes.byteLength !== entry.byteLength) reasons.push(`C binding byteLength mismatch: ${entry.path}`);
      if (actual !== entry.sha256) reasons.push(`C binding SHA-256 mismatch: ${entry.path}`);
      actualEntries.push({ ...entry, sha256: actual, byteLength: normalized.bytes.byteLength, hashMode: normalized.hashMode });
    } catch (error) {
      reasons.push(`C binding entry cannot be normalized: ${entry.path} (${error.message})`);
    }
  }
  const sortedPaths = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"))).map((entry) => entry.path);
  if (entries.map((entry) => entry.path).join("\u0000") !== sortedPaths.join("\u0000")) reasons.push("C D5 fileResults are not sorted by normalized UTF-8 path");
  if (actualEntries.length === 67) {
    const treeInput = Buffer.concat(actualEntries.map((entry) => Buffer.from(`${entry.path}\0${entry.hashMode}\0${entry.sha256}\0${entry.byteLength}\n`, "utf8")));
    const actualTree = createHash("sha256").update(treeInput).digest("hex");
    if (actualTree !== content.assetTreeSha256) reasons.push("C D5 assetTreeSha256 does not match current normalized entries");
  }
  const finalPath = repoPath("evaluation/personas/final-60.jsonl");
  if (!await exists(finalPath)) reasons.push("current HEAD lacks evaluation/personas/final-60.jsonl");
  else {
    const normalized = normalizedBytes("evaluation/personas/final-60.jsonl", await readFile(finalPath));
    const finalHash = createHash("sha256").update(normalized.bytes).digest("hex");
    if (normalized.hashMode !== "normalized-text" || finalHash !== content.final60Sha256) reasons.push("current HEAD normalized final-60.jsonl SHA-256 does not match C binding");
  }
  return {
    reasons,
    formalBindingSha256: formalBinding.sha256,
    d5BindingEvidenceSha256: d5Evidence.sha256,
    v23FormalSha256: formalReport.sha256,
    ownerD33EvidenceSha256: ownerD33.sha256,
    goldInputFreezeJcsSha256: freezeHash,
  };
}

export function evaluateV28Qualification(qualification) {
  if (!qualification || qualification.status !== "PASS" || typeof qualification.checks !== "object") {
    return { status: "BLOCKED", reason: "owner blind-label qualification record is missing or not PASS" };
  }
  const requiredChecks = ["coverageAndSchema", "freezeBindingAndDeadline", "fileHashUnchanged", "independence"];
  const failedChecks = requiredChecks.filter((name) => qualification.checks[name] !== true);
  if (failedChecks.length > 0) {
    return { status: "BLOCKED", reason: `owner blind-label qualification checks not satisfied: ${failedChecks.join(", ")}` };
  }
  return { status: "PENDING_OWNER_ADJUDICATION", reason: "all executable blind-label checks passed; V2-8 is reserved for owner adjudication" };
}

function definitions(context) {
  const npmTest = (tests) => npmCommand(["test", "--", "--maxWorkers=1", "--run", ...tests]);
  return {
    "V2-1": {
      hardStandard: "W2 start commit is an ancestor of current HEAD; D1 record exists; latest HEAD reruns typecheck, full tests, extension smoke and verify.",
      inputs: ["git history", "D1 V2-1 baseline record", "pi-study-helper/package.json"],
      prerequisite: async () => {
        const reasons = [];
        const ancestor = await ancestorReason();
        if (ancestor) reasons.push(ancestor);
        const w1Ancestor = await w1AncestorReason();
        if (w1Ancestor) reasons.push(w1Ancestor);
        if (!context.v21BaselineRecord) reasons.push("D1 V2-1 baseline record was not supplied with --v2-1-baseline-record");
        else if (!await exists(repoPath(context.v21BaselineRecord))) reasons.push(`missing D1 V2-1 baseline record: ${context.v21BaselineRecord}`);
        else reasons.push(...validateV21BaselineRecord(await readFile(repoPath(context.v21BaselineRecord), "utf8")));
        reasons.push(...await requireFiles(["pi-study-helper/package.json"]));
        return reasons;
      },
      commands: async () => [
        npmCommand(["ci"]),
        npmCommand(["run", "typecheck"]),
        npmCommand(["test", "--", "--maxWorkers=1"]),
        npmCommand(["run", "smoke:extension"]),
        npmCommand(["run", "verify"]),
      ],
    },
    "V2-2": {
      hardStandard: "Profile revision 2 loads from a clean directory and rejects traversal, missing assets, dangling references, duplicate manifest entries and wrong revision.",
      inputs: ["pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/profile.json", "profile schema and negative tests"],
      prerequisite: async () => requireFiles([
        "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/profile.json",
        "pi-study-helper/tests/profile-v2-schema.test.ts",
        "pi-study-helper/tests/pandas-cleaning-v2-assets.test.ts",
      ]),
      commands: async () => [npmTest(["tests/profile-v2-schema.test.ts", "tests/pandas-cleaning-v2-assets.test.ts"])],
    },
    "V2-3": {
      hardStandard: "C historical formal binding/execution evidence proves the formal commit, 67 normalized assets, three runs and known-wrong rejection; the separately supplied owner D33 evidence proves W2-V2-3-ENV-1, and C's final report must cite that owner evidence. All content facts bind to the owner freeze record.",
      inputs: ["--v2-3-formal-binding", "--v2-3-d5-binding-evidence", "--v2-3-v23-formal", "--v2-3-gold-input-freeze", "--v2-3-owner-d33-evidence", "--v2-3-c-final-report"],
      // V2-3 has typed failure handling in runVerification: C-schema and
      // freeze-binding failures are ordinary BLOCKED; only D33 environment
      // evidence failures are classified as environment_mismatch.
      prerequisite: async () => [],
      commands: async () => [],
    },
    "V2-4": {
      hardStandard: "All-correct, all-wrong, skip, resume, replay, conflicting retry and completion transaction cases conform; dimensions with no valid evidence remain unverified, with mastery=null and confidence=0; KnowledgeState input is reproducible.",
      inputs: ["diagnostic runtime and KnowledgeState author tests"],
      prerequisite: async () => requireFiles([
        "pi-study-helper/tests/diagnostic-runtime.test.ts",
        "pi-study-helper/tests/knowledge-state.test.ts",
      ]),
      commands: async () => [npmTest(["tests/diagnostic-runtime.test.ts", "tests/knowledge-state.test.ts"])],
    },
    "V2-5": {
      hardStandard: "Four repository interfaces exist; only commit exposes public formal state; version conflicts and failures leave no partial write.",
      inputs: ["repository transaction author tests"],
      prerequisite: async () => requireFiles([
        "pi-study-helper/tests/file-learning-session-repository.test.ts",
        "pi-study-helper/tests/learning-session-repository.test.ts",
        "pi-study-helper/tests/profile-family-repository.test.ts",
        "pi-study-helper/tests/private-memory-repository.test.ts",
      ]),
      commands: async () => [npmTest([
        "tests/file-learning-session-repository.test.ts",
        "tests/learning-session-repository.test.ts",
        "tests/profile-family-repository.test.ts",
        "tests/private-memory-repository.test.ts",
      ])],
    },
    "V2-6": {
      hardStandard: "All 20 development and 60 final cases have valid fields, diagnostic results and computable KnowledgeState preconditions; no buildPath invocation or path-validity metric.",
      inputs: ["evaluation/personas/development-20.jsonl", "evaluation/personas/final-60.jsonl", "E V2-6 executable and runtime test"],
      prerequisite: async () => requireFiles([
        "evaluation/personas/development-20.jsonl",
        "evaluation/personas/final-60.jsonl",
        "pi-study-helper/scripts/w2-verification/v2-6-preconditions.mjs",
        "pi-study-helper/scripts/w2-verification/v2-6-preconditions.test.mjs",
        "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/profile.json",
      ]),
      commands: async () => [command(process.execPath, [
        "pi-study-helper/scripts/w2-verification/v2-6-preconditions.mjs",
        "--development", "evaluation/personas/development-20.jsonl",
        "--final", "evaluation/personas/final-60.jsonl",
        "--profile", "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft",
      ], repositoryRoot)],
    },
    "V2-7": {
      hardStandard: "Only explicit safe DTO, ordinary log, D recorded-response, safe-export or verification-report inputs are scanned; all six sensitive categories have zero hits.",
      inputs: ["one or more --v2-7-input / --v2-7-location / --v2-7-surface triples", "mandatory six-category --v2-7-canary-file"],
      prerequisite: async () => {
        if (context.v27Inputs.length === 0) return ["no explicit V2-7 safe output was supplied"];
        const reasons = [];
        for (const [index, input] of context.v27Inputs.entries()) {
          if (!normalizedLocation(input.location)) reasons.push(`invalid V2-7 normalized output location: ${input.location}`);
          if (!V2_7_SURFACES.includes(input.surface)) reasons.push(`V2-7 input ${index + 1} has a non-contract surface: ${input.surface}`);
          if (!await exists(input.path)) reasons.push(`missing V2-7 input file at explicit input position ${index + 1}`);
        }
        if (!context.v27CanaryFile) reasons.push("missing mandatory six-category V2-7 canary file");
        else if (!await exists(context.v27CanaryFile)) reasons.push("missing V2-7 canary file");
        else {
          try {
            validateV27Canaries(JSON.parse(await readFile(context.v27CanaryFile, "utf8")));
          } catch (error) {
            reasons.push(`invalid V2-7 canary file: ${error.message}`);
          }
        }
        return reasons;
      },
      commands: async () => {
        const args = [];
        for (const input of context.v27Inputs) args.push("--input", input.path, "--output-location", input.location, "--surface", input.surface);
        args.push("--canary-file", context.v27CanaryFile);
        return [command(process.execPath, ["pi-study-helper/scripts/w2-verification/v2-7-asset-isolation.mjs", ...args], repositoryRoot)];
      },
    },
    "V2-8": {
      hardStandard: "Only owner qualification may move V2-8 to PENDING_OWNER_ADJUDICATION; PASS is prohibited until D7 owner adjudication and formal gold generation.",
      inputs: ["evaluation/golden/annotations/e-first-20.jsonl", "--v2-8-qualification owner summary"],
      prerequisite: async () => requireFiles(["evaluation/golden/annotations/e-first-20.jsonl"]),
      commands: async () => [],
    },
  };
}

async function readQualification(relativePath) {
  if (!relativePath) return null;
  const path = repoPath(relativePath);
  if (!await exists(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function runVerification(id, context, { execute = false } = {}) {
  const definition = definitions(context)[id];
  if (!definition) throw new Error(`unknown V2 item: ${id}`);
  const commands = await definition.commands();
  const base = { v2Id: id, hardStandard: definition.hardStandard, inputs: definition.inputs, commands: commands.map((item) => auditCommand(item, id)) };
  if (id === "V2-3") {
    const binding = await validateV23Binding(context);
    if (binding.reasons.length > 0) return { ...base, status: "BLOCKED", reasons: binding.reasons, commandResults: [], ...(binding.classification ? { classification: binding.classification } : {}) };
    if (!execute) return { ...base, status: "BLOCKED", reasons: ["verification commands were not executed; rerun with --run"], commandResults: [] };
    return {
      ...base,
      status: "PASS",
      reasons: [],
      commandResults: [],
      formalBindingSha256: binding.formalBindingSha256,
      d5BindingEvidenceSha256: binding.d5BindingEvidenceSha256,
      v23FormalSha256: binding.v23FormalSha256,
      ownerD33EvidenceSha256: binding.ownerD33EvidenceSha256,
      goldInputFreezeJcsSha256: binding.goldInputFreezeJcsSha256,
    };
  }
  const preconditions = await definition.prerequisite();
  if (preconditions.length > 0) return { ...base, status: "BLOCKED", reasons: preconditions, commandResults: [] };
  if (id === "V2-8") {
    const qualification = await readQualification(context.v28Qualification);
    const verdict = evaluateV28Qualification(qualification);
    return { ...base, status: verdict.status, reasons: [verdict.reason], commandResults: [] };
  }
  if (!execute) return { ...base, status: "BLOCKED", reasons: ["verification commands were not executed; rerun with --run"], commandResults: [] };
  const commandResults = [];
  let v27Scan = null;
  for (const item of commands) {
    const result = await runCommand(item, { captureStdout: id === "V2-7" });
    const { capturedStdout, ...auditableResult } = result;
    commandResults.push(auditCommand(auditableResult, id));
    if (result.exitCode !== 0) {
      const safeCommand = auditCommand(item, id);
      return { ...base, status: "BLOCKED", reasons: [`command failed: ${safeCommand.program} ${safeCommand.args.join(" ")} (exit ${result.exitCode})`], commandResults };
    }
    if (id === "V2-7") {
      try {
        const parsed = JSON.parse(capturedStdout);
        if (parsed.status !== "PASS" || typeof parsed.counts !== "object") throw new Error("scanner did not return a PASS report");
        v27Scan = {
          inputCount: parsed.inputCount,
          outputLocations: parsed.outputLocations,
          inputFingerprints: parsed.inputFingerprints,
          counts: parsed.counts,
          status: parsed.status,
        };
      } catch {
        return { ...base, status: "BLOCKED", reasons: ["V2-7 scanner output is not a valid safe report"], commandResults };
      }
    }
  }
  return { ...base, status: "PASS", reasons: [], commandResults, ...(v27Scan ? { v27Scan } : {}) };
}

function defaultContext() {
  return {
    v21BaselineRecord: null,
    v23FormalBinding: null,
    v23D5BindingEvidence: null,
      v23FormalReport: null,
      v23GoldInputFreeze: null,
      v23OwnerD33Evidence: null,
      v23CFinalReport: null,
    v27Inputs: [],
    v27CanaryFile: null,
    v28Qualification: null,
  };
}

export function parseArgs(argv) {
  const context = defaultContext();
  let action = null;
  let selected = [];
  let lastV27Input = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--list", "--status", "--run", "--check-tool-baseline"].includes(argument)) {
      if (action) throw new Error("only one primary action is allowed");
      action = argument;
    } else if (argument === "--v2") {
      const value = argv[++index];
      if (!value) throw new Error("missing value for --v2");
      selected.push(...value.split(","));
    } else if (argument === "--v2-1-baseline-record") context.v21BaselineRecord = argv[++index];
    else if (argument === "--v2-3-formal-binding") context.v23FormalBinding = argv[++index];
    else if (argument === "--v2-3-d5-binding-evidence") context.v23D5BindingEvidence = argv[++index];
    else if (argument === "--v2-3-v23-formal") context.v23FormalReport = argv[++index];
    else if (argument === "--v2-3-gold-input-freeze") context.v23GoldInputFreeze = argv[++index];
    else if (argument === "--v2-3-owner-d33-evidence") context.v23OwnerD33Evidence = argv[++index];
    else if (argument === "--v2-3-c-final-report") context.v23CFinalReport = argv[++index];
    else if (argument === "--v2-7-input") {
      const path = argv[++index];
      if (!path) throw new Error("missing value for --v2-7-input");
      lastV27Input = { path, location: null, surface: null };
      context.v27Inputs.push(lastV27Input);
    } else if (argument === "--v2-7-location") {
      const location = argv[++index];
      if (!lastV27Input || !location) throw new Error("--v2-7-location must follow --v2-7-input");
      lastV27Input.location = location;
    } else if (argument === "--v2-7-surface") {
      const surface = argv[++index];
      if (!lastV27Input || !surface) throw new Error("--v2-7-surface must follow an --v2-7-input");
      lastV27Input.surface = surface;
    } else if (argument === "--v2-7-canary-file") context.v27CanaryFile = argv[++index];
    else if (argument === "--v2-8-qualification") context.v28Qualification = argv[++index];
    else throw new Error(`unknown parameter: ${argument}`);
    if (argv[index] === undefined) throw new Error(`missing value for ${argument}`);
  }
  if (!action) throw new Error("one primary action is required");
  selected = selected.length === 0 ? [...V2_IDS] : [...new Set(selected)];
  for (const id of selected) if (!V2_IDS.includes(id)) throw new Error(`unknown V2 item: ${id}`);
  return { action, selected, context };
}

function publicDefinition(id, context) {
  const definition = definitions(context)[id];
  return { v2Id: id, hardStandard: definition.hardStandard, inputs: definition.inputs };
}

function usage() {
  console.log("Usage: node v2-comprehensive-verification.mjs --list | --status [--v2 V2-1,V2-7] | --run [--v2 V2-1,V2-7] [--v2-1-baseline-record <repo-relative>] [--v2-3-formal-binding <read-only-json> --v2-3-d5-binding-evidence <read-only-json> --v2-3-v23-formal <read-only-json> --v2-3-gold-input-freeze <read-only-json> --v2-3-owner-d33-evidence <owner-read-only-json> --v2-3-c-final-report <C-read-only-markdown>] [--v2-7-input <file> --v2-7-location <normalized-relative-output> --v2-7-surface <safe_dto|ordinary_log|d_recording|safe_export|verification_report> --v2-7-canary-file <file>] [--v2-8-qualification <repo-relative>] | --check-tool-baseline");
}

async function main(argv) {
  if (argv.length > 0 && argv[0] === "--run-v2-7") {
    const scanner = resolve(scriptDirectory, "v2-7-asset-isolation.mjs");
    const child = spawn(process.execPath, [scanner, ...argv.slice(1)], { stdio: "inherit", windowsHide: true });
    const code = await new Promise((resolveChild, rejectChild) => {
      child.once("error", rejectChild);
      child.once("exit", resolveChild);
    });
    process.exitCode = code ?? 2;
    return;
  }
  const { action, selected, context } = parseArgs(argv);
  if (action === "--check-tool-baseline") {
    const result = await checkToolBaseline();
    console.log(JSON.stringify(result));
    if (result.status !== "READY_FOR_OWNER_REGISTRATION") process.exitCode = 1;
    return;
  }
  if (action === "--list") {
    console.log(JSON.stringify({ verification: "W2-V2-comprehensive-runner", items: selected.map((id) => publicDefinition(id, context)) }));
    return;
  }
  const results = [];
  for (const id of selected) results.push(await runVerification(id, context, { execute: action === "--run" }));
  console.log(JSON.stringify({ verification: "W2-V2-comprehensive-runner", action, results }));
  if (results.some((result) => result.status === "BLOCKED")) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`V2 comprehensive runner BLOCKED: ${error.message}`);
    process.exitCode = 2;
  });
}
