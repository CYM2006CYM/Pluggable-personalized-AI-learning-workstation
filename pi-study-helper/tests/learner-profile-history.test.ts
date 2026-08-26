import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LearnerProfileHistoryService } from "../src/application/learner-profile-history-service.js";
import {
  FileLearnerProfileHistoryRepository,
  InMemoryLearnerProfileHistoryRepository,
  LearnerProfileHistoryRepositoryError,
} from "../src/infrastructure/learner-profile-history-repository.js";
import type { SessionSnapshot } from "../src/repositories/learning-session-repository.js";

const now = "2026-08-25T10:00:00.000Z";

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: "session-history",
    sessionVersion: 7,
    profileRevision: 3,
    view: {
      sessionId: "session-history", sessionVersion: 7, profileRevision: 3, subjectId: "pandas-cleaning",
      mode: "recommended", goalId: "goal-main", availableMinutes: 90, status: "active", stage: "learning", diagnosticRequired: true,
    },
    evidence: [{
      evidenceId: "evidence-1", requestId: "submit-1", sessionId: "session-history", knowledgePointId: "kp-csv",
      profileRevision: 3, evidenceVersion: 1, kind: "mcq", source: "deterministic_quiz", form: "selected_response",
      impact: "mastery", outcome: "incorrect", score: 0, independence: "independent", activityId: "act-csv", attemptId: "attempt-1", createdAt: now,
    }],
    knowledgeStates: [{
      knowledgePointId: "kp-csv", profileRevision: 3, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1",
      mastery: 0, confidence: 1, status: "support_needed", validEvidenceCount: 1, evidenceFormCount: 1,
      evidenceIds: ["evidence-1"], consideredEvidenceIds: ["evidence-1"], asOf: now, skipEligible: false, lastUpdatedAt: now,
    }],
    latestCommit: { evidenceVersion: 1, sessionVersion: 7, requestId: "submit-1" },
    activityProgress: [{ nodeId: "node-csv", activities: [{
      activityId: "act-csv", status: "insufficient", attemptIds: ["attempt-1", "attempt-2"], result: "fail",
      quizRetryCount: 2, continuedWithGap: true, updatedAt: now,
    }] }],
    diagnosticDraftVersion: 2,
    ...overrides,
  };
}

describe("学情画像历史闭环", () => {
  it("保存Evidence版本和带缺口事实，未把失败活动写成掌握", async () => {
    const repository = new InMemoryLearnerProfileHistoryRepository();
    const sessions = { getBoundSnapshot: vi.fn(async () => snapshot()) };
    const agent = { summarize: vi.fn(async () => ({
      status: "accepted" as const, runId: "profile-run-1", explanation: "本轮仍需复习 CSV 读取知识。", evidenceRefs: ["evidence-1"],
    })) };
    const service = new LearnerProfileHistoryService({ sessions: sessions as never, repository, profileAgent: agent, now: () => new Date(now) });
    const entry = await service.capture({ sessionId: "session-history", trigger: "continued_with_gap" });
    expect(entry).toMatchObject({ sessionVersion: 7, evidenceVersion: 1, trigger: "continued_with_gap" });
    expect(entry.profile.agentStatus).toBe("agent_complete");
    expect(entry.profile.skippedActivityIds).toContain("act-csv");
    expect(entry.profile.supportNeeded).toContain("kp-csv");
    expect(entry.profile.strengths).not.toContain("kp-csv");
    expect(entry.profile.deterministicSummary).toContain("未将其记为掌握");
  });

  it("同一Session版本幂等，内容变化时拒绝改写", async () => {
    const repository = new InMemoryLearnerProfileHistoryRepository();
    const service = new LearnerProfileHistoryService({ sessions: { getBoundSnapshot: async () => snapshot() } as never, repository, now: () => new Date(now) });
    const first = await service.capture({ sessionId: "session-history", trigger: "quiz_submitted" });
    expect(await service.capture({ sessionId: "session-history", trigger: "quiz_submitted" })).toEqual(first);
    await expect(repository.append({
      sessionId: first.sessionId, sessionVersion: first.sessionVersion, profileRevision: first.profileRevision,
      evidenceVersion: first.evidenceVersion, trigger: first.trigger, capturedAt: first.capturedAt,
      profile: { ...first.profile, deterministicSummary: "被改写的摘要" },
    })).rejects.toEqual(expect.objectContaining<Partial<LearnerProfileHistoryRepositoryError>>({ code: "profile_history_conflict" }));
  });

  it("文件仓库重启后按Session版本顺序恢复历史", async () => {
    const root = await mkdtemp(join(tmpdir(), "profile-history-"));
    const firstRepository = new FileLearnerProfileHistoryRepository({ dataRoot: root });
    let current = snapshot();
    const service = new LearnerProfileHistoryService({ sessions: { getBoundSnapshot: async () => current } as never, repository: firstRepository, now: () => new Date(now) });
    await service.capture({ sessionId: "session-history", trigger: "quiz_submitted" });
    current = snapshot({ sessionVersion: 8, view: { ...snapshot().view, sessionVersion: 8 }, latestCommit: { evidenceVersion: 1, sessionVersion: 8, requestId: "continue-gap" } });
    await service.capture({ sessionId: "session-history", trigger: "continued_with_gap" });
    const restored = new FileLearnerProfileHistoryRepository({ dataRoot: root });
    expect((await restored.list("session-history")).map((entry) => entry.sessionVersion)).toEqual([7, 8]);
    expect((await restored.getLatest("session-history"))?.trigger).toBe("continued_with_gap");
  });
});
