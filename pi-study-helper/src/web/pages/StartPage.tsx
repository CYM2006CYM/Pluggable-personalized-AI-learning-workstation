import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { BackgroundQuestionnaire, LearningEntryMode } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { routeForSession } from "../api/navigation.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";

const EXPERIENCE = ["none", "basic", "comfortable", "uncertain"] as const;
const PREFERENCES = [
  { value: "step_by_step", label: "逐步讲解" },
  { value: "concise", label: "重点速览" },
  { value: "example_first", label: "案例优先" },
] as const;
const DEFAULT_BACKGROUND: BackgroundQuestionnaire = {
  python_experience: "uncertain",
  pandas_experience: "uncertain",
  explanation_preference: "step_by_step",
};
const SYSTEM_PATH_BUDGET_MINUTES = 400;

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
  return (
    <PageFrame eyebrow="学习入口" title="开始一次可追踪的学习会话" summary="选择资料包、入口和问卷。所有正式进度由本地服务保存。" actions={<span className="header-badge">服务端记录</span>}>
      {bootstrap.loading ? <PageStatePanel page="start" state="loading" /> : null}
      {!bootstrap.loading && stateError ? <PageStatePanel page="start" state={isApiError(stateError) && stateError.status === 409 ? "conflict" : "error"} code={isApiError(stateError) ? stateError.code : stateError.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
      {!bootstrap.loading && stateError === undefined && (bootstrap.data?.profiles.length === 0 || bootstrap.data?.goals.length === 0) ? <PageStatePanel page="start" state="empty" /> : null}
      {!bootstrap.loading && stateError === undefined && bootstrap.data !== undefined && bootstrap.data.profiles.length > 0 && bootstrap.data.goals.length > 0 ? (
        <div className="start-layout" data-page="start">
          <section className="work-section profile-section" aria-labelledby="profile-heading">
            <div className="section-heading"><div><p className="section-kicker">ACTIVE PROFILE</p><h2 id="profile-heading">{activeProfile?.name}</h2></div><span className="status-tag success">已启用</span></div>
            <dl className="metadata-grid"><div><dt>领域</dt><dd>{activeProfile?.subjectId}</dd></div><div><dt>修订</dt><dd>Revision {activeProfile?.revision}</dd></div><div><dt>能力</dt><dd>{activeProfile?.modalities.join(" / ")}</dd></div></dl>
          </section>
          <form className="work-section start-form" aria-labelledby="session-heading" onSubmit={start}>
            <div className="section-heading"><div><p className="section-kicker">SESSION</p><h2 id="session-heading">会话设置</h2></div><span className="quiet-label">服务端绑定</span></div>
            <div className="form-grid">
              <label>学习资料包<select aria-label="学习资料包" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{bootstrap.data.profiles.map((profile) => <option key={profile.subjectId} value={profile.subjectId}>{profile.name}</option>)}</select></label>
              <fieldset><legend>学习入口</legend><label className="choice-row"><input type="radio" name="entry" checked={mode === "recommended"} onChange={() => setMode("recommended")} /> 系统推荐</label><label className="choice-row"><input type="radio" name="entry" checked={mode === "chapter"} onChange={() => setMode("chapter")} /> 按章节学习</label></fieldset>
              <label>学习目标<select aria-label="学习目标" value={goalId} onChange={(event) => setGoalId(event.target.value)}>{bootstrap.data.goals.map((goal) => <option key={goal.goalId} value={goal.goalId}>{goal.title}</option>)}</select></label>
              <div className="system-time-note"><strong>学习时长由系统计算</strong><span>完成诊断后，系统会按需要学习的章节和正式活动给出预计时间。</span></div>
              {mode === "chapter" ? <label>起始章节<select aria-label="起始章节" value={chapterId} onChange={(event) => setChapterId(event.target.value)}>{bootstrap.data.chapters.map((chapter) => <option key={chapter.chapterId} value={chapter.chapterId}>{chapter.title}</option>)}</select></label> : null}
              <label>Python经验<select aria-label="Python经验" value={background.python_experience} onChange={(event) => setBackground({ ...background, python_experience: event.target.value as BackgroundQuestionnaire["python_experience"] })}>{EXPERIENCE.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Pandas经验<select aria-label="Pandas经验" value={background.pandas_experience} onChange={(event) => setBackground({ ...background, pandas_experience: event.target.value as BackgroundQuestionnaire["pandas_experience"] })}>{EXPERIENCE.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>讲解偏好<select aria-label="讲解偏好" value={background.explanation_preference} onChange={(event) => setBackground({ ...background, explanation_preference: event.target.value as BackgroundQuestionnaire["explanation_preference"] })}>{PREFERENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
            <div className="section-footer"><span className="quiet-label">{subjectId}</span><button type="submit" className="button primary" disabled={busy || subjectId === "" || goalId === "" || (mode === "chapter" && chapterId === "")}>{busy ? "正在创建" : "开始学习"}</button></div>
          </form>
          {bootstrap.data.recoverableSessions.map((session) => <section className="resume-strip" aria-label="恢复会话" key={session.sessionId}><div><strong>可恢复会话</strong><span>{session.stage} · Session v{session.sessionVersion}</span></div><button type="button" className="button text-button" disabled={busy} onClick={() => void recover(session.sessionId)}>从服务端恢复</button></section>)}
        </div>
      ) : null}
    </PageFrame>
  );
}
