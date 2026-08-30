import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { AgentPipeline, AgentPipelineDiscovery, agentPipelineSummary, type PipelineResourceKind } from "../components/AgentPipeline.js";
import { AGENT_PIPELINE_STATUS_FALLBACK, PIPELINE_DRAWER } from "../copy/learn-page-copy.js";
import { PaperFlip } from "../components/PaperFlip.js";
import { downloadAgentRunExport } from "../api/agent-run-client.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { useAgentRun } from "../hooks/use-agent-run.js";
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
import { relearnNodeIdForActivity } from "../relearn-context.js";
import { buildFlowContext, buildStudyFlow, type StudyFlowView } from "../flow/study-flow.js";
import { stepLabel } from "../copy/ui-copy.js";
import {
  ACTIVITY_SUMMARY_FALLBACK,
  ACTIVITY_TITLE_FALLBACK,
  AGENT_DISCOVERY_PENDING,
  ANSWER_REVIEW_LEGACY_PROMPT,
  ANSWER_REVIEW_ORIGINAL,
  ANSWER_REVIEW_TITLE,
  BACK_TO_LESSON_LABEL,
  BACK_TO_PATH_LABEL,
  CODE_ABANDON_GAP_BUTTON,
  CODE_DRAFT_LABEL,
  CODE_INFO_NOTICE,
  CODE_RESULT_TITLE,
  CODE_RETRY_EVALUATION_BUTTON,
  CODE_RETRY_MODIFIED_BUTTON,
  CODE_SAVE_DRAFT_BUTTON,
  CODE_SUBMIT_BUTTON,
  CONTRACT_ACCEPTANCE_CRITERIA,
  CONTRACT_BACKGROUND,
  CONTRACT_EDITABLE,
  CONTRACT_IMPLEMENT,
  CONTRACT_INPUT,
  CONTRACT_LIBRARIES,
  CONTRACT_MISSING_ALERT,
  CONTRACT_OUTPUT,
  CONTRACT_PROHIBITED,
  CONTRACT_RETURN,
  CONTRACT_RULES,
  CONTRACT_TITLE,
  CONTINUE_NEXT_BUTTON,
  DRAFT_ABSENT_NOTICE,
  DRAFT_KEPT_NOTICE,
  DRAFT_STATE_PREFIX,
  editableRegionsLabel,
  errorKindLabel,
  EVALUATOR_UNAVAILABLE_BODY,
  EVALUATOR_UNAVAILABLE_HEADING,
  EVIDENCE_NOT_GENERATED,
  EVIDENCE_RECORDED,
  EXECUTION_COMPLETED,
  EXECUTION_FAILED,
  FEEDBACK_ANSWER_CORRECT,
  FEEDBACK_ANSWER_WRONG,
  FEEDBACK_STATE,
  FLOW_RETURN_BACK,
  FLOW_RETURN_NEXT,
  FLOW_RETURN_STEP,
  FLOW_RETURN_TITLE,
  flowReturnBackLabel,
  flowReturnNextLabel,
  HEADER_BADGE_LOADING,
  HEADER_BADGE_NODE_PYTHON,
  INFO_CARD_KNOWLEDGE_POINT,
  INFO_CARD_SUMMARY,
  JUDGMENT_FALSE_LABEL,
  JUDGMENT_TRUE_LABEL,
  LEGACY_TEST_POINTS_NOTICE,
  METRIC_CORRECT_COUNT,
  METRIC_EVIDENCE,
  METRIC_EXECUTION,
  METRIC_PASS_REQUIREMENT,
  METRIC_PROBLEM_TYPE,
  NO_POINT_DETAIL,
  PASSED_POINTS_LABEL,
  passRequirementLabel,
  PENDING_ACTION_COPY,
  pendingStatusLabel,
  PYODIDE_CLOSED_CODE,
  PYODIDE_CLOSED_NOTICE,
  QUIZ_INFO_NOTICE,
  QUIZ_LEGEND,
  QUIZ_NEXT_BUTTON,
  QUIZ_PREV_BUTTON,
  QUIZ_RESULT_TITLE,
  QUIZ_RETRY_NEW_SET_BUTTON,
  QUIZ_SKIP_GAP_BUTTON,
  QUIZ_SUBMIT_BUTTON,
  QUIZ_SCORE_NONE,
  quizScoreLabel,
  quizAnsweredLabel,
  quizPagerAriaLabel,
  quizPagerLabel,
  questionSourceLabel,
  RECOVERED_DONE_HEADING,
  RECOVERED_RETRY_HEADING,
  RECOVERED_STATE_CODE,
  recoveredBodyLabel,
  activityProgressLabel,
  activityResultLabel,
  RECOVERY_BODY,
  RECOVERY_CAN_TRY_AGAIN,
  RECOVERY_LIMIT_REACHED,
  RECOVERY_RETRY_BUTTON,
  recoveryCategoryLabel,
  REMEDIATION_IMPROVED,
  REMEDIATION_REGRESSED,
  REMEDIATION_TITLE,
  REMEDIATION_UNCHANGED,
  remediationBodyLabel,
  RETRY_MODIFY_BUTTON,
  SAMPLE_DOWNLOAD_BUTTON,
  SAMPLE_FILE_NAME_PREFIX,
  SAMPLE_HEADING,
  SAMPLE_INPUT_TITLE,
  SAMPLE_KICKER,
  SAMPLE_NOTE,
  SAMPLE_OUTPUT_TITLE,
  sampleCsvAriaLabel,
  sampleExplanationLabel,
  sampleRowsLabel,
  safeFeedbackLabel,
  TEST_POINT_COL_STATUS,
  TEST_POINT_COL_TEST,
  TEST_POINT_COL_TYPE,
  TEST_POINT_GLYPH,
  TEST_POINT_HEADING,
  TEST_POINT_KICKER,
  TEST_POINT_NOTE,
  TEST_POINT_SCOPE_PUBLIC,
  TEST_POINT_SCOPE_SEALED,
  testPointStatusLabel,
  verdictLabel,
  answerReviewIndexLabel,
  correctAnswerLabel,
  explanationLabel,
  activityEyebrowLabel,
} from "../copy/activity-page-copy.js";
import "./ActivityPage.css";

