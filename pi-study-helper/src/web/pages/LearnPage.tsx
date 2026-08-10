import { Link, useParams } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { contextAnswerMock, learningCardDisplayFixture, nextStepMock, pathCandidateMock } from "../mocks/safe-dtos.js";
import { useUiStore } from "../state/ui-store.js";

export function LearnPage() {
  const pageViewState = useUiStore((state) => state.pageViewState);
  const { sessionId, nodeId } = useParams<{ sessionId: string; nodeId: string }>();

  return (
    <PageFrame
      eyebrow="学习工作台"
      title={learningCardDisplayFixture.title}
      summary={learningCardDisplayFixture.reason}
      actions={<span className="header-badge">预计 {learningCardDisplayFixture.estimatedMinutes} 分钟</span>}
    >
      {pageViewState !== "ready" ? (
        <PageStatePanel page="learn" state={pageViewState} />
      ) : (
        <div className="learn-layout" data-page="learn" data-session-id={sessionId} data-node-id={nodeId}>
          <aside className="path-rail" aria-label="当前路径">
            <p className="section-kicker">PATH {nextStepMock.pathVersion}</p>
            {pathCandidateMock.nodes.map((node, index) => (
              <div className={`rail-node ${node.nodeId === nextStepMock.node?.nodeId ? "current" : ""}`} key={node.nodeId}>
                <span>{index + 1}</span>
                <div><strong>{node.knowledgePointId.replace("pandas.clean.", "")}</strong><small>{node.status}</small></div>
              </div>
            ))}
          </aside>

          <article className="learning-content">
            <section className="content-band objective-band">
              <p className="section-kicker">本节目标</p>
              <h2>{learningCardDisplayFixture.objective}</h2>
            </section>
            <section className="content-band" aria-labelledby="explanation-heading">
              <div className="section-heading">
                <h2 id="explanation-heading">分步理解</h2>
                <span className="status-tag neutral">{learningCardDisplayFixture.reviewStatus}</span>
              </div>
              <ol className="explanation-list">
                {learningCardDisplayFixture.explanation.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </section>
            <section className="content-band split-band">
              <div>
                <p className="section-kicker">示例</p>
                <p>{learningCardDisplayFixture.example}</p>
              </div>
              <div>
                <p className="section-kicker">常见误区</p>
                <p>{learningCardDisplayFixture.commonMistake}</p>
              </div>
            </section>
            <details className="source-panel">
              <summary>查看来源依据</summary>
              <ul>{learningCardDisplayFixture.sourceAnchorIds.map((source) => <li key={source}>{source}</li>)}</ul>
            </details>
            <section className="context-strip" aria-label="上下文回答">
              <div><strong>安全上下文回答</strong><span>{contextAnswerMock.answer}</span></div>
              <small>来源：{contextAnswerMock.sourceAnchorIds.join(", ")}</small>
            </section>
            <div className="section-footer">
              <button type="button" className="button secondary">保存并暂停</button>
              <Link className="button primary" to="/activity/session-demo-001/act-missing">进入练习活动</Link>
            </div>
          </article>
        </div>
      )}
    </PageFrame>
  );
}
