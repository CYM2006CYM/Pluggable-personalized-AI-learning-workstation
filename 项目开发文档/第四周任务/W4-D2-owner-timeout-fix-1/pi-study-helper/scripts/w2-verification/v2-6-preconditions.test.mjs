import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DiagnosticRuntime, createProfileDirectoryDiagnosticLoader } from "../../src/application/diagnostic-runtime.js";
import { FileLearningSessionRepository } from "../../src/repositories/file-learning-session-repository.js";
import { parseJsonl, validatePersonaCases } from "./v2-6-preconditions.mjs";

const backgroundMappings = {
  python_experience: new Map([
    ["有 Python 课程基础", "basic"],
    ["自学过基础 Python", "basic"],
    ["以工作任务为主", "uncertain"],
  ]),
  pandas_experience: new Map([
    ["刚接触 pandas", "basic"],
    ["有零散表格处理经验", "basic"],
    ["经常处理订单表", "comfortable"],
  ]),
  explanation_preference: new Map([
    ["希望分步骤说明", "step_by_step"],
    ["希望看到数据结构解释", "example_first"],
    ["希望先看验收条件", "concise"],
  ]),
};

function adaptBackgroundQuestionnaire(fields) {
  const source = new Map(fields.filter((field) => field.fieldId !== "case_variant").map((field) => [field.fieldId, field.value]));
  const output = {};
  for (const [fieldId, mapping] of Object.entries(backgroundMappings)) {
    const mapped = mapping.get(source.get(fieldId));
    if (mapped === undefined) throw new Error(`unsupported ${fieldId} value`);
    output[fieldId] = mapped;
  }
  return output;
}

function validCase(prefix, index) {
  return {
    caseId: `${prefix}-${String(index).padStart(3, "0")}`,
    personaType: "self_learner",
    background: [{ fieldId: "experience", value: "none" }],
    goalId: "goal-clean-orders",
    diagnosticAnswers: [{ questionId: "diag-01", action: "skip" }],
    availableMinutes: 30,
  };
}

describe("E V2-6 case-input preconditions", () => {
  it("accepts exactly 20 development and 60 final structurally valid cases", () => {
    expect(validatePersonaCases(Array.from({ length: 20 }, (_, index) => validCase("dev", index + 1)), { prefix: "dev", expectedCount: 20 })).toEqual([]);
    expect(validatePersonaCases(Array.from({ length: 60 }, (_, index) => validCase("final", index + 1)), { prefix: "final", expectedCount: 60 })).toEqual([]);
  });

  it("rejects bad fields, missing fields and non-computable diagnostic inputs", () => {
    const badField = { ...validCase("dev", 1), personaType: "unknown" };
    const missingField = { ...validCase("dev", 1) };
    delete missingField.goalId;
    const impossibleAnswer = { ...validCase("dev", 1), diagnosticAnswers: [{ questionId: "", action: "answer", answer: 0 }] };
    expect(validatePersonaCases([badField], { prefix: "dev", expectedCount: 1 }).join(" ")).toContain("personaType is invalid");
    expect(validatePersonaCases([missingField], { prefix: "dev", expectedCount: 1 }).join(" ")).toContain("missing required field goalId");
    expect(validatePersonaCases([impossibleAnswer], { prefix: "dev", expectedCount: 1 }).join(" ")).toContain("non-empty questionId");
  });

  it("parses JSONL without invoking buildPath or deriving a path-validity metric", () => {
    const parsed = parseJsonl(`${JSON.stringify(validCase("dev", 1))}\n`, "development");
    expect(parsed.errors).toEqual([]);
    expect(parsed.cases).toHaveLength(1);
  });

  it("maps frozen W2 background labels to the W4 questionnaire without carrying case_variant", () => {
    expect(adaptBackgroundQuestionnaire([
      { fieldId: "python_experience", value: "有 Python 课程基础" },
      { fieldId: "pandas_experience", value: "经常处理订单表" },
      { fieldId: "explanation_preference", value: "希望看到数据结构解释" },
      { fieldId: "case_variant", value: 2 },
    ])).toEqual({ python_experience: "basic", pandas_experience: "comfortable", explanation_preference: "example_first" });
    expect(() => adaptBackgroundQuestionnaire([
      { fieldId: "python_experience", value: "未知" },
      { fieldId: "pandas_experience", value: "刚接触 pandas" },
      { fieldId: "explanation_preference", value: "希望分步骤说明" },
    ])).toThrow("unsupported python_experience value");
  });
});