type SubmitResult = ActivitySubmissionOutput | EvaluatorFailureView;
type PendingAction = "advance" | "continue_with_gap";
const MAX_RECOVERY_ATTEMPTS = 2;

export function ActivityPage() {
  const { sessionId = "", activityId = "" } = useParams<{ sessionId: string; activityId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = useBootstrap(sessionId);
  const routeState = (location.state as { opened?: ActivityDraftOutput; nodeId?: string; relearnNodeId?: string } | null);
  const [opened, setOpened] = useState<ActivityDraftOutput | undefined>(routeState?.opened);
  const [result, setResult] = useState<SubmitResult>();
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [quizFlipForward, setQuizFlipForward] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [actionError, setActionError] = useState<Error>();
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<Error>();
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const [recoveryTrigger, setRecoveryTrigger] = useState(0);
  const [agentRequestId, setAgentRequestId] = useState<string>();
  const actionProgress = useAsyncActionProgress();
  const agentRun = useAgentRun({
    requestId: agentRequestId,
    runId: agentRequestId === undefined && opened?.kind === "quiz" ? opened.activity.agentRunId : undefined,
    active: busy || opened?.kind === "quiz",
  });
  const routeStateChecked = useRef<string>();
  const initializedDraftBinding = useRef<string>();
  const drafts = useUiStore((state) => state.activityDrafts);
  const setDraft = useUiStore((state) => state.setActivityDraft);
  const clearDraft = useUiStore((state) => state.clearActivityDraft);
  const session = bootstrap.data?.session;
  const relearnNodeId = routeState?.relearnNodeId ?? relearnNodeIdForActivity(session, activityId);
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
    api.getNextStep({ sessionId, sessionVersion, profileRevision, pathVersion, ...(relearnNodeId === undefined ? {} : { nodeId: relearnNodeId }) }).then(async (next) => {
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
        ...(next.relearnAllowed === true ? { relearn: true } : {}),
      });
    }).then((recovered) => {
      if (recovered.attemptId !== attempt.attemptId) throw new Error("attempt_identity_changed_during_recovery");
      setOpened(recovered);
    }).catch((error: unknown) => {
      setRecoveryError(error instanceof Error ? error : new Error("activity_recovery_failed"));
    }).finally(() => setRecovering(false));
  }, [activityId, bootstrap.loading, opened, recovering, recoveryAttempts, recoveryError, recoveryTrigger, relearnNodeId, session, sessionId]);

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
    actionProgress.start(opened.kind === "code" ? PENDING_ACTION_COPY.submittingCode : PENDING_ACTION_COPY.submittingQuiz);
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
    finally { actionProgress.stop(); setBusy(false); }
  };

  const advance = async (retry: boolean) => {
    setBusy(true); setPendingAction("advance"); setActionError(undefined);
    actionProgress.start(retry ? PENDING_ACTION_COPY.confirmingRetry : PENDING_ACTION_COPY.preparingNext);
    try {
      const fresh = await api.getBootstrap(sessionId);
      if (fresh.session?.path === undefined) throw new Error("path_not_recoverable");
      const relearnNode = relearnNodeId === undefined ? undefined : fresh.session.path.nodes.find((node) => node.nodeId === relearnNodeId);
      const continueRelearning = relearnNode !== undefined && (retry || relearnNode.activityIds.at(-1) !== activityId);
      const next = await api.getNextStep({
        sessionId,
        sessionVersion: fresh.session.view.sessionVersion,
        profileRevision: fresh.session.view.profileRevision,
        pathVersion: fresh.session.path.pathVersion,
        ...(continueRelearning ? { nodeId: relearnNodeId } : {}),
      });
      if (next.completed || next.node === undefined || next.activity === undefined) { navigate(`/summary/${sessionId}`); return; }
      const currentNodeId = fresh.session.path.nodes.find((node) => node.activityIds.includes(activityId))?.nodeId;
      const continueInsideNode = retry || currentNodeId === next.node.nodeId;
      if (continueInsideNode) {
        actionProgress.update(next.activity.kind === "mcq"
          ? retry ? PENDING_ACTION_COPY.generatingNewQuizSet : PENDING_ACTION_COPY.preparingQuizSet
          : PENDING_ACTION_COPY.preparingCodeActivity);
        const openRequestId = newRequestId("web-open-retry");
        setAgentRequestId(next.activity.kind === "mcq" ? openRequestId : undefined);
        const nextOpened = await api.openActivity({ requestId: openRequestId, sessionId, sessionVersion: next.sessionVersion, profileRevision: next.profileRevision, activityId: next.activity.activityId, activityVersion: next.activity.activityVersion, pathVersion: next.pathVersion, ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }), ...(next.relearnAllowed === true ? { relearn: true } : {}) });
        setOpened(nextOpened); setResult(undefined); setAnswers({}); setQuestionIndex(0);
        setAgentRequestId(undefined);
        navigate(`/activity/${sessionId}/${next.activity.activityId}`, { replace: true, state: { opened: nextOpened, nodeId: next.node.nodeId, ...(continueRelearning ? { relearnNodeId } : {}) } });
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
    actionProgress.start(PENDING_ACTION_COPY.recordingGap);
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
  const title = opened?.activity.title ?? ACTIVITY_TITLE_FALLBACK;
  const summary = opened?.activity.prompt ?? ACTIVITY_SUMMARY_FALLBACK;
  const activityNodeId = session?.path?.nodes.find((node) => node.activityIds.includes(activityId))?.nodeId
    ?? (location.state as { nodeId?: string } | null)?.nodeId;
  const currentQuestion = opened?.kind === "quiz" ? opened.activity.questions[questionIndex] : undefined;
  const codeNeedsRetry = result !== undefined && !isEvaluatorFailure(result) && result.kind === "code" && result.result.verdict !== "pass";
  const codeCanContinueWithGap = codeNeedsRetry && (submittedProgress?.attemptIds.length ?? 0) >= 2;
  const flowContext = buildFlowContext(session, {
    currentStep: "activity",
    activeNodeId: activityNodeId,
    hasActivity: opened !== undefined,
  });
  const flowView = buildStudyFlow(session?.path?.nodes ?? [], flowContext);

  /*
   * 流水线收纳:与学习页同一套「默认收纳成状态带、展开即完整八工位工作台」。
   * 活动页的主角是题目本身,机房不该喧宾夺主;运行失败时自动展开。
   */
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const pipelineFailed = agentRun.run?.status === "failed";
  useEffect(() => {
    if (pipelineFailed) setPipelineOpen(true);
  }, [pipelineFailed]);
  // 本页的运行要么服务本轮题组要么服务代码批改,标签沿用题组口径。
  const pipelineResourceKind: PipelineResourceKind = "quiz";
  const pipelineBody = agentRun.run !== undefined
    ? <AgentPipeline run={agentRun.run} mode={agentRun.transport === "complete" ? "snapshot" : "live"} resourceKind={pipelineResourceKind} onExport={() => downloadAgentRunExport(agentRun.run!.runId).then(() => undefined)} />
    : agentRequestId !== undefined
      ? <AgentPipelineDiscovery resourceKind={pipelineResourceKind} statusText={actionProgress.text ?? AGENT_DISCOVERY_PENDING} />
      : null;
  const pipelineSummary = agentPipelineSummary(
    agentRun.run,
    pipelineResourceKind,
    agentRun.run === undefined && agentRequestId !== undefined
      ? actionProgress.text ?? AGENT_PIPELINE_STATUS_FALLBACK
      : undefined,
  );
  const pipeline = pipelineBody === null ? null : <details
    className="pipeline-drawer"
    data-state={pipelineSummary.state}
    open={pipelineOpen}
  >
    <summary onClick={(event) => { event.preventDefault(); setPipelineOpen((open) => !open); }} aria-label={PIPELINE_DRAWER.toggleAria}>
      <span className="kicker-dot drawer-dot" aria-hidden="true" />
      <span className="pipeline-drawer-title">{PIPELINE_DRAWER.title}</span>
      <span className="pipeline-drawer-status" role="status">{pipelineSummary.text}</span>
      <span className="pipeline-drawer-toggle" aria-hidden="true">{pipelineOpen ? PIPELINE_DRAWER.collapse : PIPELINE_DRAWER.view}</span>
    </summary>
    <div className="pipeline-drawer-body">{pipelineBody}</div>
  </details>;

  /*
   * 头部徽章只在「有话可说」时出现:「加载中」仅属于真实加载/恢复中,
   * 空态与错误态不再残留一枚永远转不完的假加载徽章。
   */
  const headerBadgeLabel = bootstrap.loading || recovering
    ? HEADER_BADGE_LOADING
    : opened?.kind === "quiz" ? questionSourceLabel(opened.activity.questionSource)
      : opened?.kind === "code" ? HEADER_BADGE_NODE_PYTHON
        : submittedProgress !== undefined ? activityProgressLabel(submittedProgress.status)
          : undefined;
  return <PageFrame eyebrow={activityEyebrowLabel(opened?.activity.kind)} title={title} summary={summary} back={{ to: activityNodeId === undefined ? `/path/${sessionId}` : `/learn/${sessionId}/${activityNodeId}`, label: BACK_TO_LESSON_LABEL }} actions={headerBadgeLabel === undefined ? undefined : <span className="header-badge">{headerBadgeLabel}</span>}>
    {bootstrap.loading || recovering ? <PageStatePanel page="activity" state="loading" /> : null}
    {!bootstrap.loading && !recovering && error ? <PageStatePanel page="activity" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && !recovering && error === undefined && recoveryError !== undefined ? <ActivityRecoveryFailure error={recoveryError} attempts={recoveryAttempts} hasBrowserDraft={localDraft.length > 0} activityNodeId={activityNodeId} sessionId={sessionId} onRetry={() => { setRecoveryError(undefined); setRecoveryTrigger((current) => current + 1); }} /> : null}
    {refreshBlocked ? <ActivityRecoveryFailure error={new Error("ACTIVITY_SAFE_VIEW_INCOMPLETE")} attempts={recoveryAttempts} hasBrowserDraft={localDraft.length > 0} activityNodeId={activityNodeId} sessionId={sessionId} /> : null}
    {!bootstrap.loading && !recovering && error === undefined && recoveryError === undefined && !refreshBlocked && opened === undefined && submittedProgress !== undefined ? <section className="state-panel recovery-state activity-state-panel" data-state="recovery" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}><p className="state-code">{RECOVERED_STATE_CODE}</p><h2>{retryPending ? RECOVERED_RETRY_HEADING : RECOVERED_DONE_HEADING}</h2><p>{recoveredBodyLabel(activityProgressLabel(submittedProgress.status), activityResultLabel(submittedProgress.result))}</p><div className="button-row">{activityNodeId === undefined ? null : <button type="button" className="button secondary" onClick={() => navigate(`/learn/${sessionId}/${activityNodeId}`)}>{BACK_TO_LESSON_LABEL}</button>}<button type="button" className="button primary" disabled={busy} onClick={() => void advance(retryPending)}>{retryPending ? RETRY_MODIFY_BUTTON : CONTINUE_NEXT_BUTTON}</button></div></section> : null}
    {!bootstrap.loading && !recovering && error === undefined && recoveryError === undefined && !refreshBlocked && opened === undefined && submittedProgress === undefined ? <PageStatePanel page="activity" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && recoveryError === undefined && pipeline !== null ? <div className="activity-pipeline-slot">{pipeline}</div> : null}
    {!bootstrap.loading && error === undefined && recoveryError === undefined && opened !== undefined ? <div className="activity-layout" data-page="activity">
      <aside className="activity-brief">
        <details className="activity-info activity-card">
          <summary>{INFO_CARD_SUMMARY}</summary>
          <dl className="metric-list"><div><dt>{INFO_CARD_KNOWLEDGE_POINT}</dt><dd>{knowledgePointLabel(opened.activity.primaryKnowledgePointId)}</dd></div></dl>
          <p className="notice-line">{opened.kind === "quiz" ? QUIZ_INFO_NOTICE : CODE_INFO_NOTICE}</p>
        </details>
        <FlowReturnCard flow={flowView} activeNodeId={activityNodeId} />
      </aside>
      <div className="activity-workspace">
        <div className="activity-toolbar" style={{ minHeight: STABLE_LAYOUT.activityTabsHeight }}>
          <span className="kind-badge">{activityEyebrowLabel(opened.activity.kind)}</span>
          {opened.kind === "quiz" && result === undefined && currentQuestion !== undefined
            ? <div className="quiz-pager" aria-label={quizPagerAriaLabel(questionIndex + 1, opened.activity.questions.length)}><span>{quizPagerLabel(questionIndex + 1, opened.activity.questions.length)}</span><span>{quizAnsweredLabel(completeAnswers.length)}</span></div>
            : null}
        </div>
        <section className="activity-stage" style={{ minHeight: STABLE_LAYOUT.activityStageMinHeight }}>
          {actionProgress.active ? <p className="async-action-status feedback-status" data-state={FEEDBACK_STATE.pending} role="status" aria-live="polite">{actionProgress.text}</p> : null}
          {result !== undefined ? <ResultView value={result} /> : opened.kind === "quiz" && currentQuestion !== undefined ? <>
            <fieldset className="answer-list"><legend className="sr-only">{QUIZ_LEGEND}</legend><PaperFlip key={currentQuestion.questionId} direction={quizFlipForward ? 1 : -1} className="quiz-question"><h2>{currentQuestion.prompt}</h2>{currentQuestion.kind === "judgment" ? [true, false].map((value) => <label className="answer-option" key={String(value)}><input type="radio" name={currentQuestion.questionId} checked={answers[currentQuestion.questionId] === value} onChange={() => setAnswers({ ...answers, [currentQuestion.questionId]: value })} /><span>{value ? JUDGMENT_TRUE_LABEL : JUDGMENT_FALSE_LABEL}</span></label>) : currentQuestion.options.map((option, index) => <label className="answer-option" key={option}><input type="radio" name={currentQuestion.questionId} checked={answers[currentQuestion.questionId] === option} onChange={() => setAnswers({ ...answers, [currentQuestion.questionId]: option })} /><span className="option-key">{String.fromCharCode(65 + index)}</span><span className="option-copy">{option}</span></label>)}</PaperFlip></fieldset>
            <div className="section-footer"><button type="button" className="button secondary" disabled={busy || questionIndex === 0} onClick={() => { setQuizFlipForward(false); setQuestionIndex((current) => Math.max(0, current - 1)); }}>{QUIZ_PREV_BUTTON}</button>{questionIndex < opened.activity.questions.length - 1 ? <button type="button" className="button primary" disabled={busy || answers[currentQuestion.questionId] === undefined} onClick={() => { setQuizFlipForward(true); setQuestionIndex((current) => current + 1); }}>{QUIZ_NEXT_BUTTON}</button> : <button type="button" className="button primary async-action-button" disabled={busy || completeAnswers.length !== opened.activity.questions.length} onClick={() => void submit()}>{busy ? actionProgress.text ?? pendingStatusLabel(PENDING_ACTION_COPY.submittingQuiz, 0) : QUIZ_SUBMIT_BUTTON}</button>}</div>
          </> : opened.kind === "code" ? <>
            <CodeContractView activity={opened.activity} />
            <label htmlFor="code-draft">{CODE_DRAFT_LABEL}</label>
            <textarea id="code-draft" value={localDraft} onChange={(event) => updateCodeDraft(opened, event.target.value)} spellCheck={false} />
            <div className="notice-line" role="status" data-preview-enabled="false"><strong>{PYODIDE_CLOSED_CODE}</strong><br />{PYODIDE_CLOSED_NOTICE}</div>
            <div className="section-footer"><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void saveCodeDraft()}>{CODE_SAVE_DRAFT_BUTTON}</button></div><button type="button" className="button primary async-action-button" disabled={busy || localDraft === ""} onClick={() => void submit()}>{busy ? actionProgress.text ?? pendingStatusLabel(PENDING_ACTION_COPY.submittingCode, 0) : CODE_SUBMIT_BUTTON}</button></div>
          </> : null}
          {result !== undefined && isEvaluatorFailure(result) ? <div className="section-footer"><button type="button" className="button secondary" onClick={() => activityNodeId === undefined ? navigate(`/path/${sessionId}`) : navigate(`/learn/${sessionId}/${activityNodeId}`)}>{BACK_TO_LESSON_LABEL}</button><button type="button" className="button primary" disabled={busy || opened.kind !== "code"} onClick={() => void retryEvaluation()}>{CODE_RETRY_EVALUATION_BUTTON}</button></div>
            : codeNeedsRetry ? <div className="section-footer"><button type="button" className="button secondary" onClick={() => activityNodeId === undefined ? navigate(`/path/${sessionId}`) : navigate(`/learn/${sessionId}/${activityNodeId}`)}>{BACK_TO_LESSON_LABEL}</button><div className="button-row">{codeCanContinueWithGap ? <button type="button" className="button secondary async-action-button" disabled={busy} onClick={() => void continueWithGap()}>{pendingAction === "continue_with_gap" ? actionProgress.text : CODE_ABANDON_GAP_BUTTON}</button> : null}<button type="button" className="button primary async-action-button" disabled={busy} onClick={() => void advance(true)}>{pendingAction === "advance" ? actionProgress.text : CODE_RETRY_MODIFIED_BUTTON}</button></div></div>
              : result !== undefined ? <div className="section-footer">{result.kind === "quiz" && result.result.retryAllowed ? <div className="button-row">{opened.kind === "quiz" && opened.activity.retryNumber >= 1 ? <button type="button" className="button secondary async-action-button" disabled={busy} onClick={() => void continueWithGap()}>{pendingAction === "continue_with_gap" ? actionProgress.text : QUIZ_SKIP_GAP_BUTTON}</button> : null}<button type="button" className="button primary async-action-button" disabled={busy} onClick={() => void advance(true)}>{pendingAction === "advance" ? actionProgress.text : QUIZ_RETRY_NEW_SET_BUTTON}</button></div> : <button type="button" className="button primary" disabled={busy} onClick={() => void advance(false)}>{CONTINUE_NEXT_BUTTON}</button>}</div> : null}
        </section>
      </div>
    </div> : null}
  </PageFrame>;
}

