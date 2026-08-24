import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  LearningCardSafeView,
  LessonContentBlock,
  LessonModule,
  LessonModuleId,
  LessonVariantId,
  NextStepOutput,
  SelectedLessonSafeView,
} from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { activityKindLabel, contentReadinessLabel, knowledgePointLabel } from "../learning-labels.js";

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

function RichLessonView({ card }: { card: LearningCardSafeView & { selectedLesson: SelectedLessonSafeView } }) {
  const lesson = card.selectedLesson;
  const defaults = new Set(DEFAULT_OPEN_MODULES[lesson.variantId]);
  const [openState, setOpenState] = useState<Partial<Record<LessonModuleId, boolean>>>({});
  const isOpen = (moduleId: LessonModuleId) => openState[moduleId] ?? defaults.has(moduleId);
  const setAll = (open: boolean) => setOpenState(Object.fromEntries(lesson.modules.map((module) => [module.moduleId, open])));

  return <>
    <section className="content-band lesson-objectives" aria-labelledby="lesson-objectives-heading">
      <div className="section-heading"><div><p className="section-kicker">学习目标</p><h2 id="lesson-objectives-heading">开始前，先明确这一节要学会什么</h2></div><span className="status-tag success">{lesson.label}</span></div>
      <div className="objective-columns">
        <div><h3>你将了解</h3><ul>{lesson.learningObjectives.understand.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3>你将掌握</h3><ul>{lesson.learningObjectives.master.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
    </section>
    {card.personalizedTip === undefined ? null : <aside className="lesson-personal-tip"><span>个性化学习提示</span><p>{card.personalizedTip.text}</p></aside>}
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
  if (progress?.activities.some((activity) => activity.continuedWithGap)) return "暂时跳过 / 未掌握";
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
  const [pathOpen, setPathOpen] = useState(false);
  const actionProgress = useAsyncActionProgress();
  const session = bootstrap.data?.session;

  useEffect(() => {
    if (next !== undefined || session?.path === undefined) return;
    setLoadingNext(true);
    api.getNextStep({ sessionId, sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision, pathVersion: session.path.pathVersion })
      .then(setNext).catch((error: unknown) => setActionError(error instanceof Error ? error : new Error("next_step_failed"))).finally(() => setLoadingNext(false));
  }, [next, session, sessionId]);

  const open = async () => {
    if (session === undefined || session.path === undefined || next?.activity === undefined) return;
    setBusy(true); setActionError(undefined);
    actionProgress.start(next.activity.kind === "mcq" ? "正在生成并审核题组" : "正在准备正式活动");
    try {
      const opened = await api.openActivity({
        requestId: newRequestId("web-open-activity"), sessionId, sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision, activityId: next.activity.activityId,
        activityVersion: next.activity.activityVersion, pathVersion: session.path.pathVersion,
        ...(next.card === undefined ? {} : { acknowledgedCardId: next.card.cardId }),
      });
      navigate(`/activity/${sessionId}/${next.activity.activityId}`, { state: { opened, nodeId } });
    } catch (error) { setActionError(error instanceof Error ? error : new Error("activity_open_failed")); }
    finally { actionProgress.stop(); setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  const loading = bootstrap.loading || loadingNext;
  const requestedNode = session?.path?.nodes.find((node) => node.nodeId === nodeId);
  const requestedBinding = session?.learningCards?.find((binding) => binding.nodeId === nodeId);
  const reviewingEarlierLesson = next?.node !== undefined && next.node.nodeId !== nodeId && requestedBinding !== undefined;
  const displayNode = requestedNode ?? next?.node;
  const displayCard = requestedBinding?.card ?? next?.card;
  const lessonLabel = displayCard?.selectedLesson?.label;
  const isLegacyHelper = displayNode?.knowledgePointId === "basic-python";
  return <PageFrame eyebrow="数据清洗实验手册" title={displayCard?.title ?? "学习内容"} summary={displayCard?.objective ?? "从服务端读取当前会话绑定的权威教学正文。"} back={{ to: `/path/${sessionId}`, label: "返回学习路径" }} actions={<span className="header-badge">{reviewingEarlierLesson ? "回看模式" : lessonLabel ?? contentReadinessLabel(next?.contentReadiness)}</span>}>
    {loading ? <PageStatePanel page="learn" state="loading" /> : null}
    {!loading && error ? <PageStatePanel page="learn" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); setNext(undefined); void bootstrap.reload(); }} /> : null}
    {!loading && error === undefined && (session === undefined || next === undefined || displayNode === undefined) ? <PageStatePanel page="learn" state="empty" /> : null}
    {!loading && error === undefined && session !== undefined && next?.node !== undefined && displayNode !== undefined ? <>
      <div className="learn-layout" data-page="learn" data-session-id={sessionId} data-node-id={nodeId}>
        <aside className={`path-rail ${pathOpen ? "open" : ""}`} aria-label="当前路径"><button type="button" className="path-rail-toggle" aria-expanded={pathOpen} onClick={() => setPathOpen((open) => !open)}>学习目录 <span aria-hidden="true">{pathOpen ? "收起" : "展开"}</span></button><p className="section-kicker">路径版本 {next.pathVersion}</p><div className="path-rail-nodes">{session.path?.nodes.map((node, index) => { const binding = session.learningCards?.find((item) => item.nodeId === node.nodeId); const isCurrent = node.nodeId === next.node?.nodeId; const canReview = binding !== undefined || isCurrent; return <button type="button" disabled={!canReview} onClick={() => { setPathOpen(false); navigate(`/learn/${sessionId}/${node.nodeId}`, isCurrent ? { state: { next } } : undefined); }} className={`rail-node ${node.nodeId === displayNode.nodeId ? "current" : ""}`} key={node.nodeId}><span className="rail-node-index">{index + 1}</span><span className="rail-node-copy"><strong>{binding?.card.title ?? knowledgePointLabel(node.knowledgePointId)}</strong><small>{railProgressLabel(session, node.nodeId, isCurrent, canReview, node.status)}</small></span></button>; })}</div></aside>
        <article className="learning-content">
          {displayCard === undefined && isLegacyHelper ? <section className="content-band objective-band"><p className="section-kicker">基础辅助节点</p><h2>本节点不扩写独立教材</h2><p>它只用于确认进入Pandas学习前所需的基础Python操作。完成正式活动后，将进入六节结构化中文教学正文。</p></section>
            : displayCard === undefined ? <section className="content-band lesson-blocked" role="alert"><p className="section-kicker">正文不可用</p><h2>当前会话没有绑定可验证的教学正文</h2><p>请重新读取会话；若问题仍存在，需要修复Profile正文或Schema后新建会话。本页不会使用空白内容冒充教材。</p><button type="button" className="button primary" onClick={() => { setNext(undefined); void bootstrap.reload(); }}>重新读取会话</button></section>
              : displayCard.selectedLesson === undefined ? <LegacyCardView card={displayCard} readiness={next.contentReadiness} /> : <RichLessonView card={displayCard as LearningCardSafeView & { selectedLesson: SelectedLessonSafeView }} />}
          {reviewingEarlierLesson ? <div className="section-footer lesson-footer"><span className="quiet-label">正在回看已绑定正文，不会改变学习进度</span><button type="button" className="button primary" onClick={() => navigate(`/learn/${sessionId}/${next.node!.nodeId}`, { state: { next } })}>返回当前学习进度</button></div> : <div className="section-footer lesson-footer"><span className="quiet-label">{activityKindLabel(next.activity?.kind)}</span>{next.activity === undefined
            ? <button type="button" className="button primary" onClick={() => { setNext(undefined); void bootstrap.reload(); }}>重新读取内容</button>
            : <><span className="async-action-status" role="status" aria-live="polite">{actionProgress.text ?? ""}</span><button type="button" className="button primary async-action-button" disabled={busy || (displayCard === undefined && !isLegacyHelper)} onClick={() => void open()}>{actionProgress.text ?? "进入正式活动"}</button></>}</div>}
        </article>
      </div>
    </> : null}
  </PageFrame>;
}
