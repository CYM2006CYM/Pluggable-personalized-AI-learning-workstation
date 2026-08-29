import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CompleteSessionOutput, SessionRecoverySafeView } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { SummaryGenerationPipeline } from "../components/SummaryGenerationPipeline.js";
import { useAgentRun } from "../hooks/use-agent-run.js";
import { useAsyncActionProgress } from "../hooks/use-async-action-progress.js";
import { knowledgeStatusLabel, masteryLabel, profileStatusLabel } from "../copy/ui-copy.js";
import { knowledgePointLabel } from "../learning-labels.js";
import "./SummaryPage.css";
import {
  ARCHIVE_CARD,
  DIAGNOSTIC_SKIPS,
  FALLBACK_LESSON_TITLE,
  MASTERY_GAINS,
  NEXT_TASK,
  PROFILE_DETAIL,
  SUMMARY_JOURNEY,
  SUMMARY_OUTCOME,
  SUMMARY_PAGE,
  SUMMARY_STATE_COPY,
  SUMMARY_STATS,
  UNRESOLVED,
  attemptsLabel,
  bestResultLabel,
  diagnosticOutcomeLabel,
  evidenceCountLabel,
  pathPlannedLabel,
  runsLabel,
  unresolvedResultLabel,
} from "../copy/summary-page-copy.js";

type UnresolvedResult = "fail" | "partial" | "insufficient" | "unverified";
interface UnresolvedItem { nodeId: string; activityId: string; title: string; result: UnresolvedResult; bestResult?: UnresolvedResult | "pass"; attemptCount: number; continuedWithGap: boolean }
interface DiagnosticSkippedItem { nodeId: string; title: string; finalPracticalRetained: boolean }

type LearnerProfile = NonNullable<SessionRecoverySafeView["learningProfile"]>;

