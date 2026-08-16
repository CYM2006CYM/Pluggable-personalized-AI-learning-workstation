import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CompleteSessionOutput, SessionRecoverySafeView } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";

type UnresolvedResult = "fail" | "partial" | "insufficient" | "unverified";
interface UnresolvedItem { nodeId: string; activityId: string; result: UnresolvedResult }

export function SummaryPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const bootstrap = useBootstrap(sessionId);
  const [output, setOutput] = useState<CompleteSessionOutput>();
  const [actionError, setActionError] = useState<Error>();
  const [attempted, setAttempted] = useState(false);
  const session = bootstrap.data?.session;
  const unresolved = useMemo(() => unresolvedActivities(session), [session]);

  useEffect(() => {
    if (attempted || session === undefined || session.view.status === "completed") return;
    setAttempted(true);
    api.completeSession({ requestId: newRequestId("web-complete-session"), sessionId, sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision })
      .then(setOutput).catch((error: unknown) => setActionError(error instanceof Error ? error : new Error("complete_session_failed")));
  }, [attempted, session, sessionId]);

  const error = actionError ?? bootstrap.error;
  return <PageFrame eyebrow="会话总结" title="本次学习进度" summary={output?.summary ?? "总结由服务端确定性事务生成。"} actions={<span className="header-badge">Session v{output?.sessionVersion ?? session?.view.sessionVersion ?? 0}</span>}>
    {bootstrap.loading ? <PageStatePanel page="summary" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="summary" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} detail="只有最终综合实操产生正式学习者判定后才能结束会话。" onRetry={() => { setActionError(undefined); setAttempted(false); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && session === undefined ? <PageStatePanel page="summary" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && session?.view.status === "completed" && output === undefined ? <><PageStatePanel page="summary" state="recovery" code="COMPLETED_SUMMARY_NOT_REPLAYABLE" detail="会话已完成；当前 Bootstrap 可恢复活动级结果，但未冻结完整历史总结重放。" /><ProgressSummary session={session} unresolved={unresolved} /></> : null}
    {!bootstrap.loading && error === undefined && output !== undefined && session !== undefined ? <div className="summary-layout" data-page="summary"><ProgressSummary session={session} unresolved={unresolved} /><section className="work-section recommendation-section"><p className="section-kicker">NEXT RECOMMENDATION</p><h2>下一步建议</h2><p>{output.nextRecommendation ?? "当前没有额外建议。"}</p></section><section className="work-section branch-section"><p className="section-kicker">CONTINUE</p><h2>后续动作</h2><div className="branch-list"><Link to="/"><strong>开始新会话</strong><span>重新选择入口和学习目标</span></Link></div></section></div> : null}
  </PageFrame>;
}

function unresolvedActivities(session?: SessionRecoverySafeView): UnresolvedItem[] {
  if (session === undefined) return [];
  return session.activityProgress.reduce<UnresolvedItem[]>((items, node) => {
    for (const activity of node.activities) {
      if (activity.result === "partial" || activity.result === "fail" || activity.result === "insufficient") {
        items.push({ nodeId: node.nodeId, activityId: activity.activityId, result: activity.result });
      } else if (activity.status === "pending" || activity.status === "in_progress") {
        items.push({ nodeId: node.nodeId, activityId: activity.activityId, result: "unverified" });
      }
    }
    return items;
  }, []);
}

function ProgressSummary({ session, unresolved }: { session: SessionRecoverySafeView; unresolved: UnresolvedItem[] }) {
  return <><section className="summary-metrics" aria-label="会话指标"><div><span>路径节点</span><strong>{session.path?.nodes.length ?? 0}</strong><small>服务端快照</small></div><div><span>活动记录</span><strong>{session.activityProgress.flatMap((node) => node.activities).length}</strong><small>确定性游标</small></div><div><span>未解决结果</span><strong>{unresolved.length}</strong><small>fail/partial/insufficient/unverified</small></div><div><span>Profile</span><strong>{session.view.profileRevision}</strong><small>绑定修订</small></div></section><section className="work-section recommendation-section"><p className="section-kicker">UNRESOLVED</p><h2>仍需处理</h2>{unresolved.length === 0 ? <p>暂无未解决项。</p> : <ul>{unresolved.map((item) => <li key={`${item.nodeId}:${item.activityId}`}>{item.activityId}: {item.result}</li>)}</ul>}</section></>;
}
