import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ConfirmedPathOutput, KnowledgeState, PathCandidateOutput, ReplanPathOutput } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { knowledgeStatusLabel, masteryLabel } from "../copy/ui-copy.js";
import {
  PATH_PAGE_COPY,
  PATH_PANEL_COPY,
  arrangementText,
  diagnosticPathNotice,
  pathNodeStatusLabel,
  pathNodeTone,
  reasonLabel,
  requirementLabel,
  scaffoldLabel,
} from "../copy/path-page-copy.js";
import { projectSequentialPathNodes } from "../flow/study-flow.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { difficultyLabel, knowledgePointLabel } from "../learning-labels.js";
import "./PathPage.css";

interface PathLocationState {
  candidate?: PathCandidateOutput;
  evidenceVersion?: number;
  knowledgeStates?: KnowledgeState[];
  capabilityProfileRevision?: number;
}

type PendingPathAction = "confirm" | "replan" | "enter";

/**
 * 路径确认页。
 *
 * 页面结构（卡片模型）：
 * - 一个任务卡「这是依据你的诊断算出来的路径」承载说明与主确认操作；
 * - 路径明细与时间/诊断依据是两张并排的证据信息卡，默认折叠；
 * - 重算结果是重算动作的即时反馈，不折叠。
 *
 * 顺序投影（只有第一个未完成节点宣称「可以开始」）来自动线模块
 * projectSequentialPathNodes，本页不保留实现副本。
 */
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
    actionProgress.start(PATH_PAGE_COPY.confirmProgress);
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
    actionProgress.start(PATH_PAGE_COPY.replanProgress);
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
    actionProgress.start(PATH_PAGE_COPY.enterProgress);
    try {
      const next = await api.getNextStep({ sessionId, sessionVersion: meta.sessionVersion, profileRevision: meta.profileRevision, pathVersion: path.pathVersion });
      if (next.completed || next.node === undefined) navigate(`/summary/${sessionId}`);
      else navigate(`/learn/${sessionId}/${next.node.nodeId}`, { state: { next } });
    } catch (error) { setActionError(error instanceof Error ? error : new Error("next_step_failed")); }
    finally { actionProgress.stop(); setPendingAction(undefined); setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  return <PageFrame eyebrow={PATH_PAGE_COPY.eyebrow} title={PATH_PAGE_COPY.title} summary={PATH_PAGE_COPY.summary} back={{ to: sessionId === "" ? "/" : `/diagnostic/${sessionId}`, label: PATH_PAGE_COPY.backLabel }} actions={<span className="header-badge">{PATH_PAGE_COPY.headerBadge(systemEstimatedMinutes)}</span>}>
    {bootstrap.loading ? <PageStatePanel page="path" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="path" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); setConfirmed(undefined); setReplanned(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && (session === undefined || path === undefined) ? <PageStatePanel page="path" state="empty" detail={PATH_PAGE_COPY.emptyDetail} /> : null}
    {!bootstrap.loading && error === undefined && session !== undefined && path !== undefined ? (
      <div className="path-page" data-page="path">
        <section className="path-task-card">
          <div className="path-task-heading">
            <div>
              <h2 className="path-task-title">{PATH_PAGE_COPY.taskTitle}</h2>
              <p className="path-task-body">{PATH_PAGE_COPY.taskBody}</p>
            </div>
            <span className={`status-tag ${active ? "success" : "neutral"}`}>{active ? PATH_PAGE_COPY.confirmedTag : PATH_PAGE_COPY.pendingTag}</span>
          </div>
          {actionProgress.active ? <p className="async-action-status" role="status" aria-live="polite">{actionProgress.text}</p> : null}
          <div className="path-task-footer">
            <span className="quiet-label">{PATH_PAGE_COPY.taskSummary(candidate?.status === "infeasible", path.nodes.length, systemEstimatedMinutes)}</span>
            <div className="button-row">
              {active ? (
                <>
                  <button type="button" className="button secondary async-action-button" disabled={busy || !canReplan} onClick={() => void replan()}>{pendingAction === "replan" ? actionProgress.text : PATH_PAGE_COPY.replanButton}</button>
                  <button type="button" className="button primary async-action-button" disabled={busy} onClick={() => void enterLearning()}>{pendingAction === "enter" ? actionProgress.text : PATH_PAGE_COPY.enterButton}</button>
                </>
              ) : (
                <button type="button" className="button primary async-action-button" disabled={busy || path.status === "infeasible"} onClick={() => void confirm()}>{pendingAction === "confirm" ? actionProgress.text : PATH_PAGE_COPY.confirmButton}</button>
              )}
            </div>
          </div>
        </section>

        {replanned === undefined ? null : (
          <section className="path-replan-result" aria-live="polite">
            <h2 className="path-replan-title">{PATH_PANEL_COPY.replanTitle}</h2>
            <dl className="metric-list horizontal">
              <div><dt>{PATH_PANEL_COPY.replanChanged}</dt><dd>{replanned.changed ? PATH_PANEL_COPY.yes : PATH_PANEL_COPY.no}</dd></div>
              <div><dt>{PATH_PANEL_COPY.replanFallback}</dt><dd>{replanned.fallbackToPrevious ? PATH_PANEL_COPY.yes : PATH_PANEL_COPY.no}</dd></div>
            </dl>
            <ul className="path-change-reasons">{replanned.changeReasons.length === 0 ? <li>{PATH_PANEL_COPY.noChange}</li> : replanned.changeReasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}</ul>
          </section>
        )}

        <div className="path-card-grid">
          <details className="path-info-card" open={replanned !== undefined}>
            <summary className="path-card-summary"><span className="path-card-title">{PATH_PANEL_COPY.detailTitle}</span><span className="path-caret" aria-hidden="true"></span></summary>
            <ul className="path-evidence-list">
              {displayNodes.map((node) => (
                <li className="path-evidence-node" data-status={pathNodeTone(node)} key={node.nodeId}>
                  <div className="path-evidence-main">
                    <strong>{titleByNode.get(node.nodeId) ?? knowledgePointLabel(node.knowledgePointId)}</strong>
                    <span>{arrangementText(node, knowledgeStates)}</span>
                    <small>{difficultyLabel(node.difficulty)} · {scaffoldLabel(node.scaffold)} · {requirementLabel(node.required)}</small>
                  </div>
                  <div className="path-evidence-meta">
                    <span>{node.estimatedMinutes}分钟</span>
                    <strong className="path-status-badge">{pathNodeStatusLabel(node)}</strong>
                  </div>
                </li>
              ))}
            </ul>
          </details>

          <details className="path-info-card">
            <summary className="path-card-summary"><span className="path-card-title">{PATH_PANEL_COPY.basisTitle}</span><span className="path-caret" aria-hidden="true"></span></summary>
            <dl className="metric-list">
              <div><dt>{PATH_PANEL_COPY.estimatedLabel}</dt><dd>{systemEstimatedMinutes}分钟</dd></div>
              <div><dt>{PATH_PANEL_COPY.minimumLabel}</dt><dd>{candidate?.minimumRequiredMinutes ?? PATH_PANEL_COPY.minimumSatisfied}</dd></div>
              <div><dt>{PATH_PANEL_COPY.missingPrerequisitesLabel}</dt><dd>{candidate?.missingPrerequisiteIds.length ?? 0}{PATH_PANEL_COPY.countUnit}</dd></div>
            </dl>
            <h3 className="path-subheading">{PATH_PANEL_COPY.profileTitle}</h3>
            {knowledgeStates.length === 0 ? <p className="notice-line">{PATH_PANEL_COPY.noKnowledgeStates}</p> : (
              <dl className="metric-list">
                {knowledgeStates.map((state) => (
                  <div key={state.knowledgePointId}>
                    <dt>{knowledgePointLabel(state.knowledgePointId)}</dt>
                    <dd>{masteryLabel(state.mastery)} · {knowledgeStatusLabel(state.status)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="notice-line">{diagnosticPathNotice(knowledgeStates, path.nodes)}</p>
          </details>
        </div>
      </div>
    ) : null}
  </PageFrame>;
}