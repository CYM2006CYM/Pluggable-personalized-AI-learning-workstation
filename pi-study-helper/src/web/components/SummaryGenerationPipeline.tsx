import { useEffect, useMemo, useState } from "react";
import type { AgentStageRole, AgentStageStatus, SafeAgentRunView, SafeAgentStageView } from "../../contracts/index.js";

const SUMMARY_STAGES = [
  { role: "source", index: "01", label: "汇总证据", waiting: "等待读取正式学习记录" },
  { role: "profile", index: "02", label: "建立画像", waiting: "等待计算掌握与薄弱项" },
  { role: "generator", index: "03", label: "画像 Agent", waiting: "等待组织学习成果与建议" },
  { role: "safety", index: "04", label: "核验结论", waiting: "等待核对事实与证据引用" },
  { role: "publish", index: "05", label: "保存总结", waiting: "等待冻结可恢复的总结" },
] as const satisfies ReadonlyArray<{ role: AgentStageRole; index: string; label: string; waiting: string }>;

type SummaryStageRole = typeof SUMMARY_STAGES[number]["role"];

const STATUS_LABEL: Record<AgentStageStatus, string> = {
  queued: "等待",
  running: "处理中",
  succeeded: "已完成",
  revised: "已修订",
  rejected: "未采用",
  failed: "失败",
  fallback: "已回退",
  skipped: "未触发",
};

function latestSummaryStages(stages: readonly SafeAgentStageView[]): Map<SummaryStageRole, SafeAgentStageView> {
  const latest = new Map<SummaryStageRole, SafeAgentStageView>();
  const roles = new Set<AgentStageRole>(SUMMARY_STAGES.map((stage) => stage.role));
  for (const stage of stages) {
    if (roles.has(stage.role)) latest.set(stage.role as SummaryStageRole, stage);
  }
  return latest;
}

function stageState(event: SafeAgentStageView | undefined): "queued" | "running" | "complete" | "fallback" | "failed" {
  if (event === undefined) return "queued";
  if (event.status === "running") return "running";
  if (event.status === "fallback" || event.status === "skipped" || event.status === "revised") return "fallback";
  if (event.status === "failed" || event.status === "rejected") return "failed";
  return event.status === "succeeded" ? "complete" : "queued";
}

function elapsedLabel(startedAt: string | undefined, durationMs: number | undefined, now: number): string {
  if (durationMs !== undefined) return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} 秒`;
  if (startedAt === undefined) return "--";
  return `${Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1_000))} 秒`;
}

export interface SummaryGenerationPipelineProps {
  run?: SafeAgentRunView;
  elapsedText: string;
  transport: "idle" | "discovering" | "sse" | "polling" | "complete";
}

export function SummaryGenerationPipeline({ run, elapsedText, transport }: SummaryGenerationPipelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const latest = useMemo(() => latestSummaryStages(run?.stages ?? []), [run?.stages]);
  const currentRole = run?.currentStage as SummaryStageRole | undefined;
  const activeEvent = currentRole === undefined ? undefined : latest.get(currentRole);
  const fallback = run?.status === "fallback" || [...latest.values()].some((event) => event.status === "fallback");

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const headline = run === undefined
    ? "正在建立总结运行记录"
    : activeEvent?.publicSummary ?? "正在同步服务端总结进度";
  const transportLabel = transport === "sse" ? "实时事件已连接" : transport === "polling" ? "正在轮询服务端" : transport === "complete" ? "运行记录已完成" : "正在连接服务端";

  return <section className="summary-generation" aria-labelledby="summary-generation-title" data-transport={transport}>
    <header className="summary-generation-header">
      <div>
        <p className="section-kicker">学情画像 Agent 工作台</p>
        <h2 id="summary-generation-title">正在生成本次学习总结</h2>
        <p>{headline}</p>
      </div>
      <div className="summary-generation-clock" role="status" aria-live="polite" aria-atomic="true">
        <span className="summary-generation-pulse" aria-hidden="true" />
        <strong>{elapsedText}</strong>
        <small>{transportLabel}</small>
      </div>
    </header>

    <ol className="summary-generation-track" aria-label="学习总结生成阶段">
      {SUMMARY_STAGES.map((stage) => {
        const event = latest.get(stage.role);
        const state = stageState(event);
        return <li className={`summary-generation-stage is-${state}`} key={stage.role} aria-current={state === "running" ? "step" : undefined}>
          <div className="summary-generation-node">
            <span>{stage.index}</span>
            <i aria-hidden="true" />
          </div>
          <div className="summary-generation-copy">
            <strong>{stage.label}</strong>
            <span>{event === undefined ? stage.waiting : event.publicSummary}</span>
            <small>{event === undefined ? "等待" : `${STATUS_LABEL[event.status]} · ${elapsedLabel(event.startedAt, event.durationMs, now)}`}</small>
          </div>
        </li>;
      })}
    </ol>

    <p className={`summary-generation-note${fallback ? " is-fallback" : ""}`}>
      {fallback
        ? "画像 Agent 没有返回可核验结果。系统正在使用正式学习证据生成确定性事实总结，学习记录不会丢失。"
        : "页面会持续接收服务端的真实阶段事件。画像 Agent 只能解释已确认事实，不能改写成绩、掌握状态或正式证据。"}
    </p>
  </section>;
}