/** 当前位置与下一步：告诉用户当前环节、做完回到哪一节、接下来去哪。 */
function FlowReturnCard({ flow, activeNodeId }: { flow: StudyFlowView; activeNodeId?: string }) {
  return <section className="flow-return activity-card" aria-label={FLOW_RETURN_TITLE}>
    <h3 className="flow-return-title">{FLOW_RETURN_TITLE}</h3>
    <dl className="flow-return-list">
      <div><dt>{FLOW_RETURN_STEP}</dt><dd>{stepLabel("activity")}</dd></div>
      <div><dt>{FLOW_RETURN_BACK}</dt><dd>{flowReturnBackLabel(flow, activeNodeId)}</dd></div>
      <div><dt>{FLOW_RETURN_NEXT}</dt><dd>{flowReturnNextLabel(flow)}</dd></div>
    </dl>
  </section>;
}

/** 统一反馈状态节点：文案与 class 的单一调用点，动效由 ticket 15 在此挂载。 */
function FeedbackStatus({ state, children }: { state: string; children: ReactNode }) {
  return <span className="feedback-status" data-state={state}>{children}</span>;
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
  const category = recoveryCategoryLabel(isApiError(error) ? { status: error.status } : { message: error.message });
  const canRetry = attempts < MAX_RECOVERY_ATTEMPTS && onRetry !== undefined;
  return <section className="state-panel recovery-state activity-state-panel" data-state="recovery-error" role="alert" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
    <p className="state-code">{isApiError(error) ? error.code : error.message}</p>
    <h2>{category}</h2>
    <p>{RECOVERY_BODY}{attempts >= MAX_RECOVERY_ATTEMPTS ? RECOVERY_LIMIT_REACHED : RECOVERY_CAN_TRY_AGAIN}</p>
    <p className="notice-line"><strong>{DRAFT_STATE_PREFIX}</strong>{hasBrowserDraft ? DRAFT_KEPT_NOTICE : DRAFT_ABSENT_NOTICE}</p>
    <div className="button-row">{canRetry ? <button type="button" className="button primary" onClick={onRetry}>{RECOVERY_RETRY_BUTTON}</button> : null}{activityNodeId === undefined ? null : <Link className="button secondary" to={`/learn/${sessionId}/${activityNodeId}`}>{BACK_TO_LESSON_LABEL}</Link>}<Link className="button secondary" to={`/path/${sessionId}`}>{BACK_TO_PATH_LABEL}</Link></div>
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
  if (isEvaluatorFailure(value)) return <div className="evaluator-stage" data-state={FEEDBACK_STATE.error} role="alert"><p className="state-code">{errorKindLabel(value.errorCode)}</p><h2>{EVALUATOR_UNAVAILABLE_HEADING}</h2><p>{EVALUATOR_UNAVAILABLE_BODY}</p></div>;
  if (value.kind === "code") {
    const testPoints = value.result.testPoints;
    const passedCount = testPoints?.filter((point) => point.status === "passed").length;
    return <div className="result-stage" data-state={verdictFeedbackState(value.result.verdict)}>
      <div className="result-header">
        <div><p className="section-kicker">{CODE_RESULT_TITLE}</p><h2>{verdictLabel(value.result.verdict)}</h2></div>
        <span className="score-block">{testPoints === undefined ? NO_POINT_DETAIL : `${passedCount} / ${testPoints.length}`}<small>{PASSED_POINTS_LABEL}</small></span>
      </div>
      <p className="feedback-copy">{safeFeedbackLabel(value.result.safeFeedback, value.result.errorCode)}</p>
      <dl className="metric-list horizontal"><div><dt>{METRIC_EXECUTION}</dt><dd><FeedbackStatus state={value.result.executionStatus === "completed" ? FEEDBACK_STATE.success : FEEDBACK_STATE.error}>{value.result.executionStatus === "completed" ? EXECUTION_COMPLETED : EXECUTION_FAILED}</FeedbackStatus></dd></div><div><dt>{METRIC_PROBLEM_TYPE}</dt><dd>{errorKindLabel(value.result.errorCode)}</dd></div></dl>
      {testPoints === undefined
        ? <p className="notice-line">{LEGACY_TEST_POINTS_NOTICE}</p>
        : <TestPointTable testPoints={testPoints} />}
    </div>;
  }
  const score = quizScore(value.result);
  return <div className="result-stage" data-state={verdictFeedbackState(value.result.verdict)}><div className="result-header"><div><p className="section-kicker">{QUIZ_RESULT_TITLE}</p><h2>{verdictLabel(value.result.verdict)}</h2></div><span className="score-block">{score === null ? QUIZ_SCORE_NONE : quizScoreLabel(score)}</span></div><p className="feedback-copy">{value.result.safeFeedback}</p><dl className="metric-list horizontal"><div><dt>{METRIC_CORRECT_COUNT}</dt><dd>{value.result.correctCount}/{value.result.totalCount}</dd></div><div><dt>{METRIC_PASS_REQUIREMENT}</dt><dd>{passRequirementLabel(value.result.requiredCorrectCount)}</dd></div><div><dt>{METRIC_EVIDENCE}</dt><dd>{value.evidenceId === undefined ? EVIDENCE_NOT_GENERATED : EVIDENCE_RECORDED}</dd></div></dl>{value.result.remediationOutcome === undefined ? null : <section className={`remediation-outcome is-${value.result.remediationOutcome.status}`} data-state={value.result.remediationOutcome.status} aria-label={REMEDIATION_TITLE}><div><span>{REMEDIATION_TITLE}</span><strong>{value.result.remediationOutcome.status === "improved" ? REMEDIATION_IMPROVED : value.result.remediationOutcome.status === "regressed" ? REMEDIATION_REGRESSED : REMEDIATION_UNCHANGED}</strong></div><p>{remediationBodyLabel(value.result.remediationOutcome.previousMissedQuestionCount, value.result.remediationOutcome.currentMissedQuestionCount, value.result.remediationOutcome.stillWeakKnowledgePointIds)}</p></section>}{value.result.answerReview === undefined ? null : <section className="answer-review"><h2>{ANSWER_REVIEW_TITLE}</h2>{value.result.answerReview.map((item, index) => <div key={item.questionId}><p className="answer-review-prompt"><span>{ANSWER_REVIEW_ORIGINAL}</span>{item.prompt ?? ANSWER_REVIEW_LEGACY_PROMPT}</p><FeedbackStatus state={item.correct ? FEEDBACK_STATE.correct : FEEDBACK_STATE.wrong}><strong>{answerReviewIndexLabel(index)}{item.correct ? FEEDBACK_ANSWER_CORRECT : FEEDBACK_ANSWER_WRONG}</strong></FeedbackStatus><p>{correctAnswerLabel(item.correctAnswer)}</p><p><strong>{explanationLabel(item.explanation)}</strong></p></div>)}</section>}</div>;
}

