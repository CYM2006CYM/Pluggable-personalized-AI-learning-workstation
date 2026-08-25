import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { BackgroundQuestionnaire, DiagnosticQuestionSafeView } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { knowledgePointLabel } from "../learning-labels.js";

export function DiagnosticPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const bootstrap = useBootstrap(sessionId);
  const navigate = useNavigate();
  const [answer, setAnswer] = useState<string | boolean>();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [diagnosticSkipIds, setDiagnosticSkipIds] = useState<Set<string>>(() => new Set());
  const session = bootstrap.data?.session;
  const processed = session?.diagnosticDraft?.processedQuestionIds ?? [];
  const questions = useMemo(() => bootstrap.data?.diagnostic.questions ?? [], [bootstrap.data]);
  const savedAnswers = session?.diagnosticDraft?.answers ?? [];
  const questionIds = useMemo(() => new Set(questions.map((item) => item.questionId)), [questions]);
  const answeredQuestionIds = useMemo(() => new Set(
    savedAnswers
      .filter((item) => item.status === "answered" && item.submittedAnswer !== undefined && questionIds.has(item.questionId))
      .map((item) => item.questionId),
  ), [questionIds, savedAnswers]);
  const answeredCount = answeredQuestionIds.size;
  const diagnosticProgressPercent = questions.length === 0 ? 0 : Math.min(100, (answeredCount / questions.length) * 100);
  const firstUnprocessedIndex = questions.findIndex((item) => !processed.includes(item.questionId));
  const question = questions[questionIndex];
  const savedAnswer = question === undefined ? undefined : savedAnswers.find((item) => item.questionId === question.questionId);
  const diagnosticSkipOptions = useMemo(() => (session?.knowledgeStates ?? [])
    .filter((state) => state.diagnosticSkipEligible === true), [session?.knowledgeStates]);

  useEffect(() => {
    if (session?.view.mode !== "recommended" || questions.length === 0) return;
    setQuestionIndex(firstUnprocessedIndex === -1 ? questions.length : firstUnprocessedIndex);
  }, [firstUnprocessedIndex, questions.length, session?.diagnosticDraftVersion, session?.view.mode]);

  useEffect(() => {
    setAnswer(savedAnswer?.submittedAnswer);
  }, [question?.questionId, savedAnswer?.submittedAnswer]);

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
      await bootstrap.reload();
    } catch (error) { setActionError(error instanceof Error ? error : new Error("diagnostic_answer_failed")); }
    finally { setBusy(false); }
  };

  const buildPath = async (skipIds: readonly string[]) => {
    if (session === undefined) return;
    if (session.evidenceVersion === undefined) throw new Error("diagnostic_evidence_unavailable");
    const candidate = await api.buildPath({
      requestId: newRequestId("web-build-path"), sessionId, sessionVersion: session.view.sessionVersion,
      profileRevision: session.view.profileRevision, goalId: session.view.goalId, mode: session.view.mode,
      ...(session.view.chapterId === undefined ? {} : { chapterId: session.view.chapterId }),
      availableMinutes: session.view.availableMinutes, evidenceVersion: session.evidenceVersion,
      selectedKnowledgePointIds: [], diagnosticSkipKnowledgePointIds: [...skipIds], lockedNodeIds: [],
    });
    navigate(`/path/${sessionId}`, { state: {
      candidate,
      evidenceVersion: session.evidenceVersion,
      knowledgeStates: session.knowledgeStates,
    } });
  };

  const completeDiagnostic = async () => {
    if (session === undefined || bootstrap.data === undefined) return;
    setBusy(true); setActionError(undefined);
    try {
      const background: BackgroundQuestionnaire = session.diagnosticDraft?.background ?? { python_experience: "uncertain", pandas_experience: "uncertain", explanation_preference: "step_by_step" };
      const completed = await api.completeDiagnostic(session.view.mode === "chapter" ? {
        requestId: newRequestId("web-diagnostic-complete"), sessionId, sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision, mode: "background_only", background, diagnosticDraftVersion: session.diagnosticDraftVersion,
      } : {
        requestId: newRequestId("web-diagnostic-complete"), sessionId, sessionVersion: session.view.sessionVersion,
        profileRevision: session.view.profileRevision, mode: "fixed", diagnosticId: bootstrap.data.diagnostic.diagnosticId,
        diagnosticVersion: bootstrap.data.diagnostic.diagnosticVersion, diagnosticDraftVersion: session.diagnosticDraftVersion,
      });
      if (session.view.mode === "chapter") {
        const candidate = await api.buildPath({
          requestId: newRequestId("web-build-path"), sessionId, sessionVersion: completed.sessionVersion,
          profileRevision: completed.profileRevision, goalId: session.view.goalId, mode: session.view.mode,
          ...(session.view.chapterId === undefined ? {} : { chapterId: session.view.chapterId }),
          availableMinutes: session.view.availableMinutes, evidenceVersion: completed.evidenceVersion,
          selectedKnowledgePointIds: [], diagnosticSkipKnowledgePointIds: [], lockedNodeIds: [],
        });
        navigate(`/path/${sessionId}`, { state: { candidate, evidenceVersion: completed.evidenceVersion, knowledgeStates: completed.knowledgeStates } });
      } else {
        await bootstrap.reload();
      }
    } catch (error) { setActionError(error instanceof Error ? error : new Error("diagnostic_complete_failed")); }
    finally { setBusy(false); }
  };

  const error = actionError ?? bootstrap.error;
  const state = error === undefined ? undefined : isApiError(error) && error.status === 409 ? "conflict" : "error";
  return <PageFrame eyebrow={session?.view.mode === "chapter" ? "背景问卷" : "固定诊断"} title="确认当前学习起点" summary="可返回检查并修改答案；只有完成诊断后，最新草稿才会生成正式学习画像。" back={{ to: "/", label: "返回主菜单" }} actions={<span className="header-badge">草稿 v{session?.diagnosticDraftVersion ?? 0}</span>}>
    {bootstrap.loading ? <PageStatePanel page="diagnostic" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="diagnostic" state={state!} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && session === undefined ? <PageStatePanel page="diagnostic" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && session !== undefined ? <div className="diagnostic-layout" data-page="diagnostic">
      <section className="work-section question-section" aria-labelledby="question-heading">
        {session.view.mode === "chapter" ? <><p className="section-kicker">背景问卷</p><h2 id="question-heading">章节模式不生成诊断证据</h2><dl className="metric-list"><div><dt>Python经验</dt><dd>{session.diagnosticDraft?.background?.python_experience}</dd></div><div><dt>Pandas经验</dt><dd>{session.diagnosticDraft?.background?.pandas_experience}</dd></div><div><dt>讲解偏好</dt><dd>{session.diagnosticDraft?.background?.explanation_preference}</dd></div></dl><div className="section-footer"><button type="button" className="button secondary" onClick={() => navigate("/")}>返回修改问卷</button><button type="button" className="button primary" disabled={busy} onClick={() => void completeDiagnostic()}>完成问卷并生成路径</button></div></> : session.view.stage === "path" ? <><p className="section-kicker">诊断完成 · 跳过资格确认</p><h2 id="question-heading">选择需要跳过的教学章节</h2><p>同时答对“概念理解”和“代码/应用辨析”的模块可以跳过。默认继续学习；选择跳过只省略对应章节教学和普通练习，最终综合实操仍然保留。</p>{session.path === undefined ? <fieldset className="answer-list"><legend className="sr-only">可选择跳过的章节</legend>{diagnosticSkipOptions.length === 0 ? <p className="notice-line">本次没有模块同时通过两类客观诊断证据，系统将保留全部章节。</p> : diagnosticSkipOptions.map((state) => <label className="answer-option" key={state.knowledgePointId}><input type="checkbox" checked={diagnosticSkipIds.has(state.knowledgePointId)} onChange={(event) => setDiagnosticSkipIds((current) => { const next = new Set(current); if (event.target.checked) next.add(state.knowledgePointId); else next.delete(state.knowledgePointId); return next; })} /><span className="option-copy"><strong>{knowledgePointLabel(state.knowledgePointId)}</strong><small>两类客观诊断证据均通过，可选择跳过</small></span></label>)}</fieldset> : <p className="notice-line">路径已经生成，可以返回路径页继续确认。</p>}<div className="section-footer"><span className="quiet-label">已选择跳过 {diagnosticSkipIds.size} 个章节</span>{session.path === undefined ? <button type="button" className="button primary" disabled={busy} onClick={() => { setBusy(true); setActionError(undefined); void buildPath([...diagnosticSkipIds]).catch((error) => setActionError(error instanceof Error ? error : new Error("path_build_failed"))).finally(() => setBusy(false)); }}>按选择生成学习路径</button> : <button type="button" className="button primary" onClick={() => navigate(`/path/${sessionId}`)}>返回学习路径</button>}</div></> : question === undefined ? <><p className="section-kicker">诊断题已处理</p><h2 id="question-heading">请确认答案后生成学习画像</h2><p>你可以返回上一题检查或修改，系统只会采用每道题最后保存的答案。</p><div className="section-footer"><button type="button" className="button secondary" disabled={busy || questions.length === 0} onClick={() => setQuestionIndex(Math.max(0, questions.length - 1))}>← 返回上一题</button><button type="button" className="button primary" disabled={busy} onClick={() => void completeDiagnostic()}>完成诊断并选择学习章节</button></div></> : <><div className="progress-track" aria-label={`已保存诊断进度 ${answeredCount}/${questions.length}`}><span style={{ width: `${diagnosticProgressPercent}%` }} /></div><p className="section-kicker">第 {questionIndex + 1} 题 / 共 {questions.length} 题 · {question.evidenceForm === "code_reasoning" ? "代码/应用辨析" : "概念理解"} · {processed.includes(question.questionId) ? "已保存，可修改" : "尚未保存"}</p><h2 id="question-heading">{question.prompt}</h2><fieldset className="answer-list"><legend className="sr-only">请选择答案</legend>{question.kind === "judgment" ? [true, false].map((value) => <label className="answer-option" key={String(value)}><input type="radio" name="diagnostic-answer" checked={answer === value} onChange={() => setAnswer(value)} /><span>{value ? "正确" : "错误"}</span></label>) : question.options?.map((option, index) => <label className="answer-option" key={option}><input type="radio" name="diagnostic-answer" checked={answer === option} onChange={() => setAnswer(option)} /><span className="option-key">{String.fromCharCode(65 + index)}</span><span className="option-copy">{option}</span></label>)}</fieldset><div className="section-footer diagnostic-actions"><button type="button" className="button secondary" disabled={busy || questionIndex === 0} onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}>← 上一题</button><div className="button-row"><button type="button" className="button text-button" disabled={busy} onClick={() => void submitQuestion(question, true)}>跳过本题</button>{processed.includes(question.questionId) && answer === savedAnswer?.submittedAnswer ? <button type="button" className="button primary" disabled={busy} onClick={() => setQuestionIndex((current) => Math.min(questions.length, current + 1))}>下一题 →</button> : <button type="button" className="button primary" disabled={busy || answer === undefined} onClick={() => void submitQuestion(question, false)}>{processed.includes(question.questionId) ? "保存修改并继续" : "保存并继续"}</button>}</div></div></>}
      </section>
      <aside className="work-section evidence-summary"><p className="section-kicker">SERVER SNAPSHOT</p><h2>恢复状态</h2><dl className="metric-list"><div><dt>会话版本</dt><dd>{session.view.sessionVersion}</dd></div><div><dt>草稿版本</dt><dd>{session.diagnosticDraftVersion}</dd></div><div><dt>已处理题目</dt><dd>{processed.length}</dd></div></dl><p className="notice-line">刷新后重新读取 Bootstrap，不依赖浏览器内存恢复。</p></aside>
    </div> : null}
  </PageFrame>;
}
