import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  LearningCardSafeView,
  LessonContentBlock,
  LessonModule,
  LessonModuleId,
  LessonVariantId,
  NextStepOutput,
  PersonalizedLessonTip,
  SelectedLessonSafeView,
} from "../../contracts/index.js";
import { isSelfContainedGuidingQuestion } from "../../domain/personalized-lesson-guide.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { AgentPipeline, AgentPipelineDiscovery } from "../components/AgentPipeline.js";
import { downloadAgentRunExport } from "../api/agent-run-client.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { useAgentRun } from "../hooks/use-agent-run.js";
import { activityKindLabel, contentReadinessLabel } from "../learning-labels.js";
import { relearnNodeIdForActivity } from "../relearn-context.js";
import { AGENT_PIPELINE_STATUS_FALLBACK, LEARN_PAGE_COPY, requestErrorLabel } from "../copy/learn-page-copy.js";
import "./LearnPage.css";

const DEFAULT_OPEN_MODULES: Record<LessonVariantId, readonly LessonModuleId[]> = {
  guided: ["intuition", "concepts", "walkthrough"],
  concise: ["intuition", "final-task"],
  practice: ["intuition", "walkthrough", "final-task"],
};

/** 误区与术语依据收进折叠信息卡,其余模块构成正文阅读区。 */
const INFO_MODULE_IDS: ReadonlySet<LessonModuleId> = new Set(["mistakes", "terms-sources"]);

function LessonBlockView({ block }: { block: LessonContentBlock }) {
  if (block.kind === "subheading") return <h3 className="lesson-subheading">{block.text}</h3>;
  if (block.kind === "paragraph") return <p className="lesson-paragraph">{block.text}</p>;
  if (block.kind === "code") return <pre className="lesson-code" aria-label={LEARN_PAGE_COPY.codeAriaLabel}><code>{block.code}</code></pre>;
  if (block.kind === "list") {
    const items = block.items.map((item, index) => <li key={`${block.blockId}-${index}`}>{item}</li>);
    return block.ordered ? <ol className="lesson-list">{items}</ol> : <ul className="lesson-list">{items}</ul>;
  }
  return <aside className={`lesson-callout ${block.tone}`}><strong>{block.title}</strong><p>{block.text}</p></aside>;
}

function LessonModuleView({
  module,
  open,
  onToggle,
  lesson,
}: {
  module: LessonModule;
  open: boolean;
  onToggle: (open: boolean) => void;
  lesson: SelectedLessonSafeView;
}) {
  const isInfo = INFO_MODULE_IDS.has(module.moduleId);
  const showsReferences = module.moduleId === "terms-sources";
  return <details className={`lesson-module${isInfo ? " is-info" : ""}`} open={open}>
    <summary aria-expanded={open} onClick={(event) => { event.preventDefault(); onToggle(!open); }}><span>{module.title}</span><small>{module.summary}</small></summary>
    <div className="lesson-module-body">
      {module.blocks.map((block) => <LessonBlockView block={block} key={block.blockId} />)}
      {showsReferences ? <>
        <h3 className="lesson-subheading">{LEARN_PAGE_COPY.termsHeading}</h3>
        <dl className="lesson-terms">{lesson.termNotes.map((note) => <div key={note.term}><dt>{note.term}</dt><dd>{note.explanation}</dd></div>)}</dl>
        <h3 className="lesson-subheading">{LEARN_PAGE_COPY.sourcesHeading}</h3>
        <ul className="lesson-sources">{lesson.sourceClaims.map((claim) => <li key={claim.claimId}><span>{claim.statement}</span></li>)}</ul>
      </> : null}
    </div>
  </details>;
}

function hasStructuredLessonGuideBody(tip: PersonalizedLessonTip | undefined): boolean {
  return tip?.lessonOverview !== undefined
    && tip.priorConnection !== undefined
    && tip.learningFocus !== undefined
    && tip.nextConnection !== undefined
    && tip.studyAdvice !== undefined;
}

