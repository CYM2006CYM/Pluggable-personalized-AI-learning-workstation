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
import { activityKindLabel, contentReadinessLabel, knowledgePointLabel } from "../learning-labels.js";
import { relearnNodeIdForActivity } from "../relearn-context.js";

const DEFAULT_OPEN_MODULES: Record<LessonVariantId, readonly LessonModuleId[]> = {
  guided: ["intuition", "concepts", "walkthrough"],
  concise: ["intuition", "final-task"],
  practice: ["intuition", "walkthrough", "final-task"],
};

function LessonBlockView({ block }: { block: LessonContentBlock }) {
  if (block.kind === "subheading") return <h3 className="lesson-subheading">{block.text}</h3>;
  if (block.kind === "paragraph") return <p className="lesson-paragraph">{block.text}</p>;
  if (block.kind === "code") return <pre className="lesson-code" aria-label={`${block.language}代码示例`}><code>{block.code}</code></pre>;
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
  const showsReferences = module.moduleId === "terms-sources";
  return <details className="lesson-module" open={open}>
    <summary aria-expanded={open} onClick={(event) => { event.preventDefault(); onToggle(!open); }}><span>{module.title}</span><small>{module.summary}</small></summary>
    <div className="lesson-module-body">
      {module.blocks.map((block) => <LessonBlockView block={block} key={block.blockId} />)}
      {showsReferences ? <>
        <h3 className="lesson-subheading">术语解释</h3>
        <dl className="lesson-terms">{lesson.termNotes.map((note) => <div key={note.term}><dt>{note.term}</dt><dd>{note.explanation}</dd></div>)}</dl>
        <h3 className="lesson-subheading">本节依据</h3>
        <ul className="lesson-sources">{lesson.sourceClaims.map((claim) => <li key={claim.claimId}><span>{claim.statement}</span><small>{claim.sourceAnchorIds.join(" / ")}</small></li>)}</ul>
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
      <section><span>承接前文</span><p>{tip.priorConnection}</p></section>
      <section><span>本节主线</span><p>{tip.learningFocus}</p></section>
      <section><span>下一步去哪里</span><p>{tip.nextConnection}</p></section>
      <section><span>学习建议</span><p>{tip.studyAdvice}</p></section>
    </div>
    {guidingQuestionReady ? <div className="lesson-guide-question"><span>带着这个问题进入正文</span><p>{tip.guidingQuestion}</p></div> : null}
  </div>;
}

function RichLessonView({
  card,
  pipeline,
  tipLoading,
  tipProgressText,
  onGenerateTip,
}: {
  card: LearningCardSafeView & { selectedLesson: SelectedLessonSafeView };
  pipeline?: ReactNode;
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

  return <>
    <section className="content-band lesson-objectives" aria-labelledby="lesson-objectives-heading">
      <div className="section-heading"><div><p className="section-kicker">学习目标</p><h2 id="lesson-objectives-heading">开始前，先明确这一节要学会什么</h2></div><span className="status-tag success">{lesson.label}</span></div>
      <div className="objective-columns">
        <div><h3>你将了解</h3><ul>{lesson.learningObjectives.understand.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3>你将掌握</h3><ul>{lesson.learningObjectives.master.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
    </section>
    {pipeline}
    <aside className={`lesson-personal-tip ${tipLoading ? "is-loading" : card.personalizedTip === undefined ? "is-unavailable" : "is-generated"}`} role="status" aria-live="polite">
      <div className="lesson-personal-tip-heading">
        <div className="lesson-personal-tip-title"><span>AI 个性化课前导学</span>{card.personalizedTip?.lessonVariantLabel === undefined ? null : <small>{card.personalizedTip.lessonVariantLabel}</small>}</div>
        <strong>{tipLoading ? tipProgressText ?? "正在生成并审核个性化提醒（已处理 0 秒）" : card.personalizedTip === undefined ? "本次未生成" : structuredTipReady ? "已生成" : "旧版提醒"}</strong>
      </div>
      {tipLoading
        ? <p>Agent 正在读取本节正式正文、章节关系和学情信息，并执行 Generator、Hunter 与 Judge 审核；正文已可正常阅读。</p>
        : card.personalizedTip === undefined
          ? <p>本次没有形成通过审核的个性化提醒，继续使用完整正式正文，不影响本节学习。</p>
          : <PersonalizedLessonGuide tip={card.personalizedTip} />}
      {!tipLoading && !structuredTipReady ? <button type="button" className="button text-button" onClick={onGenerateTip}>{card.personalizedTip === undefined ? "重新生成提醒" : "升级课前导学"}</button> : null}
    </aside>
    <div className="lesson-controls" aria-label="教学模块显示控制">
      <span>共 {lesson.modules.length} 个教学模块</span>
      <div><button type="button" className="button text-button" onClick={() => setAll(true)}>展开全部</button><button type="button" className="button text-button" onClick={() => setAll(false)}>全部收起</button></div>
    </div>
    <section className="lesson-manual" aria-label="结构化教学正文">
      {lesson.modules.map((module) => <LessonModuleView
        key={module.moduleId}
        module={module}
        open={isOpen(module.moduleId)}
        onToggle={(open) => setOpenState((current) => ({ ...current, [module.moduleId]: open }))}
        lesson={lesson}
      />)}
    </section>
  </>;
}

function LegacyCardView({ card, readiness }: { card: LearningCardSafeView; readiness: NextStepOutput["contentReadiness"] }) {
  return <>
    <section className="content-band objective-band"><p className="section-kicker">本节目标</p><h2>{card.objective}</h2></section>
    <section className="content-band"><div className="section-heading"><h2>分步理解</h2><span className="status-tag neutral">{contentReadinessLabel(readiness)}</span></div><ol className="explanation-list">{card.explanation.map((item) => <li key={item}>{item}</li>)}</ol></section>
    <section className="content-band split-band"><div><p className="section-kicker">示例</p><pre className="lesson-code"><code>{card.example}</code></pre></div><div><p className="section-kicker">常见误区</p><p>{card.commonMistake}</p></div></section>
    <details className="source-panel"><summary>查看来源依据</summary><ul>{card.sourceAnchorIds.map((source) => <li key={source}>{source}</li>)}</ul></details>
  </>;
}

function railProgressLabel(session: NonNullable<ReturnType<typeof useBootstrap>["data"]>["session"], nodeId: string, isCurrent: boolean, canReview: boolean, nodeStatus: string): string {
  if (isCurrent) return "当前进度";
  const progress = session?.activityProgress.find((item) => item.nodeId === nodeId);
  if (progress?.activities.some((activity) => activity.continuedWithGap)) return "暂时跳过 / 可重新学习";
  if (nodeStatus === "skipped") return canReview ? "已跳过，可重新学习" : "已跳过";
  if (nodeStatus === "completed") return "已完成，可回看";
  return canReview ? "可回看" : "尚未解锁";
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
  const [pathOpen, setPathOpen] = useState(false);
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
    actionProgress.start(next.activity.kind === "mcq" ? "正在生成并审核题组" : "正在准备正式活动");
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
    actionProgress.start("正在生成并审核个性化提醒");
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
      ? <AgentPipelineDiscovery resourceKind={pipelineResourceKind} statusText={actionProgress.text ?? "正在等待服务端响应"} />
      : null;

  return <PageFrame eyebrow="数据清洗实验手册" title={displayCard?.title ?? "学习内容"} summary={displayCard?.objective ?? "从服务端读取当前会话绑定的权威教学正文。"} back={{ to: `/path/${sessionId}`, label: "返回学习路径" }} actions={<span className="header-badge">{reviewingEarlierLesson ? next?.relearnAllowed === true ? "可重新学习" : "回看模式" : lessonLabel ?? contentReadinessLabel(next?.contentReadiness)}</span>}>
    {loading ? <PageStatePanel page="learn" state="loading" /> : null}
    {!loading && error ? <PageStatePanel page="learn" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); setNext(undefined); void bootstrap.reload(); }} /> : null}
    {!loading && error === undefined && (session === undefined || next === undefined || displayNode === undefined) ? <PageStatePanel page="learn" state="empty" /> : null}
    {!loading && error === undefined && session !== undefined && next?.node !== undefined && displayNode !== undefined ? <>
      <div className="learn-layout" data-page="learn" data-session-id={sessionId} data-node-id={nodeId}>
        <aside className={`path-rail ${pathOpen ? "open" : ""}`} aria-label="当前路径"><button type="button" className="path-rail-toggle" aria-expanded={pathOpen} onClick={() => setPathOpen((open) => !open)}>学习目录 <span aria-hidden="true">{pathOpen ? "收起" : "展开"}</span></button><p className="section-kicker">路径版本 {next.pathVersion}</p><div className="path-rail-nodes">{session.path?.nodes.map((node, index) => { const binding = session.learningCards?.find((item) => item.nodeId === node.nodeId); const currentNodeId = next.currentNodeId ?? (next.navigationMode !== "review" ? next.node?.nodeId : undefined); const isCurrent = node.nodeId === currentNodeId; const canReview = binding !== undefined || isCurrent; return <button type="button" disabled={!canReview} onClick={() => { setPathOpen(false); navigate(`/learn/${sessionId}/${node.nodeId}`); }} className={`rail-node ${node.nodeId === displayNode.nodeId ? "current" : ""}`} key={node.nodeId}><span className="rail-node-index">{index + 1}</span><span className="rail-node-copy"><strong>{binding?.card.title ?? knowledgePointLabel(node.knowledgePointId)}</strong><small>{railProgressLabel(session, node.nodeId, isCurrent, canReview, node.status)}</small></span></button>; })}</div></aside>
        <article className="learning-content">
          {displayCard === undefined && isLegacyHelper ? <section className="content-band objective-band"><p className="section-kicker">基础辅助节点</p><h2>本节点不扩写独立教材</h2><p>它只用于确认进入Pandas学习前所需的基础Python操作。完成正式活动后，将进入六节结构化中文教学正文。</p></section>
            : displayCard === undefined ? <section className="content-band lesson-blocked" role="alert"><p className="section-kicker">正文不可用</p><h2>当前会话没有绑定可验证的教学正文</h2><p>请重新读取会话；若问题仍存在，需要修复Profile正文或Schema后新建会话。本页不会使用空白内容冒充教材。</p><button type="button" className="button primary" onClick={() => { setNext(undefined); void bootstrap.reload(); }}>重新读取会话</button></section>
              : displayCard.selectedLesson === undefined ? <><LegacyCardView card={displayCard} readiness={next.contentReadiness} />{pipeline}</> : <RichLessonView card={displayCard as LearningCardSafeView & { selectedLesson: SelectedLessonSafeView }} pipeline={pipeline} tipLoading={tipBusy} tipProgressText={tipBusy ? actionProgress.text : undefined} onGenerateTip={() => { setTipAttemptedNodeId(undefined); void prepareTip(); }} />}
          {reviewingEarlierLesson ? <div className="section-footer lesson-footer"><span className="quiet-label">回看正文不会改变进度；重新作答后才会形成新的学习证据</span><div className="button-row">{actionProgress.text === undefined ? null : <span className="async-action-status" role="status" aria-live="polite">{actionProgress.text}</span>}{next.currentNodeId === undefined ? null : <button type="button" className="button secondary" disabled={busy || tipBusy} onClick={() => navigate(`/learn/${sessionId}/${next.currentNodeId}`)}>返回当前学习进度</button>}{next.relearnAllowed === true && next.activity !== undefined ? <button type="button" className="button primary async-action-button" disabled={busy || tipBusy || displayCard === undefined} onClick={() => void open()}>{actionProgress.text ?? "重新学习本节"}</button> : null}</div></div> : <div className="section-footer lesson-footer"><span className="quiet-label">{activityKindLabel(next.activity?.kind)}</span>{next.activity === undefined
            ? <button type="button" className="button primary" onClick={() => { setNext(undefined); void bootstrap.reload(); }}>重新读取内容</button>
            : <><span className="async-action-status" role="status" aria-live="polite">{actionProgress.text ?? ""}</span><button type="button" className="button primary async-action-button" disabled={busy || tipBusy || (displayCard === undefined && !isLegacyHelper)} onClick={() => void open()}>{tipBusy ? actionProgress.text ?? "提醒生成中（已处理 0 秒）" : actionProgress.text ?? "进入正式活动"}</button></>}</div>}
        </article>
      </div>
    </> : null}
  </PageFrame>;
}
