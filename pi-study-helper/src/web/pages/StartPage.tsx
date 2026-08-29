import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AppBootstrapSafeView, BackgroundQuestionnaire, LearningEntryMode } from "../../contracts/index.js";
import type { StudyStepId } from "../flow/study-flow.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { routeForSession } from "../api/navigation.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { experienceLabel, stepLabel } from "../copy/ui-copy.js";
import { EXPLANATION_PREFERENCES, modalityLabel, START_PAGE_COPY } from "../copy/start-page-copy.js";
import "./StartPage.css";

const EXPERIENCE = ["none", "basic", "comfortable", "uncertain"] as const;
const DEFAULT_BACKGROUND: BackgroundQuestionnaire = {
  python_experience: "uncertain",
  pandas_experience: "uncertain",
  explanation_preference: "step_by_step",
};
const SYSTEM_PATH_BUDGET_MINUTES = 400;

/** 右栏页签扇的五个环节,文案取语义层 stepLabel(准备/诊断/分析/学习/总结)。 */
const FAN_STEPS: readonly StudyStepId[] = ["prepare", "diagnostic", "analysis", "lesson", "summary"];

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
  const recoverableSession = bootstrap.data?.recoverableSessions[0];
  return (
    <PageFrame eyebrow={START_PAGE_COPY.eyebrow} title={START_PAGE_COPY.title} summary={START_PAGE_COPY.summary}>
      {bootstrap.loading ? <PageStatePanel page="start" state="loading" /> : null}
      {!bootstrap.loading && stateError ? <PageStatePanel page="start" state={isApiError(stateError) && stateError.status === 409 ? "conflict" : "error"} code={isApiError(stateError) ? stateError.code : stateError.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
      {!bootstrap.loading && stateError === undefined && (bootstrap.data?.profiles.length === 0 || bootstrap.data?.goals.length === 0) ? <PageStatePanel page="start" state="empty" /> : null}
      {!bootstrap.loading && stateError === undefined && bootstrap.data !== undefined && bootstrap.data.profiles.length > 0 && bootstrap.data.goals.length > 0 ? (
        <div className="start-page" data-page="start">
          {/* 扉页标题区:eyebrow 小标签 + 荧光笔主标题 + 副标题(印章与胶带由 CSS 伪元素承载) */}
          <header className="sp-heading">
            <p className="sp-eyebrow">{START_PAGE_COPY.eyebrow}</p>
            <h1 className="sp-title">
              {START_PAGE_COPY.titleLead}
              <span className="sp-phrase">{START_PAGE_COPY.titlePhrase}</span>
              {START_PAGE_COPY.titleTail}
            </h1>
            <p className="sp-summary">{START_PAGE_COPY.summary}</p>
          </header>

          {/* 右栏桌面拼贴:纯装饰部分整块 aria-hidden;书签夹页保留真实交互,放在 aria-hidden 之外 */}
          <div className="sp-side">
            <div className="sp-collage" aria-hidden="true">
              <div className="sp-stack">
                <div className="sp-letter">
                  <span className="sp-line" />
                  <span className="sp-line sp-line-highlight" />
                  <span className="sp-line" />
                  <span className="sp-line sp-line-short" />
                </div>
              </div>
              <ul className="sp-fan">
                {FAN_STEPS.map((step, index) => (
                  <li key={step} className={step === "lesson" ? "sp-tab sp-tab-accent" : "sp-tab"} style={{ "--tab-rotate": `${(index - 2) * 3}deg` } as CSSProperties}>
                    {stepLabel(step)}
                  </li>
                ))}
              </ul>
            </div>
            {recoverableSession === undefined ? null : (
              <div className="sp-bookmark-wrap">
                <button type="button" className="sp-bookmark" disabled={busy} onClick={() => void recover(recoverableSession.sessionId)}>
                  <span className="sp-bookmark-text">
                    <span className="sp-bookmark-kicker">{START_PAGE_COPY.bookmarkKicker}</span>
                    <span className="sp-bookmark-name">{profileNameOf(bootstrap.data!.profiles, recoverableSession.subjectId) ?? START_PAGE_COPY.fallbackLabel}</span>
                  </span>
                  <span className="sp-bookmark-cta">{START_PAGE_COPY.resumeCta}</span>
                </button>
              </div>
            )}
          </div>

          {/* 左栏:三问三卡 + 主操作 + 教材信息卡 */}
          <div className="sp-main">
            <form className="sp-form" aria-label={START_PAGE_COPY.taskTitle} onSubmit={start}>
              <section className="sp-card" aria-labelledby="sp-card-1-title">
                <div className="sp-card-head">
                  <span className="sp-card-no" aria-hidden="true">1</span>
                  <h2 id="sp-card-1-title" className="sp-card-title">{START_PAGE_COPY.question1Title}</h2>
                </div>
                <div className="sp-card-body">
                  <label className="sp-field">{START_PAGE_COPY.formPackageLabel}<select className="sp-select" aria-label={START_PAGE_COPY.formPackageLabel} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{bootstrap.data.profiles.map((profile) => <option key={profile.subjectId} value={profile.subjectId}>{profile.name}</option>)}</select></label>
                </div>
              </section>

              <section className="sp-card" aria-labelledby="sp-card-2-title">
                <div className="sp-card-head">
                  <span className="sp-card-no" aria-hidden="true">2</span>
                  <h2 id="sp-card-2-title" className="sp-card-title">{START_PAGE_COPY.question2Title}</h2>
                </div>
                <div className="sp-card-body">
                  <fieldset className="sp-mode-field"><legend>{START_PAGE_COPY.formModeLabel}</legend><label className="sp-choice-row"><input type="radio" name="entry" checked={mode === "recommended"} onChange={() => setMode("recommended")} /> {START_PAGE_COPY.formModeRecommended}</label><label className="sp-choice-row"><input type="radio" name="entry" checked={mode === "chapter"} onChange={() => setMode("chapter")} /> {START_PAGE_COPY.formModeChapter}</label></fieldset>
                  <label className="sp-field">{START_PAGE_COPY.formGoalLabel}<select className="sp-select" aria-label={START_PAGE_COPY.formGoalLabel} value={goalId} onChange={(event) => setGoalId(event.target.value)}>{bootstrap.data.goals.map((goal) => <option key={goal.goalId} value={goal.goalId}>{goal.title}</option>)}</select></label>
                  {mode === "chapter" ? <label className="sp-field">{START_PAGE_COPY.formChapterLabel}<select className="sp-select" aria-label={START_PAGE_COPY.formChapterLabel} value={chapterId} onChange={(event) => setChapterId(event.target.value)}>{bootstrap.data.chapters.map((chapter) => <option key={chapter.chapterId} value={chapter.chapterId}>{chapter.title}</option>)}</select></label> : null}
                </div>
              </section>

              <section className="sp-card" aria-labelledby="sp-card-3-title">
                <div className="sp-card-head">
                  <span className="sp-card-no" aria-hidden="true">3</span>
                  <h2 id="sp-card-3-title" className="sp-card-title">{START_PAGE_COPY.question3Title}</h2>
                </div>
                <div className="sp-card-body">
                  <label className="sp-field">{START_PAGE_COPY.formPythonLabel}<select className="sp-select" aria-label={START_PAGE_COPY.formPythonLabel} value={background.python_experience} onChange={(event) => setBackground({ ...background, python_experience: event.target.value as BackgroundQuestionnaire["python_experience"] })}>{EXPERIENCE.map((value) => <option key={value} value={value}>{experienceLabel(value)}</option>)}</select></label>
                  <label className="sp-field">{START_PAGE_COPY.formPandasLabel}<select className="sp-select" aria-label={START_PAGE_COPY.formPandasLabel} value={background.pandas_experience} onChange={(event) => setBackground({ ...background, pandas_experience: event.target.value as BackgroundQuestionnaire["pandas_experience"] })}>{EXPERIENCE.map((value) => <option key={value} value={value}>{experienceLabel(value)}</option>)}</select></label>
                  <label className="sp-field">{START_PAGE_COPY.formPreferenceLabel}<select className="sp-select" aria-label={START_PAGE_COPY.formPreferenceLabel} value={background.explanation_preference} onChange={(event) => setBackground({ ...background, explanation_preference: event.target.value as BackgroundQuestionnaire["explanation_preference"] })}>{EXPLANATION_PREFERENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                </div>
                <div className="sp-time-note"><strong>{START_PAGE_COPY.timeNoteTitle}</strong><span>{START_PAGE_COPY.timeNoteBody}</span></div>
              </section>

              <div className="task-footer">
                <p className="task-footer-note">{START_PAGE_COPY.taskFooterNote}</p>
                <button type="submit" className="button primary cta-start" disabled={busy || subjectId === "" || goalId === "" || (mode === "chapter" && chapterId === "")}>{busy ? START_PAGE_COPY.ctaBusy : START_PAGE_COPY.ctaStart}</button>
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
          </div>
        </div>
      ) : null}
    </PageFrame>
  );
}