/** 判分结论 → 统一反馈状态词表。 */
function verdictFeedbackState(verdict: string | undefined): string {
  if (verdict === "pass") return FEEDBACK_STATE.success;
  if (verdict === "partial") return FEEDBACK_STATE.warning;
  if (verdict === "fail" || verdict === "not_graded") return FEEDBACK_STATE.error;
  return FEEDBACK_STATE.neutral;
}

function TestPointTable({ testPoints }: { testPoints: readonly ActivityTestPointResult[] }) {
  return <section className="test-point-section" aria-labelledby="test-point-heading">
    <div className="test-point-heading">
      <div><p className="section-kicker">{TEST_POINT_KICKER}</p><h3 id="test-point-heading">{TEST_POINT_HEADING}</h3></div>
      <p>{TEST_POINT_NOTE}</p>
    </div>
    <div className="test-point-table-wrap">
      <table className="test-point-table">
        <thead><tr><th scope="col">{TEST_POINT_COL_TEST}</th><th scope="col">{TEST_POINT_COL_TYPE}</th><th scope="col">{TEST_POINT_COL_STATUS}</th></tr></thead>
        <tbody>{testPoints.map((point) => <tr key={point.pointNumber} data-status={point.status}>
          <th scope="row">#{point.pointNumber}</th>
          <td>{point.scope === "public" ? TEST_POINT_SCOPE_PUBLIC : TEST_POINT_SCOPE_SEALED}</td>
          <td><FeedbackStatus state={point.status === "passed" ? FEEDBACK_STATE.passed : point.status === "failed" ? FEEDBACK_STATE.failed : FEEDBACK_STATE.notRun}><span className="test-point-status"><span aria-hidden="true">{point.status === "passed" ? TEST_POINT_GLYPH.passed : point.status === "failed" ? TEST_POINT_GLYPH.failed : TEST_POINT_GLYPH.not_run}</span>{testPointStatusLabel(point.status)}</span></FeedbackStatus></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function CodeContractView({ activity }: { activity: CodeActivitySafeView }) {
  const criteria = activity.publicAcceptanceCriteria ?? (activity.outputContract === undefined ? [] : [activity.outputContract]);
  const statement = activity.problemStatement;
  return <section className="code-contract" aria-labelledby="code-contract-heading">
    <p className="section-kicker">{CONTRACT_TITLE}</p>
    <h2 id="code-contract-heading">{activity.title}</h2>
    {statement === undefined ? <p role="alert">{CONTRACT_MISSING_ALERT}</p> : <>
      <h3>{CONTRACT_BACKGROUND}</h3>
      <p>{statement.background}</p>
      <div className="code-contract-copy">
        <section><h3>{CONTRACT_INPUT}</h3><p>{statement.inputDescription}</p></section>
        <section><h3>{CONTRACT_OUTPUT}</h3><p>{statement.outputDescription}</p></section>
      </div>
    </>}
    <dl className="code-contract-grid">
      {activity.entryPoint === undefined ? null : <div><dt>{CONTRACT_IMPLEMENT}</dt><dd><code>{activity.entryPoint}</code></dd></div>}
      {activity.outputContract === undefined ? null : <div><dt>{CONTRACT_RETURN}</dt><dd>{activity.outputContract}</dd></div>}
      {activity.allowedLibraries?.length ? <div><dt>{CONTRACT_LIBRARIES}</dt><dd>{activity.allowedLibraries.join("、")}</dd></div> : null}
      {activity.editableRegions?.length ? <div><dt>{CONTRACT_EDITABLE}</dt><dd>{editableRegionsLabel(activity.editableRegions)}</dd></div> : null}
    </dl>
    {statement === undefined ? null : <div className="code-rule-columns">
      <section><h3>{CONTRACT_RULES}</h3><ol>{statement.rules.map((item) => <li key={item}>{item}</li>)}</ol></section>
      <section><h3>{CONTRACT_PROHIBITED}</h3><ul>{statement.prohibitedActions.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>}
    {criteria.length === 0 ? null : <><h3>{CONTRACT_ACCEPTANCE_CRITERIA}</h3><ul>{criteria.map((item) => <li key={item}>{item}</li>)}</ul></>}
    {statement === undefined ? null : <details className="code-sample" aria-labelledby="code-sample-heading">
      <summary><div className="sample-section-heading"><div><p className="section-kicker">{SAMPLE_KICKER}</p><h3 id="code-sample-heading">{SAMPLE_HEADING}</h3></div><p>{SAMPLE_NOTE}</p></div></summary>
      <div className="code-sample-grid">
        <CsvSample title={SAMPLE_INPUT_TITLE} fileName={statement.sample.inputFileName} content={statement.sample.inputCsv} />
        <CsvSample title={SAMPLE_OUTPUT_TITLE} fileName={statement.sample.outputFileName} content={statement.sample.outputCsv} />
      </div>
      <p className="sample-explanation"><strong>{sampleExplanationLabel(statement.sample.explanation)}</strong></p>
    </details>}
  </section>;
}

function CsvSample({ title, fileName, content }: { title: string; fileName: string; content: string }) {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${normalized}`)}`;
  const dataRows = Math.max(0, normalized.trimEnd().split(/\r?\n/u).length - 1);
  return <section className="csv-sample">
    <div className="csv-sample-heading"><div><h4>{title}</h4><span>{sampleRowsLabel(dataRows)}</span></div><a className="button secondary compact" href={href} download={fileName}>{SAMPLE_DOWNLOAD_BUTTON}</a></div>
    <pre className="lesson-code" aria-label={sampleCsvAriaLabel(title)}><code>{normalized}</code></pre>
    <p className="csv-file-name">{SAMPLE_FILE_NAME_PREFIX}<code>{fileName}</code></p>
  </section>;
}