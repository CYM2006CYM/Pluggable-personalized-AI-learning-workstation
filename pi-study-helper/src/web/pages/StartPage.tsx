import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AppBootstrapSafeView, BackgroundQuestionnaire, LearningEntryMode } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { routeForSession } from "../api/navigation.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { experienceLabel, stageLabel } from "../copy/ui-copy.js";
import { EXPLANATION_PREFERENCES, entryModeLabel, modalityLabel, START_PAGE_COPY } from "../copy/start-page-copy.js";
import "./StartPage.css";

const EXPERIENCE = ["none", "basic", "comfortable", "uncertain"] as const;
const DEFAULT_BACKGROUND: BackgroundQuestionnaire = {
  python_experience: "uncertain",
  pandas_experience: "uncertain",
  explanation_preference: "step_by_step",
};
const SYSTEM_PATH_BUDGET_MINUTES = 400;

/** 可恢复会话里没有资料包名与目标标题,从 bootstrap 清单反查,查不到回落中文通称。 */
function profileNameOf(profiles: AppBootstrapSafeView["profiles"], subjectId: string): string | undefined {
  return profiles.find((profile) => profile.subjectId === subjectId)?.name;
}

function goalTitleOf(goals: AppBootstrapSafeView["goals"], goalId: string): string | undefined {
  return goals.find((goal) => goal.goalId === goalId)?.title;
}

