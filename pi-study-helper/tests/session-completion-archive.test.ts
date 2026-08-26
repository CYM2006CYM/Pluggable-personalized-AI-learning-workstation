import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileSessionCompletionArchiveRepository,
  InMemorySessionCompletionArchiveRepository,
  SessionCompletionArchiveError,
} from "../src/infrastructure/session-completion-archive-repository.js";

function input() {
  const completedAt = "2026-08-25T12:00:00.000Z";
  return {
    sessionId: "session-complete", sessionVersion: 9, profileRevision: 3, evidenceVersion: 6, createdAt: completedAt,
    output: { requestId: "complete-request", sessionId: "session-complete", sessionVersion: 9, profileRevision: 3, completedAt, summary: "本次学习仍有一个知识点需要支持。" },
    unresolvedFacts: ["kp-csv:support_needed"], agentRunIds: ["agent-run-1"],
  };
}

describe("完成会话安全归档", () => {
  it("幂等创建且拒绝改写冻结总结", async () => {
    const repository = new InMemorySessionCompletionArchiveRepository();
    const first = await repository.create(input());
    expect(first.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(await repository.create(input())).toEqual(first);
    await expect(repository.create({ ...input(), output: { ...input().output, summary: "被改写" } }))
      .rejects.toEqual(expect.objectContaining<Partial<SessionCompletionArchiveError>>({ code: "completion_archive_conflict" }));
  });

  it("拒绝密钥、答案和宿主绝对路径进入完成归档", async () => {
    const repository = new InMemorySessionCompletionArchiveRepository();
    for (const summary of ["api_key=sk-1234567890abcdef", "正确答案：B", "证据在C:/Users/test/private.json"]) {
      await expect(repository.create({ ...input(), output: { ...input().output, summary } }))
        .rejects.toEqual(expect.objectContaining<Partial<SessionCompletionArchiveError>>({ code: "completion_archive_invalid" }));
    }
  });

  it("文件仓库在新实例中复验SHA并恢复原始输出", async () => {
    const root = await mkdtemp(join(tmpdir(), "completion-archive-"));
    const first = new FileSessionCompletionArchiveRepository({ dataRoot: root });
    const created = await first.create(input());
    const restored = await new FileSessionCompletionArchiveRepository({ dataRoot: root }).get("session-complete");
    expect(restored).toEqual(created);
  });
});
