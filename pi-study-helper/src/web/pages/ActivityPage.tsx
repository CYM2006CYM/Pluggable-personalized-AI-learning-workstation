import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  ActivityDraftOutput,
  ActivitySubmissionOutput,
  ActivityTestPointResult,
  CodeActivitySafeView,
  CodeActivityDraftOutput,
  QuizAnswerInput,
} from "../../contracts/index.js";
import { api, isApiError, isEvaluatorFailure, newRequestId, quizScore, type EvaluatorFailureView } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { knowledgePointLabel } from "../learning-labels.js";
import {
  clearActivityDraft,
  readActivityDraft,
  writeActivityDraft,
  type ActivityDraftBinding,
  type DraftStorage,
} from "../state/activity-draft-storage.js";
import { useUiStore } from "../state/ui-store.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";

type SubmitResult = ActivitySubmissionOutput | EvaluatorFailureView;
type PendingAction = "advance" | "continue_with_gap";
const MAX_RECOVERY_ATTEMPTS = 2;

export function ActivityPage() {
  const { sessionId = "", activityId = "" } = useParams<{ sessionId: string; activityId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = useBootstrap(sessionId);
  const [opened, setOpened] = useState<ActivityDraftOutput | undefined>((location.state as { opened?: ActivityDraftOutput } | null)?.opened);
  const [result, setResult] = useState<SubmitResult>();
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [actionError, setActionError] = useState<Error>();
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<Error>();
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const [recoveryTrigger, setRecoveryTrigger] = useState(0);
  const actionProgress = useAsyncActionProgress();
  const routeStateChecked = useRef<string>();
  const initializedDraftBinding = useRef<string>();
  const drafts = useUiStore((state) => state.activityDrafts);
  const setDraft = useUiStore((state) => state.setActivityDraft);
  const clearDraft = useUiStore((state) => state.clearActivityDraft);
  const session = bootstrap.data?.session;
  const submittedProgress = session?.activityProgress
    .flatMap((node) => node.activities)
    .find((activity) => activity.activityId === activityId && activity.result !== undefined);
  const localDraft = opened?.kind === "code" ? drafts[opened.attemptId] ?? opened.userText : "";

  const captureActionError = async (error: unknown, fallback: string) => {
    const normalized = error instanceof Error ? error : new Error(fallback);
    setActionError(normalized);
    if (isApiError(normalized) && normalized.status === 409) await bootstrap.reload();
  };

  useEffect(() => {
    if (opened?.kind !== "code") return;
    const binding = draftBinding(sessionId, activityId, opened);
    const currentAttempt = session?.currentAttempt;
    const serverConfirmed = currentAttempt?.kind === "code"
      && currentAttempt.activityId === activityId
      && currentAttempt.attemptId === opened.attemptId
      && currentAttempt.draftVersion === opened.draftVersion
      && session?.view.profileRevision === opened.profileRevision;
    const initializationKey = `${bindingKey(binding)}:${serverConfirmed ? "confirmed" : "server"}`;
    if (initializedDraftBinding.current === initializationKey) return;
    initializedDraftBinding.current = initializationKey;
    const storage = getSessionStorage();
    const restored = serverConfirmed && storage !== undefined ? readActivityDraft(storage, binding) : undefined;
    setDraft(opened.attemptId, restored ?? opened.userText);
  }, [activityId, opened, session, sessionId, setDraft]);

  useEffect(() => {
    if (bootstrap.loading || bootstrap.error !== undefined || session === undefined || routeStateChecked.current === activityId) return;
    routeStateChecked.current = activityId;
    if (result !== undefined || opened === undefined || submittedProgress === undefined) return;
      setOpened(undefined);
      setAnswers({});
      setQuestionIndex(0);
  }, [activityId, bootstrap.error, bootstrap.loading, opened, result, session, submittedProgress]);

  useEffect(() => {
    const attempt = session?.currentAttempt;
    if (bootstrap.loading || opened !== undefined || recovering || recoveryError !== undefined || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS || session === undefined || attempt?.activityId !== activityId || session.path === undefined) return;
    const { sessionVersion, profileRevision } = session.view;
    const pathVersion = session.path.pathVersion;
    setRecoveryAttempts((current) => current + 1);
    setRecovering(true);
    api.getNextStep({ sessionId, sessionVersion, profileRevision, pathVersion }).then(async (next) => {
      if (next.activity?.activityId !== activityId) throw new Error("activity_safe_view_incomplete");
      const recoveredSessionVersion = attempt.kind === "code"
        ? (await api.recoverActivity({ sessionId, sessionVersion, profileRevision, activityId, attemptId: attempt.attemptId })).sessionVersion
        : next.sessionVersion;
      return api.openActivity({
        requestId: newRequestId("web-recover-attempt"),
        sessionId,
        sessionVersion: recoveredSessionVersion,
        profileRevision: next.profileRevision,
        activityId,
        activityVersion: next.activity.activityVersion,
        pathVersion: next.pathVersion,
        ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }),
      });
    }).then((recovered) => {
      if (recovered.attemptId !== attempt.attemptId) throw new Error("attempt_identity_changed_during_recovery");
      setOpened(recovered);
    }).catch((error: unknown) => {
      setRecoveryError(error instanceof Error ? error : new Error("activity_recovery_failed"));
    }).finally(() => setRecovering(false));
  }, [activityId, bootstrap.loading, opened, recovering, recoveryAttempts, recoveryError, recoveryTrigger, session, sessionId]);

  const completeAnswers = useMemo<QuizAnswerInput[]>(() => opened?.kind !== "quiz" ? [] : opened.activity.questions.flatMap((question) => answers[question.questionId] === undefined ? [] : [{ questionId: question.questionId, answer: answers[question.questionId]! }]), [answers, opened]);

  const persistCodeDraft = async (current: CodeActivityDraftOutput, userText = localDraft): Promise<CodeActivityDraftOutput> => {
    const saved = await api.saveActivityDraft({
      requestId: newRequestId("web-save-code"), sessionId, sessionVersion: current.sessionVersion,
      profileRevision: current.profileRevision, activityId, activityVersion: current.activity.activityVersion,
      attemptId: current.attemptId, draftVersion: current.draftVersion, userText,
    });
    if (saved.kind !== "code" || saved.attemptId !== current.attemptId || saved.activity.activityId !== activityId) {
      throw new Error("invalid_code_draft_response");
    }
    persistBrowserDraft(draftBinding(sessionId, activityId, saved), userText);
    setDraft(saved.attemptId, userText);
    setOpened(saved);
    return saved;
  };

  const saveCodeDraft = async () => {
    if (opened?.kind !== "code") return;
    setBusy(true); setActionError(undefined);
    try {
      await persistCodeDraft(opened);
    } catch (error) { await captureActionError(error, "draft_save_failed"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (opened === undefined) return;
    setBusy(true); setActionError(undefined);
    try {
      const submissionDraft = opened.kind === "code" && localDraft !== opened.userText
        ? await persistCodeDraft(opened, localDraft)
        : opened;
      const submitted = await api.submitActivity(submissionDraft.kind === "quiz" ? {
        requestId: newRequestId("web-submit-quiz"), sessionId, sessionVersion: opened.sessionVersion, profileRevision: opened.profileRevision,
        kind: "quiz", activityId, activityVersion: opened.activity.activityVersion, attemptId: opened.attemptId, answers: completeAnswers,
      } : {
        requestId: newRequestId("web-submit-code"), sessionId, sessionVersion: submissionDraft.sessionVersion, profileRevision: submissionDraft.profileRevision,
        kind: "code", activityId, activityVersion: submissionDraft.activity.activityVersion, attemptId: submissionDraft.attemptId, draftVersion: submissionDraft.draftVersion, userText: localDraft,
      });
      setResult(submitted);
      if (!isEvaluatorFailure(submitted) && submissionDraft.kind === "code" && submitted.result.verdict === "pass") {
        removeBrowserDraft(submissionDraft.attemptId, clearDraft);
      }
      await bootstrap.reload();
    } catch (error) { await captureActionError(error, "activity_submit_failed"); }
    finally { setBusy(false); }
  };

  const advance = async (retry: boolean) => {
    setBusy(true); setPendingAction("advance"); setActionError(undefined);
    actionProgress.start(retry ? "正在确认重试条件" : "正在准备下一步");
    try {
      const fresh = await api.getBootstrap(sessionId);
      if (fresh.session?.path === undefined) throw new Error("path_not_recoverable");
      const next = await api.getNextStep({ sessionId, sessionVersion: fresh.session.view.sessionVersion, profileRevision: fresh.session.view.profileRevision, pathVersion: fresh.session.path.pathVersion });
      if (next.completed || next.node === undefined || next.activity === undefined) { navigate(`/summary/${sessionId}`); return; }
      const currentNodeId = fresh.session.path.nodes.find((node) => node.activityIds.includes(activityId))?.nodeId;
      const continueInsideNode = retry || currentNodeId === next.node.nodeId;
      if (continueInsideNode) {
        actionProgress.update(next.activity.kind === "mcq"
          ? retry ? "正在生成并审核新题组" : "正在准备题组"
          : "正在准备代码活动");
        const nextOpened = await api.openActivity({ requestId: newRequestId("web-open-retry"), sessionId, sessionVersion: next.sessionVersion, profileRevision: next.profileRevision, activityId: next.activity.activityId, activityVersion: next.activity.activityVersion, pathVersion: next.pathVersion, ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }) });
        setOpened(nextOpened); setResult(undefined); setAnswers({}); setQuestionIndex(0);
        navigate(`/activity/${sessionId}/${next.activity.activityId}`, { replace: true, state: { opened: nextOpened, nodeId: next.node.nodeId } });
      } else navigate(`/learn/${sessionId}/${next.node.nodeId}`, { state: { next } });
    } catch (error) { await captureActionError(error, "advance_failed"); }
    finally { actionProgress.stop(); setPendingAction(undefined); setBusy(false); }
  };

  const retryEvaluation = async () => {
    if (opened?.kind !== "code") return;
    setBusy(true); setActionError(undefined);
    try {
      const fresh = await api.getBootstrap(sessionId);
      const attempt = fresh.session?.currentAttempt;
      if (fresh.session === undefined || attempt?.kind !== "code" || attempt.attemptId !== opened.attemptId || attempt.status !== "evaluator_error") throw new Error("evaluator_attempt_not_recoverable");
      const recovered = await api.recoverActivity({ sessionId, sessionVersion: fresh.session.view.sessionVersion, profileRevision: fresh.session.view.profileRevision, activityId, attemptId: attempt.attemptId });
      if (recovered.attempt.kind !== "code" || recovered.draftVersion === undefined || recovered.userText === undefined) throw new Error("evaluator_draft_not_recoverable");
      const recoveredDraft: CodeActivityDraftOutput = { ...opened, sessionVersion: recovered.sessionVersion, profileRevision: recovered.profileRevision, draftVersion: recovered.draftVersion, userText: recovered.userText };
      persistBrowserDraft(draftBinding(sessionId, activityId, recoveredDraft), recoveredDraft.userText);
      setDraft(recoveredDraft.attemptId, recoveredDraft.userText);
      setOpened(recoveredDraft);
      const retried = await api.submitActivity({
        requestId: newRequestId("web-retry-evaluation"), sessionId, sessionVersion: recoveredDraft.sessionVersion, profileRevision: recoveredDraft.profileRevision,
        kind: "code", activityId, activityVersion: recoveredDraft.activity.activityVersion,
        attemptId: recoveredDraft.attemptId, draftVersion: recoveredDraft.draftVersion, userText: recoveredDraft.userText,
      });
      setResult(retried);
      if (!isEvaluatorFailure(retried)) removeBrowserDraft(recoveredDraft.attemptId, clearDraft);
      await bootstrap.reload();
    } catch (error) { await captureActionError(error, "evaluation_retry_failed"); }
    finally { setBusy(false); }
  };

  const continueWithGap = async () => {
    if (opened === undefined || result === undefined || isEvaluatorFailure(result)
        || result.kind !== opened.kind || result.result.verdict === "pass") return;
    setBusy(true); setPendingAction("continue_with_gap"); setActionError(undefined);
    actionProgress.start("正在记录未掌握状态");
    try {
      const fresh = await api.getBootstrap(sessionId);
      if (fresh.session?.path === undefined) throw new Error("path_not_recoverable");
      const continued = await api.continueActivityWithGap({
        requestId: newRequestId("web-continue-with-gap"),
        sessionId,
        sessionVersion: fresh.session.view.sessionVersion,
        profileRevision: fresh.session.view.profileRevision,
        activityId,
        attemptId: opened.attemptId,
      });
      const authoritative = await api.getBootstrap(sessionId);
      if (authoritative.session?.path === undefined) throw new Error("path_not_recoverable");
      const next = await api.getNextStep({
        sessionId,
        sessionVersion: authoritative.session.view.sessionVersion,
        profileRevision: authoritative.session.view.profileRevision,
        pathVersion: authoritative.session.path.pathVersion,
      });
      if (next.completed || next.node === undefined) navigate(`/summary/${sessionId}`);
      else navigate(`/learn/${sessionId}/${next.node.nodeId}`, { state: { next } });
    } catch (error) { await captureActionError(error, "continue_with_gap_failed"); }
    finally { actionProgress.stop(); setPendingAction(undefined); setBusy(false); }
  };

  const updateCodeDraft = (current: CodeActivityDraftOutput, userText: string) => {
    setDraft(current.attemptId, userText);
    persistBrowserDraft(draftBinding(sessionId, activityId, current), userText);
  };

  const error = actionError ?? bootstrap.error;
  const retryPending = submittedProgress?.status === "in_progress";
  const refreshBlocked = !bootstrap.loading && !recovering && error === undefined && recoveryError === undefined && opened === undefined && recoveryAttempts >= MAX_RECOVERY_ATTEMPTS && session?.currentAttempt?.activityId === activityId;
  const title = opened?.activity.title ?? "活动恢复";
  const summary = opened?.activity.prompt ?? "从服务端 Attempt 安全视图恢复当前活动。";
  const activityNodeId = session?.path?.nodes.find((node) => node.activityIds.includes(activityId))?.nodeId
    ?? (location.state as { nodeId?: string } | null)?.nodeId;
  const currentQuestion = opened?.kind === "quiz" ? opened.activity.questions[questionIndex] : undefined;
  const codeNeedsRetry = result !== undefined && !isEvaluatorFailure(result) && result.kind === "code" && result.result.verdict !== "pass";
  const codeCanContinueWithGap = codeNeedsRetry && (submittedProgress?.attemptIds.length ?? 0) >= 2;
  return <PageFrame eyebrow={opened?.kind === "quiz" ? "课后客观题" : "主观代码题"} title={title} summary={summary} back={{ to: activityNodeId === undefined ? `/path/${sessionId}` : `/learn/${sessionId}/${activityNodeId}`, label: "返回教学内容" }} actions={<span className="header-badge">{opened?.kind === "quiz" ? questionSourceLabel(opened.activity.questionSource) : opened?.kind === "code" ? "Node/Python权威评测" : "加载中"}</span>}>
    {bootstrap.loading || recovering ? <PageStatePanel page="activity" state="loading" /> : null}
    {!bootstrap.loading && !recovering && error ? <PageStatePanel page="activity" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && !recovering && error === undefined && recoveryError !== undefined ? <ActivityRecoveryFailure error={recoveryError} attempts={recoveryAttempts} hasBrowserDraft={localDraft.length > 0} activityNodeId={activityNodeId} sessionId={sessionId} onRetry={() => { setRecoveryError(undefined); setRecoveryTrigger((current) => current + 1); }} /> : null}
    {refreshBlocked ? <ActivityRecoveryFailure error={new Error("ACTIVITY_SAFE_VIEW_INCOMPLETE")} attempts={recoveryAttempts} hasBrowserDraft={localDraft.length > 0} activityNodeId={activityNodeId} sessionId={sessionId} /> : null}
    {!bootstrap.loading && !recovering && error === undefined && recoveryError === undefined && !refreshBlocked && opened === undefined && submittedProgress !== undefined ? <section className="state-panel recovery-state" data-state="recovery" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}><p className="state-code">已恢复服务端进度</p><h2>{retryPending ? "上次结果需要修改后重试" : "该活动已经完成"}</h2><p>服务端记录：{progressLabel(submittedProgress.status)} / {resultLabel(submittedProgress.result)}。系统不会重复创建已完成的提交。</p><div className="button-row">{activityNodeId === undefined ? null : <button type="button" className="button secondary" onClick={() => navigate(`/learn/${sessionId}/${activityNodeId}`)}>返回教学内容</button>}<button type="button" className="button primary" disabled={busy} onClick={() => void advance(retryPending)}>{retryPending ? "修改并重新评测" : "继续下一步"}</button></div></section> : null}
    {!bootstrap.loading && !recovering && error === undefined && recoveryError === undefined && !refreshBlocked && opened === undefined && submittedProgress === undefined ? <PageStatePanel page="activity" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && recoveryError === undefined && opened !== undefined ? <div className="activity-layout" data-page="activity">
      <aside className="activity-brief"><p className="section-kicker">活动信息</p><dl className="metric-list"><div><dt>知识点</dt><dd>{knowledgePointLabel(opened.activity.primaryKnowledgePointId)}</dd></div><div><dt>活动版本</dt><dd>{opened.activity.activityVersion}</dd></div><div><dt>当前尝试</dt><dd>{opened.attemptId}</dd></div><div><dt>会话版本</dt><dd>{opened.sessionVersion}</dd></div></dl><p className="notice-line">{opened.kind === "quiz" ? "提交前不显示答案；提交后只展示本题组的安全复盘。" : "题面、公开样例和验收点可以查看；隐藏测试与参考答案始终留在服务端。"}</p></aside>
      <div className="activity-workspace"><section className="activity-stage" style={{ minHeight: STABLE_LAYOUT.activityStageMinHeight }}>
        {actionProgress.active ? <p className="async-action-status" role="status" aria-live="polite">{actionProgress.text}</p> : null}
        {result !== undefined ? <ResultView value={result} /> : opened.kind === "quiz" && currentQuestion !== undefined ? <>
          <div className="quiz-pager" aria-label={`第 ${questionIndex + 1} 题，共 ${opened.activity.questions.length} 题`}><span>第 {questionIndex + 1} / {opened.activity.questions.length} 题</span><span>{completeAnswers.length} 题已作答</span></div>
          <fieldset className="answer-list"><legend className="sr-only">当前题目答案</legend><div className="quiz-question" key={currentQuestion.questionId}><h2>{currentQuestion.prompt}</h2>{currentQuestion.kind === "judgment" ? [true, false].map((value) => <label className="answer-option" key={String(value)}><input type="radio" name={currentQuestion.questionId} checked={answers[currentQuestion.questionId] === value} onChange={() => setAnswers({ ...answers, [currentQuestion.questionId]: value })} /><span>{value ? "正确" : "错误"}</span></label>) : currentQuestion.options.map((option, index) => <label className="answer-option" key={option}><input type="radio" name={currentQuestion.questionId} checked={answers[currentQuestion.questionId] === option} onChange={() => setAnswers({ ...answers, [currentQuestion.questionId]: option })} /><span className="option-key">{String.fromCharCode(65 + index)}</span><span className="option-copy">{option}</span></label>)}</div></fieldset>
          <div className="section-footer"><button type="button" className="button secondary" disabled={busy || questionIndex === 0} onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}>← 上一题</button>{questionIndex < opened.activity.questions.length - 1 ? <button type="button" className="button primary" disabled={busy || answers[currentQuestion.questionId] === undefined} onClick={() => setQuestionIndex((current) => current + 1)}>下一题 →</button> : <button type="button" className="button primary" disabled={busy || completeAnswers.length !== opened.activity.questions.length} onClick={() => void submit()}>提交完整题组</button>}</div>
        </> : opened.kind === "code" ? <>
          <CodeContractView activity={opened.activity} />
          <label htmlFor="code-draft">代码草稿</label>
          <textarea id="code-draft" value={localDraft} onChange={(event) => updateCodeDraft(opened, event.target.value)} spellCheck={false} />
          <div className="notice-line" role="status" data-preview-enabled="false"><strong>PYODIDE_DISABLED_WITH_NODE_FALLBACK</strong><br />浏览器预览未启用；正式评测由本地 Node/Python 执行。</div>
          <div className="section-footer"><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void saveCodeDraft()}>保存草稿</button></div><button type="button" className="button primary" disabled={busy || localDraft === ""} onClick={() => void submit()}>提交正式评测</button></div>
        </> : null}
        {result !== undefined && isEvaluatorFailure(result) ? <div className="section-footer"><button type="button" className="button secondary" onClick={() => activityNodeId === undefined ? navigate(`/path/${sessionId}`) : navigate(`/learn/${sessionId}/${activityNodeId}`)}>返回教学内容</button><button type="button" className="button primary" disabled={busy || opened.kind !== "code"} onClick={() => void retryEvaluation()}>恢复草稿并重试评测</button></div>
          : codeNeedsRetry ? <div className="section-footer"><button type="button" className="button secondary" onClick={() => activityNodeId === undefined ? navigate(`/path/${sessionId}`) : navigate(`/learn/${sessionId}/${activityNodeId}`)}>返回教学内容</button><div className="button-row">{codeCanContinueWithGap ? <button type="button" className="button secondary async-action-button" disabled={busy} onClick={() => void continueWithGap()}>{pendingAction === "continue_with_gap" ? actionProgress.text : "放弃并进入下一环节"}</button> : null}<button type="button" className="button primary async-action-button" disabled={busy} onClick={() => void advance(true)}>{pendingAction === "advance" ? actionProgress.text : "修改代码后重试"}</button></div></div>
            : result !== undefined ? <div className="section-footer">{result.kind === "quiz" && result.result.retryAllowed ? <div className="button-row">{opened.kind === "quiz" && opened.activity.retryNumber >= 1 ? <button type="button" className="button secondary async-action-button" disabled={busy} onClick={() => void continueWithGap()}>{pendingAction === "continue_with_gap" ? actionProgress.text : "暂时跳过，进入下一章节"}</button> : null}<button type="button" className="button primary async-action-button" disabled={busy} onClick={() => void advance(true)}>{pendingAction === "advance" ? actionProgress.text : "使用新题组重试"}</button></div> : <button type="button" className="button primary" disabled={busy} onClick={() => void advance(false)}>继续下一步</button>}</div> : null}
      </section></div>
    </div> : null}
  </PageFrame>;
}

