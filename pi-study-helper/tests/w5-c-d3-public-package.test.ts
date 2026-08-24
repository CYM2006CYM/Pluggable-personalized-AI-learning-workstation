import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hashPublicExecutionBundle, validatePublicExecutionBundle } from "../src/application/public-execution-bundle.js";
import { PythonProcessCodeEvaluationAdapter } from "../src/infrastructure/python-process-evaluation-adapter.js";
import { createRealServer, get, post, writeMeta } from "./w5-c-d1-public-run.test.js";
import { recordedQuizAnswers } from "./web/fixtures/recorded-quiz-answers.js";

const projectRoot = resolve(import.meta.dirname, "..");
const fixturesRoot = resolve(projectRoot, "fixtures/profiles");
const profileRoot = resolve(fixturesRoot, "pandas-cleaning-revision-3-draft");
const outputPath = process.env.W5_C_D3_PUBLIC_PACKAGE_OUTPUT;
const formalHashes: Readonly<Record<string, string>> = {
  "act-load-csv": "5e1b444472c136364809b926adc8b9ec0f7eaff29a2b6715605c062db2eebe7d",
  "act-inspect-dataframe": "737b0d6ae618f98b5c3e7bd5b67c2f5342559decd7436dbed57a046ef4c97be6",
  "act-missing": "1a42dfe66391ea56d11b7c8b525ac2da19146c3fc7d4401a3439e6b7b793125b",
  "act-duplicates": "dd88d60ef3320f7eba10fbba7cddc76ee96859e3f7fd7f7a9139fe9ed96d4886",
  "act-types": "cfa703b189cb49cfa2e56ce3b0790a0412e58c996c82aa93ca459596d71c1880",
  "act-practical": "7731912ed0f6ec7596cbfbf3b7d029a3d354503c4b28a6ddcf623493df9c74a9",
};
const solutionFiles: Readonly<Record<string, string>> = {
  "act-load-csv": "solution-read-csv.py",
  "act-inspect-dataframe": "solution-structure.py",
  "act-missing": "solution-missing.py",
  "act-duplicates": "solution-duplicates.py",
  "act-types": "solution-types.py",
  "act-practical": "solution-practical.py",
};

