import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileFamilyQuizActivityAssetResolver } from "../../src/application/quiz-activity-runtime.js";
import { createDemoRuntime } from "../../src/demo/composition-root.js";
import { startHttpServer, type HttpServerHandle } from "../../src/demo/http-server.js";
import { ProfileFamilyRepository } from "../../src/repositories/profile-family-repository.js";

const fixturesRoot = resolve(import.meta.dirname, "../../fixtures/profiles");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function server() {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "w4-e-real-api-"));
  const handle: HttpServerHandle = startHttpServer(createDemoRuntime({ dataRoot, fixturesRoot }), 0);
  await handle.ready;
  const address = handle.server.address() as AddressInfo;
  cleanups.push(async () => { await handle.close(); await rm(dataRoot, { recursive: true, force: true }); });
  return `http://127.0.0.1:${address.port}`;
}

async function get(url: string, path: string) {
  const response = await fetch(`${url}${path}`);
  return { response, body: await response.json() as any };
}

async function post(url: string, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { response, body: await response.json() as any };
}

function writeMeta(data: any, requestId: string) {
  return { requestId, sessionVersion: data.sessionVersion, profileRevision: data.profileRevision };
}

describe("W4 E independent real API trajectories", () => {
  it("runs chapter mode and restores diagnostic draft, quiz Attempt and submitted progress", async () => {
    const url = await server();
    const initial = await get(url, "/api/bootstrap");
    expect(initial.response.status).toBe(200);
    const started = await post(url, "/api/sessions", { requestId: "e-chapter-start", subjectId: "pandas-cleaning", mode: "chapter", goalId: initial.body.data.goals[0].goalId, chapterId: initial.body.data.chapters[0].chapterId, availableMinutes: 400 });
    const sessionId = started.body.data.sessionId;
    const background = { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" };
    const draft = await post(url, `/api/sessions/${sessionId}/diagnostic/draft`, { ...writeMeta(started.body.data, "e-chapter-draft"), diagnosticId: initial.body.data.diagnostic.diagnosticId, diagnosticVersion: initial.body.data.diagnostic.diagnosticVersion, diagnosticDraftVersion: 0, background });
    const draftRefresh = await get(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(draftRefresh.body.data.session.diagnosticDraft).toMatchObject({ background, diagnosticDraftVersion: draft.body.data.diagnosticDraftVersion });
    const completed = await post(url, `/api/sessions/${sessionId}/diagnostic/complete`, { ...writeMeta(draft.body.data, "e-chapter-complete"), mode: "background_only", background, diagnosticDraftVersion: draft.body.data.diagnosticDraftVersion });
    const built = await post(url, `/api/sessions/${sessionId}/path`, { ...writeMeta(completed.body.data, "e-chapter-path"), goalId: started.body.data.goalId, mode: "chapter", chapterId: started.body.data.chapterId, availableMinutes: 400, evidenceVersion: completed.body.data.evidenceVersion, selectedKnowledgePointIds: [], lockedNodeIds: [] });
    expect(built.body.data.status).toBe("candidate");
    const confirmed = await post(url, `/api/sessions/${sessionId}/path/confirm`, { ...writeMeta(built.body.data, "e-chapter-confirm"), pathId: built.body.data.pathId, pathVersion: built.body.data.pathVersion });
    const next = await get(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${confirmed.body.data.sessionVersion}&profileRevision=${confirmed.body.data.profileRevision}&pathVersion=${confirmed.body.data.pathVersion}`);
    const opened = await post(url, `/api/activities/${next.body.data.activity.activityId}/open`, { ...writeMeta(next.body.data, "e-chapter-open"), sessionId, activityVersion: next.body.data.activity.activityVersion, pathVersion: next.body.data.pathVersion, ...(next.body.data.card === undefined ? {} : { acknowledgedCardId: next.body.data.card.cardId }) });
    expect(opened.response.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body.data.kind).toBe("quiz");
    expect(opened.body.data.activity.questions.length).toBeGreaterThan(0);
    expect(JSON.stringify(opened.body.data)).not.toMatch(/correctAnswer|answerKey|explanation/iu);
    const attemptRefresh = await get(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(attemptRefresh.body.data.session.currentAttempt).toMatchObject({ kind: "quiz", attemptId: opened.body.data.attemptId, status: "draft" });
    const reopenedNext = await get(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${attemptRefresh.body.data.session.sessionVersion}&profileRevision=${attemptRefresh.body.data.session.profileRevision}&pathVersion=${attemptRefresh.body.data.session.path.pathVersion}`);
    const reopened = await post(url, `/api/activities/${opened.body.data.activity.activityId}/open`, {
      ...writeMeta(reopenedNext.body.data, "e-chapter-reopen"), sessionId,
      activityVersion: reopenedNext.body.data.activity.activityVersion,
      pathVersion: reopenedNext.body.data.pathVersion,
    });
    expect(reopened.response.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body.data.attemptId).toBe(opened.body.data.attemptId);
    expect(reopened.body.data.activity.questions.map((question: any) => question.questionId))
      .toEqual(opened.body.data.activity.questions.map((question: any) => question.questionId));
    const answers = opened.body.data.activity.questions.map((question: any) => ({ questionId: question.questionId, answer: question.kind === "judgment" ? false : question.options[0] }));
    const submitted = await post(url, `/api/activities/${opened.body.data.activity.activityId}/submit`, { ...writeMeta(opened.body.data, "e-chapter-submit"), sessionId, kind: "quiz", activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, answers });
    expect(submitted.response.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.data.result.totalCount).toBe(answers.length);
    expect(submitted.body.data.result.requiredCorrectCount).toBe(Math.ceil(answers.length * 0.75));
    expect(submitted.body.data.result.answerReview).toHaveLength(answers.length);
    const submittedRefresh = await get(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(submittedRefresh.body.data.session.activityProgress.flatMap((node: any) => node.activities).some((activity: any) => activity.attemptIds.includes(opened.body.data.attemptId))).toBe(true);
    const continuation = await get(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${submittedRefresh.body.data.session.sessionVersion}&profileRevision=${submittedRefresh.body.data.session.profileRevision}&pathVersion=${submittedRefresh.body.data.session.path.pathVersion}`);
    expect(continuation.response.status, JSON.stringify(continuation.body)).toBe(200);
    if (!continuation.body.data.completed) {
      const continued = await post(url, `/api/activities/${continuation.body.data.activity.activityId}/open`, {
        ...writeMeta(continuation.body.data, "e-chapter-continue-open"), sessionId,
        activityVersion: continuation.body.data.activity.activityVersion,
        pathVersion: continuation.body.data.pathVersion,
        ...(continuation.body.data.card === undefined ? {} : { acknowledgedCardId: continuation.body.data.card.cardId }),
      });
      expect(continued.response.status, JSON.stringify(continued.body)).toBe(200);
      if (continuation.body.data.activity.activityId === opened.body.data.activity.activityId) {
        expect(continued.body.data.attemptId).not.toBe(opened.body.data.attemptId);
        expect(continued.body.data.activity.retryNumber).toBe(1);
      } else {
        expect(continuation.body.data.activity.activityId).not.toBe(opened.body.data.activity.activityId);
      }
    }
  }, 60_000);

  it("runs the recommended questionnaire, fixed diagnostic and deterministic path", async () => {
    const url = await server();
    const initial = (await get(url, "/api/bootstrap")).body.data;
    const started = await post(url, "/api/sessions", { requestId: "e-recommended-start", subjectId: "pandas-cleaning", mode: "recommended", goalId: initial.goals[0].goalId, availableMinutes: 400 });
    const sessionId = started.body.data.sessionId;
    const background = { python_experience: "comfortable", pandas_experience: "basic", explanation_preference: "example_first" };
    const draft = await post(url, `/api/sessions/${sessionId}/diagnostic/draft`, { ...writeMeta(started.body.data, "e-recommended-draft"), diagnosticId: initial.diagnostic.diagnosticId, diagnosticVersion: initial.diagnostic.diagnosticVersion, currentQuestionId: initial.diagnostic.questions[0].questionId, diagnosticDraftVersion: 0, background });
    const draftRefresh = await get(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(draftRefresh.body.data.session.diagnosticDraft).toMatchObject({ background, diagnosticDraftVersion: draft.body.data.diagnosticDraftVersion });
    let meta = draft.body.data;
    for (const question of initial.diagnostic.questions) {
      const answered = await post(url, `/api/sessions/${sessionId}/diagnostic/answers`, { ...writeMeta(meta, `e-answer-${question.questionId}`), diagnosticId: initial.diagnostic.diagnosticId, diagnosticVersion: initial.diagnostic.diagnosticVersion, questionId: question.questionId, action: "answer", answer: question.kind === "judgment" ? false : question.options[0], diagnosticDraftVersion: meta.diagnosticDraftVersion });
      expect(answered.response.status).toBe(200); meta = answered.body.data;
    }
    const completed = await post(url, `/api/sessions/${sessionId}/diagnostic/complete`, { ...writeMeta(meta, "e-recommended-complete"), mode: "fixed", diagnosticId: initial.diagnostic.diagnosticId, diagnosticVersion: initial.diagnostic.diagnosticVersion, diagnosticDraftVersion: meta.diagnosticDraftVersion });
    expect(completed.body.data.knowledgeStates.length).toBeGreaterThan(0);
    const built = await post(url, `/api/sessions/${sessionId}/path`, { ...writeMeta(completed.body.data, "e-recommended-path"), goalId: started.body.data.goalId, mode: "recommended", availableMinutes: 400, evidenceVersion: completed.body.data.evidenceVersion, selectedKnowledgePointIds: [], lockedNodeIds: [] });
    expect(built.body.data.nodes.length).toBeGreaterThanOrEqual(6);
    expect(built.body.data.nodes.every((node: any) => ["difficulty", "scaffold", "required", "positionLocked"].every((key) => key in node))).toBe(true);
    const confirmed = await post(url, `/api/sessions/${sessionId}/path/confirm`, { ...writeMeta(built.body.data, "e-recommended-confirm"), pathId: built.body.data.pathId, pathVersion: built.body.data.pathVersion });
    const next = await get(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${confirmed.body.data.sessionVersion}&profileRevision=${confirmed.body.data.profileRevision}&pathVersion=${confirmed.body.data.pathVersion}`);
    expect(next.response.status, JSON.stringify(next.body)).toBe(200);
    const opened = await post(url, `/api/activities/${next.body.data.activity.activityId}/open`, {
      ...writeMeta(next.body.data, "e-recommended-open"), sessionId,
      activityVersion: next.body.data.activity.activityVersion,
      pathVersion: next.body.data.pathVersion,
      ...(next.body.data.card === undefined ? {} : { acknowledgedCardId: next.body.data.card.cardId }),
    });
    expect(opened.response.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body.data.kind).toBe("quiz");
    const questionIds = opened.body.data.activity.questions.map((question: any) => question.questionId);
    const attemptRefresh = await get(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(attemptRefresh.body.data.session.currentAttempt).toMatchObject({ attemptId: opened.body.data.attemptId, status: "draft" });
    const reopenedNext = await get(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${attemptRefresh.body.data.session.sessionVersion}&profileRevision=${attemptRefresh.body.data.session.profileRevision}&pathVersion=${attemptRefresh.body.data.session.path.pathVersion}`);
    const reopened = await post(url, `/api/activities/${opened.body.data.activity.activityId}/open`, {
      ...writeMeta(reopenedNext.body.data, "e-recommended-reopen"), sessionId,
      activityVersion: reopenedNext.body.data.activity.activityVersion,
      pathVersion: reopenedNext.body.data.pathVersion,
    });
    expect(reopened.body.data.attemptId).toBe(opened.body.data.attemptId);
    expect(reopened.body.data.activity.questions.map((question: any) => question.questionId)).toEqual(questionIds);
    const answers = opened.body.data.activity.questions.map((question: any) => ({ questionId: question.questionId, answer: question.kind === "judgment" ? false : question.options[0] }));
    const submitted = await post(url, `/api/activities/${opened.body.data.activity.activityId}/submit`, {
      ...writeMeta(opened.body.data, "e-recommended-submit"), sessionId, kind: "quiz",
      activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, answers,
    });
    expect(submitted.response.status, JSON.stringify(submitted.body)).toBe(200);
    const submittedRefresh = await get(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
    expect(submittedRefresh.body.data.session.activityProgress.flatMap((node: any) => node.activities).some((activity: any) => activity.attemptIds.includes(opened.body.data.attemptId))).toBe(true);
    const continuation = await get(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${submittedRefresh.body.data.session.sessionVersion}&profileRevision=${submittedRefresh.body.data.session.profileRevision}&pathVersion=${submittedRefresh.body.data.session.path.pathVersion}`);
    expect(continuation.response.status, JSON.stringify(continuation.body)).toBe(200);
    expect(continuation.body.data.completed || continuation.body.data.activity !== undefined).toBe(true);
  }, 60_000);

  it("opens a revision 3 code activity after completing the preceding quiz activity", async () => {
    const url = await server();
    const initial = (await get(url, "/api/bootstrap")).body.data;
    const started = await post(url, "/api/sessions", {
      requestId: "e-code-chain-start", subjectId: "pandas-cleaning", mode: "chapter",
      goalId: initial.goals[0].goalId, chapterId: initial.chapters[0].chapterId, availableMinutes: 400,
    });
    const sessionId = started.body.data.sessionId;
    const background = { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" };
    const draft = await post(url, `/api/sessions/${sessionId}/diagnostic/draft`, {
      ...writeMeta(started.body.data, "e-code-chain-draft"), diagnosticId: initial.diagnostic.diagnosticId,
      diagnosticVersion: initial.diagnostic.diagnosticVersion, diagnosticDraftVersion: 0, background,
    });
    const completed = await post(url, `/api/sessions/${sessionId}/diagnostic/complete`, {
      ...writeMeta(draft.body.data, "e-code-chain-complete"), mode: "background_only", background,
      diagnosticDraftVersion: draft.body.data.diagnosticDraftVersion,
    });
    const built = await post(url, `/api/sessions/${sessionId}/path`, {
      ...writeMeta(completed.body.data, "e-code-chain-path"), goalId: started.body.data.goalId, mode: "chapter",
      chapterId: started.body.data.chapterId, availableMinutes: 400, evidenceVersion: completed.body.data.evidenceVersion,
      selectedKnowledgePointIds: [], lockedNodeIds: [],
    });
    const confirmed = await post(url, `/api/sessions/${sessionId}/path/confirm`, {
      ...writeMeta(built.body.data, "e-code-chain-confirm"), pathId: built.body.data.pathId, pathVersion: built.body.data.pathVersion,
    });

    const resolverRoot = await mkdtemp(resolve(tmpdir(), "w4-e-code-chain-profile-"));
    cleanups.push(async () => { await rm(resolverRoot, { recursive: true, force: true }); });
    const profiles = new ProfileFamilyRepository({ dataRoot: resolverRoot, fixturesRoot });
    await profiles.activateRevision3Draft("pandas-cleaning");
    const quizAssets = new ProfileFamilyQuizActivityAssetResolver(profiles);
    let state = confirmed.body.data;
    for (let step = 0; step < 8; step += 1) {
      const next = await get(url, `/api/sessions/${sessionId}/next-step?sessionVersion=${state.sessionVersion}&profileRevision=${state.profileRevision}&pathVersion=${state.pathVersion}`);
      expect(next.response.status, JSON.stringify(next.body)).toBe(200);
      expect(next.body.data.completed).toBe(false);
      const activity = next.body.data.activity;
      expect(activity).toBeDefined();
      const opened = await post(url, `/api/activities/${activity.activityId}/open`, {
        ...writeMeta(next.body.data, `e-code-chain-open-${step}`), sessionId,
        activityVersion: activity.activityVersion, pathVersion: next.body.data.pathVersion,
        ...(next.body.data.card === undefined ? {} : { acknowledgedCardId: next.body.data.card.cardId }),
      });
      expect(opened.response.status, JSON.stringify(opened.body)).toBe(200);
      if (opened.body.data.kind === "code") {
        expect(opened.body.data.activity.activityVersion).toBe(3);
        expect(opened.body.data.activity.kind).toBe("code_completion");
        expect(opened.body.data.activity.starterCode).toContain("TODO_BEGIN");
        return;
      }
      const questions = opened.body.data.activity.questions;
      const assets = await quizAssets.loadAssets("pandas-cleaning", 3, activity.activityId);
      const privateQuestions = [...assets.fixedQuestions, ...assets.supplementalQuestions,
        ...(assets.legacyQuestion === undefined ? [] : [assets.legacyQuestion])];
      const answersById = new Map(privateQuestions.map((question) => [question.questionId, question.correctAnswer]));
      const answers = questions.map((question: any) => {
        const answer = answersById.get(question.questionId);
        if (answer === undefined) throw new Error(`Missing deterministic answer for ${question.questionId}`);
        return { questionId: question.questionId, answer };
      });
      const submitted = await post(url, `/api/activities/${activity.activityId}/submit`, {
        ...writeMeta(opened.body.data, `e-code-chain-submit-${step}`), sessionId, kind: "quiz",
        activityVersion: opened.body.data.activity.activityVersion, attemptId: opened.body.data.attemptId, answers,
      });
      expect(submitted.response.status, JSON.stringify(submitted.body)).toBe(200);
      expect(submitted.body.data.result.verdict).toBe("pass");
      const refreshed = await get(url, `/api/bootstrap?recoverSessionId=${sessionId}`);
      state = { ...refreshed.body.data.session, pathVersion: refreshed.body.data.session.path.pathVersion };
    }
    throw new Error("Revision 3 code activity was not reached within the bounded trajectory");
  }, 60_000);
});

describe("W4 E six-point public asset audit", () => {
  it("binds six public cards to six independent four-question fixed groups", async () => {
    const root = resolve(fixturesRoot, "pandas-cleaning-revision-3-draft");
    const coverage = JSON.parse(await readFile(resolve(root, "quality/w4-b-coverage-matrix.json"), "utf8"));
    const cards = JSON.parse(await readFile(resolve(root, "cards/learning-cards.json"), "utf8"));
    const groups = JSON.parse(await readFile(resolve(root, "assessments/question-groups.json"), "utf8"));
    expect(coverage.coreKnowledgePoints).toHaveLength(6);
    const observedQuestionIds = new Set<string>();
    for (const point of coverage.coreKnowledgePoints) {
      expect(cards.cards.some((card: any) => card.cardId === point.cardId && card.knowledgePointId === point.knowledgePointId)).toBe(true);
      const group = groups.groups.find((item: any) => item.groupId === point.fixedQuestionGroupId);
      expect(group?.questions).toHaveLength(4);
      for (const question of group.questions) {
        expect(observedQuestionIds.has(question.questionId)).toBe(false);
        observedQuestionIds.add(question.questionId);
        expect(JSON.stringify(question)).not.toMatch(/correctAnswer|explanation|answerKey/iu);
      }
    }
    expect(observedQuestionIds.size).toBe(24);
  });
});
