import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { BackgroundQuestionnaire, DiagnosticQuestionSafeView } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";

export function DiagnosticPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const bootstrap = useBootstrap(sessionId);
  const navigate = useNavigate();
  const [answer, setAnswer] = useState<string | boolean>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const session = bootstrap.data?.session;
  const processed = session?.diagnosticDraft?.processedQuestionIds ?? [];
  const question = useMemo(() => bootstrap.data?.diagnostic.questions.find((item) => !processed.includes(item.questionId)), [bootstrap.data, processed]);

  const submitQuestion = async (item: DiagnosticQuestionSafeView, skip: boolean) => {
    if (session === undefined) return;
    setBusy(true); setActionError(undefined);
    try {
      await api.submitDiagnosticAnswer({
        requestId: newRequestId("web-diagnostic-answer"), sessionId, sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision, diagnosticId: bootstrap.data!.diagnostic.diagnosticId,
        diagnosticVersion: bootstrap.data!.diagnostic.diagnosticVersion, questionId: item.questionId,
        diagnosticDraftVersion: session.diagnosticDraftVersion,
        ...(skip ? { action: "skip" as const } : { action: "answer" as const, answer: answer! }),
      });
      setAnswer(undefined); await bootstrap.reload();
    } catch (error) { setActionError(error instanceof Error ? error : new Error("diagnostic_answer_failed")); }
    finally { setBusy(false); }
  };

  const completeAndBuild = async () => {
    if (session === undefined || bootstrap.data === undefined) return;
    setBusy(true); setActionError(undefined);
    try {
      const background: BackgroundQuestionnaire = session.diagnosticDraft?.background ?? { python_experience: "uncertain", pandas_experience: "uncertain", explanation_preference: "uncertain" };
      const completed = await api.completeDiagnostic(session.view.mode === "chapter" ? {
        requestId: newRequestId("web-diagnostic-complete"), sessionId, sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision, mode: "background_only", background, diagnosticDraftVersion: session.diagnosticDraftVersion,
      } : {
        requestId: newRequestId("web-diagnostic-complete"), sessionId, sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision, mode: "fixed", diagnosticId: bootstrap.data.diagnostic.diagnosticId,
        diagnosticVersion: bootstrap.data.diagnostic.diagnosticVersion, diagnosticDraftVersion: session.diagnosticDraftVersion,
      });
      const candidate = await api.buildPath({
        requestId: newRequestId("web-build-path"), sessionId, sessionVersion: completed.sessionVersion,
        profileRevision: completed.profileRevision, goalId: session.view.goalId, mode: session.view.mode,
        ...(session.view.chapterId === undefined ? {} : { chapterId: session.view.chapterId }),
        availableMinutes: session.view.availableMinutes, evidenceVersion: completed.evidenceVersion,
        selectedKnowledgePointIds: [], lockedNodeIds: [],
      });
      navigate(`/path/${sessionId}`, { state: {
        candidate,
        evidenceVersion: completed.evidenceVersion,
        knowledgeStates: completed.knowledgeStates,
        capabilityProfileRevision: completed.capabilityProfileRevision,
      } });
    } catch (error) { setActionError(error instanceof Error ? error : new Error("diagnostic_complete_failed")); }
    finally { setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  const state = error === undefined ? undefined : isApiError(error) && error.status === 409 ? "conflict" : "error";
  return <PageFrame eyebrow={session?.view.mode === "chapter" ? "背景问卷" : "固定诊断"} title="确认当前学习起点" summary="问卷和逐题草稿使用独立版本；完成诊断时才推进正式会话。" actions={<span className="header-badge">Draft v{session?.diagnosticDraftVersion ?? 0}</span>}>
    {bootstrap.loading ? <PageStatePanel page="diagnostic" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="diagnostic" state={state!} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && session === undefined ? <PageStatePanel page="diagnostic" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && session !== undefined ? <div className="diagnostic-layout" data-page="diagnostic">
      <section className="work-section question-section" aria-labelledby="question-heading">
        {session.view.mode === "chapter" ? <><p className="section-kicker">BACKGROUND ONLY</p><h2 id="question-heading">章节模式不生成诊断 Evidence</h2><dl className="metric-list"><div><dt>Python经验</dt><dd>{session.diagnosticDraft?.background?.python_experience}</dd></div><div><dt>Pandas经验</dt><dd>{session.diagnosticDraft?.background?.pandas_experience}</dd></div><div><dt>讲解偏好</dt><dd>{session.diagnosticDraft?.background?.explanation_preference}</dd></div></dl><div className="section-footer"><button type="button" className="button primary" disabled={busy} onClick={() => void completeAndBuild()}>完成问卷并生成路径</button></div></> : question === undefined ? <><p className="section-kicker">DIAGNOSTIC COMPLETE</p><h2 id="question-heading">所有诊断题均已处理</h2><p>现在可以原子完成诊断并生成路径。</p><button type="button" className="button primary" disabled={busy} onClick={() => void completeAndBuild()}>完成诊断</button></> : <><div className="progress-track" aria-label={`诊断进度 ${processed.length + 1}/${bootstrap.data!.diagnostic.questions.length}`}><span style={{ width: `${((processed.length + 1) / bootstrap.data!.diagnostic.questions.length) * 100}%` }} /></div><p className="section-kicker">{question.knowledgePointId}</p><h2 id="question-heading">{question.prompt}</h2><fieldset className="answer-list"><legend className="sr-only">请选择答案</legend>{question.kind === "judgment" ? [true, false].map((value) => <label className="answer-option" key={String(value)}><input type="radio" name="diagnostic-answer" checked={answer === value} onChange={() => setAnswer(value)} /><span>{value ? "正确" : "错误"}</span></label>) : question.options?.map((option, index) => <label className="answer-option" key={option}><input type="radio" name="diagnostic-answer" checked={answer === option} onChange={() => setAnswer(option)} /><span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option}</span></label>)}</fieldset><div className="section-footer"><button type="button" className="button text-button" disabled={busy} onClick={() => void submitQuestion(question, true)}>跳过并保持未验证</button><button type="button" className="button primary" disabled={busy || answer === undefined} onClick={() => void submitQuestion(question, false)}>保存并继续</button></div></>}
      </section>
      <aside className="work-section evidence-summary"><p className="section-kicker">SERVER SNAPSHOT</p><h2>恢复状态</h2><dl className="metric-list"><div><dt>会话版本</dt><dd>{session.view.sessionVersion}</dd></div><div><dt>草稿版本</dt><dd>{session.diagnosticDraftVersion}</dd></div><div><dt>已处理题目</dt><dd>{processed.length}</dd></div></dl><p className="notice-line">刷新后重新读取 Bootstrap，不依赖浏览器内存恢复。</p></aside>
    </div> : null}
  </PageFrame>;
}