const developmentPath = process.env.W2_V26_DEVELOPMENT_PATH;
const finalPath = process.env.W2_V26_FINAL_PATH;
const profilePath = process.env.W2_V26_PROFILE_PATH;
const temporaryRoots = [];
// The full 20+60 recomputation takes 65-70 seconds on the approved cold
// Windows environment. Keep a bounded budget with enough measured headroom.
const V2_6_RUNTIME_TIMEOUT_MS = 120_000;

afterAll(async () => {
  await Promise.all(temporaryRoots.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("E V2-6 runtime recomputation", () => {
  it("recomputes every supplied case and keeps no-evidence knowledge dimensions unverified", async () => {
    if (!developmentPath || !finalPath || !profilePath) return;
    const development = parseJsonl(await readFile(developmentPath, "utf8"), "development").cases;
    const final = parseJsonl(await readFile(finalPath, "utf8"), "final").cases;
    expect(validatePersonaCases(development, { prefix: "dev", expectedCount: 20 })).toEqual([]);
    expect(validatePersonaCases(final, { prefix: "final", expectedCount: 60 })).toEqual([]);
    const loadAssets = createProfileDirectoryDiagnosticLoader(() => profilePath);
    const assets = await loadAssets("pandas-cleaning", 2);
    const root = await mkdtemp(join(tmpdir(), "e-v2-6-"));
    temporaryRoots.push(root);
    const repository = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-08-02T00:00:00.000Z") });
    const runtime = new DiagnosticRuntime({ repository, dataRoot: root, now: () => new Date("2026-08-02T00:00:00.000Z"), loadAssets });
    const questionsByKnowledgePoint = new Map();
    for (const question of assets.blueprint.questions) {
      const values = questionsByKnowledgePoint.get(question.knowledgePointId) ?? [];
      values.push(question.questionId);
      questionsByKnowledgePoint.set(question.knowledgePointId, values);
    }
    for (const item of [...development, ...final]) {
      const view = await repository.create({
        requestId: `create-${item.caseId}`,
        subjectId: "pandas-cleaning",
        mode: "recommended",
        goalId: item.goalId,
        availableMinutes: item.availableMinutes,
        profileRevision: 2,
        diagnosticRequired: true,
      });
      const base = {
        sessionId: view.sessionId,
        sessionVersion: view.sessionVersion,
        profileRevision: 2,
        diagnosticId: assets.blueprint.blueprintId,
        diagnosticVersion: 1,
      };
      const questionnaire = adaptBackgroundQuestionnaire(item.background);
      const saved = await runtime.saveDiagnosticDraft({
        ...base,
        requestId: `background-${item.caseId}`,
        diagnosticDraftVersion: 0,
        background: questionnaire,
        currentQuestionId: assets.blueprint.questions[0]?.questionId,
      });
      let diagnosticDraftVersion = saved.diagnosticDraftVersion;
      for (const answer of item.diagnosticAnswers) {
        const submitted = await runtime.submitDiagnosticAnswer({ ...base, ...answer, diagnosticDraftVersion, requestId: `${item.caseId}-${answer.questionId}` });
        diagnosticDraftVersion = submitted.diagnosticDraftVersion;
      }
      const completed = await runtime.completeDiagnostic({ ...base, mode: "fixed", diagnosticDraftVersion, requestId: `complete-${item.caseId}` });
      expect(completed.knowledgeStates.length).toBeGreaterThan(0);
      expect(completed.knowledgeStates.every((state) => state.profileRevision === 2 && Number.isFinite(state.confidence))).toBe(true);
      const skipped = new Set(item.diagnosticAnswers.filter((answer) => answer.action === "skip").map((answer) => answer.questionId));
      for (const state of completed.knowledgeStates) {
        const questions = questionsByKnowledgePoint.get(state.knowledgePointId) ?? [];
        if (questions.length > 0 && questions.every((questionId) => skipped.has(questionId))) {
          expect(state.status).toBe("unverified");
          expect(state.mastery).toBeNull();
        }
      }
    }
  }, V2_6_RUNTIME_TIMEOUT_MS);
});
