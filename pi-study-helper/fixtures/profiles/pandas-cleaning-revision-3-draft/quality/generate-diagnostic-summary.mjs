import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { DiagnosticRuntime } from "../../../../src/application/diagnostic-runtime.ts";
import { FileLearningSessionRepository } from "../../../../src/repositories/file-learning-session-repository.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../../../../");
const profileRoot = resolve(repositoryRoot, "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft");
const final60Path = resolve(repositoryRoot, "evaluation/personas/final-60.jsonl");
const fixedNow = () => new Date("2026-08-01T00:00:00.000Z");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jcs(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported JCS value: ${typeof value}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizedText(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) throw new Error("UTF-8 BOM is not permitted");
  return Buffer.from(text.replace(/\r\n|\r/g, "\n"), "utf8");
}

function projectKnowledgeState(state) {
  return {
    confidence: state.confidence,
    knowledgePointId: state.knowledgePointId,
    mastery: state.mastery,
    status: state.status,
  };
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error("Usage: node --experimental-strip-types generate-diagnostic-summary.mjs <output.json>");

  const [blueprint, answerKey, knowledgeAsset, final60Raw] = await Promise.all([
    readJson(resolve(profileRoot, "assessments/diagnostic/questions.json")),
    readJson(resolve(profileRoot, "assessments/diagnostic/private/answer-key.json")),
    readJson(resolve(profileRoot, "knowledge/knowledge-points.json")),
    readFile(final60Path),
  ]);
  const cases = new TextDecoder("utf-8", { fatal: true }).decode(final60Raw).trimEnd().split("\n").map((line) => JSON.parse(line));
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "w2-diagnostic-freeze-"));

  try {
    const repository = new FileLearningSessionRepository({ dataRoot: temporaryRoot, now: fixedNow });
    const runtime = new DiagnosticRuntime({
      repository,
      dataRoot: temporaryRoot,
      now: fixedNow,
      loadAssets: async () => ({ blueprint, answerKey, knowledgePoints: knowledgeAsset.knowledgePoints }),
    });
    const summaries = [];

    for (const candidate of cases) {
      const requestPrefix = `freeze-${candidate.caseId}`;
      const view = await repository.create({
        requestId: `${requestPrefix}-create`,
        subjectId: "pandas-cleaning",
        mode: "recommended",
        goalId: candidate.goalId,
        availableMinutes: candidate.availableMinutes,
        profileRevision: 3,
        diagnosticRequired: true,
      });
      for (const [index, answer] of candidate.diagnosticAnswers.entries()) {
        await runtime.submitDiagnosticAnswer({
          ...answer,
          requestId: `${requestPrefix}-answer-${String(index + 1).padStart(2, "0")}`,
          sessionId: view.sessionId,
          sessionVersion: view.sessionVersion,
          profileRevision: 3,
          diagnosticId: blueprint.blueprintId,
          diagnosticVersion: 1,
          questionId: answer.questionId,
        });
      }
      const completed = await runtime.completeDiagnostic({
        requestId: `${requestPrefix}-complete`,
        sessionId: view.sessionId,
        sessionVersion: view.sessionVersion,
        profileRevision: 3,
        diagnosticId: blueprint.blueprintId,
        diagnosticVersion: 1,
      });
      summaries.push({
        caseId: candidate.caseId,
        evidenceVersion: completed.evidenceVersion,
        insufficientKnowledgePointIds: [...completed.insufficientKnowledgePointIds].sort(),
        knowledgeStates: [...completed.knowledgeStates].map(projectKnowledgeState).sort((left, right) =>
          left.knowledgePointId.localeCompare(right.knowledgePointId, "en"),
        ),
      });
    }

    const summary = {
      aCommit: "1008f765e12687a0a1f7d65666a64cf13995e0a3",
      caseCount: summaries.length,
      final60Sha256: sha256(normalizedText(final60Raw)),
      profileRevision: 3,
      scoringVersion: blueprint.scoringVersion,
      summaryVersion: "w2-diagnostic-knowledge-state-summary-v1",
      summaries,
    };
    await writeFile(outputPath, `${jcs(summary)}\n`, "utf8");
    process.stdout.write(`${sha256(Buffer.from(jcs(summary), "utf8"))}  ${outputPath}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