function ActivityRecoveryFailure({
  error,
  attempts,
  hasBrowserDraft,
  activityNodeId,
  sessionId,
  onRetry,
}: {
  error: Error;
  attempts: number;
  hasBrowserDraft: boolean;
  activityNodeId?: string;
  sessionId: string;
  onRetry?: () => void;
}) {
  const category = isApiError(error)
    ? error.status === 409 ? "服务端版本已经变化" : error.status === 404 ? "原活动或作答记录不存在" : "服务连接暂时失败"
    : error.message === "activity_safe_view_incomplete" || error.message === "ACTIVITY_SAFE_VIEW_INCOMPLETE"
      ? "活动安全内容不完整"
      : "活动恢复失败";
  const canRetry = attempts < MAX_RECOVERY_ATTEMPTS && onRetry !== undefined;
  return <section className="state-panel recovery-state" data-state="recovery-error" role="alert" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
    <p className="state-code">{isApiError(error) ? error.code : error.message}</p>
    <h2>{category}</h2>
    <p>服务端保留原 Attempt，页面没有创建替代作答，也没有生成新的 Evidence。{attempts >= MAX_RECOVERY_ATTEMPTS ? "已达到本页恢复上限，自动恢复现已停止。" : "你可以再尝试一次恢复。"}</p>
    <p className="notice-line"><strong>草稿状态：</strong>{hasBrowserDraft ? "浏览器中的代码草稿仍然保留；服务端是否收到最后一次保存尚未确认。" : "当前没有可确认的浏览器代码草稿；未提交的题目答案不会被冒充为已保存。"}</p>
    <div className="button-row">{canRetry ? <button type="button" className="button primary" onClick={onRetry}>再次尝试恢复</button> : null}{activityNodeId === undefined ? null : <Link className="button secondary" to={`/learn/${sessionId}/${activityNodeId}`}>返回教学内容</Link>}<Link className="button secondary" to={`/path/${sessionId}`}>返回学习路径</Link></div>
  </section>;
}

