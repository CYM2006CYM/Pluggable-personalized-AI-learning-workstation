import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  BuildPathInput,
  ActivityAttemptSafeView,
  ActivityDraftOutput,
  PathNodeSafeView,
  QuizActivityDraftOutput,
  QuizSubmitActivityInput,
  SubmitActivityInput,
  ReplanPathOutput,
  SessionRecoverySafeView,
  McqActivityAsset,
  QuizQuestionGroupAsset,
  QuizAnswerKeyAsset,
} from "../src/contracts/index.js";

describe("W4 public contract boundary", () => {
  it("keeps contracts as the only public W4 DTO definition source", async () => {
    const compatibility = await readFile(resolve(process.cwd(), "src/application/learning-runtime-facade.ts"), "utf8");
    const domain = await readFile(resolve(process.cwd(), "src/domain/v2-types.ts"), "utf8");
    expect(compatibility.trim()).toBe('/** W3 compatibility entrypoint. Public DTO definitions live in contracts. */\nexport * from "../contracts/facade.js";');
    expect(domain).not.toMatch(/interface (LearningCardSafeView|QuizQuestionGroupAsset|QuizAnswerKeyAsset)/u);
  });

  it("excludes derived candidates and private answer fields from public inputs and open output", () => {
    expectTypeOf<Extract<keyof BuildPathInput, "knowledgeStates" | "pathCandidate" | "activityProgress" | "evidenceCandidate">>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof QuizSubmitActivityInput, "correctAnswer" | "prompt" | "knowledgeStates" | "activityProgress">>().toEqualTypeOf<never>();
    const opened: QuizActivityDraftOutput = {
      kind: "quiz", requestId: "open", sessionId: "session", sessionVersion: 1, profileRevision: 3, attemptId: "attempt",
      activity: { activityId: "quiz", activityVersion: 1, kind: "mcq", title: "Quiz", prompt: "Answer", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], retryNumber: 0, questions: [{ questionId: "q", kind: "single_choice", prompt: "Q", options: ["A", "B"] }] },
    };
    expect(JSON.stringify(opened)).not.toMatch(/correctAnswer|explanation|privateAnswerRef/u);
  });

  it("exposes the W4 path, replan, and recovery fields", () => {
    expectTypeOf<Pick<PathNodeSafeView, "difficulty" | "scaffold" | "required" | "positionLocked">>().toBeObject();
    expectTypeOf<ReplanPathOutput["changeReasons"]>().toEqualTypeOf<string[]>();
    expectTypeOf<SessionRecoverySafeView["activityProgress"]>().toBeArray();
    expectTypeOf<SessionRecoverySafeView["diagnosticDraftVersion"]>().toBeNumber();
  });

  it("narrows every activity union by its required outer kind", () => {
    const narrowDraft = (draft: ActivityDraftOutput) => {
      switch (draft.kind) {
        case "code": return draft.draftVersion + draft.userText.length;
        case "quiz": return draft.activity.questions.length;
      }
    };
    const narrowAttempt = (attempt: ActivityAttemptSafeView) => {
      switch (attempt.kind) {
        case "code": return attempt.draftVersion;
        case "quiz": return attempt.result?.kind ?? "quiz";
      }
    };
    expectTypeOf<Parameters<typeof narrowDraft>[0]>().toEqualTypeOf<ActivityDraftOutput>();
    expectTypeOf<Parameters<typeof narrowAttempt>[0]>().toEqualTypeOf<ActivityAttemptSafeView>();
    expectTypeOf<{ activityId: string; activityVersion: number; attemptId: string; draftVersion: number; userText: string }>().not.toMatchTypeOf<SubmitActivityInput>();
    expectTypeOf<{ activityId: string; activityVersion: number; attemptId: string; answers: [] }>().not.toMatchTypeOf<SubmitActivityInput>();
    expectTypeOf<{ kind: "quiz"; activityId: string; attemptId: string; status: "submitted"; retryNumber: 0; result: import("../src/contracts/index.js").ActivityResult }>().not.toMatchTypeOf<ActivityAttemptSafeView>();
    expectTypeOf<{ nodeId: string; knowledgePointId: string; activityIds: string[]; status: "available"; estimatedMinutes: number; reasonCodes: string[] }>().not.toMatchTypeOf<PathNodeSafeView>();
  });

  it("exports the legacy/group asset union and private key as distinct structures", () => {
    expectTypeOf<McqActivityAsset["kind"]>().toEqualTypeOf<"mcq">();
    expectTypeOf<QuizQuestionGroupAsset["groups"][number]["questions"][number]>().not.toHaveProperty("correctAnswer");
    expectTypeOf<QuizAnswerKeyAsset["groups"][number]["answers"][number]["correctAnswer"]>().toEqualTypeOf<string | boolean>();
  });
});
