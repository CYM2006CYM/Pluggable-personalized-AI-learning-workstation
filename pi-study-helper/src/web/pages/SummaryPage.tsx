import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { completeSessionMock, diagnosticCompleteMock, pathCandidateMock } from "../mocks/safe-dtos.js";
import { useUiStore } from "../state/ui-store.js";

export function SummaryPage() {
  const pageViewState = useUiStore((state) => state.pageViewState);

  return (
    <PageFrame
      eyebrow="会话总结"
      title="本次学习进度"
      summary={completeSessionMock.summary}
      actions={<span className="header-badge">Session v{completeSessionMock.sessionVersion}</span>}
    >
      {pageViewState !== "ready" ? (
        <PageStatePanel page="summary" state={pageViewState} />
      ) : (
        <div className="summary-layout" data-page="summary">
          <section className="summary-metrics" aria-label="会话指标">
            <div><span>路径节点</span><strong>{pathCandidateMock.nodes.length}</strong><small>当前候选</small></div>
            <div><span>证据版本</span><strong>{diagnosticCompleteMock.evidenceVersion}</strong><small>服务端快照</small></div>
            <div><span>仍需验证</span><strong>{diagnosticCompleteMock.insufficientKnowledgePointIds.length}</strong><small>知识点</small></div>
            <div><span>Profile</span><strong>{completeSessionMock.profileRevision}</strong><small>绑定修订</small></div>
          </section>

          <section className="work-section recommendation-section" aria-labelledby="recommendation-heading">
            <p className="section-kicker">NEXT RECOMMENDATION</p>
            <h2 id="recommendation-heading">下一步建议</h2>
            <p>{completeSessionMock.nextRecommendation}</p>
          </section>

          <section className="work-section branch-section" aria-labelledby="branch-heading">
            <div className="section-heading"><div><p className="section-kicker">CONTINUE</p><h2 id="branch-heading">选择后续动作</h2></div></div>
            <div className="branch-list">
              <Link to="/learn/session-demo-001/node-missing-values"><strong>继续当前路径</strong><span>从第一个可用节点继续</span></Link>
              <button type="button"><strong>做迁移任务</strong><span>使用同一知识点的新数据</span></button>
              <button type="button"><strong>复习薄弱点</strong><span>请求确定性回补后缀</span></button>
              <Link to="/diagnostic/session-demo-001"><strong>重新诊断</strong><span>创建新的诊断版本</span></Link>
              <button type="button"><strong>结束会话</strong><span>提交当前总结</span></button>
            </div>
          </section>
        </div>
      )}
    </PageFrame>
  );
}
