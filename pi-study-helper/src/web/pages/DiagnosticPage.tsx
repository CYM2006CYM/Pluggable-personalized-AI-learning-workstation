import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { BackgroundQuestionnaire, DiagnosticQuestionSafeView } from "../../contracts/index.js";
import { api, isApiError, newRequestId } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { PaperFlip } from "../components/PaperFlip.js";
import { DIAGNOSTIC_PAGE_COPY } from "../copy/diagnostic-page-copy.js";
import { explanationPreferenceLabel, experienceLabel } from "../copy/ui-copy.js";
import { knowledgePointLabel } from "../learning-labels.js";
import "./DiagnosticPage.css";

export function DiagnosticPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const bootstrap = useBootstrap(sessionId);
  const navigate = useNavigate();
  const [answer, setAnswer] = useState<string | boolean>();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [diagnosticSkipIds, setDiagnosticSkipIds] = useState<Set<string>>(() => new Set());
  const [flipForward, setFlipForward] = useState(true);
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

  const copy = DIAGNOSTIC_PAGE_COPY;
  const error = actionError ?? bootstrap.error;
  const state = error === undefined ? undefined : isApiError(error) && error.status === 409 ? "conflict" : "error";
  return <PageFrame eyebrow={session?.view.mode === "chapter" ? copy.eyebrowChapter : copy.eyebrowRecommended} title={copy.title} summary={copy.summary} back={{ to: "/", label: copy.backLabel }}>
    {bootstrap.loading ? <PageStatePanel page="diagnostic" state="loading" /> : null}
    {!bootstrap.loading && error ? <PageStatePanel page="diagnostic" state={state!} code={isApiError(error) ? error.code : error.message} onRetry={() => { setActionError(undefined); void bootstrap.reload(); }} /> : null}
    {!bootstrap.loading && error === undefined && session === undefined ? <PageStatePanel page="diagnostic" state="empty" /> : null}
    {!bootstrap.loading && error === undefined && session !== undefined ? <div className="diagnostic-page" data-page="diagnostic">
      <section className="diagnostic-orientation" aria-labelledby="diagnostic-orientation-title">
        <h2 id="diagnostic-orientation-title" className="diagnostic-orientation-title">{copy.orientation.title}</h2>
        <p>{copy.orientation.body}</p>
      </section>
      {session.view.mode === "chapter" ? <section className="diagnostic-task" aria-labelledby="diagnostic-task-heading">
        <p className="diagnostic-kicker">{copy.chapter.sectionKicker}</p>
        <h2 id="diagnostic-task-heading">{copy.chapter.title}</h2>
        <p className="diagnostic-lead">{copy.chapter.lead}</p>
        <details className="diagnostic-info">
          <summary>{copy.chapter.infoSummary}</summary>
          <div className="diagnostic-info-body">
            <p>{copy.chapter.infoIntro}</p>
            <dl className="diagnostic-facts">
              <div><dt>{copy.chapter.pythonLabel}</dt><dd>{experienceLabel(session.diagnosticDraft?.background?.python_experience)}</dd></div>
              <div><dt>{copy.chapter.pandasLabel}</dt><dd>{experienceLabel(session.diagnosticDraft?.background?.pandas_experience)}</dd></div>
              <div><dt>{copy.chapter.explanationLabel}</dt><dd>{explanationPreferenceLabel(session.diagnosticDraft?.background?.explanation_preference)}</dd></div>
            </dl>
          </div>
        </details>
        <div className="diagnostic-actions">
          <button type="button" className="diagnostic-btn diagnostic-btn--secondary" onClick={() => navigate("/")}>{copy.chapter.secondary}</button>
          <button type="button" className="diagnostic-btn diagnostic-btn--primary" disabled={busy} onClick={() => void completeDiagnostic()}>{copy.chapter.primary}</button>
        </div>
      </section> : session.view.stage === "path" ? <section className="diagnostic-task" aria-labelledby="diagnostic-task-heading">
        <p className="diagnostic-kicker">{copy.skip.sectionKicker}</p>
        <h2 id="diagnostic-task-heading">{copy.skip.title}</h2>
        <p className="diagnostic-lead">{copy.skip.lead}</p>
        {session.path === undefined ? <fieldset className="diagnostic-options"><legend className="visually-hidden">{copy.skip.legend}</legend>{diagnosticSkipOptions.length === 0 ? <p className="diagnostic-note">{copy.skip.noneHint}</p> : diagnosticSkipOptions.map((state) => <label className="diagnostic-option" key={state.knowledgePointId}><input type="checkbox" checked={diagnosticSkipIds.has(state.knowledgePointId)} onChange={(event) => setDiagnosticSkipIds((current) => { const next = new Set(current); if (event.target.checked) next.add(state.knowledgePointId); else next.delete(state.knowledgePointId); return next; })} /><span className="diagnostic-option-copy"><strong>{knowledgePointLabel(state.knowledgePointId)}</strong><small>{copy.skip.optionHint}</small></span></label>)}</fieldset> : <p className="diagnostic-note">{copy.skip.alreadyBuilt}</p>}
        <div className="diagnostic-actions">
          <span className="diagnostic-quiet">{copy.skip.selectedCount(diagnosticSkipIds.size)}</span>
          {session.path === undefined ? <button type="button" className="diagnostic-btn diagnostic-btn--primary" disabled={busy} onClick={() => { setBusy(true); setActionError(undefined); void buildPath([...diagnosticSkipIds]).catch((error) => setActionError(error instanceof Error ? error : new Error("path_build_failed"))).finally(() => setBusy(false)); }}>{copy.skip.primary}</button> : <button type="button" className="diagnostic-btn diagnostic-btn--primary" onClick={() => navigate(`/path/${sessionId}`)}>{copy.skip.backToPath}</button>}
        </div>
      </section> : question === undefined ? <section className="diagnostic-task" aria-labelledby="diagnostic-task-heading">
        <p className="diagnostic-kicker">{copy.confirm.sectionKicker}</p>
        <h2 id="diagnostic-task-heading">{copy.confirm.title}</h2>
        <p className="diagnostic-lead">{copy.confirm.lead}</p>
        <div className="diagnostic-actions">
          <button type="button" className="diagnostic-btn diagnostic-btn--secondary" disabled={busy || questions.length === 0} onClick={() => setQuestionIndex(Math.max(0, questions.length - 1))}>{copy.confirm.secondary}</button>
          <button type="button" className="diagnostic-btn diagnostic-btn--primary" disabled={busy} onClick={() => void completeDiagnostic()}>{copy.confirm.primary}</button>
        </div>
      </section> : <section className="diagnostic-task" aria-labelledby="diagnostic-task-heading">
        <div className="diagnostic-progress">
          <div className="progress-track" aria-label={copy.answer.progressAria(answeredCount, questions.length)}><span style={{ transform: `scaleX(${diagnosticProgressPercent / 100})` }} /></div>
          <p className="diagnostic-counter">{copy.answer.counter(questionIndex + 1, questions.length)} · {question.evidenceForm === "code_reasoning" ? copy.answer.codeEvidence : copy.answer.conceptEvidence} · {processed.includes(question.questionId) ? copy.answer.savedEditable : copy.answer.notSaved}</p>
        </div>
        <PaperFlip key={question.questionId} direction={flipForward ? 1 : -1} className="diagnostic-question-flip">
          <h2 id="diagnostic-task-heading">{question.prompt}</h2>
          <fieldset className="diagnostic-options"><legend className="visually-hidden">{copy.answer.legend}</legend>{question.kind === "judgment" ? [true, false].map((value) => <label className="diagnostic-option" key={String(value)}><input type="radio" name="diagnostic-answer" checked={answer === value} onChange={() => setAnswer(value)} /><span>{value ? copy.answer.judgmentTrue : copy.answer.judgmentFalse}</span></label>) : question.options?.map((option, index) => <label className="diagnostic-option" key={option}><input type="radio" name="diagnostic-answer" checked={answer === option} onChange={() => setAnswer(option)} /><span className="diagnostic-option-key">{String.fromCharCode(65 + index)}</span><span className="diagnostic-option-copy">{option}</span></label>)}</fieldset>
        </PaperFlip>
        <div className="diagnostic-actions">
          <button type="button" className="diagnostic-btn diagnostic-btn--secondary" disabled={busy || questionIndex === 0} onClick={() => { setFlipForward(false); setQuestionIndex((current) => Math.max(0, current - 1)); }}>{copy.answer.prev}</button>
          <div className="diagnostic-actions-row">
            <button type="button" className="diagnostic-btn diagnostic-btn--text" disabled={busy} onClick={() => void submitQuestion(question, true)}>{copy.answer.skip}</button>
            {processed.includes(question.questionId) && answer === savedAnswer?.submittedAnswer ? <button type="button" className="diagnostic-btn diagnostic-btn--primary" disabled={busy} onClick={() => { setFlipForward(true); setQuestionIndex((current) => Math.min(questions.length, current + 1)); }}>{copy.answer.next}</button> : <button type="button" className="diagnostic-btn diagnostic-btn--primary" disabled={busy || answer === undefined} onClick={() => void submitQuestion(question, false)}>{busy ? copy.answer.saving : processed.includes(question.questionId) ? copy.answer.saveEdit : copy.answer.save}</button>}
          </div>
        </div>
      </section>}
    </div> : null}
  </PageFrame>;
}