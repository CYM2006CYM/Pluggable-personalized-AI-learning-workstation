import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProfileDirectoryDiagnosticLoader,
  DiagnosticRuntime,
} from "../src/application/diagnostic-runtime.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { ProfileFamilyQuizActivityAssetResolver } from "../src/application/quiz-activity-runtime.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const profileRoot = resolve("fixtures/profiles/pandas-cleaning-revision-3-draft");
const roots: string[] = [];
const background = {
  python_experience: "basic",
  pandas_experience: "none",
  explanation_preference: "step_by_step",
} as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(mode: "recommended" | "chapter") {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "pandas-revision-3-diagnostic-"));
  roots.push(dataRoot);
  const repository = new FileLearningSessionRepository({ dataRoot });
  const view = await repository.create({
    requestId: `create-${mode}`,
    subjectId: "pandas-cleaning",
    mode,
    goalId: "goal-clean-orders",
    availableMinutes: 45,
    profileRevision: 3,
    diagnosticRequired: true,
  });
  const runtime = new DiagnosticRuntime({
    repository,
    dataRoot,
    loadAssets: createProfileDirectoryDiagnosticLoader(() => profileRoot),
  });
  return { repository, runtime, view };
}

describe("Pandas revision 3 diagnostic binding", () => {
  it.each(["recommended", "chapter"] as const)(
    "saves the background questionnaire with formal assets in %s mode",
    async (mode) => {
      const { runtime, view } = await setup(mode);
      const saved = await runtime.saveDiagnosticDraft({
        requestId: `background-${mode}`,
        sessionId: view.sessionId,
        sessionVersion: view.sessionVersion,
        profileRevision: 3,
        diagnosticId: "diagnostic-pandas-cleaning-v2-draft",
        diagnosticVersion: 1,
        diagnosticDraftVersion: 0,
        currentQuestionId: "diag-01",
        background,
      });

      expect(saved).toMatchObject({
        profileRevision: 3,
        diagnosticDraftVersion: 1,
        currentQuestionId: "diag-01",
      });
    },
  );

  it("completes chapter background_only without diagnostic Evidence", async () => {
    const { repository, runtime, view } = await setup("chapter");
    await runtime.saveDiagnosticDraft({
      requestId: "background-chapter",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 3,
      diagnosticId: "diagnostic-pandas-cleaning-v2-draft",
      diagnosticVersion: 1,
      diagnosticDraftVersion: 0,
      background,
    });

    const completed = await runtime.completeDiagnostic({
      requestId: "complete-chapter-background",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 3,
      mode: "background_only",
      background,
      diagnosticDraftVersion: 1,
    });

    expect(completed).toMatchObject({
      mode: "background_only",
      profileRevision: 3,
      evidenceVersion: 0,
      knowledgeStates: [],
    });
    expect((await repository.getSnapshot({
      sessionId: view.sessionId,
      sessionVersion: completed.sessionVersion,
      profileRevision: 3,
    })).evidence).toEqual([]);
  });

  it("loads the legal revision 3 legacy helper question without treating it as a W4 group", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "pandas-revision-3-legacy-quiz-"));
    roots.push(dataRoot);
    const profiles = new ProfileFamilyRepository({ dataRoot, fixturesRoot: resolve("fixtures/profiles") });
    await profiles.activateRevision3Draft("pandas-cleaning");
    const assets = await new ProfileFamilyQuizActivityAssetResolver(profiles)
      .loadAssets("pandas-cleaning", 3, "act-basic-python-remediation");

    expect(assets.legacySubtype).toBe("single_choice");
    expect(assets.legacyQuestion).toMatchObject({
      questionId: "fallback-basic-python-01",
      kind: "single_choice",
      correctAnswer: "df.shape",
      options: ["df.shape", "shape(df)", "df->shape", "df.shape()"],
    });
    expect(assets.fixedQuestions).toEqual([]);
    expect(assets.supplementalQuestions).toEqual([]);
  });
});
