import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { NextStepOutput } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";

export function LearnPage() {
  const { sessionId = "", nodeId = "" } = useParams<{ sessionId: string; nodeId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = useBootstrap(sessionId);
  const [next, setNext] = useState<NextStepOutput | undefined>((location.state as { next?: NextStepOutput } | null)?.next);
  const [loadingNext, setLoadingNext] = useState(next === undefined);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const session = bootstrap.data?.session;

  useEffect(() => {
    if (next !== undefined || session?.path === undefined) return;
    setLoadingNext(true);
    api.getNextStep({ sessionId, sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision, pathVersion: session.path.pathVersion })
      .then(setNext).catch((error: unknown) => setActionError(error instanceof Error ? error : new Error("next_step_failed"))).finally(() => setLoadingNext(false));
  }, [next, session, sessionId]);

  const open = async () => {
    if (session === undefined || session.path === undefined || next?.activity === undefined) return;
    setBusy(true); setActionError(undefined);
    try {
      const opened = await api.openActivity({ requestId: newRequestId("web-open-activity"), sessionId, sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision, activityId: next.activity.activityId, activityVersion: next.activity.activityVersion, pathVersion: session.path.pathVersion, ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }) });
      navigate(`/activity/${sessionId}/${next.activity.activityId}`, { state: { opened, nodeId } });
    } catch (error) { setActionError(error instanceof Error ? error : new Error("activity_open_failed")); }
    finally { setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  const loading = bootstrap.loading || loadingNext;
  return <PageFrame eyebrow="学习工作台" title={next?.card?.title ?? "学习内容"} summary={next?.card?.objective ?? "从服务端读取结构化卡片和当前活动。"} actions={<span className="header-badge">{next?.contentReadiness ?? "loading"}</span>}>
    {loading ? <PageStatePanel page="learn" state="loading" /> : null}
    {!loading && error ? <PageStatePanel page="learn" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); setNext(undefined); void bootstrap.reload(); }} /> : null}
    {!loading && error === undefined && (session === undefined || next === undefined || next.node === undefined) ? <PageStatePanel page="learn" state="empty" /> : null}
    {!loading && error === undefined && session !== undefined && next?.node !== undefined ? <div className="learn-layout" data-page="learn" data-session-id={sessionId} data-node-id={nodeId}><aside className="path-rail" aria-label="当前路径"><p className="section-kicker">PATH {next.pathVersion}</p>{session.path?.nodes.map((node, index) => <div className={`rail-node ${node.nodeId === next.node?.nodeId ? "current" : ""}`} key={node.nodeId}><span>{index + 1}</span><div><strong>{node.knowledgePointId}</strong><small>{node.status}</small></div></div>)}</aside><article className="learning-content">{next.card === undefined ? <section className="content-band objective-band"><p className="section-kicker">CONTENT {next.contentReadiness ?? "preparing"}</p><h2>内容正在准备或使用安全 fallback</h2></section> : <><section className="content-band objective-band"><p className="section-kicker">本节目标</p><h2>{next.card.objective}</h2></section><section className="content-band"><div className="section-heading"><h2>分步理解</h2><span className="status-tag neutral">{next.contentReadiness ?? "ready"}</span></div><ol className="explanation-list">{next.card.explanation.map((item) => <li key={item}>{item}</li>)}</ol></section><section className="content-band split-band"><div><p className="section-kicker">示例</p><p>{next.card.example}</p></div><div><p className="section-kicker">常见误区</p><p>{next.card.commonMistake}</p></div></section><details className="source-panel"><summary>查看来源依据</summary><ul>{next.card.sourceAnchorIds.map((source) => <li key={source}>{source}</li>)}</ul></details></>}<section className="context-strip" aria-label="安全审核状态"><div><strong>安全审核时间线</strong><span>该字段为可选安全投影；当前响应未提供时间线。</span></div><small>NOT_PROVIDED</small></section><div className="section-footer"><span className="quiet-label">{next.activity?.kind ?? "无活动"}</span>{next.activity === undefined ? <button type="button" className="button primary" onClick={() => { setNext(undefined); void bootstrap.reload(); }}>重新读取内容</button> : <button type="button" className="button primary" disabled={busy} onClick={() => void open()}>进入练习活动</button>}</div></article></div> : null}
  </PageFrame>;
}
