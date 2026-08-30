import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { AgentPipeline, AgentPipelineDiscovery, agentPipelineSummary } from "../components/AgentPipeline.js";
import { downloadAgentRunExport } from "../api/agent-run-client.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { useAgentRun } from "../hooks/use-agent-run.js";
import { activityKindLabel, contentReadinessLabel, knowledgePointLabel } from "../learning-labels.js";
import { relearnNodeIdForActivity } from "../relearn-context.js";
import { buildFlowContext, buildStudyFlow, type StudyFlowView } from "../flow/study-flow.js";
import { lessonCounterLabel } from "../copy/ui-copy.js";
import {
  AGENT_PIPELINE_STATUS_FALLBACK,
  LEARN_PAGE_COPY,
  LESSON_ACTS,
  PIPELINE_DRAWER,
  STATION_STACK,
  lessonPositionAriaLabel,
  requestErrorLabel,
  stationLabel,
} from "../copy/learn-page-copy.js";
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
  station,
  index,
}: {
  module: LessonModule;
  open: boolean;
  onToggle: (open: boolean) => void;
  lesson: SelectedLessonSafeView;
  /** 正文动线的站点短语(为什么学 / 学什么 / …)。附录卡没有站点,不传。 */
  station?: string;
  /** 站点序号(1 起)。纸张堆叠里印在卡头,和侧栏/任务卡的圆点同一套语言。 */
  index?: number;
}) {
  const isInfo = INFO_MODULE_IDS.has(module.moduleId);
  const showsReferences = module.moduleId === "terms-sources";
  return <details
    className={`lesson-module${isInfo ? " is-info" : ""}`}
    data-role={module.moduleId}
    open={open}
  >
    <summary aria-expanded={open} onClick={(event) => { event.preventDefault(); onToggle(!open); }}>
      {index === undefined ? null : <span className="station-marker" aria-hidden="true"><i>{index}</i></span>}
      {station === undefined ? null : <em className="station-tag">{station}</em>}
      <span>{module.title}</span><small>{module.summary}</small>
    </summary>
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

/** 任务卡上的「本节位置」:一排小圆点 + 节次文案,把任务卡、侧栏大动线和正文站点串成同一条线。 */
function LessonPositionStrip({ flow, activeNodeId }: { flow: StudyFlowView; activeNodeId: string | undefined }) {
  if (flow.totalLessons === 0) return null;
  const current = flow.cycles.find((cycle) => cycle.nodeId === activeNodeId);
  const lessonName = current === undefined ? undefined : knowledgePointLabel(current.knowledgePointId);
  return <div className="lesson-position" role="img" aria-label={lessonPositionAriaLabel(current?.index, flow.totalLessons, lessonName)}>
    <span className="lesson-position-dots" aria-hidden="true">
      {flow.cycles.map((cycle) => <i key={cycle.nodeId} data-status={cycle.status} />)}
    </span>
    <span className="lesson-position-text">
      {current === undefined
        ? `共 ${flow.totalLessons} 节`
        : lessonCounterLabel(current.index, flow.totalLessons)}
      {lessonName === undefined ? null : ` · ${lessonName}`}
    </span>
  </div>;
}

/**
 * 学习页两幕(同一路由,#study 哈希对应学习幕):
 * - 引入幕:一本摊开的书——左页本节目标,右页个性化导学,
 *   引导问题做通栏钩子;CTA 是「翻开正文」。
 * - 学习幕:正文站点纸叠 + 附录卡 + 进入正式活动。
 * 流水线收纳条两幕共用,随时可查;模块开合与流水线渲染沿用原逻辑。
 */
function RichLessonView({
  card,
  flow,
  activeNodeId,
  pipeline,
  footer,
  tipLoading,
  tipProgressText,
  onGenerateTip,
  onEnterActivity,
}: {
  card: LearningCardSafeView & { selectedLesson: SelectedLessonSafeView };
  flow: StudyFlowView;
  activeNodeId: string | undefined;
  pipeline?: ReactNode;
  footer: ReactNode;
  tipLoading: boolean;
  tipProgressText?: string;
  onGenerateTip: () => void;
  onEnterActivity?: () => void;
}) {
  const lessonLocation = useLocation();
  const lessonNavigate = useNavigate();
  const lesson = card.selectedLesson;
  const defaults = new Set(DEFAULT_OPEN_MODULES[lesson.variantId]);
  const [openState, setOpenState] = useState<Partial<Record<LessonModuleId, boolean>>>({});
  const isOpen = (moduleId: LessonModuleId) => openState[moduleId] ?? defaults.has(moduleId);
  const structuredTipReady = hasStructuredLessonGuide(card.personalizedTip);
  const readingModules = useMemo(() => lesson.modules.filter((module) => !INFO_MODULE_IDS.has(module.moduleId)), [lesson.modules]);
  const infoModules = useMemo(() => lesson.modules.filter((module) => INFO_MODULE_IDS.has(module.moduleId)), [lesson.modules]);
  const stationFromHash = (hash: string) => {
    if (!hash.startsWith("#study/")) return 0;
    let moduleId: string;
    try {
      moduleId = decodeURIComponent(hash.slice("#study/".length));
    } catch {
      return 0;
    }
    const index = readingModules.findIndex((module) => module.moduleId === moduleId);
    return index < 0 ? 0 : index;
  };
  const replaceStudyHash = (hash: string) => {
    lessonNavigate({ pathname: lessonLocation.pathname, search: lessonLocation.search, hash }, { replace: true });
  };

  /*
   * 分幕:#study 对应学习幕。进出都直接改状态,hashchange 只服务
   * 浏览器前进/后退;返回简报用 replaceState 抹掉哈希,不留历史垃圾。
   */
  const [act, setAct] = useState<"briefing" | "study">(
    () => lessonLocation.hash.startsWith("#study") ? "study" : "briefing",
  );
  useEffect(() => {
    setAct(lessonLocation.hash.startsWith("#study") ? "study" : "briefing");
  }, [lessonLocation.hash]);
  const openStudy = () => {
    const moduleId = readingModules[0]?.moduleId;
    replaceStudyHash(moduleId === undefined ? "#study" : `#study/${encodeURIComponent(moduleId)}`);
    setAct("study");
  };
  const backToBriefing = () => {
    replaceStudyHash("");
    setAct("briefing");
  };

  /*
   * 站点纸张堆叠:一次只亮一站,翻动时旧纸滑出淡去、新纸滑入。
   * 翻站后把学习幕顶部滚回视口——否则上一站很长、下一站很短时,
   * 视口会悬在空白里。
   */
  const [station, setStation] = useState(() => stationFromHash(lessonLocation.hash));
  const [leaving, setLeaving] = useState<number | null>(null);
  const dirRef = useRef<1 | -1>(1);
  const studyRef = useRef<HTMLElement | null>(null);
  const stationTotal = readingModules.length;
  useEffect(() => {
    if (!lessonLocation.hash.startsWith("#study")) return;
    setStation(stationFromHash(lessonLocation.hash));
  }, [lessonLocation.hash, readingModules]);

  /*
   * 吸顶缓冲:站点导航条吸住/松开的瞬间只靠 position:sticky 会显得硬。
   * 哨兵元素贴在导航条原位,滚出视口顶线(扣除吸顶位移)即视为吸住,
   * 交给 CSS 播落定动画并浮起影子;松开时交还原位,不做离场动画。
   */
  const [stackStuck, setStackStuck] = useState(false);
  const stackSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = stackSentinelRef.current;
    if (sentinel === null || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => setStackStuck(!(entries[entries.length - 1]?.isIntersecting ?? true)),
      // 顶部收缩量与吸顶位移 top: var(--space-3) 对齐
      { rootMargin: "-12px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [act, stationTotal]);
  const goToStation = (target: number) => {
    const next = Math.max(0, Math.min(stationTotal - 1, target));
    if (next === station) return;
    dirRef.current = next > station ? 1 : -1;
    setLeaving(station);
    setStation(next);
    const moduleId = readingModules[next]?.moduleId;
    replaceStudyHash(moduleId === undefined ? "#study" : `#study/${encodeURIComponent(moduleId)}`);
    requestAnimationFrame(() => {
      const el = studyRef.current;
      if (el === null || typeof el.scrollIntoView !== "function") return;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    });
  };
  const paperDirection = { "--paper-from": dirRef.current === 1 ? "32px" : "-32px" } as CSSProperties;
  const renderModule = (index: number) => <LessonModuleView
    module={readingModules[index]!}
    open={isOpen(readingModules[index]!.moduleId)}
    onToggle={(open) => setOpenState((current) => ({ ...current, [readingModules[index]!.moduleId]: open }))}
    lesson={lesson}
    station={stationLabel(readingModules[index]!.moduleId)}
    index={index + 1}
  />;

  if (act === "study") return (
    <section className="lesson-study" ref={studyRef}>
      <div className="study-head">
        <LessonPositionStrip flow={flow} activeNodeId={activeNodeId} />
        <button type="button" className="button text-button" onClick={backToBriefing}>{LESSON_ACTS.backToBriefing}</button>
      </div>
      {stationTotal === 0 ? null : <>
        <div className="stack-nav-sentinel" ref={stackSentinelRef} aria-hidden="true" />
        <nav className={`stack-nav${stackStuck ? " is-stuck" : ""}`} aria-label={STATION_STACK.navAria}>
          <button type="button" className="button secondary stack-nav-step" disabled={station === 0} onClick={() => goToStation(station - 1)}>{STATION_STACK.prev}</button>
          <div className="stack-nav-state">
            <span className="stack-nav-count">{STATION_STACK.count(station + 1, stationTotal)}</span>
            <ol className="stack-nav-ticks" aria-hidden="true">
              {readingModules.map((module, index) => <li key={module.moduleId}>
                <button
                  type="button"
                  data-current={index === station}
                  aria-label={STATION_STACK.jumpAria(stationLabel(module.moduleId))}
                  onClick={() => goToStation(index)}
                />
              </li>)}
            </ol>
            <span className="stack-nav-label">{readingModules[station] === undefined ? "" : stationLabel(readingModules[station]!.moduleId)}</span>
          </div>
          <button type="button" className="button primary stack-nav-step" disabled={station === stationTotal - 1} onClick={() => goToStation(station + 1)}>{STATION_STACK.next}</button>
        </nav>
        <div className="lesson-stack" style={paperDirection}>
          {leaving === null ? null : <div
            className="lesson-paper is-leaving"
            aria-hidden="true"
            key={`leaving-${leaving}-${station}`}
          >{renderModule(leaving)}</div>}
          <div className="lesson-paper is-active" key={station}>{renderModule(station)}</div>
        </div>
      </>}
      {infoModules.length === 0 ? null : <section className="learn-facts" aria-label={LEARN_PAGE_COPY.factsAriaLabel}>
        {infoModules.map((module) => <LessonModuleView
          key={module.moduleId}
          module={module}
          open={isOpen(module.moduleId)}
          onToggle={(open) => setOpenState((current) => ({ ...current, [module.moduleId]: open }))}
          lesson={lesson}
        />)}
      </section>}
      <div className="study-footer">{footer}</div>
    </section>
  );

  const tip = card.personalizedTip;
  const tipStatus = tipLoading
    ? tipProgressText ?? LEARN_PAGE_COPY.tipGenerating
    : tip === undefined
      ? LEARN_PAGE_COPY.tipUnavailableStatus
      : structuredTipReady ? LEARN_PAGE_COPY.tipStructuredStatus : LEARN_PAGE_COPY.tipLegacyStatus;

  return (
    <section className="lesson-briefing">
      <div className="briefing-band">
        <LessonPositionStrip flow={flow} activeNodeId={activeNodeId} />
      </div>
      <div className="lesson-spread">
        <article className="spread-page" aria-labelledby="learn-task-heading">
          <header className="spread-page-heading">
            <p className="task-kicker"><span className="kicker-dot" aria-hidden="true" />{LEARN_PAGE_COPY.taskKicker}</p>
            <span className="status-tag success">{lesson.label}</span>
          </header>
          <h2 id="learn-task-heading">{LEARN_PAGE_COPY.taskTitle}</h2>
          <div className="objective-columns">
            <div><h3>{LEARN_PAGE_COPY.understandHeading}</h3><ul>{lesson.learningObjectives.understand.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><h3>{LEARN_PAGE_COPY.masterHeading}</h3><ul>{lesson.learningObjectives.master.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
        </article>
        <div className="spread-spine" aria-hidden="true" />
        <article className="spread-page">
          <header className="spread-page-heading">
            <p className="task-kicker"><span className="kicker-dot" aria-hidden="true" />{LEARN_PAGE_COPY.tipTitle}</p>
            <div className="lesson-personal-tip-heading"><strong>{tipStatus}</strong></div>
          </header>
          <small className="spread-variant">{card.personalizedTip?.lessonVariantLabel ?? lesson.label}</small>
          {tipLoading ? <p className="spread-tip-body">{LEARN_PAGE_COPY.tipLoadingBody}</p>
            : tip === undefined ? <aside className="spread-tip-empty">
                <strong>{LEARN_PAGE_COPY.tipEmptyTitle}</strong>
                <p>{LEARN_PAGE_COPY.tipEmptyBody}</p>
                <p className="spread-tip-empty-next">{LEARN_PAGE_COPY.tipEmptyNext}</p>
              </aside>
              : hasStructuredLessonGuideBody(tip) ? <>
                <p className="spread-overview">{tip.lessonOverview}</p>
                <div className="lesson-guide-grid">
                  <section><span>{LEARN_PAGE_COPY.guidePrior}</span><p>{tip.priorConnection}</p></section>
                  <section><span>{LEARN_PAGE_COPY.guideFocus}</span><p>{tip.learningFocus}</p></section>
                  <section><span>{LEARN_PAGE_COPY.guideNext}</span><p>{tip.nextConnection}</p></section>
                  <section><span>{LEARN_PAGE_COPY.guideAdvice}</span><p>{tip.studyAdvice}</p></section>
                </div>
              </>
                : <p className="spread-tip-body">{tip.text}</p>}
          {tipLoading || structuredTipReady ? null : <button type="button" className="button text-button" onClick={onGenerateTip}>{tip === undefined ? LEARN_PAGE_COPY.tipRegenerate : LEARN_PAGE_COPY.tipUpgrade}</button>}
        </article>
      </div>
      {structuredTipReady && isSelfContainedGuidingQuestion(tip?.guidingQuestion) ? (
        <div className="question-band">
          <span>{LEARN_PAGE_COPY.guideQuestion}</span>
          <p>{tip!.guidingQuestion}</p>
        </div>
      ) : null}
      <div className="briefing-cta">
        {pipeline}
        <div className="briefing-actions">
          <button type="button" className="button primary" onClick={openStudy}>{LESSON_ACTS.openStudy}</button>
          {onEnterActivity === undefined ? null : (
            <button type="button" className="button text-button" disabled={tipLoading} onClick={onEnterActivity}>{LESSON_ACTS.skipToActivity}</button>
          )}
        </div>
      </div>
    </section>
  );
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
  const pipelineBody = agentRun.run !== undefined
    ? <AgentPipeline run={agentRun.run} mode={agentRun.transport === "complete" ? "snapshot" : "live"} resourceKind={pipelineResourceKind} onExport={() => downloadAgentRunExport(agentRun.run!.runId).then(() => undefined)} />
    : agentRequestId !== undefined
      ? <AgentPipelineDiscovery resourceKind={pipelineResourceKind} statusText={actionProgress.text ?? AGENT_PIPELINE_STATUS_FALLBACK} />
      : null;

  /*
   * 流水线收纳:默认只露一条状态带,展开后是完整八工位工作台。
   * 运行失败时自动展开——出错恰恰是最需要看内部状态的时刻。
   */
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const pipelineFailed = agentRun.run?.status === "failed";
  useEffect(() => {
    if (pipelineFailed) setPipelineOpen(true);
  }, [pipelineFailed]);
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

  // 任务卡上的「本节位置」与正文站点共用同一份动线数据。
  const activeNodeId = displayNode?.nodeId;
  const flowView = useMemo(() => buildStudyFlow(session?.path?.nodes ?? [], buildFlowContext(session, {
    currentStep: "lesson",
    ...(activeNodeId === undefined ? {} : { activeNodeId }),
    hasActivity: next?.activity !== undefined,
  })), [session, activeNodeId, next?.activity]);

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
                : <RichLessonView card={displayCard as LearningCardSafeView & { selectedLesson: SelectedLessonSafeView }} flow={flowView} activeNodeId={activeNodeId} pipeline={pipeline} footer={taskFooter} tipLoading={tipBusy} tipProgressText={tipBusy ? actionProgress.text : undefined} onGenerateTip={() => { setTipAttemptedNodeId(undefined); void prepareTip(); }} onEnterActivity={next.activity === undefined || reviewingEarlierLesson ? undefined : () => void open()} />}
        </article>
      </div>
    </> : null}
  </PageFrame>;
}
