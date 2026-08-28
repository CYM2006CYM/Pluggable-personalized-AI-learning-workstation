import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ConfirmedPathOutput, KnowledgeState, PathCandidateOutput, ReplanPathOutput } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { difficultyLabel, knowledgePointLabel, knowledgeStatusLabel } from "../learning-labels.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";

interface PathLocationState {
  candidate?: PathCandidateOutput;
  evidenceVersion?: number;
  knowledgeStates?: KnowledgeState[];
  capabilityProfileRevision?: number;
}

type PendingPathAction = "confirm" | "replan" | "enter";

const STATUS_LABELS = { locked: "等待先修", available: "可以开始", in_progress: "正在学习", completed: "已完成", skipped: "已跳过" } as const;
const SCAFFOLD_LABELS = { none: "独立完成", hint: "提示辅助", worked_example: "示例带练" } as const;
const REASON_LABELS: Record<string, string> = {
  prerequisite_required: "本节是后续学习的必要基础",
  prerequisite_gap: "需要先补齐前置知识",
  low_mastery: "诊断显示当前掌握不足",
  goal_required: "属于本次学习目标",
  review_due: "需要复习巩固",
  user_selected: "由你指定学习",
  error_remediation: "根据错误安排重做",
  time_compressed: "已压缩为必要活动",
  evidence_insufficient: "现有证据不足以安全跳过",
  diagnostic_skip_selected: "你选择依据两类诊断证据跳过本节教学",
};

function arrangementText(node: PathCandidateOutput["nodes"][number], states: readonly KnowledgeState[]): string {
  if (node.status === "skipped" && node.reasonCodes.includes("diagnostic_skip_selected")) return "你已选择跳过本节教学和普通练习；系统保留这项诊断事实。";
  if (node.reasonCodes.includes("diagnostic_skip_selected")) return "你已选择跳过本节教学；本节点只保留不可跳过的最终综合实操。";
  if (node.status === "skipped") return "多种正式学习证据已满足自动跳过条件，本节不重复安排。";
  const state = states.find((item) => item.knowledgePointId === node.knowledgePointId);
  if (state?.status === "ready" || state?.status === "mastered") {
    return "当前掌握度较高，但还没有满足安全跳过条件；系统保留必要验证，并减少脚手架。";
  }
  return node.reasonCodes.map((code) => REASON_LABELS[code] ?? code).join("；") || "按知识先修顺序安排。";
}

function diagnosticPathNotice(states: readonly KnowledgeState[], nodes: readonly PathCandidateOutput["nodes"][number][]): string {
  if (states.length === 0) return "本次没有形成诊断知识状态，系统按未验证处理。";
  const supportNeeded = states.filter((state) => state.status === "support_needed" || state.status === "learning" || state.status === "unverified").length;
  const ready = states.filter((state) => state.status === "ready").length;
  const mastered = states.filter((state) => state.status === "mastered").length;
  // A diagnostic skip can retain the mandatory final practical activity. Such
  // a node is intentionally not `status: skipped`, but its teaching content
  // is still skipped and must be counted in the learner-facing summary.
  const skipped = nodes.filter((node) => node.reasonCodes.includes("diagnostic_skip_selected")).length;
  const optional = states.filter((state) => state.diagnosticSkipEligible === true).length;
  return `本次诊断形成 ${states.length} 个知识状态：${supportNeeded} 个需要支持，${ready} 个已有基础，${mastered} 个已充分掌握；${optional} 个模块通过两类客观诊断证据，可由你决定是否跳过；当前路径已选择跳过 ${skipped} 个章节教学。`;
}

function statusLabel(node: PathCandidateOutput["nodes"][number]): string {
  if (node.reasonCodes.includes("diagnostic_skip_selected")) {
    return node.status === "skipped" ? "已跳过" : "已跳过教学（保留实操）";
  }
  return STATUS_LABELS[node.status];
}

/**
 * The path engine may mark several independent nodes as available after a
 * diagnostic skip. The learner-facing path is still walked in order, so only
 * the first unfinished node may advertise "可以开始".
 */
function projectSequentialPathNodes<T extends PathCandidateOutput["nodes"][number]>(nodes: readonly T[]): T[] {
  let startableClaimed = false;
  let blockedByPrerequisite = false;
  return nodes.map((node) => {
    if (node.status === "skipped" || node.status === "completed") return node;
    if (node.status === "in_progress") {
      blockedByPrerequisite = true;
      return node;
    }
    if (node.status === "locked") {
      blockedByPrerequisite = true;
      return node;
    }
    if (node.status === "available" && !startableClaimed && !blockedByPrerequisite) {
      startableClaimed = true;
      return node;
    }
    return { ...node, status: "locked" as const };
  });
}

