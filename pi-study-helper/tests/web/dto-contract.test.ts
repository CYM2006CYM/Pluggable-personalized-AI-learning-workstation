import { describe, expect, it } from "vitest";
import {
  activityDraftMock,
  activityRecoveryMock,
  activitySubmissionMock,
  completeSessionMock,
  diagnosticCompleteMock,
  diagnosticQuestionDisplayFixture,
  evaluatorFeedbackMock,
  FACADE_DTO_MOCKS,
  learningCardDisplayFixture,
  nextStepMock,
  PAGE_DISPLAY_FIXTURES,
  pathCandidateMock,
  preparedActivityMock,
  profileDisplayFixture,
  recoverSessionMock,
  sessionConflictMock,
  startSessionMock,
} from "../../src/web/mocks/safe-dtos.js";

function keys(value: object): string[] {
  return Object.keys(value).sort();
}

describe("W3 D2 safe DTO mocks", () => {
  it("uses the exact 21号 session and recovery fields", () => {
    expect(keys(startSessionMock)).toEqual([
      "availableMinutes", "diagnosticRequired", "goalId", "mode", "pathVersion", "profileRevision",
      "requestId", "sessionId", "sessionVersion", "stage", "status", "subjectId",
    ].sort());
    expect(keys(sessionConflictMock)).toEqual([
      "availableMinutes", "diagnosticRequired", "errorCode", "goalId", "mode", "pathVersion",
      "profileRevision", "sessionId", "sessionVersion", "stage", "status", "subjectId",
    ].sort());
    expect(keys(recoverSessionMock)).toEqual([
      "profileRevision", "recoveryAction", "requestId", "sessionId", "sessionVersion", "view",
    ].sort());
    expect(keys(recoverSessionMock.view)).toEqual([
      "availableMinutes", "diagnosticRequired", "goalId", "mode", "pathVersion", "profileRevision",
      "sessionId", "sessionVersion", "stage", "status", "subjectId",
    ].sort());
  });

  it("keeps diagnostic and KnowledgeState mocks on their frozen fields", () => {
    expect(keys(diagnosticQuestionDisplayFixture)).toEqual([
      "current", "diagnosticId", "diagnosticVersion", "kind", "knowledgePointTitle", "options",
      "prompt", "questionId", "skippable", "total",
    ].sort());
    expect(keys(diagnosticCompleteMock)).toEqual([
      "capabilityProfileRevision", "diagnosticId", "evidenceVersion", "insufficientKnowledgePointIds",
      "knowledgeStates", "profileRevision", "requestId", "sessionId", "sessionVersion", "diagnosticDraftVersion",
    ].sort());
    for (const state of diagnosticCompleteMock.knowledgeStates) {
      expect(keys(state)).toEqual([
        "aggregationVersion", "asOf", "confidence", "consideredEvidenceIds", "evidenceFormCount",
        "evidenceIds", "evidenceVersion", "knowledgePointId", "lastUpdatedAt", "mastery",
        "profileRevision", "skipEligible", "status", "validEvidenceCount",
      ].sort());
    }
  });

  it("keeps path and next-step mocks on their frozen fields", () => {
    expect(keys(pathCandidateMock)).toEqual([
      "minimumRequiredMinutes", "missingPrerequisiteIds", "nodes", "pathId", "pathVersion",
      "profileRevision", "requestId", "sessionId", "sessionVersion", "status",
    ].sort());
    for (const node of pathCandidateMock.nodes) {
      expect(keys(node)).toEqual([
        "activityIds", "difficulty", "estimatedMinutes", "knowledgePointId", "nodeId", "positionLocked",
        "reasonCodes", "required", "scaffold", "status",
      ].sort());
    }
    expect(keys(nextStepMock)).toEqual([
      "activity", "completed", "node", "pathVersion", "profileRevision", "sessionId", "sessionVersion",
    ].sort());
  });

  it("keeps activity lifecycle mocks on the 21号 public contract", () => {
    expect(keys(activityDraftMock)).toEqual([
      "activity", "attemptId", "draftVersion", "kind", "profileRevision", "requestId", "sessionId",
      "sessionVersion", "userText",
    ].sort());
    expect(keys(preparedActivityMock)).toEqual([
      "activityId", "bundleHash", "environmentId", "expiresAt", "mode", "profileRevision", "publicDatasetFiles",
      "publicTestSources", "requestId", "runId", "sessionId", "sessionVersion", "starterCodeHash",
    ].sort());
    expect(keys(activitySubmissionMock)).toEqual([
      "committed", "evidenceId", "evidenceVersion", "attemptId", "kind", "profileRevision", "requestId",
      "result", "sessionId", "sessionVersion",
    ].sort());
    expect(keys(activitySubmissionMock.result)).toEqual([
      "assetBundleHash", "dimensionResults", "durationMs", "environmentHash", "errorCode", "errorKind",
      "evaluatorVersion", "executionStatus", "safeFeedback", "score", "testPoints", "verdict",
    ].sort());
    expect(keys(evaluatorFeedbackMock.result)).toEqual([
      "assetBundleHash", "environmentHash", "errorCode", "errorKind", "evaluatorVersion",
      "executionStatus", "safeFeedback", "verdict",
    ].sort());
    expect(keys(activityRecoveryMock)).toEqual([
      "attempt", "draftVersion", "profileRevision", "recoveryAction", "sessionId", "sessionVersion", "userText",
    ].sort());
  });

  it("keeps page-only projections explicit and allowlisted", () => {
    expect(keys(profileDisplayFixture)).toEqual(["modalities", "name", "revision", "status", "subjectId"].sort());
    expect(keys(learningCardDisplayFixture)).toEqual([
      "artifactId", "commonMistake", "estimatedMinutes", "example", "explanation", "objective",
      "reason", "reviewStatus", "sourceAnchorIds", "title",
    ].sort());
    expect(keys(completeSessionMock)).toEqual([
      "completedAt", "nextRecommendation", "profileRevision", "requestId", "sessionId", "sessionVersion", "summary",
    ].sort());
  });

  it("exports public Facade DTO mocks and page fixtures as separate groups", () => {
    expect(Object.keys(FACADE_DTO_MOCKS).length).toBeGreaterThan(0);
    expect(Object.keys(PAGE_DISPLAY_FIXTURES)).toEqual(["diagnosticQuestion", "learningCard", "profile"].sort());
    for (const fixture of Object.values(PAGE_DISPLAY_FIXTURES)) {
      expect(Object.values(FACADE_DTO_MOCKS)).not.toContain(fixture);
    }
  });

  it("keeps ActivityResult score on the frozen 0..1 scale", () => {
    expect(activitySubmissionMock.result.score).toBe(0.78);
    expect(activitySubmissionMock.result.score).toBeLessThanOrEqual(1);
  });

  it.each([
    ["Facade DTO mocks", FACADE_DTO_MOCKS],
    ["page display fixtures", PAGE_DISPLAY_FIXTURES],
  ] as const)("contains no private or host-only material in %s", (_label, group) => {
    const serialized = JSON.stringify(group);
    for (const forbidden of [
      "correctAnswer", "hiddenTest", "referenceSolution", "rubricRef", "apiKey", "systemPrompt",
      "privateCsv", "C:\\", "/home/", "learnerSubmission", "private raw submission",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