function findPython(): string {
  return execFileSync("where.exe", ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python";
}
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function variant(starter: string, passEdit: boolean): string {
  if (!passEdit) return starter;
  const marker = "# TODO_BEGIN\n";
  return starter.includes(marker) ? starter.replace(marker, `${marker}    clean_df = df.copy()\n`) : `${starter}\n# public-pass-edit\n`;
}
function safeResult(result: any) {
  return {
    executionStatus: result.executionStatus,
    verdict: result.verdict,
    ...(result.score === undefined ? {} : { score: result.score }),
    ...(result.errorKind === undefined ? {} : { errorKind: result.errorKind }),
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    evaluatorVersion: result.evaluatorVersion,
    environmentHash: result.environmentHash,
    assetBundleHash: result.assetBundleHash,
    ...(result.dimensionResults === undefined ? {} : { dimensionResults: result.dimensionResults }),
  };
}

describe("W5 D3 C real public execution package measurement", () => {
  it("consumes two public /run packages for each of the six code activities and measures each with Node three times", async () => {
    const activities = JSON.parse(await readFile(resolve(profileRoot, "activities/learning-activities.json"), "utf8")) as { activities: any[] };
    const environment = JSON.parse(await readFile(resolve(profileRoot, "environments/environment-lock.json"), "utf8"));
    const adapter = new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable: findPython() });
    const groups: any[] = [];
    const seen = new Set<string>();
    const dynamicAnswers = await recordedQuizAnswers();
    const server = await createRealServer(findPython());
    try {
      const initial = (await get(server.url, "/api/bootstrap")).body.data;
      const started = await post(server.url, "/api/sessions", { requestId: "r2-start", subjectId: "pandas-cleaning", mode: "chapter", goalId: initial.goals[0].goalId, chapterId: initial.chapters[0].chapterId, availableMinutes: 400 });
      expect(started.response.status).toBe(200);
      let state = started.body.data;
      const background = { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" };
      const draft = await post(server.url, `/api/sessions/${state.sessionId}/diagnostic/draft`, { ...writeMeta(state, "r2-draft"), diagnosticId: initial.diagnostic.diagnosticId, diagnosticVersion: initial.diagnostic.diagnosticVersion, diagnosticDraftVersion: 0, background });
      const completed = await post(server.url, `/api/sessions/${state.sessionId}/diagnostic/complete`, { ...writeMeta(draft.body.data, "r2-complete"), mode: "background_only", background, diagnosticDraftVersion: draft.body.data.diagnosticDraftVersion });
      const built = await post(server.url, `/api/sessions/${state.sessionId}/path`, { ...writeMeta(completed.body.data, "r2-path"), goalId: state.goalId, mode: "chapter", chapterId: state.chapterId, availableMinutes: 400, evidenceVersion: completed.body.data.evidenceVersion, selectedKnowledgePointIds: [], lockedNodeIds: [] });
      const confirmed = await post(server.url, `/api/sessions/${state.sessionId}/path/confirm`, { ...writeMeta(built.body.data, "r2-confirm"), pathId: built.body.data.pathId, pathVersion: built.body.data.pathVersion });
      state = confirmed.body.data;
      for (let step = 0; step < 48 && seen.size < 6; step += 1) {
        const next = await get(server.url, `/api/sessions/${state.sessionId}/next-step?sessionVersion=${state.sessionVersion}&profileRevision=${state.profileRevision}&pathVersion=${state.pathVersion}`);
        expect(next.response.status).toBe(200);
        if (next.body.data.completed) break;
        const activity = next.body.data.activity;
        const opened = await post(server.url, `/api/activities/${activity.activityId}/open`, { ...writeMeta(next.body.data, `r2-open-${step}`), sessionId: state.sessionId, activityVersion: activity.activityVersion, pathVersion: next.body.data.pathVersion, ...(next.body.data.card ? { acknowledgedCardId: next.body.data.card.cardId } : {}) });
        expect(opened.response.status).toBe(200);
        if (opened.body.data.kind !== "code") {
          const answers = opened.body.data.activity.questions.map((question: any) => ({
            questionId: question.questionId,
            answer: dynamicAnswers.get(question.questionId) ?? (question.kind === "judgment" ? false : question.options[0]),
          }));
          const quiz = await post(server.url, `/api/activities/${activity.activityId}/submit`, { ...writeMeta(opened.body.data, `r2-quiz-${step}`), kind: "quiz", activityId: activity.activityId, activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, answers });
          expect(quiz.response.status).toBe(200);
        } else {
          const activityInfo = activities.activities.find((item) => item.activityId === activity.activityId);
          expect(activityInfo?.starterCode).toBeTypeOf("string");
          let draftState = opened.body.data;
          for (const passEdit of [false, true]) {
            const code = variant(opened.body.data.userText, passEdit);
            const saved = await post(server.url, `/api/activities/${activity.activityId}/draft`, { ...writeMeta(draftState, `r2-save-${step}-${passEdit}`), activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, draftVersion: draftState.draftVersion, userText: code });
            expect(saved.response.status).toBe(200);
            const run = await post(server.url, `/api/activities/${activity.activityId}/run`, { ...writeMeta(saved.body.data, `r2-run-${step}-${passEdit}`), activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, draftVersion: saved.body.data.draftVersion, mode: "preview" });
            expect(run.response.status, JSON.stringify(run.body)).toBe(200);
            const prepared = run.body.data;
            validatePublicExecutionBundle({ runId: prepared.runId, sessionId: prepared.sessionId, activityId: prepared.activityId, profileRevision: prepared.profileRevision, environmentId: prepared.environmentId, starterCodeHash: prepared.starterCodeHash, publicDatasetFiles: prepared.publicDatasetFiles, publicTestSources: prepared.publicTestSources, expiresAt: prepared.expiresAt, bundleHash: prepared.bundleHash }, { sessionId: state.sessionId, activityId: activity.activityId, profileRevision: 3, environmentId: prepared.environmentId }, new Date());
            expect(prepared.bundleHash).toBe(hashPublicExecutionBundle(prepared));
            const preparedNode = await adapter.prepare({
              activity: { activityId: activity.activityId, kind: activityInfo.kind, profileRevision: 3, templateVersion: activityInfo.templateVersion, environmentRef: prepared.environmentId },
              profileRevision: 3,
              taskVersion: activityInfo.templateVersion,
              mode: "submit",
              environment: { environmentId: prepared.environmentId, status: "measured_node_submit", environmentHash: environment.environmentHash, prototypeEvidenceRef: environment.prototypeEvidenceRef },
              assetBundleHash: formalHashes[activity.activityId]!,
            });
            const runs = [];
            for (let repeat = 1; repeat <= 3; repeat += 1) {
              const startedAt = new Date().toISOString();
              const startedMs = performance.now();
              const result = await adapter.run({ requestId: `r2-node-${step}-${passEdit}-${repeat}`, attemptId: `r2-attempt-${step}-${passEdit}-${repeat}`, prepared: preparedNode, code }, new AbortController().signal);
              runs.push({ repeat, startedAt, endedAt: new Date().toISOString(), elapsed_ms: Math.round((performance.now() - startedMs) * 1000) / 1000, result: safeResult(result) });
            }
            const signatures = runs.map((item) => JSON.stringify(item.result));
            const baseGroup = { source: "HTTP POST /api/activities/:id/run", inputSha256: hash(code), publicPackageSha256: hash(JSON.stringify(prepared)), runId: prepared.runId, activityId: prepared.activityId, profileRevision: prepared.profileRevision, environmentId: prepared.environmentId, starterCodeHash: prepared.starterCodeHash, publicDatasetFiles: prepared.publicDatasetFiles, publicTestSources: prepared.publicTestSources, bundleHash: prepared.bundleHash, nodeRuns: runs, nodeFieldsIdentical: signatures.every((signature) => signature === signatures[0]), pyodide: { status: "NOT_RUN", errorCode: "PYODIDE_CANDIDATE_UNAVAILABLE", elapsed_ms: null }, sensitiveFieldMatch: /hidden|private|rubric|reference|answer|correct|api.key|[A-Za-z]:[\\/]/iu.test(JSON.stringify({ prepared, runs })) };
            groups.push({ ...baseGroup, inputId: `w5-d3-r2-${String(groups.length + 1).padStart(2, "0")}` });
            draftState = saved.body.data;
          }
          const solutionFile = solutionFiles[activity.activityId];
          expect(solutionFile).toBeTypeOf("string");
          const solution = await readFile(resolve(profileRoot, "reference-solutions", solutionFile!), "utf8");
          const solutionDraft = await post(server.url, `/api/activities/${activity.activityId}/draft`, { ...writeMeta(draftState, `r2-save-solution-${step}`), activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, draftVersion: draftState.draftVersion, userText: solution });
          expect(solutionDraft.response.status, JSON.stringify(solutionDraft.body)).toBe(200);
          const submitted = await post(server.url, `/api/activities/${activity.activityId}/submit`, { ...writeMeta(solutionDraft.body.data, `r2-submit-${step}`), kind: "code", activityId: activity.activityId, activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, userText: solution, draftVersion: solutionDraft.body.data.draftVersion });
          expect(submitted.response.status, JSON.stringify(submitted.body)).toBe(200);
          expect(submitted.body.data.result.verdict).toBe("pass");
          seen.add(activity.activityId);
        }
        const recovered = await get(server.url, `/api/bootstrap?recoverSessionId=${state.sessionId}`);
        expect(recovered.response.status).toBe(200);
        state = { ...recovered.body.data.session, pathVersion: recovered.body.data.session.path.pathVersion };
      }
    } finally {
      await server.runtime.close();
    }
    expect(groups.length).toBe(12);
    expect(new Set(groups.map((group) => group.activityId)).size).toBe(6);
    expect(groups.every((group) => group.nodeFieldsIdentical && !group.sensitiveFieldMatch && group.pyodide.status === "NOT_RUN")).toBe(true);
    if (outputPath !== undefined) {
      const resolvedOutput = resolve(outputPath);
      await mkdir(dirname(resolvedOutput), { recursive: true });
      await writeFile(resolvedOutput, `${JSON.stringify({ schemaVersion: 2, contract: "W5-C1/W5-R1", source: "real-composition-root-http-run", groups, summary: { inputGroups: groups.length, nodeRuns: groups.length * 3, activityCount: new Set(groups.map((group) => group.activityId)).size, pyodideNotRunGroups: groups.filter((group) => group.pyodide.status === "NOT_RUN").length, sensitiveMatches: groups.filter((group) => group.sensitiveFieldMatch).length } }, null, 2)}\n`, "utf8");
    }
  }, 420_000);
});