function hasStructuredLessonGuide(tip: PersonalizedLessonTip | undefined): boolean {
  return hasStructuredLessonGuideBody(tip) && isSelfContainedGuidingQuestion(tip?.guidingQuestion);
}

function PersonalizedLessonGuide({ tip }: { tip: PersonalizedLessonTip }) {
  if (!hasStructuredLessonGuideBody(tip)) return <p>{tip.text}</p>;
  const guidingQuestionReady = isSelfContainedGuidingQuestion(tip.guidingQuestion);
  return <div className="lesson-guide">
    <p className="lesson-guide-overview">{tip.lessonOverview}</p>
    <div className="lesson-guide-grid">
      <section><span>{LEARN_PAGE_COPY.guidePrior}</span><p>{tip.priorConnection}</p></section>
      <section><span>{LEARN_PAGE_COPY.guideFocus}</span><p>{tip.learningFocus}</p></section>
      <section><span>{LEARN_PAGE_COPY.guideNext}</span><p>{tip.nextConnection}</p></section>
      <section><span>{LEARN_PAGE_COPY.guideAdvice}</span><p>{tip.studyAdvice}</p></section>
    </div>
    {guidingQuestionReady ? <div className="lesson-guide-question"><span>{LEARN_PAGE_COPY.guideQuestion}</span><p>{tip.guidingQuestion}</p></div> : null}
  </div>;
}

/**
 * 丰富卡片:任务卡(本节目标 + 主操作)→ 八站点流水线 → 个性化课前导学 →
 * 模块控制条 → 正文阅读区 → 折叠信息卡(误区 / 术语依据)。
 * 模块开合状态与流水线渲染完全沿用重构前逻辑,只换展示结构与文案。
 */
