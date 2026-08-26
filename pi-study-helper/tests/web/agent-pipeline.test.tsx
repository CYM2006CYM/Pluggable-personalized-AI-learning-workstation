// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStageRole, AgentStageStatus, SafeAgentRunView, SafeAgentStageView } from "../../src/contracts/agent-run.js";
import { AgentPipeline } from "../../src/web/components/AgentPipeline.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

function event(sequence: number, role: AgentStageRole, status: AgentStageStatus, summary: string): SafeAgentStageView {
  return {
    eventId: `evt-demo-${sequence}`,
    sequence,
    role,
    label: role,
    status,
    startedAt: `2026-08-25T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    ...(status === "running" || status === "queued" ? {} : { finishedAt: `2026-08-25T08:00:${String(sequence + 1).padStart(2, "0")}.000Z`, durationMs: 1_000 }),
    attemptNumber: 1,
    publicSummary: summary,
    metrics: [{ metricId: `metric-${sequence}`, label: "公开检查", value: "已记录", tone: "success" }],
    issueCategories: status === "rejected" ? ["答案歧义"] : [],
    ...(role === "judge" ? { decision: status === "rejected" ? "rejected" as const : "accepted" as const } : {}),
    sourceClaimIds: role === "source" ? ["claim-read-csv"] : [],
  };
}

function fixture(status: SafeAgentRunView["status"] = "running"): SafeAgentRunView {
  const stages = [
    event(1, "source", "succeeded", "已绑定逐步讲解版正文和公开来源。"),
    event(2, "profile", "succeeded", "已读取当前学情画像，本轮没有上一轮错题。"),
    event(3, "generator", status === "running" ? "running" : "succeeded", "正在依据正文生成4至6道全新单选题。"),
  ];
  if (status !== "running") stages.push(
    event(4, "safety", "succeeded", "结构、来源和重复检查全部通过。"),
    event(5, "hunter", "succeeded", "Hunter未发现需要辩护的实质争议。"),
    event(6, "defender", "skipped", "Hunter没有提出实质争议，Defender未触发。"),
    event(7, "judge", status === "failed" ? "rejected" : "succeeded", status === "failed" ? "候选题组未达到发布标准。" : "裁决通过，可以发布。"),
    event(8, "publish", status === "fallback" ? "fallback" : status === "failed" ? "failed" : "succeeded", status === "fallback" ? "实时链失败，已切换固定题保障。" : "已发布5道审核题。"),
  );
  return {
    runId: "agent-run-demo-001",
    requestId: "request-demo-001",
    sessionId: "session-demo-001",
    activityId: "act-load-csv",
    profileRevision: 3,
    pathVersion: 2,
    evidenceVersion: 4,
    status,
    currentStage: status === "running" ? "generator" : "publish",
    startedAt: "2026-08-25T08:00:00.000Z",
    ...(status === "running" ? {} : { finishedAt: "2026-08-25T08:00:12.000Z", durationMs: 12_000 }),
    resultOrigin: status === "fallback" ? "profile_fixed" : status === "succeeded" ? "ai_live" : "unknown",
    questionCount: status === "running" ? 0 : 5,
    ...(status === "fallback" ? { fallbackReasonCode: "judge_rejected" } : {}),
    ...(status !== "fallback" ? {} : { remediation: {
      lessonVariantId: "guided",
      previousAttemptId: "attempt-previous",
      missedQuestionCount: 2,
      weakKnowledgePointIds: ["kp-read-csv"],
      learnerProfileSource: "agent",
      publicRecommendation: "先复习读取参数和异常处理，再用新题组检查薄弱知识是否改善。",
      evidenceVersion: 4,
      evidenceRefCount: 3,
    } }),
    stages,
  };
}

async function render(run: SafeAgentRunView, onExport?: () => Promise<void> | void) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<AgentPipeline run={run} mode="prototype" onExport={onExport} />));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("AgentPipeline visual prototype", () => {
  it("shows eight stable stations and the active station details", async () => {
    const host = await render(fixture());
    expect(host.querySelectorAll(".agent-station")).toHaveLength(8);
    expect(host.textContent).toContain("Generator生成题组");
    expect(host.textContent).toContain("正在依据正文生成4至6道全新单选题");
    expect(host.textContent).toContain("视觉原型");
  });

  it("只依据服务端startedAt实时读秒，终态仍使用正式durationMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T08:00:05.000Z"));
    const host = await render(fixture());
    expect(host.textContent).toContain("5.0 秒");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(host.textContent).toContain("6.0 秒");
    await act(async () => root!.render(<AgentPipeline run={fixture("succeeded")} mode="snapshot" />));
    expect(host.textContent).toContain("12.0 秒");
  });

  it("stops displaying an unbounded timer for a stale running record", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T08:03:00.000Z"));
    const host = await render(fixture());
    expect(host.querySelector('[data-timeout="true"]')).not.toBeNull();
    expect(host.textContent).toContain("已超时，已停止等待");
    expect(host.textContent).toContain("超过120秒");
    expect(host.textContent).toContain("超时未完成");
    expect(host.textContent).not.toContain("180.0 秒");
  });

  it("shows skipped Defender and fixed fallback without claiming AI success", async () => {
    const host = await render(fixture("fallback"));
    expect(host.textContent).toContain("已启用固定保障");
    expect(host.textContent).toContain("固定题保障");
    const defender = [...host.querySelectorAll(".agent-station")].find((item) => item.textContent?.includes("辩护"));
    expect(defender?.textContent).toContain("未触发");
    expect(host.textContent).not.toContain("实时AI · 已发布");
    expect(host.textContent).toContain("正文 + 上轮错题 + 学情画像建议");
    expect(host.textContent).toContain("2 道");
    expect(host.textContent).toContain("kp-read-csv");
    expect(host.textContent).toContain("画像Agent · v4 · 3项");
  });

  it("完整显示服务端提供的学情建议，不在组件层截断", async () => {
    const recommendation = "学情建议".repeat(300);
    const host = await render({
      ...fixture("fallback"),
      remediation: { ...fixture("fallback").remediation!, publicRecommendation: recommendation },
    });
    expect(host.querySelector(".agent-remediation-heading p")?.textContent).toBe(recommendation);
  });

  it("uses personalized-tip wording instead of quiz wording on lesson runs", async () => {
    const run = { ...fixture("succeeded"), activityId: "node-pandas.clean.read-csv", questionCount: 0 };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<AgentPipeline run={run} mode="snapshot" resourceKind="tip" />));

    expect(host.textContent).toContain("八个工位共同准备本节个性化提醒");
    expect([...host.querySelectorAll("button")].some((button) => button.getAttribute("aria-label")?.startsWith("Generator生成个性化提醒"))).toBe(true);
    expect(host.textContent).toContain("发布提醒或保留正式正文");
    expect([...host.querySelectorAll("button")].some((button) => button.getAttribute("aria-label")?.startsWith("Generator生成题组"))).toBe(false);
  });

  it("allows selecting a completed station and collapsing the workbench", async () => {
    const host = await render(fixture("succeeded"));
    const source = [...host.querySelectorAll("button")].find((item) => item.getAttribute("aria-label")?.startsWith("教学依据准备"));
    await act(async () => source?.click());
    expect(host.textContent).toContain("已绑定逐步讲解版正文和公开来源");
    const collapse = [...host.querySelectorAll("button")].find((item) => item.textContent === "收起工作台");
    await act(async () => collapse?.click());
    expect(host.querySelector(".agent-workbench")).toBeNull();
  });

  it("reports export failure and allows a retry instead of failing silently", async () => {
    const exportRun = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const host = await render(fixture("succeeded"), exportRun);
    await act(async () => host.querySelector<HTMLButtonElement>(".agent-workbench-actions .secondary")?.click());
    expect(host.textContent).toContain("导出失败，重试");
    expect(host.textContent).toContain("安全协同记录未能导出");
    await act(async () => host.querySelector<HTMLButtonElement>(".agent-workbench-actions .secondary")?.click());
    expect(host.textContent).toContain("导出协同记录");
    expect(exportRun).toHaveBeenCalledTimes(2);
  });
});
