import { useEffect, useMemo, useState } from "react";
import {
  AGENT_STAGE_ROLES,
  type AgentStageRole,
  type AgentStageStatus,
  type SafeAgentRunView,
  type SafeAgentStageView,
} from "../../contracts/agent-run.js";

const ROLE_COPY: Record<AgentStageRole, { index: string; label: string; shortLabel: string }> = {
  source: { index: "01", label: "教学依据准备", shortLabel: "依据" },
  profile: { index: "02", label: "学情画像分析", shortLabel: "画像" },
  generator: { index: "03", label: "Generator生成题组", shortLabel: "生成" },
  safety: { index: "04", label: "确定性安全检查", shortLabel: "安检" },
  hunter: { index: "05", label: "Hunter反向找错", shortLabel: "找错" },
  defender: { index: "06", label: "Defender辩护", shortLabel: "辩护" },
  judge: { index: "07", label: "Judge最终裁决", shortLabel: "裁决" },
  publish: { index: "08", label: "发布题组或固定保障", shortLabel: "发布" },
};

const STALE_RUNNING_RUN_AFTER_MS = 120_000;

function roleCopy(role: AgentStageRole, resourceKind: PipelineResourceKind) {
  if (resourceKind === "tip" && role === "generator") return { ...ROLE_COPY[role], label: "Generator生成个性化提醒" };
  if (resourceKind === "tip" && role === "publish") return { ...ROLE_COPY[role], label: "发布提醒或保留正式正文" };
  return ROLE_COPY[role];
}

const STATUS_COPY: Record<AgentStageStatus, string> = {
  queued: "等待",
  running: "运行中",
  succeeded: "已完成",
  revised: "修订完成",
  rejected: "已拒绝",
  failed: "失败",
  fallback: "固定保障",
  skipped: "未触发",
};

function latestByRole(stages: readonly SafeAgentStageView[]): Map<AgentStageRole, SafeAgentStageView> {
  const result = new Map<AgentStageRole, SafeAgentStageView>();
  for (const stage of stages) result.set(stage.role, stage);
  return result;
}

function latestStage(run: SafeAgentRunView, role: AgentStageRole): SafeAgentStageView | undefined {
  for (let index = run.stages.length - 1; index >= 0; index -= 1) {
    const stage = run.stages[index];
    if (stage?.role === role) return stage;
  }
  return undefined;
}

