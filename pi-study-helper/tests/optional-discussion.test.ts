import type { Graph } from "pi-loop-graph-sdk";
import { describe, expect, it, vi } from "vitest";
import { executeOptionalDiscussion } from "../src/application/optional-discussion.js";
import { completedRun, failedRun } from "./graph-run-result.js";

const graph = { id: "study_discuss_question", version: "1" } as Graph;

const okResult = () => completedRun(graph, { reply: "提示", clarified_points: [], lingering_questions: [] });
const failure = (reason: string) => failedRun(graph, reason);

describe("executeOptionalDiscussion", () => {
  it("首次图失败时重试一次并返回成功结果", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(failure("未调用完成工具"))
      .mockResolvedValueOnce(okResult());

    const output = await executeOptionalDiscussion(execute, graph, { revealAnswer: false });

    expect(output).toEqual({
      status: "ok",
      result: { reply: "提示", clarified_points: [], lingering_questions: [] },
    });
    expect(execute).toHaveBeenNthCalledWith(1, graph, { revealAnswer: false, completionAttempt: 1 });
    expect(execute).toHaveBeenNthCalledWith(2, graph, { revealAnswer: false, completionAttempt: 2 });
  });

  it("两次失败后返回 unavailable，不向外抛出中断整场会话", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("provider error"))
      .mockResolvedValueOnce(failure("未调用完成工具"));

    await expect(executeOptionalDiscussion(execute, graph, {})).resolves.toEqual({
      status: "unavailable",
      reasons: ["provider error", "未调用完成工具"],
    });
  });
});
