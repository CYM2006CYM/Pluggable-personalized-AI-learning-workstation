import { describe, expect, expectTypeOf, it } from "vitest";
import type { Evidence } from "../src/domain/v2-types.js";
import type {
  CommitLearningSessionInput,
  CreateLearningSessionRecord,
  GetSessionSnapshotInput,
  LearningSessionRepository,
  RecoverLearningSessionInput,
  SessionCommitCandidate,
} from "../src/repositories/learning-session-repository.js";

describe("W1-C2 LearningSessionRepository port", () => {
  it("contains exactly create, getSnapshot, commit, and recover", () => {
    const methodNames = ["create", "getSnapshot", "commit", "recover"] as const satisfies readonly (keyof LearningSessionRepository)[];

    expect(methodNames).toEqual(["create", "getSnapshot", "commit", "recover"]);
    expectTypeOf<(typeof methodNames)[number]>().toEqualTypeOf<keyof LearningSessionRepository>();
  });

  it("allows only the commit input to carry an Evidence candidate", () => {
    expectTypeOf<SessionCommitCandidate["evidenceCandidate"]>().toEqualTypeOf<Evidence | undefined>();
    expectTypeOf<Extract<keyof CommitLearningSessionInput, "candidate">>().toEqualTypeOf<"candidate">();
    expectTypeOf<Extract<keyof CreateLearningSessionRecord, "candidate" | "evidenceCandidate">>()
      .toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof GetSessionSnapshotInput, "candidate" | "evidenceCandidate">>()
      .toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof RecoverLearningSessionInput, "candidate" | "evidenceCandidate">>()
      .toEqualTypeOf<never>();
  });

  it("keeps create free of client session versions", () => {
    expectTypeOf<Extract<keyof CreateLearningSessionRecord, "sessionId" | "sessionVersion">>()
      .toEqualTypeOf<never>();
    expectTypeOf<CreateLearningSessionRecord["mode"]>().toEqualTypeOf<"chapter" | "recommended">();
  });
});