export function StartPage() {
  const bootstrap = useBootstrap();
  const navigate = useNavigate();
  const [mode, setMode] = useState<LearningEntryMode>("recommended");
  const [subjectId, setSubjectId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error>();

  useEffect(() => {
    if (bootstrap.data === undefined) return;
    setSubjectId((value) => bootstrap.data!.profiles.some((profile) => profile.subjectId === value)
      ? value
      : bootstrap.data!.profiles[0]?.subjectId ?? "");
    setGoalId((value) => value || bootstrap.data!.goals[0]?.goalId || "");
    setChapterId((value) => value || bootstrap.data!.chapters[0]?.chapterId || "");
  }, [bootstrap.data]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (bootstrap.data === undefined) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const session = await api.startSession({
        requestId: newRequestId("web-start"), subjectId, mode, goalId, availableMinutes: SYSTEM_PATH_BUDGET_MINUTES,
        ...(mode === "chapter" ? { chapterId } : {}),
      });
      await api.saveDiagnosticDraft({
        requestId: newRequestId("web-diagnostic-draft"),
        sessionId: session.sessionId,
        sessionVersion: session.sessionVersion,
        profileRevision: session.profileRevision,
        diagnosticId: bootstrap.data.diagnostic.diagnosticId,
        diagnosticVersion: bootstrap.data.diagnostic.diagnosticVersion,
        background,
        diagnosticDraftVersion: 0,
        ...(mode === "recommended" && bootstrap.data.diagnostic.questions[0] !== undefined
          ? { currentQuestionId: bootstrap.data.diagnostic.questions[0].questionId }
          : {}),
      });
      navigate(`/diagnostic/${session.sessionId}`);
    } catch (error) {
      setActionError(error instanceof Error ? error : new Error("start_failed"));
    } finally {
      setBusy(false);
    }
  };

  const recover = async (sessionId: string) => {
    setBusy(true);
    setActionError(undefined);
    try {
      const recovered = await api.getBootstrap(sessionId);
      if (recovered.session === undefined) throw new Error("session_not_found");
      navigate(routeForSession(recovered.session));
    } catch (error) {
      setActionError(error instanceof Error ? error : new Error("recovery_failed"));
    } finally {
      setBusy(false);
    }
  };

  const stateError = actionError ?? bootstrap.error;
  const activeProfile = bootstrap.data?.profiles.find((profile) => profile.subjectId === subjectId)
    ?? bootstrap.data?.profiles[0];
  const activeGoalTitle = goalTitleOf(bootstrap.data?.goals ?? [], goalId) ?? START_PAGE_COPY.fallbackLabel;
  return (
    <PageFrame eyebrow={START_PAGE_COPY.eyebrow} title={START_PAGE_COPY.title} summary={START_PAGE_COPY.summary}>
      {bootstrap.loading ? <PageStatePanel page="start" state="loading" /> : null}
      {!bootstrap.loading && stateError ? <PageStatePanel page="start" state={isApiError(stateError) && stateError.status === 409 ? "conflict" : "error"} code={isApiError(stateError) ? stateError.code : stateError.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
      {!bootstrap.loading && stateError === undefined && (bootstrap.data?.profiles.length === 0 || bootstrap.data?.goals.length === 0) ? <PageStatePanel page="start" state="empty" /> : null}
      {!bootstrap.loading && stateError === undefined && bootstrap.data !== undefined && bootstrap.data.profiles.length > 0 && bootstrap.data.goals.length > 0 ? (
        <div className="start-page" data-page="start">
          <form className="task-card start-task" aria-labelledby="start-task-title" onSubmit={start}>
            <div className="task-heading">
              <p className="task-kicker">{START_PAGE_COPY.taskKicker}</p>
              <h2 id="start-task-title" className="task-title">{START_PAGE_COPY.taskTitle}</h2>
              <p className="task-lede">{START_PAGE_COPY.taskLede}</p>
            </div>
            <div className="start-form-grid">
              <label className="start-field">{START_PAGE_COPY.formPackageLabel}<select className="start-select" aria-label={START_PAGE_COPY.formPackageLabel} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{bootstrap.data.profiles.map((profile) => <option key={profile.subjectId} value={profile.subjectId}>{profile.name}</option>)}</select></label>
              <fieldset className="start-mode-field"><legend>{START_PAGE_COPY.formModeLabel}</legend><label className="start-choice-row"><input type="radio" name="entry" checked={mode === "recommended"} onChange={() => setMode("recommended")} /> {START_PAGE_COPY.formModeRecommended}</label><label className="start-choice-row"><input type="radio" name="entry" checked={mode === "chapter"} onChange={() => setMode("chapter")} /> {START_PAGE_COPY.formModeChapter}</label></fieldset>
              <label className="start-field">{START_PAGE_COPY.formGoalLabel}<select className="start-select" aria-label={START_PAGE_COPY.formGoalLabel} value={goalId} onChange={(event) => setGoalId(event.target.value)}>{bootstrap.data.goals.map((goal) => <option key={goal.goalId} value={goal.goalId}>{goal.title}</option>)}</select></label>
              <div className="start-time-note"><strong>{START_PAGE_COPY.timeNoteTitle}</strong><span>{START_PAGE_COPY.timeNoteBody}</span></div>
              {mode === "chapter" ? <label className="start-field">{START_PAGE_COPY.formChapterLabel}<select className="start-select" aria-label={START_PAGE_COPY.formChapterLabel} value={chapterId} onChange={(event) => setChapterId(event.target.value)}>{bootstrap.data.chapters.map((chapter) => <option key={chapter.chapterId} value={chapter.chapterId}>{chapter.title}</option>)}</select></label> : null}
              <label className="start-field">{START_PAGE_COPY.formPythonLabel}<select className="start-select" aria-label={START_PAGE_COPY.formPythonLabel} value={background.python_experience} onChange={(event) => setBackground({ ...background, python_experience: event.target.value as BackgroundQuestionnaire["python_experience"] })}>{EXPERIENCE.map((value) => <option key={value} value={value}>{experienceLabel(value)}</option>)}</select></label>
              <label className="start-field">{START_PAGE_COPY.formPandasLabel}<select className="start-select" aria-label={START_PAGE_COPY.formPandasLabel} value={background.pandas_experience} onChange={(event) => setBackground({ ...background, pandas_experience: event.target.value as BackgroundQuestionnaire["pandas_experience"] })}>{EXPERIENCE.map((value) => <option key={value} value={value}>{experienceLabel(value)}</option>)}</select></label>
              <label className="start-field">{START_PAGE_COPY.formPreferenceLabel}<select className="start-select" aria-label={START_PAGE_COPY.formPreferenceLabel} value={background.explanation_preference} onChange={(event) => setBackground({ ...background, explanation_preference: event.target.value as BackgroundQuestionnaire["explanation_preference"] })}>{EXPLANATION_PREFERENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
            <div className="task-footer">
              <p className="task-footer-note">{START_PAGE_COPY.taskFooterNote}</p>
              <button type="submit" className="cta-start" disabled={busy || subjectId === "" || goalId === "" || (mode === "chapter" && chapterId === "")}>{busy ? START_PAGE_COPY.ctaBusy : START_PAGE_COPY.ctaStart}</button>
            </div>
          </form>

          <details className="info-card start-material">
            <summary>
              <span className="info-card-title">{START_PAGE_COPY.materialTitle}</span>
              <span className="info-card-facts">{activeProfile?.name ?? START_PAGE_COPY.fallbackLabel} · {activeGoalTitle}</span>
              <span className="info-card-chevron" aria-hidden="true"></span>
            </summary>
            <dl className="info-card-body">
              <div><dt>{START_PAGE_COPY.materialCapabilityLabel}</dt><dd>{activeProfile?.modalities.map(modalityLabel).join(" / ") ?? START_PAGE_COPY.fallbackLabel}</dd></div>
              <div><dt>{START_PAGE_COPY.materialGoalLabel}</dt><dd>{activeGoalTitle}</dd></div>
              <div><dt>{START_PAGE_COPY.materialModeLabel}</dt><dd>{mode === "chapter" ? START_PAGE_COPY.formModeChapter : START_PAGE_COPY.formModeRecommended}</dd></div>
            </dl>
          </details>

          {bootstrap.data.recoverableSessions.length === 0 ? null : (
            <section className="resume-group" aria-labelledby="resume-heading">
              <div className="resume-group-heading">
                <h2 id="resume-heading" className="resume-heading">{START_PAGE_COPY.resumeTitle}</h2>
                <p className="resume-lede">{START_PAGE_COPY.resumeLede}</p>
              </div>
              <ul className="resume-list">
                {bootstrap.data.recoverableSessions.slice(0, 2).map((session) => (
                  <li className="resume-item" key={session.sessionId}>
                    <div className="resume-item-main">
                      <p className="resume-item-title"><span className="resume-stage">{stageLabel(session.stage)}</span>{profileNameOf(bootstrap.data!.profiles, session.subjectId) ?? START_PAGE_COPY.fallbackLabel}</p>
                      <p className="resume-item-meta">{goalTitleOf(bootstrap.data!.goals, session.goalId) ?? START_PAGE_COPY.fallbackLabel} · {entryModeLabel(session.mode)}</p>
                    </div>
                    <button type="button" className="resume-cta" disabled={busy} onClick={() => void recover(session.sessionId)}>{START_PAGE_COPY.resumeCta}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </PageFrame>
  );
}