function draftBinding(sessionId: string, activityId: string, opened: CodeActivityDraftOutput): ActivityDraftBinding {
  return { sessionId, activityId, attemptId: opened.attemptId, profileRevision: opened.profileRevision, draftVersion: opened.draftVersion };
}

function bindingKey(binding: ActivityDraftBinding): string {
  return `${binding.sessionId}:${binding.activityId}:${binding.attemptId}:${binding.profileRevision}:${binding.draftVersion}`;
}

function getSessionStorage(): DraftStorage | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

function persistBrowserDraft(binding: ActivityDraftBinding, userText: string): void {
  const storage = getSessionStorage();
  if (storage === undefined) return;
  try { writeActivityDraft(storage, binding, userText); } catch { /* Browser storage is a best-effort recovery aid. */ }
}

function removeBrowserDraft(attemptId: string, clearUiDraft: (attemptId: string) => void): void {
  const storage = getSessionStorage();
  if (storage !== undefined) clearActivityDraft(storage, attemptId);
  clearUiDraft(attemptId);
}

function ResultView({ value }: { value: SubmitResult }) {
  if (isEvaluatorFailure(value)) return <div className="evaluator-stage" role="alert"><p className="state-code">{errorLabel(value.errorCode)}</p><h2>评测服务暂时不可用</h2><p>本次没有评分，也没有推进学习状态。代码草稿仍然保留。</p></div>;
  if (value.kind === "code") {
    const testPoints = value.result.testPoints;
    const passedCount = testPoints?.filter((point) => point.status === "passed").length;
    return <div className="result-stage">
      <div className="result-header">
        <div><p className="section-kicker">权威评测结果</p><h2>{verdictLabel(value.result.verdict)}</h2></div>
        <span className="score-block">{testPoints === undefined ? "无逐点明细" : `${passedCount} / ${testPoints.length}`}<small>通过测试点</small></span>
      </div>
      <p className="feedback-copy">{safeFeedbackLabel(value.result.safeFeedback, value.result.errorCode)}</p>
      <dl className="metric-list horizontal"><div><dt>执行状态</dt><dd>{value.result.executionStatus === "completed" ? "执行完成" : "执行失败"}</dd></div><div><dt>问题类型</dt><dd>{errorLabel(value.result.errorCode)}</dd></div><div><dt>评测版本</dt><dd>{value.result.evaluatorVersion}</dd></div></dl>
      {testPoints === undefined
        ? <p className="notice-line">该历史评测结果生成时尚未记录逐测试点状态，请修改代码后重新评测。</p>
        : <TestPointTable testPoints={testPoints} />}
    </div>;
  }
  const score = quizScore(value.result);
  return <div className="result-stage"><div className="result-header"><div><p className="section-kicker">确定性判分结果</p><h2>{verdictLabel(value.result.verdict)}</h2></div><span className="score-block">{score === null ? "未形成" : score.toFixed(2)}</span></div><p className="feedback-copy">{value.result.safeFeedback}</p><dl className="metric-list horizontal"><div><dt>正确题数</dt><dd>{value.result.correctCount}/{value.result.totalCount}</dd></div><div><dt>通过要求</dt><dd>至少答对 {value.result.requiredCorrectCount} 题</dd></div><div><dt>学习证据</dt><dd>{value.evidenceId === undefined ? "未生成" : "已记录"}</dd></div></dl>{value.result.answerReview === undefined ? null : <section className="answer-review"><h2>提交后安全复盘</h2>{value.result.answerReview.map((item, index) => <div key={item.questionId}><p className="answer-review-prompt"><span>原题</span>{item.prompt ?? "旧版作答记录未保存原题题干"}</p><strong>第 {index + 1} 题 · {item.correct ? "回答正确" : "需要复习"}</strong><p>正确答案：{String(item.correctAnswer)}</p><p><strong>正文解释：</strong>{item.explanation}</p></div>)}</section>}</div>;
}

