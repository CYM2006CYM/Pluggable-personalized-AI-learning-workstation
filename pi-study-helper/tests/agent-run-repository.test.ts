import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AgentRunRepositoryError,
  FileAgentRunRepository,
  InMemoryAgentRunRepository,
  agentRunIdForRequest,
  type AgentRunRepository,
} from "../src/infrastructure/agent-run-repository.js";

const times = [
  "2026-08-25T09:00:00.000Z",
  "2026-08-25T09:00:01.000Z",
  "2026-08-25T09:00:02.000Z",
  "2026-08-25T09:00:03.000Z",
];

function createInput(requestId = "request-1", sessionId = "session-1") {
  return { requestId, sessionId, activityId: "activity-1", profileRevision: 3, pathVersion: 2, evidenceVersion: 1 };
}

async function sourceStage(repository: AgentRunRepository, runId: string): Promise<void> {
  await repository.append(runId, {
    role: "source", label: "教学依据准备", status: "running", startedAt: times[0]!, attemptNumber: 1,
    publicSummary: "正在绑定当前章节正式正文。",
  });
  await repository.append(runId, {
    role: "source", label: "教学依据准备", status: "succeeded", startedAt: times[0]!, finishedAt: times[1]!, durationMs: 1_000,
    attemptNumber: 1, publicSummary: "已绑定当前章节正式正文。", sourceClaimIds: ["claim-1"],
  });
}

describe("Agent运行持久仓库", () => {
  it("按requestId幂等创建并拒绝跨Session复用", async () => {
    const repository = new InMemoryAgentRunRepository(() => new Date(times[0]!));
    const first = await repository.create(createInput());
    expect(await repository.create(createInput())).toEqual(first);
    expect(first.runId).toBe(agentRunIdForRequest("request-1"));
    await expect(repository.create(createInput("request-1", "session-2")))
      .rejects.toEqual(expect.objectContaining<Partial<AgentRunRepositoryError>>({ code: "agent_run_conflict" }));
  });

  it("把重做依据绑定到requestId且不允许幂等重放时更换", async () => {
    const repository = new InMemoryAgentRunRepository(() => new Date(times[0]!));
    const remediation = {
      lessonVariantId: "practice" as const, previousAttemptId: "attempt-1", missedQuestionCount: 1,
      weakKnowledgePointIds: ["kp-csv"], learnerProfileSource: "deterministic" as const,
      publicRecommendation: "复习错题对应知识点后重新作答。", evidenceVersion: 2, evidenceRefCount: 1,
    };
    const created = await repository.create({ ...createInput(), remediation });
    expect(created.remediation).toEqual(remediation);
    await expect(repository.create({ ...createInput(), remediation: { ...remediation, missedQuestionCount: 2 } }))
      .rejects.toEqual(expect.objectContaining<Partial<AgentRunRepositoryError>>({ code: "agent_run_conflict" }));
  });

  it("并发追加在同一run内保持连续sequence，两个Session互不串线", async () => {
    const repository = new InMemoryAgentRunRepository(() => new Date(times[0]!));
    const [left, right] = await Promise.all([
      repository.create(createInput("request-left", "session-left")),
      repository.create(createInput("request-right", "session-right")),
    ]);
    await Promise.all([sourceStage(repository, left.runId), sourceStage(repository, right.runId)]);
    expect((await repository.getByRunId(left.runId))?.stages.map((event) => event.sequence)).toEqual([1, 2]);
    expect((await repository.getByRunId(right.runId))?.sessionId).toBe("session-right");
  });

  it("发布后形成不可改写终态并通知订阅者", async () => {
    const repository = new InMemoryAgentRunRepository(() => new Date(times[0]!));
    const run = await repository.create(createInput());
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(run.runId, listener);
    await sourceStage(repository, run.runId);
    for (const [index, role] of (["profile", "generator", "safety", "hunter", "defender", "judge", "publish"] as const).entries()) {
      await repository.append(run.runId, {
        role, label: role, status: role === "defender" ? "skipped" : "succeeded",
        startedAt: times[1]!, finishedAt: times[2]!, durationMs: 1_000, attemptNumber: 1,
        publicSummary: `${role}已形成公开安全结果。`,
      });
    }
    const completed = await repository.complete(run.runId, {
      status: "succeeded", finishedAt: times[3]!, resultOrigin: "ai_live", questionCount: 5,
      artifactSha256: "a".repeat(64),
    });
    expect(completed.status).toBe("succeeded");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    await expect(repository.append(run.runId, {
      role: "publish", label: "发布", status: "succeeded", startedAt: times[3]!, finishedAt: times[3]!, durationMs: 0,
      attemptNumber: 2, publicSummary: "不得追加。",
    })).rejects.toThrow("终态run不能继续追加事件");
  });

  it("文件仓库可在新实例中恢复同一安全快照", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runs-"));
    const first = new FileAgentRunRepository({ dataRoot: root, now: () => new Date(times[0]!) });
    const run = await first.create(createInput());
    await sourceStage(first, run.runId);
    const restored = await new FileAgentRunRepository({ dataRoot: root }).getByRequestId("request-1");
    expect(restored?.stages).toHaveLength(2);
    expect(restored?.sessionId).toBe("session-1");
    const disk = await readFile(join(root, "agent-runs", "runs", `${await import("node:crypto").then(({ createHash }) => createHash("sha256").update(run.runId).digest("hex"))}.json`), "utf8");
    expect(disk).not.toContain("correctAnswer");
    expect(disk).not.toContain("systemPrompt");
  });
});