function durationLabel(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "--";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} 秒`;
}

function liveDuration(startedAt: string, durationMs: number | undefined, running: boolean, now: number): number | undefined {
  if (durationMs !== undefined) return durationMs;
  return running ? Math.max(0, now - Date.parse(startedAt)) : undefined;
}

function originLabel(origin: SafeAgentRunView["resultOrigin"], resourceKind: PipelineResourceKind): string {
  if (origin === "ai_live") return "实时AI";
  if (origin === "ai_recorded") return "AI录制响应";
  if (origin === "profile_fixed") return resourceKind === "tip" ? "正式正文保障" : "固定题保障";
  return "处理中";
}

function runStatusLabel(run: SafeAgentRunView, resourceKind: PipelineResourceKind, stale: boolean): string {
  if (stale) return "已超时，已停止等待";
  if (run.status === "running") return "运行中";
  if (run.status === "succeeded") return "已发布";
  if (run.status === "fallback") return resourceKind === "tip" ? "已保留正式正文" : "已启用固定保障";
  if (run.status === "failed") return "已停止";
  return "等待开始";
}

function stageTone(status: AgentStageStatus): string {
  if (status === "running" || status === "succeeded") return "success";
  if (status === "revised" || status === "skipped" || status === "fallback") return "warning";
  if (status === "failed" || status === "rejected") return "danger";
  return "neutral";
}

export interface AgentPipelineProps {
  run: SafeAgentRunView;
  mode?: "live" | "snapshot" | "prototype";
  resourceKind?: PipelineResourceKind;
  initiallyExpanded?: boolean;
  onExport?: () => Promise<void> | void;
}

export type PipelineResourceKind = "quiz" | "tip";

export interface AgentPipelineSummary {
  state: "discovering" | "running" | "succeeded" | "fallback" | "failed" | "timeout";
  /** 收纳态状态条的一行式文字。 */
  text: string;
}

/**
 * 流水线被收纳成一条状态带时,用它给状态条供数。
 * 刻意不输出逐秒计时——展开后的工作台自带秒级计时,
 * 状态条只表达「到哪一步了」,不与工作台抢戏。
 */
export function agentPipelineSummary(
  run: SafeAgentRunView | undefined,
  resourceKind: PipelineResourceKind,
  discoveringText: string | undefined,
): AgentPipelineSummary {
  if (run === undefined) {
    return {
      state: "discovering",
      text: discoveringText === undefined || discoveringText === "" ? "正在登记运行" : discoveringText,
    };
  }
  const stale = run.status === "running" && Number.isFinite(Date.parse(run.startedAt))
    && Date.now() - Date.parse(run.startedAt) >= STALE_RUNNING_RUN_AFTER_MS;
  if (stale) return { state: "timeout", text: "已超时，已停止等待" };
  if (run.status === "running") {
    return { state: "running", text: `运行中 · 当前工位：${roleCopy(run.currentStage, resourceKind).label}` };
  }
  if (run.status === "succeeded") {
    return { state: "succeeded", text: `已完成发布 · ${originLabel(run.resultOrigin, resourceKind)}` };
  }
  if (run.status === "fallback") {
    return { state: "fallback", text: originLabel(run.resultOrigin, resourceKind) };
  }
  return { state: "failed", text: "已停止 · 展开可查看各工位记录" };
}

export function AgentPipelineDiscovery({ statusText, resourceKind = "quiz" }: { statusText: string; resourceKind?: PipelineResourceKind }) {
  return <section className="agent-pipeline agent-pipeline-discovering" aria-labelledby="agent-pipeline-discovering" data-mode="discovery">
    <header className="agent-pipeline-header">
      <div>
        <p className="section-kicker">AI学习资源流水线</p>
        <h2 id="agent-pipeline-discovering">{resourceKind === "tip" ? "八个工位共同准备本节个性化提醒" : "八个工位共同准备本轮题组"}</h2>
      </div>
      <div className="agent-pipeline-run-state" role="status" aria-live="polite">
        <strong>正在登记运行</strong>
        <span>{statusText}</span>
      </div>
    </header>
    <ol className="agent-pipeline-track" aria-label="等待服务端登记的多智能体执行工位">
      {AGENT_STAGE_ROLES.map((role) => {
        const copy = roleCopy(role, resourceKind);
        return <li className="agent-station is-queued" key={role}>
          <button type="button" disabled aria-label={`${copy.label}，等待真实运行记录`}>
            <span className="agent-station-index">{copy.index}</span>
            <span className="agent-station-marker" aria-hidden="true" />
            <span className="agent-station-copy"><strong>{copy.shortLabel}</strong><small>等待记录</small></span>
            <span className="agent-station-duration">--</span>
          </button>
        </li>;
      })}
    </ol>
    <div className="agent-pipeline-discovery-note">
      <strong>正在等待服务端登记真实运行</strong>
      <p>运行记录创建后，本区域会按“依据、画像、生成、安检、找错、辩护、裁决、发布”的实际事件逐步更新。</p>
    </div>
  </section>;
}

export function AgentPipeline({ run, mode = "snapshot", resourceKind = "quiz", initiallyExpanded = true, onExport }: AgentPipelineProps) {
  const latest = useMemo(() => latestByRole(run.stages), [run.stages]);
  const [selectedRole, setSelectedRole] = useState<AgentStageRole>();
  const [expanded, setExpanded] = useState(initiallyExpanded || run.status === "running");
  const [now, setNow] = useState(() => Date.now());
  const [exportState, setExportState] = useState<"idle" | "exporting" | "failed">("idle");
  const activeRole = selectedRole ?? run.currentStage;
  const active = latestStage(run, activeRole);
  const orderedEvents = useMemo(() => [...run.stages].sort((left, right) => left.sequence - right.sequence), [run.stages]);
  const stale = run.status === "running" && Number.isFinite(Date.parse(run.startedAt))
    && now - Date.parse(run.startedAt) >= STALE_RUNNING_RUN_AFTER_MS;
  useEffect(() => {
    if (stale || (run.status !== "running" && active?.status !== "running")) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active?.status, run.status, stale]);
  const runDuration = stale ? STALE_RUNNING_RUN_AFTER_MS : liveDuration(run.startedAt, run.durationMs, run.status === "running", now);
  const exportRun = async (): Promise<void> => {
    if (onExport === undefined || exportState === "exporting") return;
    setExportState("exporting");
    try { await onExport(); setExportState("idle"); }
    catch { setExportState("failed"); }
  };

  return <section className={`agent-pipeline agent-pipeline-${run.status}${stale ? " agent-pipeline-timeout" : ""}`} aria-labelledby={`agent-pipeline-${run.runId}`} data-mode={mode} data-timeout={stale ? "true" : "false"}>
    <header className="agent-pipeline-header">
      <div>
        <p className="section-kicker">AI学习资源流水线</p>
        <h2 id={`agent-pipeline-${run.runId}`}>{resourceKind === "tip" ? "八个工位共同准备本节个性化提醒" : "八个工位共同准备本轮题组"}</h2>
      </div>
      <div className="agent-pipeline-run-state" role="status" aria-live="polite">
        <strong>{runStatusLabel(run, resourceKind, stale)}</strong>
        <span>{stale ? `超过${STALE_RUNNING_RUN_AFTER_MS / 1_000}秒 · 已停止等待` : `${durationLabel(runDuration)} · ${originLabel(run.resultOrigin, resourceKind)}`}</span>
      </div>
    </header>

    {mode === "prototype" ? <p className="agent-pipeline-prototype">视觉原型：当前仅使用脱敏安全事件验证布局，不代表已经连接真实Agent。</p> : null}

    {run.remediation === undefined ? null : <section className="agent-remediation-basis" aria-labelledby={`agent-remediation-${run.runId}`}>
      <div className="agent-remediation-heading">
        <div>
          <span>本轮重做依据</span>
          <h3 id={`agent-remediation-${run.runId}`}>正文 + 上轮错题 + 学情画像建议</h3>
        </div>
        <p>{run.remediation.publicRecommendation}</p>
      </div>
      <dl>
        <div><dt>当前正文</dt><dd>{run.remediation.lessonVariantId}</dd></div>
        <div><dt>上轮错题</dt><dd>{run.remediation.missedQuestionCount} 道</dd></div>
        <div><dt>薄弱知识</dt><dd>{run.remediation.weakKnowledgePointIds.join("、") || "待继续观察"}</dd></div>
        <div><dt>画像依据</dt><dd>{run.remediation.learnerProfileSource === "agent" ? "画像Agent" : "确定性Evidence"} · v{run.remediation.evidenceVersion} · {run.remediation.evidenceRefCount}项</dd></div>
      </dl>
    </section>}

    <ol className="agent-pipeline-track" aria-label="多智能体执行工位">
      {AGENT_STAGE_ROLES.map((role) => {
        const event = latest.get(role);
        const status = stale && (event === undefined || event.status === "queued" || event.status === "running") ? "failed" : event?.status ?? "queued";
        const copy = roleCopy(role, resourceKind);
        return <li className={`agent-station is-${status} ${activeRole === role ? "is-selected" : ""}`} key={role}>
          <button type="button" onClick={() => { setSelectedRole(role); setExpanded(true); }} aria-label={`${copy.label}，${stale && (event === undefined || event.status === "queued" || event.status === "running") ? "超时未完成" : STATUS_COPY[status]}`}>
            <span className="agent-station-index">{copy.index}</span>
            <span className="agent-station-marker" aria-hidden="true" />
            <span className="agent-station-copy"><strong>{copy.shortLabel}</strong><small>{stale && (event === undefined || event.status === "queued" || event.status === "running") ? "超时未完成" : STATUS_COPY[status]}</small></span>
            <span className="agent-station-duration">{event === undefined ? "--" : stale && (event.status === "queued" || event.status === "running") ? `超过${STALE_RUNNING_RUN_AFTER_MS / 1_000}秒` : durationLabel(liveDuration(event.startedAt, event.durationMs, event.status === "running", now))}</span>
          </button>
        </li>;
      })}
    </ol>

    <div className="agent-workbench-heading">
      <div><span>当前工作台</span><strong>{roleCopy(activeRole, resourceKind).label}</strong></div>
      <div className="agent-workbench-actions">
        {onExport === undefined ? null : <button type="button" className="button secondary compact" disabled={exportState === "exporting"} onClick={() => void exportRun()}>{exportState === "exporting" ? "正在导出..." : exportState === "failed" ? "导出失败，重试" : "导出协同记录"}</button>}
        <button type="button" className="button text-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起工作台" : "查看工作台"}</button>
      </div>
    </div>

    {expanded ? <div className="agent-workbench">
          {active === undefined ? <div className="agent-workbench-empty"><strong>{stale ? "该工位未在时限内完成" : "等待进入该工位"}</strong><p>{stale ? "本轮Agent运行已超过允许等待时间；页面停止继续计时，活动应使用固定保障或刷新后恢复。" : "前序工位完成后，这里会显示可公开的任务、依据和结果。"}</p></div> : <>
        <div className="agent-workbench-summary">
          <span className={`agent-status-label tone-${stageTone(active.status)}`}>{stale && (active.status === "queued" || active.status === "running") ? "超时未完成" : STATUS_COPY[active.status]}</span>
          <p>{active.publicSummary}</p>
          <dl>
            <div><dt>开始时间</dt><dd>{new Date(active.startedAt).toLocaleTimeString("zh-CN", { hour12: false })}</dd></div>
            <div><dt>处理耗时</dt><dd>{stale && (active.status === "queued" || active.status === "running") ? `超过${STALE_RUNNING_RUN_AFTER_MS / 1_000}秒` : durationLabel(liveDuration(active.startedAt, active.durationMs, active.status === "running", now))}</dd></div>
            <div><dt>执行轮次</dt><dd>第 {active.attemptNumber} 轮</dd></div>
            <div><dt>事件序号</dt><dd>#{active.sequence}</dd></div>
          </dl>
        </div>
        <div className="agent-workbench-metrics" aria-label="当前工位公开指标">
          {active.metrics.length === 0 ? <p>本工位没有额外公开指标。</p> : active.metrics.map((metric) => <div className={`agent-metric tone-${metric.tone}`} key={metric.metricId}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
        </div>
        <details className="agent-audit-details">
          <summary>查看安全审计详情</summary>
          <div className="agent-audit-grid">
            <div><span>问题类别</span><p>{active.issueCategories.length === 0 ? "未发现公开问题" : active.issueCategories.join("、")}</p></div>
            <div><span>裁决</span><p>{active.decision === undefined ? "本工位不产生裁决" : active.decision === "accepted" ? "通过" : active.decision === "revise" ? "需要修订" : "拒绝"}</p></div>
            <div><span>公开来源</span><p>{active.sourceClaimIds.length === 0 ? "本工位不新增来源" : active.sourceClaimIds.join("、")}</p></div>
            <div><span>事件标识</span><p className="agent-mono">{active.eventId}</p></div>
          </div>
        </details>
      </>}
    </div> : null}
    {exportState === "failed" ? <p className="agent-export-error" role="status">安全协同记录未能导出，请检查本地服务后重试。</p> : null}

    <details className="agent-event-log">
      <summary>查看完整安全时间线（{orderedEvents.length}条）</summary>
      <ol>{orderedEvents.map((event) => {
        const copy = roleCopy(event.role, resourceKind);
        return <li key={event.eventId}>
          <time>{new Date(event.startedAt).toLocaleTimeString("zh-CN", { hour12: false })}</time>
          <strong>{copy.shortLabel}</strong>
          <span>{STATUS_COPY[event.status]}</span>
          <p>{event.publicSummary}</p>
        </li>;
      })}</ol>
    </details>
  </section>;
}
