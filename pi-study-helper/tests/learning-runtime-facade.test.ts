import { describe, expect, expectTypeOf, it } from "vitest";
import type * as Facade from "../src/application/learning-runtime-facade.js";

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

type EmptyDtoNames<T extends Record<string, object>> = {
  [K in keyof T]: keyof T[K] extends never ? K : never;
}[keyof T];

type FacadeDtos = {
  StartSessionInput: Facade.StartSessionInput;
  StartSessionOutput: Facade.StartSessionOutput;
  RecoverSessionInput: Facade.RecoverSessionInput;
  RecoverSessionOutput: Facade.RecoverSessionOutput;
  CompleteSessionInput: Facade.CompleteSessionInput;
  CompleteSessionOutput: Facade.CompleteSessionOutput;
  SaveDiagnosticDraftInput: Facade.SaveDiagnosticDraftInput;
  DiagnosticDraftOutput: Facade.DiagnosticDraftOutput;
  SubmitDiagnosticAnswerInput: Facade.SubmitDiagnosticAnswerInput;
  DiagnosticAnswerOutput: Facade.DiagnosticAnswerOutput;
  CompleteDiagnosticInput: Facade.CompleteDiagnosticInput;
  DiagnosticCompleteOutput: Facade.DiagnosticCompleteOutput;
  BuildPathInput: Facade.BuildPathInput;
  PathCandidateOutput: Facade.PathCandidateOutput;
  ConfirmPathInput: Facade.ConfirmPathInput;
  ConfirmedPathOutput: Facade.ConfirmedPathOutput;
  GetNextStepInput: Facade.GetNextStepInput;
  NextStepOutput: Facade.NextStepOutput;
  ReplanPathInput: Facade.ReplanPathInput;
  ReplanPathOutput: Facade.ReplanPathOutput;
  OpenActivityInput: Facade.OpenActivityInput;
  ActivityDraftOutput: Facade.ActivityDraftOutput;
  SaveActivityDraftInput: Facade.SaveActivityDraftInput;
  PrepareActivityRunInput: Facade.PrepareActivityRunInput;
  PreparedActivityOutput: Facade.PreparedActivityOutput;
  SubmitActivityInput: Facade.SubmitActivityInput;
  ActivitySubmissionOutput: Facade.ActivitySubmissionOutput;
  GetActivityAttemptInput: Facade.GetActivityAttemptInput;
  ActivityAttemptSafeView: Facade.ActivityAttemptSafeView;
  RecoverActivityInput: Facade.RecoverActivityInput;
  ActivityRecoveryOutput: Facade.ActivityRecoveryOutput;
  ContextQuestionInput: Facade.ContextQuestionInput;
  ContextAnswerOutput: Facade.ContextAnswerOutput;
};

describe("W1-C2 LearningRuntimeFacade contract", () => {
  it("contains exactly the seventeen frozen short use cases", () => {
    const methodNames = [
      "startSession",
      "recoverSession",
      "completeSession",
      "saveDiagnosticDraft",
      "submitDiagnosticAnswer",
      "completeDiagnostic",
      "buildPath",
      "confirmPath",
      "getNextStep",
      "replanPath",
      "openActivity",
      "saveActivityDraft",
      "prepareActivityRun",
      "submitActivity",
      "getActivityAttempt",
      "recoverActivity",
      "askContextQuestion",
    ] as const satisfies readonly (keyof Facade.LearningRuntimeFacade)[];

    expect(methodNames).toHaveLength(17);
    expectTypeOf<(typeof methodNames)[number]>().toEqualTypeOf<keyof Facade.LearningRuntimeFacade>();
    expectTypeOf<Extract<keyof Facade.LearningRuntimeFacade, "submitDiagnostic" | "runActivity">>()
      .toEqualTypeOf<never>();
  });

  it("keeps creation, write, and read metadata separate", () => {
    expectTypeOf<keyof Facade.CreateRequestMeta>().toEqualTypeOf<"requestId">();
    expectTypeOf<keyof Facade.WriteRequestMeta>().toEqualTypeOf<
      "requestId" | "sessionId" | "sessionVersion" | "profileRevision"
    >();
    expectTypeOf<keyof Facade.ReadRequestMeta>().toEqualTypeOf<
      "sessionId" | "sessionVersion" | "profileRevision"
    >();
    expectTypeOf<Extract<keyof Facade.StartSessionInput, "sessionId" | "sessionVersion" | "profileRevision">>()
      .toEqualTypeOf<never>();
    expectTypeOf<OptionalKeys<Facade.StartSessionInput>>().toEqualTypeOf<"chapterId">();
  });

  it("keeps only chapter and recommended entry modes", () => {
    const modes = ["chapter", "recommended"] as const satisfies readonly Facade.LearningEntryMode[];

    expect(modes).toHaveLength(2);
    expectTypeOf<(typeof modes)[number]>().toEqualTypeOf<Facade.LearningEntryMode>();
    // @ts-expect-error W1-C2 leaves goal mode in future design only.
    const legacyMode: Facade.LearningEntryMode = "goal";
    expect(legacyMode).toBe("goal");
  });

  it("defines every input and output DTO with at least one field", () => {
    expectTypeOf<EmptyDtoNames<FacadeDtos>>().toEqualTypeOf<never>();
  });
});