export function PathPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = useBootstrap(sessionId);
  const routeState = (location.state as PathLocationState | null) ?? {};
  const [confirmed, setConfirmed] = useState<ConfirmedPathOutput>();
  const [replanned, setReplanned] = useState<ReplanPathOutput>();
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingPathAction>();
  const [actionError, setActionError] = useState<Error>();
  const actionProgress = useAsyncActionProgress();
  const session = bootstrap.data?.session;
  const candidate = routeState.candidate;
  const serverPath = session?.path;
  const serverPathIsAuthoritative = serverPath !== undefined
    && (serverPath.status === "active" || serverPath.status === "confirmed" || serverPath.status === "completed");
  const confirmedPath = confirmed === undefined ? undefined : {
    pathId: confirmed.pathId,
    pathVersion: confirmed.pathVersion,
    status: confirmed.status,
    nodes: serverPath?.nodes ?? candidate?.nodes ?? [],
  };
  const candidatePath = candidate?.pathId === undefined ? undefined : {
    pathId: candidate.pathId,
    pathVersion: candidate.pathVersion!,
    status: candidate.status,
    nodes: candidate.nodes,
  };
  const path = replanned !== undefined
    ? { pathId: replanned.pathId, pathVersion: replanned.pathVersion, status: "active" as const, nodes: replanned.nodes }
    : confirmedPath ?? (serverPathIsAuthoritative ? serverPath : candidatePath ?? serverPath);
  const displayNodes = path === undefined ? [] : projectSequentialPathNodes(path.nodes);
  const active = path?.status === "active" || path?.status === "confirmed" || path?.status === "completed";
  const evidenceVersion = routeState.evidenceVersion ?? session?.evidenceVersion;
  const knowledgeStates = routeState.knowledgeStates ?? session?.knowledgeStates ?? [];
  const canReplan = active && evidenceVersion !== undefined;
  const systemEstimatedMinutes = path?.nodes.filter((node) => node.status !== "skipped").reduce((total, node) => total + node.estimatedMinutes, 0) ?? 0;
  const titleByNode = new Map((session?.learningCards ?? []).map((binding) => [binding.nodeId, binding.card.title]));

  const confirm = async () => {
    if (session === undefined || path === undefined || path.status === "infeasible") return;
    setBusy(true); setPendingAction("confirm"); setActionError(undefined);
    actionProgress.start("正在确认学习路径");
    try {
      setConfirmed(await api.confirmPath({
        requestId: newRequestId("web-confirm-path"), sessionId,
        sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision,
        pathId: path.pathId, pathVersion: path.pathVersion,
      }));
    } catch (error) { setActionError(error instanceof Error ? error : new Error("path_confirm_failed")); }
    finally { actionProgress.stop(); setPendingAction(undefined); setBusy(false); }
  };

  const replan = async () => {
    if (session === undefined || path === undefined || evidenceVersion === undefined) return;
    const meta = confirmed ?? replanned ?? session.view;
    setBusy(true); setPendingAction("replan"); setActionError(undefined);
    actionProgress.start("正在按最新诊断重算路径");
    try {
      const output = await api.replanPath({
        requestId: newRequestId("web-replan-path"), sessionId,
        sessionVersion: meta.sessionVersion, profileRevision: meta.profileRevision,
        pathVersion: path.pathVersion, evidenceVersion,
        trigger: "user_constraint_changed", availableMinutes: session.view.availableMinutes,
        selectedKnowledgePointIds: [], lockedNodeIds: path.nodes.filter((node) => node.positionLocked).map((node) => node.nodeId),
        diagnosticSkipKnowledgePointIds: path.nodes.filter((node) => node.reasonCodes.includes("diagnostic_skip_selected")).map((node) => node.knowledgePointId),
      });
      setReplanned(output);
    } catch (error) { setActionError(error instanceof Error ? error : new Error("path_replan_failed")); }
    finally { actionProgress.stop(); setPendingAction(undefined); setBusy(false); }
  };

  const enterLearning = async () => {
    if (session === undefined || path === undefined) return;
    const meta = replanned ?? confirmed ?? session.view;
    setBusy(true); setPendingAction("enter"); setActionError(undefined);
    actionProgress.start("正在准备学习内容");
    try {
      const next = await api.getNextStep({ sessionId, sessionVersion: meta.sessionVersion, profileRevision: meta.profileRevision, pathVersion: path.pathVersion });
      if (next.completed || next.node === undefined) navigate(`/summary/${sessionId}`);
      else navigate(`/learn/${sessionId}/${next.node.nodeId}`, { state: { next } });
    } catch (error) { setActionError(error instanceof Error ? error : new Error("next_step_failed")); }
    finally { actionProgress.stop(); setPendingAction(undefined); setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  return <PageFrame eyebrow="路径确认" title="查看并确认学习路径" summary="系统根据诊断证据、先修关系和必做评测计算章节、辅助方式与预计时长。" back={{ to: sessionId === "" ? "/" : `/diagnostic/${sessionId}`, label: "返回诊断" }} actions={<span className="header-badge">系统预计 {systemEstimatedMinutes} 分钟</span>}>
    {bootstrap.loading ? <PageStatePanel page="path" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="path" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); setConfirmed(undefined); setReplanned(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && (session === undefined || path === undefined) ? <PageStatePanel page="path" state="empty" detail="当前安全快照没有可展示的路径。" /> : null}
    {!bootstrap.loading && error === undefined && session !== undefined && path !== undefined ? (
      <div className="path-layout" data-page="path">
        <section className="work-section path-section">
          <div className="section-heading">
            <div><p className="section-kicker">路径版本 {path.pathVersion}</p><h2>系统推荐学习路径</h2></div>
            <span className="status-tag success">{active ? "已确认" : "待确认"}</span>
          </div>
          <p className="notice-line diagnostic-path-notice">{diagnosticPathNotice(knowledgeStates, path.nodes)}</p>
          <ol className="path-list">
            {displayNodes.map((node, index) => (
              <li className={`path-node ${node.status}`} key={node.nodeId} style={{ minHeight: STABLE_LAYOUT.pathNodeMinHeight }}>
                <span className="path-sequence">{String(index + 1).padStart(2, "0")}</span>
                <div className="path-node-main">
                  <strong>{titleByNode.get(node.nodeId) ?? knowledgePointLabel(node.knowledgePointId)}</strong>
                  <span>{arrangementText(node, knowledgeStates)}</span>
                  <small>{difficultyLabel(node.difficulty)} · {SCAFFOLD_LABELS[node.scaffold]} · {node.required ? "本次目标要求" : "可选巩固"}</small>
                </div>
                <div className="path-node-meta"><span>{node.estimatedMinutes}分钟</span><strong>{statusLabel(node)}</strong></div>
              </li>
            ))}
          </ol>
          {replanned === undefined ? null : (
            <section className="replan-result" aria-live="polite">
              <h2>重算结果</h2>
              <dl className="metric-list horizontal">
                <div><dt>路径变化</dt><dd>{replanned.changed ? "是" : "否"}</dd></div>
                <div><dt>沿用旧路径</dt><dd>{replanned.fallbackToPrevious ? "是" : "否"}</dd></div>
              </dl>
              <ul>{replanned.changeReasons.length === 0 ? <li>学习安排没有变化</li> : replanned.changeReasons.map((reason) => <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>)}</ul>
            </section>
          )}
          {actionProgress.active ? <p className="async-action-status" role="status" aria-live="polite">{actionProgress.text}</p> : null}
          <div className="section-footer">
            <span className="quiet-label">{candidate?.status === "infeasible" ? "当前路径不可行" : `${path.nodes.length} 个章节 · 预计 ${systemEstimatedMinutes} 分钟`}</span>
            <div className="button-row">
              {active ? (
                <>
                  <button type="button" className="button secondary async-action-button" disabled={busy || !canReplan} onClick={() => void replan()}>{pendingAction === "replan" ? actionProgress.text : "按最新诊断重算"}</button>
                  <button type="button" className="button primary async-action-button" disabled={busy} onClick={() => void enterLearning()}>{pendingAction === "enter" ? actionProgress.text : "进入学习"}</button>
                </>
              ) : (
                <button type="button" className="button primary async-action-button" disabled={busy || path.status === "infeasible"} onClick={() => void confirm()}>{pendingAction === "confirm" ? actionProgress.text : "确认学习路径"}</button>
              )}
            </div>
          </div>
        </section>
        <aside className="work-section budget-panel">
          <p className="section-kicker">系统计算</p>
          <h2>时间与诊断依据</h2>
          <dl className="metric-list">
            <div><dt>预计学习时长</dt><dd>{systemEstimatedMinutes}分钟</dd></div>
            <div><dt>最低需要</dt><dd>{candidate?.minimumRequiredMinutes ?? "已满足"}</dd></div>
            <div><dt>缺失先修</dt><dd>{candidate?.missingPrerequisiteIds.length ?? 0}项</dd></div>
            <div><dt>会话版本</dt><dd>{(replanned ?? confirmed)?.sessionVersion ?? session.view.sessionVersion}</dd></div>
            <div><dt>能力画像修订</dt><dd>{routeState.capabilityProfileRevision ?? "当前会话"}</dd></div>
          </dl>
          <h2>诊断画像</h2>
          {knowledgeStates.length === 0 ? <p className="notice-line">本次没有形成可展示的知识状态，系统按未验证处理。</p> : (
            <dl className="metric-list">
              {knowledgeStates.map((state) => (
                <div key={state.knowledgePointId}>
                  <dt>{knowledgePointLabel(state.knowledgePointId)}</dt>
                  <dd>{state.mastery === null ? "未验证" : state.mastery.toFixed(2)} · {knowledgeStatusLabel(state.status)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="notice-line">{diagnosticPathNotice(knowledgeStates, path.nodes)}</p>
        </aside>
      </div>
    ) : null}
  </PageFrame>;
}