function RichLessonView({
  card,
  pipeline,
  footer,
  tipLoading,
  tipProgressText,
  onGenerateTip,
}: {
  card: LearningCardSafeView & { selectedLesson: SelectedLessonSafeView };
  pipeline?: ReactNode;
  footer: ReactNode;
  tipLoading: boolean;
  tipProgressText?: string;
  onGenerateTip: () => void;
}) {
  const lesson = card.selectedLesson;
  const defaults = new Set(DEFAULT_OPEN_MODULES[lesson.variantId]);
  const [openState, setOpenState] = useState<Partial<Record<LessonModuleId, boolean>>>({});
  const isOpen = (moduleId: LessonModuleId) => openState[moduleId] ?? defaults.has(moduleId);
  const setAll = (open: boolean) => setOpenState(Object.fromEntries(lesson.modules.map((module) => [module.moduleId, open])));
  const structuredTipReady = hasStructuredLessonGuide(card.personalizedTip);
  const readingModules = lesson.modules.filter((module) => !INFO_MODULE_IDS.has(module.moduleId));
  const infoModules = lesson.modules.filter((module) => INFO_MODULE_IDS.has(module.moduleId));

  return <>
    <section className="learn-task lesson-objectives" aria-labelledby="learn-task-heading">
      <div className="learn-task-heading">
        <div>
          <p className="task-kicker">{LEARN_PAGE_COPY.taskKicker}</p>
          <h2 id="learn-task-heading">{LEARN_PAGE_COPY.taskTitle}</h2>
        </div>
        <span className="status-tag success">{lesson.label}</span>
      </div>
      <div className="objective-columns">
        <div><h3>{LEARN_PAGE_COPY.understandHeading}</h3><ul>{lesson.learningObjectives.understand.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3>{LEARN_PAGE_COPY.masterHeading}</h3><ul>{lesson.learningObjectives.master.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
      {footer}
    </section>
    {pipeline}
    <aside className={`lesson-personal-tip ${tipLoading ? "is-loading" : card.personalizedTip === undefined ? "is-unavailable" : "is-generated"}`} role="status" aria-live="polite">
      <div className="lesson-personal-tip-heading">
        <div className="lesson-personal-tip-title"><span>{LEARN_PAGE_COPY.tipTitle}</span>{card.personalizedTip?.lessonVariantLabel === undefined ? null : <small>{card.personalizedTip.lessonVariantLabel}</small>}</div>
        <strong>{tipLoading ? tipProgressText ?? LEARN_PAGE_COPY.tipGenerating : card.personalizedTip === undefined ? LEARN_PAGE_COPY.tipUnavailableStatus : structuredTipReady ? LEARN_PAGE_COPY.tipStructuredStatus : LEARN_PAGE_COPY.tipLegacyStatus}</strong>
      </div>
      {tipLoading
        ? <p>{LEARN_PAGE_COPY.tipLoadingBody}</p>
        : card.personalizedTip === undefined
          ? <p>{LEARN_PAGE_COPY.tipUnavailableBody}</p>
          : <PersonalizedLessonGuide tip={card.personalizedTip} />}
      {!tipLoading && !structuredTipReady ? <button type="button" className="button text-button" onClick={onGenerateTip}>{card.personalizedTip === undefined ? LEARN_PAGE_COPY.tipRegenerate : LEARN_PAGE_COPY.tipUpgrade}</button> : null}
    </aside>
    <div className="lesson-controls" aria-label={LEARN_PAGE_COPY.controlsAriaLabel}>
      <span>{LEARN_PAGE_COPY.moduleCountLabel(lesson.modules.length)}</span>
      <div><button type="button" className="button text-button" onClick={() => setAll(true)}>{LEARN_PAGE_COPY.expandAll}</button><button type="button" className="button text-button" onClick={() => setAll(false)}>{LEARN_PAGE_COPY.collapseAll}</button></div>
    </div>
    <section className="lesson-manual" aria-label={LEARN_PAGE_COPY.readingAriaLabel}>
      {readingModules.map((module) => <LessonModuleView
        key={module.moduleId}
        module={module}
        open={isOpen(module.moduleId)}
        onToggle={(open) => setOpenState((current) => ({ ...current, [module.moduleId]: open }))}
        lesson={lesson}
      />)}
    </section>
    {infoModules.length === 0 ? null : <section className="learn-facts" aria-label={LEARN_PAGE_COPY.factsAriaLabel}>
      {infoModules.map((module) => <LessonModuleView
        key={module.moduleId}
        module={module}
        open={isOpen(module.moduleId)}
        onToggle={(open) => setOpenState((current) => ({ ...current, [module.moduleId]: open }))}
        lesson={lesson}
      />)}
    </section>}
  </>;
}

/**
 * 旧版卡片(未绑定结构化正文):同样切三段——任务卡(本节目标 + 主操作)、
 * 正文阅读区(分步理解 + 示例)、折叠信息卡(常见误区)。
 */
function LegacyLessonView({
  card,
  readiness,
  pipeline,
  footer,
}: {
  card: LearningCardSafeView;
  readiness: NextStepOutput["contentReadiness"];
  pipeline?: ReactNode;
  footer: ReactNode;
}) {
  return <>
    <section className="learn-task" aria-labelledby="learn-task-heading">
      <p className="task-kicker">{LEARN_PAGE_COPY.taskKicker}</p>
      <h2 id="learn-task-heading">{card.objective}</h2>
      {footer}
    </section>
    <section className="lesson-manual" aria-label={LEARN_PAGE_COPY.readingAriaLabel}>
      <div className="lesson-manual-heading">
        <h3>{LEARN_PAGE_COPY.stepByStepHeading}</h3>
        <span className="status-tag neutral">{contentReadinessLabel(readiness)}</span>
      </div>
      <ol className="explanation-list">{card.explanation.map((item) => <li key={item}>{item}</li>)}</ol>
      <h3 className="lesson-reading-subheading">{LEARN_PAGE_COPY.exampleHeading}</h3>
      <pre className="lesson-code"><code>{card.example}</code></pre>
    </section>
    <section className="learn-facts" aria-label={LEARN_PAGE_COPY.factsAriaLabel}>
      <details className="learn-fact">
        <summary className="learn-fact-summary"><span>{LEARN_PAGE_COPY.mistakeHeading}</span></summary>
        <p className="learn-fact-body">{card.commonMistake}</p>
      </details>
    </section>
    {pipeline}
  </>;
}

export function LearnPage() {
  const { sessionId = "", nodeId = "" } = useParams<{ sessionId: string; nodeId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = useBootstrap(sessionId);
  const [next, setNext] = useState<NextStepOutput | undefined>((location.state as { next?: NextStepOutput } | null)?.next);
  const [loadingNext, setLoadingNext] = useState(next === undefined);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [tipBusy, setTipBusy] = useState(false);
  const [tipAttemptedNodeId, setTipAttemptedNodeId] = useState<string>();
  const [agentRequestId, setAgentRequestId] = useState<string>();
  const [agentRunId, setAgentRunId] = useState<string>();
  const actionProgress = useAsyncActionProgress();
  const agentRun = useAgentRun({ requestId: agentRequestId, runId: agentRunId, active: busy || tipBusy });
  const session = bootstrap.data?.session;
  const relearnNodeId = next?.activity === undefined
    ? undefined
    : next.relearnAllowed === true
      ? nodeId
      : relearnNodeIdForActivity(session, next.activity.activityId, nodeId);

  useEffect(() => {
    if (session?.path === undefined || next?.node?.nodeId === nodeId) return;
    setLoadingNext(true);
    api.getNextStep({ sessionId, sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision, pathVersion: session.path.pathVersion, nodeId })
      .then(setNext).catch((error: unknown) => setActionError(error instanceof Error ? error : new Error("next_step_failed"))).finally(() => setLoadingNext(false));
  }, [next?.node?.nodeId, nodeId, session, sessionId]);

  const open = async () => {
    if (session === undefined || session.path === undefined || next?.activity === undefined) return;
    setBusy(true); setActionError(undefined);
    actionProgress.start(next.activity.kind === "mcq" ? LEARN_PAGE_COPY.progressQuiz : LEARN_PAGE_COPY.progressActivity);
    const requestId = newRequestId("web-open-activity");
    setAgentRequestId(next.activity.kind === "mcq" ? requestId : undefined);
    setAgentRunId(undefined);
    try {
      const opened = await api.openActivity({
        requestId, sessionId, sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision, activityId: next.activity.activityId,
        activityVersion: next.activity.activityVersion, pathVersion: session.path.pathVersion,
        ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }),
        ...(relearnNodeId === undefined ? {} : { relearn: true }),
      });
      navigate(`/activity/${sessionId}/${next.activity.activityId}`, { state: {
        opened,
        nodeId,
        ...(relearnNodeId === undefined ? {} : { relearnNodeId }),
      } });
    } catch (error) { setActionError(error instanceof Error ? error : new Error("activity_open_failed")); }
    finally { actionProgress.stop(); setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  const loading = bootstrap.loading || loadingNext;
  const requestedBinding = session?.learningCards?.find((binding) => binding.nodeId === nodeId);
  const reviewingEarlierLesson = next?.navigationMode === "review";
  const displayNode = next?.node;
  const routeCard = next?.card;
  const persistedCard = requestedBinding?.card;
  // Bootstrap is reloaded after tip publication; prefer its durable card over the
  // route snapshot, which was captured before the Agent run finished.
  const persistedTipReady = persistedCard?.personalizedTip !== undefined
    || persistedCard?.personalizedTipStatus?.state === "generated"
    || persistedCard?.personalizedTipAgentRunId !== undefined;
  const displayCard = persistedTipReady ? persistedCard : routeCard ?? persistedCard;
  const lessonLabel = displayCard?.selectedLesson?.label;
  useEffect(() => {
    // Restore the durable tip run when entering or refreshing a lesson page.
    setAgentRunId(displayCard?.personalizedTipAgentRunId);
  }, [displayCard?.personalizedTipAgentRunId, displayNode?.nodeId]);
  const isLegacyHelper = displayNode?.knowledgePointId === "basic-python";
  const prepareTip = async () => {
    if (session === undefined || session.path === undefined || displayNode === undefined || displayCard?.selectedLesson === undefined) return;
    if (hasStructuredLessonGuide(displayCard.personalizedTip) || displayNode.nodeId !== next?.node?.nodeId) return;
    setTipAttemptedNodeId(displayNode.nodeId);
    setTipBusy(true);
    actionProgress.start(LEARN_PAGE_COPY.progressTip);
    const requestId = newRequestId("web-personalized-tip");
    setAgentRequestId(requestId);
    setAgentRunId(undefined);
    try {
      const prepared = await api.preparePersonalizedTip({
        requestId,
        sessionId,
        sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision,
        pathVersion: session.path.pathVersion,
        nodeId: displayNode.nodeId,
      });
      if (prepared.agentRunId !== undefined) setAgentRunId(prepared.agentRunId);
      await bootstrap.reload();
      if (prepared.status === "unavailable" || !hasStructuredLessonGuide(prepared.card.personalizedTip)) {
        setAgentRequestId(undefined);
        setAgentRunId(undefined);
      }
    } catch {
      // Optional reminders never block the authoritative lesson body.
      setAgentRequestId(undefined);
      setAgentRunId(undefined);
    } finally {
      actionProgress.stop();
      setTipBusy(false);
    }
  };

  useEffect(() => {
    if (reviewingEarlierLesson || loading || tipBusy || busy || displayCard?.selectedLesson === undefined || hasStructuredLessonGuide(displayCard.personalizedTip)) return;
    if (displayNode === undefined || displayNode.nodeId !== next?.node?.nodeId || tipAttemptedNodeId === displayNode.nodeId) return;
    void prepareTip();
  }, [busy, displayCard, displayNode, loading, next?.node?.nodeId, reviewingEarlierLesson, tipAttemptedNodeId, tipBusy]);

  const pipelineResourceKind = agentRequestId?.startsWith("web-personalized-tip") || agentRun.run?.activityId.startsWith("node-") ? "tip" : "quiz";
  const pipeline = agentRun.run !== undefined
    ? <AgentPipeline run={agentRun.run} mode={agentRun.transport === "complete" ? "snapshot" : "live"} resourceKind={pipelineResourceKind} onExport={() => downloadAgentRunExport(agentRun.run!.runId).then(() => undefined)} />
    : agentRequestId !== undefined
      ? <AgentPipelineDiscovery resourceKind={pipelineResourceKind} statusText={actionProgress.text ?? AGENT_PIPELINE_STATUS_FALLBACK} />
      : null;

  const taskFooter = next === undefined ? null : reviewingEarlierLesson ? (
    <div className="task-footer">
      <span className="quiet-label">{LEARN_PAGE_COPY.reviewNote}</span>
      <div className="button-row">
        {actionProgress.text === undefined ? null : <span className="async-action-status" role="status" aria-live="polite">{actionProgress.text}</span>}
        {next.currentNodeId === undefined ? null : <button type="button" className="button secondary" disabled={busy || tipBusy} onClick={() => navigate(`/learn/${sessionId}/${next.currentNodeId}`)}>{LEARN_PAGE_COPY.backToCurrent}</button>}
        {next.relearnAllowed === true && next.activity !== undefined ? <button type="button" className="button primary async-action-button" disabled={busy || tipBusy || displayCard === undefined} onClick={() => void open()}>{actionProgress.text ?? LEARN_PAGE_COPY.relearnSection}</button> : null}
      </div>
    </div>
  ) : (
    <div className="task-footer">
      <span className="quiet-label">{activityKindLabel(next.activity?.kind)}</span>
      {next.activity === undefined
        ? <button type="button" className="button primary" onClick={() => { setNext(undefined); void bootstrap.reload(); }}>{LEARN_PAGE_COPY.retryRead}</button>
        : <><span className="async-action-status" role="status" aria-live="polite">{actionProgress.text ?? ""}</span><button type="button" className="button primary async-action-button" disabled={busy || tipBusy || (displayCard === undefined && !isLegacyHelper)} onClick={() => void open()}>{tipBusy ? actionProgress.text ?? LEARN_PAGE_COPY.generatingReminderFallback : actionProgress.text ?? LEARN_PAGE_COPY.enterActivity}</button></>}
    </div>
  );

  return <PageFrame eyebrow={LEARN_PAGE_COPY.eyebrow} title={displayCard?.title ?? LEARN_PAGE_COPY.frameTitleFallback} summary={displayCard?.objective ?? LEARN_PAGE_COPY.frameSummaryFallback} back={{ to: `/path/${sessionId}`, label: LEARN_PAGE_COPY.backLabel }} actions={<span className="header-badge">{reviewingEarlierLesson ? next?.relearnAllowed === true ? LEARN_PAGE_COPY.relearnBadge : LEARN_PAGE_COPY.reviewBadge : lessonLabel ?? contentReadinessLabel(next?.contentReadiness)}</span>}>
    {loading ? <PageStatePanel page="learn" state="loading" /> : null}
    {!loading && error ? <PageStatePanel page="learn" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={requestErrorLabel(isApiError(error) ? error.code : error.message)} onRetry={() => { setActionError(undefined); setNext(undefined); void bootstrap.reload(); }} /> : null}
    {!loading && error === undefined && (session === undefined || next === undefined || displayNode === undefined) ? <PageStatePanel page="learn" state="empty" /> : null}
    {!loading && error === undefined && session !== undefined && next?.node !== undefined && displayNode !== undefined ? <>
      <div className="learn-layout" data-page="learn" data-session-id={sessionId} data-node-id={nodeId}>
        <article className="learning-content">
          {displayCard === undefined && isLegacyHelper ? <section className="learn-task lesson-helper" aria-labelledby="learn-task-heading">
              <p className="task-kicker">{LEARN_PAGE_COPY.helperKicker}</p>
              <h2 id="learn-task-heading">{LEARN_PAGE_COPY.helperTitle}</h2>
              <p className="task-lede">{LEARN_PAGE_COPY.helperBody}</p>
              {taskFooter}
            </section>
            : displayCard === undefined ? <section className="learn-task lesson-blocked" role="alert" aria-labelledby="learn-task-heading">
                <p className="task-kicker">{LEARN_PAGE_COPY.blockedKicker}</p>
                <h2 id="learn-task-heading">{LEARN_PAGE_COPY.blockedTitle}</h2>
                <p className="task-lede">{LEARN_PAGE_COPY.blockedBody}</p>
                <button type="button" className="button primary" onClick={() => { setNext(undefined); void bootstrap.reload(); }}>{LEARN_PAGE_COPY.reloadSession}</button>
              </section>
              : displayCard.selectedLesson === undefined ? <LegacyLessonView card={displayCard} readiness={next.contentReadiness} pipeline={pipeline} footer={taskFooter} />
                : <RichLessonView card={displayCard as LearningCardSafeView & { selectedLesson: SelectedLessonSafeView }} pipeline={pipeline} footer={taskFooter} tipLoading={tipBusy} tipProgressText={tipBusy ? actionProgress.text : undefined} onGenerateTip={() => { setTipAttemptedNodeId(undefined); void prepareTip(); }} />}
        </article>
      </div>
    </> : null}
  </PageFrame>;
}