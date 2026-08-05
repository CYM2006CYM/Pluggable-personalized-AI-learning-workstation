import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const piRoot = resolve(scriptDirectory, "../..");
const personaTypes = new Set(["cs_student", "self_learner", "practice_oriented"]);

function issue(path, message) {
  return `${path}: ${message}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableCaseId(prefix, index) {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

export function validatePersonaCases(cases, { prefix, expectedCount }) {
  const errors = [];
  if (!Array.isArray(cases)) return [issue(prefix, "JSONL must decode to an array of cases")];
  if (cases.length !== expectedCount) errors.push(issue(prefix, `expected exactly ${expectedCount} cases, got ${cases.length}`));
  for (const [index, item] of cases.entries()) {
    const path = `${prefix}[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(issue(path, "case must be an object"));
      continue;
    }
    const allowed = new Set(["caseId", "personaType", "background", "goalId", "diagnosticAnswers", "availableMinutes", "notes"]);
    for (const key of Object.keys(item)) if (!allowed.has(key)) errors.push(issue(path, `unknown field ${key}`));
    for (const key of ["caseId", "personaType", "background", "goalId", "diagnosticAnswers", "availableMinutes"]) {
      if (!(key in item)) errors.push(issue(path, `missing required field ${key}`));
    }
    if (item.caseId !== stableCaseId(prefix, index + 1)) errors.push(issue(path, `caseId must equal ${stableCaseId(prefix, index + 1)}`));
    if (!personaTypes.has(item.personaType)) errors.push(issue(path, "personaType is invalid"));
    if (!Array.isArray(item.background) || item.background.length === 0) {
      errors.push(issue(path, "background must be a non-empty array"));
    } else {
      for (const [backgroundIndex, field] of item.background.entries()) {
        if (!isPlainObject(field) || typeof field.fieldId !== "string" || field.fieldId.length === 0 || !("value" in field)) {
          errors.push(issue(`${path}.background[${backgroundIndex}]`, "background field must contain fieldId and value"));
        }
      }
    }
    if (typeof item.goalId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(item.goalId)) errors.push(issue(path, "goalId must be a stable identifier"));
    if (!Array.isArray(item.diagnosticAnswers)) {
      errors.push(issue(path, "diagnosticAnswers must be an array"));
    } else {
      const questionIds = new Set();
      for (const [answerIndex, answer] of item.diagnosticAnswers.entries()) {
        const answerPath = `${path}.diagnosticAnswers[${answerIndex}]`;
        if (!isPlainObject(answer) || typeof answer.questionId !== "string" || answer.questionId.length === 0) {
          errors.push(issue(answerPath, "diagnostic answer requires a non-empty questionId"));
          continue;
        }
        if (questionIds.has(answer.questionId)) errors.push(issue(answerPath, `duplicate questionId ${answer.questionId}`));
        questionIds.add(answer.questionId);
        if (answer.action === "answer") {
          if (!(typeof answer.answer === "string" || typeof answer.answer === "boolean")) errors.push(issue(answerPath, "answer action requires a string or boolean answer"));
        } else if (answer.action === "skip") {
          if ("answer" in answer) errors.push(issue(answerPath, "skip action must not carry answer"));
        } else {
          errors.push(issue(answerPath, "action must be answer or skip"));
        }
      }
    }
    if (!Number.isFinite(item.availableMinutes) || item.availableMinutes <= 0) errors.push(issue(path, "availableMinutes must be a positive finite number"));
    if ("notes" in item && typeof item.notes !== "string") errors.push(issue(path, "notes must be a string when present"));
  }
  return errors;
}

export function parseJsonl(text, label) {
  const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
  const cases = [];
  const errors = [];
  for (const [index, line] of lines.entries()) {
    try {
      cases.push(JSON.parse(line));
    } catch {
      errors.push(issue(`${label}:line-${index + 1}`, "invalid JSON"));
    }
  }
  return { cases, errors };
}

export async function inspectV26Inputs({ developmentPath, finalPath }) {
  const [developmentBytes, finalBytes] = await Promise.all([readFile(developmentPath), readFile(finalPath)]);
  const development = parseJsonl(new TextDecoder("utf-8", { fatal: true }).decode(developmentBytes), "development");
  const final = parseJsonl(new TextDecoder("utf-8", { fatal: true }).decode(finalBytes), "final");
  const errors = [
    ...development.errors,
    ...final.errors,
    ...validatePersonaCases(development.cases, { prefix: "dev", expectedCount: 20 }),
    ...validatePersonaCases(final.cases, { prefix: "final", expectedCount: 60 }),
  ];
  return {
    development: { count: development.cases.length, sha256: createHash("sha256").update(developmentBytes).digest("hex") },
    final: { count: final.cases.length, sha256: createHash("sha256").update(finalBytes).digest("hex") },
    errors,
  };
}

async function runRuntimeTest({ developmentPath, finalPath, profilePath }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(piRoot, "node_modules/vitest/vitest.mjs"), "run", "--maxWorkers=1", "--run", "scripts/w2-verification/v2-6-preconditions.test.mjs"], {
      cwd: piRoot,
      windowsHide: true,
      env: {
        ...process.env,
        W2_V26_DEVELOPMENT_PATH: developmentPath,
        W2_V26_FINAL_PATH: finalPath,
        W2_V26_PROFILE_PATH: profilePath,
      },
    });
    const stdout = createHash("sha256");
    const stderr = createHash("sha256");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk) => { stdout.update(chunk); stdoutBytes += chunk.length; });
    child.stderr.on("data", (chunk) => { stderr.update(chunk); stderrBytes += chunk.length; });
    child.once("error", rejectRun);
    child.once("close", (exitCode) => resolveRun({
      exitCode: exitCode ?? 2,
      stdoutSha256: stdout.digest("hex"),
      stderrSha256: stderr.digest("hex"),
      stdoutBytes,
      stderrBytes,
    }));
  });
}

function usage() {
  console.log("Usage: node v2-6-preconditions.mjs --development <jsonl> --final <jsonl> --profile <profile-directory>");
}

async function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!(["--development", "--final", "--profile"].includes(argument))) throw new Error(`unknown parameter: ${argument}`);
    const value = argv[++index];
    if (!value) throw new Error(`missing value for ${argument}`);
    options[argument] = value;
  }
  if (!options["--development"] || !options["--final"] || !options["--profile"]) {
    usage();
    throw new Error("development, final and profile inputs are all required");
  }
  // The runtime test intentionally runs from pi-study-helper.  Resolve every
  // caller-provided input before either phase so a repository-relative CLI
  // invocation has the same meaning as a direct invocation.
  const developmentPath = resolve(process.cwd(), options["--development"]);
  const finalPath = resolve(process.cwd(), options["--final"]);
  const profilePath = resolve(process.cwd(), options["--profile"]);
  const inspection = await inspectV26Inputs({ developmentPath, finalPath });
  if (inspection.errors.length > 0) {
    console.log(JSON.stringify({ verification: "V2-6", status: "BLOCKED", inspection }));
    process.exitCode = 1;
    return;
  }
  const runtime = await runRuntimeTest({
    developmentPath,
    finalPath,
    profilePath,
  });
  const status = runtime.exitCode === 0 ? "PASS" : "BLOCKED";
  console.log(JSON.stringify({ verification: "V2-6", status, inspection, runtime }));
  if (status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`V2-6 preconditions BLOCKED: ${error.message}`);
    process.exitCode = 2;
  });
}
