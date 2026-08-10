import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { pathCandidateMock, startSessionMock } from "../mocks/safe-dtos.js";
import { useUiStore } from "../state/ui-store.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";

const statusLabels = {
  locked: "等待先修",
  available: "可以开始",
  in_progress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
} as const;

export function PathPage() {
  const pageViewState = useUiStore((state) => state.pageViewState);

  return (
    <PageFrame
      eyebrow="路径确认"
      title="查看并确认学习路径"
      summary="节点顺序、先修状态和安排理由来自确定性路径结果。"
      actions={<span className="header-badge">预算 {startSessionMock.availableMinutes} 分钟</span>}
    >
      {pageViewState !== "ready" ? (
        <PageStatePanel page="path" state={pageViewState} />
      ) : (
        <div className="path-layout" data-page="path">
          <section className="work-section path-section" aria-labelledby="path-heading">
            <div className="section-heading">
              <div>
                <p className="section-kicker">CANDIDATE · VERSION {pathCandidateMock.pathVersion}</p>
                <h2 id="path-heading">订单清洗推荐路径</h2>
              </div>
              <span className="status-tag success">{pathCandidateMock.status}</span>
            </div>
            <ol className="path-list">
              {pathCandidateMock.nodes.map((node, index) => (
                <li className={`path-node ${node.status}`} key={node.nodeId} style={{ minHeight: STABLE_LAYOUT.pathNodeMinHeight }}>
                  <span className="path-sequence">{String(index + 1).padStart(2, "0")}</span>
                  <div className="path-node-main">
                    <strong>{node.knowledgePointId.replace("pandas.clean.", "")}</strong>
                    <span>{node.reasonCodes.join(" · ")}</span>
                  </div>
                  <div className="path-node-meta">
                    <span>{node.estimatedMinutes}分钟</span>
                    <strong>{statusLabels[node.status]}</strong>
                  </div>
                </li>
              ))}
            </ol>
            <div className="section-footer">
              <button type="button" className="button secondary">选择其他侧重点</button>
              <Link className="button primary" to="/learn/session-demo-001/node-missing-values">确认这条路径</Link>
            </div>
          </section>

          <aside className="work-section budget-panel" aria-labelledby="budget-heading">
            <p className="section-kicker">TIME CONTRACT</p>
            <h2 id="budget-heading">时间与先修</h2>
            <dl className="metric-list">
              <div><dt>当前预算</dt><dd>{startSessionMock.availableMinutes}分钟</dd></div>
              <div><dt>最低需要</dt><dd>{pathCandidateMock.minimumRequiredMinutes}分钟</dd></div>
              <div><dt>缺失先修</dt><dd>{pathCandidateMock.missingPrerequisiteIds.length}项</dd></div>
              <div><dt>路径版本</dt><dd>{pathCandidateMock.pathVersion}</dd></div>
            </dl>
            <p className="notice-line">核心先修不会因时间不足被静默删除。</p>
          </aside>
        </div>
      )}
    </PageFrame>
  );
}
