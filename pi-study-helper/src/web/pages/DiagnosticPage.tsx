import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { diagnosticCompleteMock, diagnosticQuestionDisplayFixture } from "../mocks/safe-dtos.js";
import { useUiStore } from "../state/ui-store.js";

const statusLabels = {
  mastered: "已有直接证据",
  learning: "正在学习",
  unverified: "目前未验证",
  ready: "可以继续",
  support_needed: "需要支持",
} as const;

export function DiagnosticPage() {
  const pageViewState = useUiStore((state) => state.pageViewState);

  return (
    <PageFrame
      eyebrow="固定诊断"
      title="确认当前学习起点"
      summary="答案逐题保存。跳过只表示证据不足，不会直接降低掌握状态。"
      actions={<span className="header-badge">{diagnosticQuestionDisplayFixture.current} / {diagnosticQuestionDisplayFixture.total}</span>}
    >
      {pageViewState !== "ready" ? (
        <PageStatePanel page="diagnostic" state={pageViewState} />
      ) : (
        <div className="diagnostic-layout" data-page="diagnostic">
          <section className="work-section question-section" aria-labelledby="question-heading">
            <div className="progress-track" aria-label={`诊断进度 ${diagnosticQuestionDisplayFixture.current}/${diagnosticQuestionDisplayFixture.total}`}>
              <span style={{ width: `${(diagnosticQuestionDisplayFixture.current / diagnosticQuestionDisplayFixture.total) * 100}%` }} />
            </div>
            <p className="section-kicker">{diagnosticQuestionDisplayFixture.knowledgePointTitle}</p>
            <h2 id="question-heading">{diagnosticQuestionDisplayFixture.prompt}</h2>
            <fieldset className="answer-list">
              <legend className="sr-only">请选择答案</legend>
              {diagnosticQuestionDisplayFixture.options.map((option, index) => (
                <label className="answer-option" key={option}>
                  <input type="radio" name="diagnostic-answer" />
                  <span className="option-key">{String.fromCharCode(65 + index)}</span>
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
            <div className="section-footer">
              <button type="button" className="button secondary">上一题</button>
              <div className="button-row">
                <button type="button" className="button text-button">跳过并标记未验证</button>
                <Link className="button primary" to="/path/session-demo-001">保存并继续</Link>
              </div>
            </div>
          </section>

          <aside className="work-section evidence-summary" aria-labelledby="evidence-heading">
            <div className="section-heading">
              <div>
                <p className="section-kicker">EVIDENCE SNAPSHOT</p>
                <h2 id="evidence-heading">当前证据状态</h2>
              </div>
              <span className="quiet-label">v{diagnosticCompleteMock.evidenceVersion}</span>
            </div>
            <div className="status-list">
              {diagnosticCompleteMock.knowledgeStates.map((knowledge) => (
                <div className="status-row" key={knowledge.knowledgePointId}>
                  <span>{knowledge.knowledgePointId.replace("pandas.clean.", "")}</span>
                  <strong>{statusLabels[knowledge.status]}</strong>
                  <small>{knowledge.validEvidenceCount}项证据</small>
                </div>
              ))}
            </div>
            <p className="notice-line">未验证知识点将进入路径的验证或回补节点。</p>
          </aside>
        </div>
      )}
    </PageFrame>
  );
}