export function SummaryPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const bootstrap = useBootstrap(sessionId);
  const [output, setOutput] = useState<CompleteSessionOutput>();
  const [actionError, setActionError] = useState<Error>();
  const [attempted, setAttempted] = useState(false);
  const [summaryRequestId, setSummaryRequestId] = useState(() => newRequestId("web-complete-session"));
  const actionProgress = useAsyncActionProgress();
  const session = bootstrap.data?.session;
  const resolvedOutput = output ?? session?.completedSummary;
  const unresolved = useMemo(() => unresolvedActivities(session), [session]);
  const diagnosticSkipped = useMemo(() => diagnosticSkippedModules(session), [session]);
  const generating = attempted && actionError === undefined && resolvedOutput === undefined;
  const agentRun = useAgentRun({ requestId: generating ? summaryRequestId : undefined, active: generating });

  useEffect(() => {
    if (attempted || session === undefined || session.view.status === "completed") return;
    setAttempted(true);
    actionProgress.start(SUMMARY_STATE_COPY.generating);
    api.completeSession({ requestId: summaryRequestId, sessionId, sessionVersion: session.view.sessionVersion, profileRevision: session.view.profileRevision })
      .then(setOutput)
      .catch((error: unknown) => setActionError(error instanceof Error ? error : new Error("complete_session_failed")))
      .finally(actionProgress.stop);
  }, [actionProgress.start, actionProgress.stop, attempted, session, sessionId, summaryRequestId]);

  const error = actionError ?? bootstrap.error;
  const profile = resolvedOutput?.learningProfile ?? session?.learningProfile;
  return <PageFrame eyebrow={SUMMARY_PAGE.eyebrow} title={SUMMARY_PAGE.title} summary={resolvedOutput?.summary ?? SUMMARY_PAGE.pageSummaryFallback} back={{ to: "/", label: SUMMARY_PAGE.backToMenu }}>
    {bootstrap.loading ? <PageStatePanel page="summary" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="summary" state={isApiError(error) && error.status === 409 ? "conflict" : "error"} code={isApiError(error) ? error.code : error.message} detail={SUMMARY_STATE_COPY.conflictDetail} onRetry={() => { setActionError(undefined); setSummaryRequestId(newRequestId("web-complete-session")); setAttempted(false); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && session === undefined ? <PageStatePanel page="summary" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && session !== undefined && generating ? <SummaryGenerationPipeline run={agentRun.run} transport={agentRun.transport} elapsedText={actionProgress.text ?? SUMMARY_STATE_COPY.generatingElapsedFallback} /> : null}
    {!bootstrap.loading && error === undefined && session?.view.status === "completed" && resolvedOutput === undefined ? <><PageStatePanel page="summary" state="recovery" code="COMPLETED_SUMMARY_ARCHIVE_MISSING" detail={SUMMARY_STATE_COPY.archiveMissingDetail} /><SummaryJourney session={session} profile={profile} unresolved={unresolved} diagnosticSkipped={diagnosticSkipped} /></> : null}
    {!bootstrap.loading && error === undefined && resolvedOutput !== undefined && session !== undefined ? <SummaryJourney session={session} output={resolvedOutput} profile={profile} unresolved={unresolved} diagnosticSkipped={diagnosticSkipped} /> : null}
  </PageFrame>;
}

/**
 * 按动线环节（诊断 → 路径 →〔学习 ⇄ 测试〕→ 总结）汇总本次学习，
 * 末尾给一个明确的下一步去向任务卡。完成归档 SHA-256 收进折叠区。
 */
function SummaryJourney({ session, output, profile, unresolved, diagnosticSkipped }: {
  session: SessionRecoverySafeView;
  output?: CompleteSessionOutput;
  profile?: LearnerProfile;
  unresolved: UnresolvedItem[];
  diagnosticSkipped: DiagnosticSkippedItem[];
}) {
  const firstUnresolved = unresolved[0];
  return <div className="summary-layout summary-page" data-page="summary">
    <SummaryStats session={session} unresolvedCount={unresolved.length} skipCount={diagnosticSkipped.length} />
    <DiagnosticStage session={session} profile={profile} />
    <PathStage count={session.path?.nodes.length ?? 0} />
    <LearningStage session={session} profile={profile} unresolved={unresolved} diagnosticSkipped={diagnosticSkipped} />
    {output === undefined ? null : <SummaryStage output={output} />}
    {session.completionArchiveSha256 === undefined ? null : <ArchiveCard session={session} output={output} />}
    {profile === undefined ? null : <ProfileDetails profile={profile} />}
    <NextTaskCard sessionId={session.sessionId} firstUnresolved={firstUnresolved} />
  </div>;
}

function SummaryStats({ session, unresolvedCount, skipCount }: { session: SessionRecoverySafeView; unresolvedCount: number; skipCount: number }) {
  const activityCount = session.activityProgress.flatMap((node) => node.activities).length;
  return <div className="summary-stats" aria-label={SUMMARY_STATS.metricsLabel}>
    <div className="summary-stat"><span className="summary-stat-label">{SUMMARY_STATS.path.label}</span><strong className="summary-stat-value">{session.path?.nodes.length ?? 0}</strong><small className="summary-stat-hint">{SUMMARY_STATS.path.unit} · {SUMMARY_STATS.path.hint}</small></div>
    <div className="summary-stat"><span className="summary-stat-label">{SUMMARY_STATS.activity.label}</span><strong className="summary-stat-value">{activityCount}</strong><small className="summary-stat-hint">{SUMMARY_STATS.activity.unit} · {SUMMARY_STATS.activity.hint}</small></div>
    <div className="summary-stat"><span className="summary-stat-label">{SUMMARY_STATS.unresolved.label}</span><strong className="summary-stat-value">{unresolvedCount}</strong><small className="summary-stat-hint">{SUMMARY_STATS.unresolved.unit} · {SUMMARY_STATS.unresolved.hint}</small></div>
    <div className="summary-stat"><span className="summary-stat-label">{SUMMARY_STATS.skip.label}</span><strong className="summary-stat-value">{skipCount}</strong><small className="summary-stat-hint">{SUMMARY_STATS.skip.unit} · {SUMMARY_STATS.skip.hint}</small></div>
  </div>;
}

function DiagnosticStage({ session, profile }: { session: SessionRecoverySafeView; profile?: LearnerProfile }) {
  const initial = profile?.initialKnowledgeStates;
  const covered = initial?.length ?? session.knowledgeStates?.length ?? 0;
  const readyCount = initial === undefined ? undefined : initial.filter((state) => state.status === "ready" || state.status === "mastered").length;
  const supportCount = initial === undefined ? undefined : initial.filter((state) => state.status === "support_needed" || state.status === "unverified" || state.status === "learning").length;
  return <section className="summary-card" data-stage="diagnostic">
    <p className="summary-kicker">{SUMMARY_JOURNEY.diagnostic.kicker}</p>
    <h2>{SUMMARY_JOURNEY.diagnostic.heading}</h2>
    <p className="summary-body">{diagnosticOutcomeLabel(covered, readyCount, supportCount)}</p>
  </section>;
}

function PathStage({ count }: { count: number }) {
  return <section className="summary-card" data-stage="path">
    <p className="summary-kicker">{SUMMARY_JOURNEY.path.kicker}</p>
    <h2>{SUMMARY_JOURNEY.path.heading}</h2>
    <p className="summary-body">{pathPlannedLabel(count)}</p>
  </section>;
}

/** 学习 ⇄ 测试：学后掌握、主动跳过、仍需处理三个并列分区，不合并。 */
function LearningStage({ session, profile, unresolved, diagnosticSkipped }: {
  session: SessionRecoverySafeView;
  profile?: LearnerProfile;
  unresolved: UnresolvedItem[];
  diagnosticSkipped: DiagnosticSkippedItem[];
}) {
  return <section className="summary-card" data-stage="learning">
    <p className="summary-kicker">{SUMMARY_JOURNEY.learning.kicker}</p>
    <h2>{SUMMARY_JOURNEY.learning.heading}</h2>
    {profile === undefined ? null : <MasteryGains profile={profile} />}
    {diagnosticSkipped.length === 0 ? null : <DiagnosticSkips items={diagnosticSkipped} />}
    <UnresolvedItems session={session} items={unresolved} />
  </section>;
}

/** 学后掌握：前后状态用中文枚举，掌握分档与依据条数同列。 */
function MasteryGains({ profile }: { profile: LearnerProfile }) {
  const masteryById = useMemo(() => new Map(profile.currentKnowledgeStates.map((state) => [state.knowledgePointId, state.mastery])), [profile]);
  return <section className="summary-subcard" data-section="mastery-gains">
    <h3>{MASTERY_GAINS.heading}</h3>
    <p className="summary-note">{MASTERY_GAINS.balanceLabel(profile.strengths.length, profile.supportNeeded.length)}</p>
    {profile.progress.length === 0 ? null : <ul className="summary-progress">
      {profile.progress.map((item) => <li className="summary-progress-item" key={item.knowledgePointId}>
        <strong className="summary-progress-name">{knowledgePointLabel(item.knowledgePointId)}</strong>
        <span className="summary-progress-change">{knowledgeStatusLabel(item.beforeStatus)} → {knowledgeStatusLabel(item.afterStatus)} · {item.improved ? MASTERY_GAINS.improved : MASTERY_GAINS.notImproved}</span>
        <small className="summary-progress-meta">{MASTERY_GAINS.masteryAffix} {masteryLabel(masteryById.get(item.knowledgePointId))} · {evidenceCountLabel(item.evidenceIds.length)}</small>
      </li>)}
    </ul>}
  </section>;
}

/** 主动跳过章节：与学后掌握分开展示，两态（整节跳过 / 跳过教学保留实操）各自标注。 */
function DiagnosticSkips({ items }: { items: DiagnosticSkippedItem[] }) {
  return <section className="summary-subcard" data-section="diagnostic-skips">
    <h3>{DIAGNOSTIC_SKIPS.heading}</h3>
    <p className="summary-note">{DIAGNOSTIC_SKIPS.intro}</p>
    <ul className="summary-unresolved">
      {items.map((item) => <li className="summary-unresolved-item" key={item.nodeId}>
        <div className="summary-unresolved-copy">
          <strong>{item.title}</strong>
          <span>{item.finalPracticalRetained ? DIAGNOSTIC_SKIPS.teachingRetained : DIAGNOSTIC_SKIPS.fullySkipped}</span>
        </div>
        <span className="summary-tag">{DIAGNOSTIC_SKIPS.reasonTag}</span>
      </li>)}
    </ul>
  </section>;
}

function UnresolvedItems({ session, items }: { session: SessionRecoverySafeView; items: UnresolvedItem[] }) {
  return <section className="summary-subcard" data-section="unresolved-items">
    <h3>{UNRESOLVED.heading}</h3>
    {items.length === 0 ? <p className="summary-note">{UNRESOLVED.empty}</p> : <ul className="summary-unresolved">
      {items.map((item) => <li className="summary-unresolved-item" key={`${item.nodeId}:${item.activityId}`}>
        <div className="summary-unresolved-copy">
          <strong>{item.title}</strong>
          <span>{unresolvedLine(item)}</span>
        </div>
        <Link className="summary-revisit" to={`/learn/${session.sessionId}/${item.nodeId}`}>{UNRESOLVED.reviewLink}</Link>
      </li>)}
    </ul>}
  </section>;
}

function SummaryStage({ output }: { output: CompleteSessionOutput }) {
  return <section className="summary-card" data-stage="summary">
    <p className="summary-kicker">{SUMMARY_JOURNEY.summary.kicker}</p>
    <h2>{SUMMARY_JOURNEY.summary.heading}</h2>
    <p className="summary-body">{output.summary}</p>
    <p className="summary-recommendation"><strong>{SUMMARY_OUTCOME.nextRecommendation}</strong>{output.nextRecommendation ?? SUMMARY_OUTCOME.noRecommendation}</p>
  </section>;
}

/** 完成归档折叠区：默认折叠。归档 SHA-256 是受测试保护的可复验证据，标签用中文包裹。 */
function ArchiveCard({ session, output }: { session: SessionRecoverySafeView; output?: CompleteSessionOutput }) {
  return <details className="summary-info" data-section="completion-archive">
    <summary>{ARCHIVE_CARD.summaryLabel}</summary>
    <div className="summary-info-body">
      <h3>{ARCHIVE_CARD.heading}</h3>
      <dl className="summary-info-metrics">
        <div><dt>{ARCHIVE_CARD.completedAt}</dt><dd>{output?.completedAt ?? ARCHIVE_CARD.notRecorded}</dd></div>
        <div><dt>{ARCHIVE_CARD.runs}</dt><dd>{runsLabel(session.agentRunIds?.length ?? 0)}</dd></div>
        <div><dt>{ARCHIVE_CARD.shaLabel}</dt><dd className="summary-hash">{session.completionArchiveSha256}</dd></div>
      </dl>
    </div>
  </details>;
}

/** 学情画像详情折叠区：默认折叠。 */
function ProfileDetails({ profile }: { profile: LearnerProfile }) {
  return <details className="summary-info" data-section="profile-detail">
    <summary>{PROFILE_DETAIL.summaryLabel}</summary>
    <div className="summary-info-body">
      <h3>{PROFILE_DETAIL.heading}</h3>
      <dl className="summary-info-metrics">
        <div><dt>{PROFILE_DETAIL.agentStatus}</dt><dd>{profileStatusLabel(profile.agentStatus)}</dd></div>
        <div><dt>{PROFILE_DETAIL.formalEvidence}</dt><dd>{evidenceCountLabel(profile.evidenceIds.length)}</dd></div>
      </dl>
      <p className="summary-body">{profile.deterministicSummary}</p>
      {profile.agentExplanation === undefined ? null : <p className="summary-note"><strong>{PROFILE_DETAIL.agentNotePrefix}</strong>：{profile.agentExplanation}</p>}
    </div>
  </details>;
}

/** 全页唯一任务卡：下一步去向。 */
function NextTaskCard({ sessionId, firstUnresolved }: { sessionId: string; firstUnresolved?: UnresolvedItem }) {
  return <section className="summary-card summary-task" data-section="next-steps">
    <p className="summary-kicker">{NEXT_TASK.kicker}</p>
    <h2>{NEXT_TASK.heading}</h2>
    <div className="branch-list summary-branch">
      {firstUnresolved === undefined ? null : <Link to={`/learn/${sessionId}/${firstUnresolved.nodeId}`}><strong>{NEXT_TASK.reviewFirst}</strong><span>{firstUnresolved.title}</span></Link>}
      <Link to="/"><strong>{NEXT_TASK.backToMenu}</strong><span>{NEXT_TASK.backToMenuNote}</span></Link>
      <Link to="/"><strong>{NEXT_TASK.newSession}</strong><span>{NEXT_TASK.newSessionNote}</span></Link>
    </div>
  </section>;
}

function unresolvedActivities(session?: SessionRecoverySafeView): UnresolvedItem[] {
  if (session === undefined) return [];
  return session.activityProgress.reduce<UnresolvedItem[]>((items, node) => {
    const pathNode = session.path?.nodes.find((item) => item.nodeId === node.nodeId);
    const knowledgePointId = pathNode?.knowledgePointId;
    const diagnosticSkipSelected = pathNode?.reasonCodes.includes("diagnostic_skip_selected") === true;
    const title = session.learningCards?.find((item) => item.nodeId === node.nodeId)?.card.title
      ?? (knowledgePointId === undefined ? FALLBACK_LESSON_TITLE : knowledgePointLabel(knowledgePointId));
    for (const activity of node.activities) {
      if (activity.result === "partial" || activity.result === "fail" || activity.result === "insufficient") {
        items.push({ nodeId: node.nodeId, activityId: activity.activityId, title, result: activity.result, bestResult: activity.bestResult, attemptCount: activity.attemptIds.length, continuedWithGap: activity.continuedWithGap === true });
      } else if (!diagnosticSkipSelected && pathNode?.status !== "skipped" && (activity.status === "pending" || activity.status === "in_progress")) {
        items.push({ nodeId: node.nodeId, activityId: activity.activityId, title, result: "unverified", bestResult: activity.bestResult, attemptCount: activity.attemptIds.length, continuedWithGap: false });
      }
    }
    return items;
  }, []);
}

function diagnosticSkippedModules(session?: SessionRecoverySafeView): DiagnosticSkippedItem[] {
  return (session?.path?.nodes ?? [])
    .filter((node) => node.reasonCodes.includes("diagnostic_skip_selected"))
    .map((node) => ({
      nodeId: node.nodeId,
      title: knowledgePointLabel(node.knowledgePointId),
      finalPracticalRetained: node.status !== "skipped",
    }));
}

function unresolvedLine(item: UnresolvedItem): string {
  const primary = item.continuedWithGap ? UNRESOLVED.continuedWithGap : unresolvedResultLabel(item.result);
  const attempts = attemptsLabel(item.attemptCount);
  return item.bestResult === undefined
    ? `${primary} · ${attempts}`
    : `${primary} · ${attempts} · ${UNRESOLVED.bestResult} ${bestResultLabel(item.bestResult)}`;
}