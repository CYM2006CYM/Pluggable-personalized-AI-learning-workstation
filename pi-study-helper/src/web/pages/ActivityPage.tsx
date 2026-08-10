import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import {
  activityDraftMock,
  activitySubmissionMock,
  evaluatorFeedbackMock,
  preparedActivityMock,
} from "../mocks/safe-dtos.js";
import { ACTIVITY_VIEW_MODES, useUiStore, type ActivityViewMode } from "../state/ui-store.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";

const modeLabels: Record<ActivityViewMode, string> = {
  draft: "草稿",
  running: "运行中",
  submitted: "正式提交",
  safe_feedback: "安全反馈",
};

interface ActivityStageProps {
  mode: ActivityViewMode;
  draft: string;
  onDraftChange: (draft: string) => void;
}

function ActivityStage({ mode, draft, onDraftChange }: ActivityStageProps) {
  if (mode === "running") {
    return (
      <section className="activity-stage running-stage" data-activity-mode="running" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.activityStageMinHeight }}>
        <div className="run-status"><span className="spinner" aria-hidden="true" /><div><strong>正在运行公开检查</strong><span>{preparedActivityMock.environmentId}</span></div></div>
        <div className="run-progress"><span /></div>
        <dl className="metric-list horizontal">
          <div><dt>运行编号</dt><dd>{preparedActivityMock.runId}</dd></div>
          <div><dt>模式</dt><dd>{preparedActivityMock.mode}</dd></div>
          <div><dt>公开检查</dt><dd>{preparedActivityMock.publicTestSources.length}项</dd></div>
        </dl>
        <pre className="console-output">准备公开数据...\n执行固定入口...\n等待公开检查结果...</pre>
        <p className="notice-line">预览运行不写入掌握状态或正式证据。</p>
      </section>
    );
  }

  if (mode === "submitted") {
    const result = activitySubmissionMock.result;
    return (
      <section className="activity-stage result-stage" data-activity-mode="submitted" style={{ minHeight: STABLE_LAYOUT.activityStageMinHeight }}>
        <div className="result-header">
          <div><p className="section-kicker">SERVER VERDICT</p><h2>{result.verdict}</h2></div>
          <span className="score-block">{result.score} / 1</span>
        </div>
        <p className="feedback-copy">{result.safeFeedback}</p>
        <dl className="metric-list horizontal">
          <div><dt>执行状态</dt><dd>{result.executionStatus}</dd></div>
          <div><dt>错误类型</dt><dd>{result.errorCode}</dd></div>
          <div><dt>评测版本</dt><dd>{result.evaluatorVersion}</dd></div>
        </dl>
        <p className="notice-line">结果已由服务端提交，Evidence version {activitySubmissionMock.evidenceVersion}。</p>
      </section>
    );
  }

  if (mode === "safe_feedback") {
    return (
      <section className="activity-stage evaluator-stage" data-activity-mode="safe_feedback" role="alert" style={{ minHeight: STABLE_LAYOUT.activityStageMinHeight }}>
        <p className="state-code">{evaluatorFeedbackMock.result.errorCode}</p>
        <h2>评测器暂时不可用</h2>
        <p>{evaluatorFeedbackMock.result.safeFeedback}</p>
        <dl className="metric-list horizontal">
          <div><dt>执行状态</dt><dd>{evaluatorFeedbackMock.result.executionStatus}</dd></div>
          <div><dt>错误类型</dt><dd>{evaluatorFeedbackMock.result.errorKind}</dd></div>
          <div><dt>评测版本</dt><dd>{evaluatorFeedbackMock.result.evaluatorVersion}</dd></div>
        </dl>
        <div className="button-row"><button type="button" className="button primary">重试提交</button><button type="button" className="button secondary">保存并返回学习页</button></div>
      </section>
    );
  }

  return (
    <section className="activity-stage draft-stage" data-activity-mode="draft" style={{ minHeight: STABLE_LAYOUT.activityStageMinHeight }}>
      <label htmlFor="code-draft">代码草稿</label>
      <textarea id="code-draft" value={draft} onChange={(event) => onDraftChange(event.target.value)} spellCheck={false} />
      <div className="draft-meta"><span>Attempt {activityDraftMock.attemptId}</span><span>Draft v{activityDraftMock.draftVersion}</span><span>已恢复安全草稿</span></div>
      <div className="section-footer"><button type="button" className="button secondary">运行公开检查</button><button type="button" className="button primary">提交正式评测</button></div>
    </section>
  );
}

export function ActivityPage() {
  const pageViewState = useUiStore((state) => state.pageViewState);
  const activityViewMode = useUiStore((state) => state.activityViewMode);
  const setActivityViewMode = useUiStore((state) => state.setActivityViewMode);
  const activityDraft = useUiStore((state) => state.activityDraft);
  const setActivityDraft = useUiStore((state) => state.setActivityDraft);

  return (
    <PageFrame
      eyebrow="代码活动"
      title={activityDraftMock.activity.title}
      summary={activityDraftMock.activity.prompt}
      actions={<span className="header-badge">{activityDraftMock.activity.kind}</span>}
    >
      {pageViewState !== "ready" ? (
        <PageStatePanel page="activity" state={pageViewState} />
      ) : (
        <div className="activity-layout" data-page="activity">
          <aside className="activity-brief" aria-label="活动信息">
            <p className="section-kicker">ACTIVITY CONTRACT</p>
            <dl className="metric-list">
              <div><dt>知识点</dt><dd>{activityDraftMock.activity.primaryKnowledgePointId.replace("pandas.clean.", "")}</dd></div>
              <div><dt>活动版本</dt><dd>{activityDraftMock.activity.activityVersion}</dd></div>
              <div><dt>Profile</dt><dd>Revision {activityDraftMock.profileRevision}</dd></div>
              <div><dt>会话版本</dt><dd>{activityDraftMock.sessionVersion}</dd></div>
            </dl>
            <p className="notice-line">运行只检查公开内容；正式提交结果由服务端返回。</p>
            <Link to="/learn/session-demo-001/node-missing-values" className="button text-button">返回学习内容</Link>
          </aside>
          <div className="activity-workspace">
            <div className="activity-tabs" role="tablist" aria-label="活动状态" style={{ height: STABLE_LAYOUT.activityTabsHeight }}>
              {ACTIVITY_VIEW_MODES.map((mode) => (
                <button key={mode} type="button" role="tab" data-mode={mode} aria-selected={mode === activityViewMode} className={mode === activityViewMode ? "selected" : ""} onClick={() => setActivityViewMode(mode)}>{modeLabels[mode]}</button>
              ))}
            </div>
            <ActivityStage mode={activityViewMode} draft={activityDraft} onDraftChange={setActivityDraft} />
          </div>
        </div>
      )}
    </PageFrame>
  );
}
