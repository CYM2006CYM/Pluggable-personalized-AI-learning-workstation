import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  ActivityDraftOutput,
  ActivitySubmissionOutput,
  CodeActivityDraftOutput,
  QuizAnswerInput,
} from "../../contracts/index.js";
import { api, isApiError, isEvaluatorFailure, newRequestId, quizScore, type EvaluatorFailureView } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
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

export function ActivityPage() {
  const { sessionId = "", activityId = "" } = useParams<{ sessionId: string; activityId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = useBootstrap(sessionId);
  const [opened, setOpened] = useState<ActivityDraftOutput | undefined>((location.state as { opened?: ActivityDraftOutput } | null)?.opened);
  const [result, setResult] = useState<SubmitResult>();
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [recovering, setRecovering] = useState(false);
  const [recoveryAttempted, setRecoveryAttempted] = useState(false);
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
  }, [activityId, bootstrap.error, bootstrap.loading, opened, result, session, submittedProgress]);

  useEffect(() => {
    const attempt = session?.currentAttempt;
    if (bootstrap.loading || opened !== undefined || recoveryAttempted || session === undefined || attempt?.activityId !== activityId || session.path === undefined) return;
    const { sessionVersion, profileRevision } = session.view;
    const pathVersion = session.path.pathVersion;
    setRecoveryAttempted(true);
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
      setActionError(error instanceof Error ? error : new Error("activity_recovery_failed"));
    }).finally(() => setRecovering(false));
  }, [activityId, bootstrap.loading, opened, recoveryAttempted, session, sessionId]);

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
      if (!isEvaluatorFailure(submitted) && submissionDraft.kind === "code") removeBrowserDraft(submissionDraft.attemptId, clearDraft);
      await bootstrap.reload();
    } catch (error) { await captureActionError(error, "activity_submit_failed"); }
    finally { setBusy(false); }
  };

  const advance = async (retry: boolean) => {
    setBusy(true); setActionError(undefined);
    try {
      const fresh = await api.getBootstrap(sessionId);
      if (fresh.session?.path === undefined) throw new Error("path_not_recoverable");
      const next = await api.getNextStep({ sessionId, sessionVersion: fresh.session.view.sessionVersion, profileRevision: fresh.session.view.profileRevision, pathVersion: fresh.session.path.pathVersion });
      if (next.completed || next.node === undefined || next.activity === undefined) { navigate(`/summary/${sessionId}`); return; }
      if (retry) {
        const nextOpened = await api.openActivity({ requestId: newRequestId("web-open-retry"), sessionId, sessionVersion: next.sessionVersion, profileRevision: next.profileRevision, activityId: next.activity.activityId, activityVersion: next.activity.activityVersion, pathVersion: next.pathVersion, ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }) });
        setOpened(nextOpened); setResult(undefined); setAnswers({});
        navigate(`/activity/${sessionId}/${next.activity.activityId}`, { replace: true, state: { opened: nextOpened, nodeId: next.node.nodeId } });
      } else navigate(`/learn/${sessionId}/${next.node.nodeId}`, { state: { next } });
    } catch (error) { await captureActionError(error, "advance_failed"); }
    finally { setBusy(false); }
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

  const updateCodeDraft = (current: CodeActivityDraftOutput, userText: string) => {
    setDraft(current.attemptId, userText);
    persistBrowserDraft(draftBinding(sessionId, activityId, current), userText);
  };

  const error = actionError ?? bootstrap.error;
  const retryPending = submittedProgress?.status === "in_progress" && submittedProgress.quizRetryCount === 1;
  const refreshBlocked = !bootstrap.loading && !recovering && error === undefined && opened === undefined && session?.currentAttempt?.activityId === activityId;
  const title = opened?.activity.title ?? "活动恢复";
  const summary = opened?.activity.prompt ?? "从服务端 Attempt 安全视图恢复当前活动。";
  return <PageFrame eyebrow={opened?.kind === "quiz" ? "客观题组" : "代码活动"} title={title} summary={summary} actions={<span className="header-badge">{opened?.kind ?? session?.currentAttempt?.kind ?? "loading"}</span>}>
    {bootstrap.loading || recovering ? <PageStatePanel page="activity" state="loading" /> : null}
    {!bootstrap.loading && !recovering && error ? <PageStatePanel page="activity" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); setRecoveryAttempted(false); void bootstrap.reload(); }} /> : null}
    {refreshBlocked ? <PageStatePanel page="activity" state="recovery" code="ACTIVITY_SAFE_VIEW_INCOMPLETE" detail="服务端保留了当前 Attempt，但无法用当前安全 API 重新取得相同活动内容。页面不会创建替代 Attempt。" onRetry={() => { setRecoveryAttempted(false); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && !recovering && error === undefined && !refreshBlocked && opened === undefined && submittedProgress !== undefined ? <section className="state-panel recovery-state" data-state="recovery" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}><p className="state-code">SUBMITTED_PROGRESS_RECOVERED</p><h2>已恢复服务端提交进度</h2><p>该活动状态为 {submittedProgress.status}/{submittedProgress.result ?? "unverified"}。读取服务端下一步后继续，不重建旧 Attempt。</p><button type="button" className="button primary" disabled={busy} onClick={() => void advance(retryPending)}>{retryPending ? "开始新 Attempt 重试" : "进入下一活动"}</button></section> : null}
    {!bootstrap.loading && !recovering && error === undefined && !refreshBlocked && opened === undefined && submittedProgress === undefined ? <PageStatePanel page="activity" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && opened !== undefined ? <div className="activity-layout" data-page="activity">
      <aside className="activity-brief"><p className="section-kicker">ACTIVITY CONTRACT</p><dl className="metric-list"><div><dt>知识点</dt><dd>{opened.activity.primaryKnowledgePointId}</dd></div><div><dt>活动版本</dt><dd>{opened.activity.activityVersion}</dd></div><div><dt>Attempt</dt><dd>{opened.attemptId}</dd></div><div><dt>会话版本</dt><dd>{opened.sessionVersion}</dd></div></dl><p className="notice-line">打开阶段不会显示答案；正式提交后只显示安全复盘字段。</p></aside>
      <div className="activity-workspace"><section className="activity-stage" style={{ minHeight: STABLE_LAYOUT.activityStageMinHeight }}>
        {result !== undefined ? <ResultView value={result} /> : opened.kind === "quiz" ? <>
          <fieldset className="answer-list"><legend className="sr-only">题组答案</legend>{opened.activity.questions.map((question, questionIndex) => <div className="quiz-question" key={question.questionId}><h2>{questionIndex + 1}. {question.prompt}</h2>{question.kind === "judgment" ? [true, false].map((value) => <label className="answer-option" key={String(value)}><input type="radio" name={question.questionId} checked={answers[question.questionId] === value} onChange={() => setAnswers({ ...answers, [question.questionId]: value })} /><span>{value ? "正确" : "错误"}</span></label>) : question.options.map((option) => <label className="answer-option" key={option}><input type="radio" name={question.questionId} checked={answers[question.questionId] === option} onChange={() => setAnswers({ ...answers, [question.questionId]: option })} /><span>{option}</span></label>)}</div>)}</fieldset>
          <div className="section-footer"><span>{completeAnswers.length}/{opened.activity.questions.length} 已回答</span><button type="button" className="button primary" disabled={busy || completeAnswers.length !== opened.activity.questions.length} onClick={() => void submit()}>提交完整题组</button></div>
        </> : <>
          <label htmlFor="code-draft">代码草稿</label>
          <textarea id="code-draft" value={localDraft} onChange={(event) => updateCodeDraft(opened, event.target.value)} spellCheck={false} />
          <div className="notice-line" role="status" data-preview-enabled="false"><strong>PYODIDE_DISABLED_WITH_NODE_FALLBACK</strong><br />浏览器预览未启用；正式评测由本地 Node/Python 执行。</div>
          <div className="section-footer"><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void saveCodeDraft()}>保存草稿</button></div><button type="button" className="button primary" disabled={busy || localDraft === ""} onClick={() => void submit()}>提交正式评测</button></div>
        </>}
        {result !== undefined && isEvaluatorFailure(result) ? <div className="section-footer"><button type="button" className="button primary" disabled={busy || opened.kind !== "code"} onClick={() => void retryEvaluation()}>重新读取草稿后重试</button></div> : result !== undefined ? <div className="section-footer">{result.kind === "quiz" && result.result.retryAllowed ? <button type="button" className="button primary" disabled={busy} onClick={() => void advance(true)}>开始新 Attempt 重试</button> : <button type="button" className="button primary" disabled={busy} onClick={() => void advance(false)}>进入下一活动</button>}</div> : null}
      </section></div>
    </div> : null}
  </PageFrame>;
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
  if (isEvaluatorFailure(value)) return <div className="evaluator-stage" role="alert"><p className="state-code">{value.errorCode}</p><h2>评测器暂时不可用</h2><p>本次未评分，草稿和正式学习状态均不应推进。</p></div>;
  if (value.kind === "code") return <div className="result-stage"><div className="result-header"><div><p className="section-kicker">SERVER VERDICT</p><h2>{value.result.verdict}</h2></div><span className="score-block">{value.result.score} / 1</span></div><p className="feedback-copy">{value.result.safeFeedback}</p><dl className="metric-list horizontal"><div><dt>执行状态</dt><dd>{value.result.executionStatus}</dd></div><div><dt>错误类型</dt><dd>{value.result.errorCode}</dd></div><div><dt>评测版本</dt><dd>{value.result.evaluatorVersion}</dd></div></dl></div>;
  const score = quizScore(value.result);
  return <div className="result-stage"><div className="result-header"><div><p className="section-kicker">SERVER VERDICT</p><h2>{value.result.verdict}</h2></div><span className="score-block">{score === null ? "N/A" : score.toFixed(2)}</span></div><p className="feedback-copy">{value.result.safeFeedback}</p><dl className="metric-list horizontal"><div><dt>正确题数</dt><dd>{value.result.correctCount}/{value.result.totalCount}</dd></div><div><dt>通过阈值</dt><dd>{value.result.requiredCorrectCount}</dd></div><div><dt>Evidence</dt><dd>{value.evidenceId ?? "无"}</dd></div></dl>{value.result.answerReview === undefined ? null : <section className="answer-review"><h2>提交后安全复盘</h2>{value.result.answerReview.map((item) => <div key={item.questionId}><strong>{item.questionId} · {item.correct ? "正确" : "需复习"}</strong><p>正确答案：{String(item.correctAnswer)}</p><p>{item.explanation}</p><small>{item.sourceAnchorIds.join(", ")}</small></div>)}</section>}</div>;
}
