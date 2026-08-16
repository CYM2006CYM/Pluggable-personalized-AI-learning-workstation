import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ConfirmedPathOutput, PathCandidateOutput, ReplanPathOutput } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";

interface PathLocationState {
  candidate?: PathCandidateOutput;
  evidenceVersion?: number;
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
  const [actionError, setActionError] = useState<Error>();
  const session = bootstrap.data?.session;
  const candidate = routeState.candidate;
  const path = replanned !== undefined
    ? { pathId: replanned.pathId, pathVersion: replanned.pathVersion, status: "active" as const, nodes: replanned.nodes }
    : candidate?.pathId !== undefined
      ? { pathId: candidate.pathId, pathVersion: candidate.pathVersion!, status: confirmed === undefined ? candidate.status : "active" as const, nodes: candidate.nodes }
      : session?.path;
  const active = path?.status === "active" || path?.status === "confirmed" || path?.status === "completed";
  const canReplan = active && routeState.evidenceVersion !== undefined;

  const confirm = async () => {
    if (session === undefined || path === undefined || path.status === "infeasible") return;
    setBusy(true); setActionError(undefined);
    try {
      setConfirmed(await api.confirmPath({
        requestId: newRequestId("web-confirm-path"), sessionId,
        sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision,
        pathId: path.pathId, pathVersion: path.pathVersion,
      }));
    } catch (error) { setActionError(error instanceof Error ? error : new Error("path_confirm_failed")); }
    finally { setBusy(false); }
  };

  const replan = async () => {
    if (session === undefined || path === undefined || routeState.evidenceVersion === undefined) return;
    const meta = confirmed ?? replanned ?? session.view;
    setBusy(true); setActionError(undefined);
    try {
      const output = await api.replanPath({
        requestId: newRequestId("web-replan-path"), sessionId,
        sessionVersion: meta.sessionVersion, profileRevision: meta.profileRevision,
        pathVersion: path.pathVersion, evidenceVersion: routeState.evidenceVersion,
        trigger: "user_constraint_changed", availableMinutes: session.view.availableMinutes,
        selectedKnowledgePointIds: [], lockedNodeIds: path.nodes.filter((node) => node.positionLocked).map((node) => node.nodeId),
      });
      setReplanned(output);
    } catch (error) { setActionError(error instanceof Error ? error : new Error("path_replan_failed")); }
    finally { setBusy(false); }
  };

  const enterLearning = async () => {
    if (session === undefined || path === undefined) return;
    const meta = replanned ?? confirmed ?? session.view;
    setBusy(true); setActionError(undefined);
    try {
      const next = await api.getNextStep({ sessionId, sessionVersion: meta.sessionVersion, profileRevision: meta.profileRevision, pathVersion: path.pathVersion });
      if (next.completed || next.node === undefined) navigate(`/summary/${sessionId}`);
      else navigate(`/learn/${sessionId}/${next.node.nodeId}`, { state: { next } });
    } catch (error) { setActionError(error instanceof Error ? error : new Error("next_step_failed")); }
    finally { setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  return <PageFrame eyebrow="路径确认" title="查看并确认学习路径" summary="顺序、先修状态和安排原因来自确定性路径结果。" actions={<span className="header-badge">预算 {session?.view.availableMinutes ?? 0} 分钟</span>}>
    {bootstrap.loading ? <PageStatePanel page="path" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="path" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); setConfirmed(undefined); setReplanned(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && (session === undefined || path === undefined) ? <PageStatePanel page="path" state="empty" detail="当前安全快照没有可展示的路径。" /> : null}
    {!bootstrap.loading && error === undefined && session !== undefined && path !== undefined ? <div className="path-layout" data-page="path"><section className="work-section path-section"><div className="section-heading"><div><p className="section-kicker">PATH VERSION {path.pathVersion}</p><h2>确定性学习路径</h2></div><span className="status-tag success">{path.status}</span></div><ol className="path-list">{path.nodes.map((node, index) => <li className={`path-node ${node.status}`} key={node.nodeId} style={{ minHeight: STABLE_LAYOUT.pathNodeMinHeight }}><span className="path-sequence">{String(index + 1).padStart(2, "0")}</span><div className="path-node-main"><strong>{node.knowledgePointId}</strong><span>{node.reasonCodes.join(" · ") || "固定拓扑"}</span><small>{node.difficulty} · {node.scaffold} · {node.required ? "必需" : "可选"} · {node.positionLocked ? "位置锁定" : "可重算"}</small></div><div className="path-node-meta"><span>{node.estimatedMinutes}分钟</span><strong>{node.status}</strong></div></li>)}</ol>{replanned === undefined ? null : <section className="replan-result" aria-live="polite"><h2>重算结果</h2><dl className="metric-list horizontal"><div><dt>路径变化</dt><dd>{replanned.changed ? "是" : "否"}</dd></div><div><dt>沿用旧路径</dt><dd>{replanned.fallbackToPrevious ? "是" : "否"}</dd></div></dl><ul>{replanned.changeReasons.length === 0 ? <li>服务端未返回变更原因</li> : replanned.changeReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>}<div className="section-footer"><span className="quiet-label">{candidate?.status === "infeasible" ? "路径不可行" : `${path.nodes.length} 个节点`}</span><div className="button-row">{active ? <><button type="button" className="button secondary" disabled={busy || !canReplan} onClick={() => void replan()}>重新计算路径</button><button type="button" className="button primary" disabled={busy} onClick={() => void enterLearning()}>进入学习</button></> : <button type="button" className="button primary" disabled={busy || path.status === "infeasible"} onClick={() => void confirm()}>确认路径</button>}</div></div></section><aside className="work-section budget-panel"><p className="section-kicker">TIME CONTRACT</p><h2>时间与先修</h2><dl className="metric-list"><div><dt>当前预算</dt><dd>{session.view.availableMinutes}分钟</dd></div><div><dt>最低需要</dt><dd>{candidate?.minimumRequiredMinutes ?? "已满足"}</dd></div><div><dt>缺失先修</dt><dd>{candidate?.missingPrerequisiteIds.length ?? 0}项</dd></div><div><dt>会话版本</dt><dd>{(replanned ?? confirmed)?.sessionVersion ?? session.view.sessionVersion}</dd></div></dl><p className="notice-line">{canReplan ? "本次诊断流程保留了正式 evidenceVersion，可发起服务端重算。" : "刷新后的安全 DTO 未冻结 evidenceVersion；保留现有路径并禁用重算。"}</p></aside></div> : null}
  </PageFrame>;
}