function testPointStatusLabel(status: ActivityTestPointResult["status"]): string {
  if (status === "passed") return "通过";
  if (status === "failed") return "未通过";
  return "未运行";
}

function TestPointTable({ testPoints }: { testPoints: readonly ActivityTestPointResult[] }) {
  return <section className="test-point-section" aria-labelledby="test-point-heading">
    <div className="test-point-heading">
      <div><p className="section-kicker">逐点结果</p><h3 id="test-point-heading">测试点明细</h3></div>
      <p>公开测试使用题面样例；密封测试只显示结论，不公开输入、预期输出和判定规则。</p>
    </div>
    <div className="test-point-table-wrap">
      <table className="test-point-table">
        <thead><tr><th scope="col">测试点</th><th scope="col">类型</th><th scope="col">状态</th></tr></thead>
        <tbody>{testPoints.map((point) => <tr key={point.pointNumber} data-status={point.status}>
          <th scope="row">#{point.pointNumber}</th>
          <td>{point.scope === "public" ? "公开测试点" : "密封测试点"}</td>
          <td><span className={`test-point-status ${point.status}`}><span aria-hidden="true">{point.status === "passed" ? "✓" : point.status === "failed" ? "×" : "−"}</span>{testPointStatusLabel(point.status)}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function CodeContractView({ activity }: { activity: CodeActivitySafeView }) {
  const criteria = activity.publicAcceptanceCriteria ?? (activity.outputContract === undefined ? [] : [activity.outputContract]);
  const statement = activity.problemStatement;
  return <section className="code-contract" aria-labelledby="code-contract-heading">
    <p className="section-kicker">完整题面</p>
    <h2 id="code-contract-heading">{activity.title}</h2>
    {statement === undefined ? <p role="alert">该代码题缺少正式题面，当前不能提交。请返回教学内容后重试。</p> : <>
      <h3>任务背景</h3>
      <p>{statement.background}</p>
      <div className="code-contract-copy">
        <section><h3>输入说明</h3><p>{statement.inputDescription}</p></section>
        <section><h3>输出说明</h3><p>{statement.outputDescription}</p></section>
      </div>
    </>}
    <dl className="code-contract-grid">
      {activity.entryPoint === undefined ? null : <div><dt>需要实现</dt><dd><code>{activity.entryPoint}</code></dd></div>}
      {activity.outputContract === undefined ? null : <div><dt>返回要求</dt><dd>{activity.outputContract}</dd></div>}
      {activity.allowedLibraries?.length ? <div><dt>可用库</dt><dd>{activity.allowedLibraries.join("、")}</dd></div> : null}
      {activity.editableRegions?.length ? <div><dt>编辑范围</dt><dd>{activity.editableRegions.map((region) => `${region.startMarker} 到 ${region.endMarker}（最多 ${region.maxCharacters} 字符）`).join("；")}</dd></div> : null}
    </dl>
    {statement === undefined ? null : <div className="code-rule-columns">
      <section><h3>处理规则</h3><ol>{statement.rules.map((item) => <li key={item}>{item}</li>)}</ol></section>
      <section><h3>禁止事项</h3><ul>{statement.prohibitedActions.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>}
    {criteria.length === 0 ? null : <><h3>公开验收要点</h3><ul>{criteria.map((item) => <li key={item}>{item}</li>)}</ul></>}
    {statement === undefined ? null : <section className="code-sample" aria-labelledby="code-sample-heading">
      <div className="sample-section-heading"><div><p className="section-kicker">可复验公开样例</p><h3 id="code-sample-heading">完整输入与期望输出 CSV</h3></div><p>页面显示的是完整样例文件，不是截断预览；下载后可直接用表格软件或 pandas 打开。</p></div>
      <div className="code-sample-grid">
        <CsvSample title="处理前 CSV" fileName={statement.sample.inputFileName} content={statement.sample.inputCsv} />
        <CsvSample title="期望输出 CSV" fileName={statement.sample.outputFileName} content={statement.sample.outputCsv} />
      </div>
      <p className="sample-explanation"><strong>样例解释：</strong>{statement.sample.explanation}</p>
    </section>}
  </section>;
}

function CsvSample({ title, fileName, content }: { title: string; fileName: string; content: string }) {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${normalized}`)}`;
  const dataRows = Math.max(0, normalized.trimEnd().split(/\r?\n/u).length - 1);
  return <section className="csv-sample">
    <div className="csv-sample-heading"><div><h4>{title}</h4><span>{dataRows} 行数据 · UTF-8 CSV</span></div><a className="button secondary compact" href={href} download={fileName}>下载完整 CSV</a></div>
    <pre className="lesson-code" aria-label={`${title}完整内容`}><code>{normalized}</code></pre>
    <p className="csv-file-name">文件名：<code>{fileName}</code></p>
  </section>;
}

function questionSourceLabel(source: NonNullable<import("../../contracts/index.js").QuizActivitySafeView["questionSource"]> | undefined): string {
  switch (source) {
    case "ai_recorded": return "AI录制响应题组";
    case "ai_live": return "AI个性化生成题组";
    case "ai_supplemented": return "AI生成 + 固定补位";
    case "profile_fixed": return "固定题保障";
    case "insufficient": return "题量不足";
    default: return "题组来源待确认";
  }
}

function verdictLabel(verdict: string | undefined): string {
  if (verdict === "pass") return "通过";
  if (verdict === "partial") return "部分通过，需要修改";
  if (verdict === "fail") return "未通过，需要重做";
  return "本次未评分";
}

function errorLabel(code: string | undefined): string {
  const labels: Record<string, string> = {
    syntax_error: "语法错误", test_failed: "验收项未通过", timeout: "运行超时",
    output_limit: "输出过多", evaluator_timeout: "评测服务超时", evaluator_error: "评测服务错误",
    submission_contract_error: "提交内容不符合题目合同",
  };
  return code === undefined ? "无" : labels[code] ?? code;
}

function safeFeedbackLabel(feedback: string, errorCode: string | undefined): string {
  if (feedback === "One or more deterministic checks did not pass.") {
    return "公开验收项尚未全部通过。请对照题目要求检查函数返回值、字段规则和允许编辑范围，修改后重新提交。";
  }
  if (feedback === "All deterministic checks passed.") return "全部确定性验收项已通过。";
  return feedback;
}

function progressLabel(status: string): string {
  return status === "completed" ? "已完成" : status === "in_progress" ? "等待重做" : status === "insufficient" ? "证据不足" : "尚未开始";
}

function resultLabel(result: string | undefined): string {
  return result === "pass" ? "通过" : result === "partial" ? "部分通过" : result === "fail" ? "未通过" : result === "insufficient" ? "证据不足" : "尚未判定";
}
