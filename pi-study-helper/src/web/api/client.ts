import type {
  ActivityAttemptSafeView,
  ActivityDraftOutput,
  ActivityRecoveryOutput,
  ActivitySubmissionOutput,
  AppBootstrapSafeView,
  BuildPathInput,
  CompleteDiagnosticInput,
  CompleteSessionInput,
  CompleteSessionOutput,
  ContinueActivityWithGapInput,
  ContinueActivityWithGapOutput,
  ConfirmPathInput,
  ConfirmedPathOutput,
  ContextAnswerOutput,
  ContextQuestionInput,
  DiagnosticAnswerOutput,
  DiagnosticCompleteOutput,
  DiagnosticDraftOutput,
  GetActivityAttemptInput,
  GetNextStepInput,
  NextStepOutput,
  OpenActivityInput,
  PathCandidateOutput,
  PrepareActivityRunInput,
  PreparedActivityOutput,
  QuizActivityResult,
  RecoverActivityInput,
  ReplanPathInput,
  ReplanPathOutput,
  SaveActivityDraftInput,
  SaveDiagnosticDraftInput,
  StartSessionInput,
  StartSessionOutput,
  SubmitActivityInput,
  SubmitDiagnosticAnswerInput,
} from "../../contracts/index.js";

interface ApiSuccess<T> {
  requestId: string;
  data: T;
}

interface ApiFailure {
  requestId?: string;
  error?: { code?: string; message?: string };
}

export interface EvaluatorFailureView {
  status: "evaluator_error";
  errorCode: string;
  verdict: "not_graded";
}

export type SubmitActivityResponse = ActivitySubmissionOutput | EvaluatorFailureView;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export function newRequestId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body === undefined
      ? init?.headers
      : { "content-type": "application/json", ...init.headers },
  });
  let payload: ApiSuccess<T> | ApiFailure;
  try {
    payload = await response.json() as ApiSuccess<T> | ApiFailure;
  } catch {
    throw new ApiError(response.status, "invalid_response_shape");
  }
  if (!response.ok || !("data" in payload)) {
    throw new ApiError(
      response.status,
      "error" in payload ? payload.error?.code ?? "request_failed" : "invalid_response_shape",
      payload.requestId,
    );
  }
  return payload.data;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

function query(fields: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) params.set(key, String(value));
  const encoded = params.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function id(value: string): string {
  return encodeURIComponent(value);
}

export const api = {
  getBootstrap(recoverSessionId?: string) {
    return request<AppBootstrapSafeView>(`/api/bootstrap${query({ recoverSessionId })}`);
  },
  startSession(input: StartSessionInput) {
    return post<StartSessionOutput>("/api/sessions", input);
  },
  saveDiagnosticDraft(input: SaveDiagnosticDraftInput) {
    return post<DiagnosticDraftOutput>(`/api/sessions/${id(input.sessionId)}/diagnostic/draft`, without(input, "sessionId"));
  },
  submitDiagnosticAnswer(input: SubmitDiagnosticAnswerInput) {
    return post<DiagnosticAnswerOutput>(`/api/sessions/${id(input.sessionId)}/diagnostic/answers`, without(input, "sessionId"));
  },
  completeDiagnostic(input: CompleteDiagnosticInput) {
    return post<DiagnosticCompleteOutput>(`/api/sessions/${id(input.sessionId)}/diagnostic/complete`, without(input, "sessionId"));
  },
  buildPath(input: BuildPathInput) {
    return post<PathCandidateOutput>(`/api/sessions/${id(input.sessionId)}/path`, without(input, "sessionId"));
  },
  confirmPath(input: ConfirmPathInput) {
    return post<ConfirmedPathOutput>(`/api/sessions/${id(input.sessionId)}/path/confirm`, without(input, "sessionId"));
  },
  getNextStep(input: GetNextStepInput) {
    return request<NextStepOutput>(`/api/sessions/${id(input.sessionId)}/next-step${query({
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      pathVersion: input.pathVersion,
    })}`);
  },
  replanPath(input: ReplanPathInput) {
    return post<ReplanPathOutput>(`/api/sessions/${id(input.sessionId)}/path/replan`, without(input, "sessionId"));
  },
  openActivity(input: OpenActivityInput) {
    return post<ActivityDraftOutput>(`/api/activities/${id(input.activityId)}/open`, without(input, "activityId"));
  },
  saveActivityDraft(input: SaveActivityDraftInput) {
    return post<ActivityDraftOutput>(`/api/activities/${id(input.activityId)}/draft`, without(input, "activityId"));
  },
  prepareActivityRun(input: PrepareActivityRunInput) {
    return post<PreparedActivityOutput>(`/api/activities/${id(input.activityId)}/run`, without(input, "activityId"));
  },
  submitActivity(input: SubmitActivityInput) {
    return post<SubmitActivityResponse>(`/api/activities/${id(input.activityId)}/submit`, without(input, "activityId"));
  },
  continueActivityWithGap(input: ContinueActivityWithGapInput) {
    return post<ContinueActivityWithGapOutput>(`/api/activities/${id(input.activityId)}/continue-with-gap`, without(input, "activityId"));
  },
  getActivityAttempt(input: GetActivityAttemptInput) {
    return request<ActivityAttemptSafeView>(`/api/activities/${id(input.activityId)}/attempts/${id(input.attemptId)}${query({
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
    })}`);
  },
  recoverActivity(input: RecoverActivityInput) {
    return post<ActivityRecoveryOutput>(`/api/activities/${id(input.activityId)}/recover`, without(input, "activityId"));
  },
  completeSession(input: CompleteSessionInput) {
    return post<CompleteSessionOutput>(`/api/sessions/${id(input.sessionId)}/complete`, without(input, "sessionId"));
  },
  askContextQuestion(input: ContextQuestionInput) {
    return post<ContextAnswerOutput>(`/api/sessions/${id(input.sessionId)}/context-questions`, without(input, "sessionId"));
  },
};

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isEvaluatorFailure(value: SubmitActivityResponse): value is EvaluatorFailureView {
  return "status" in value && value.status === "evaluator_error";
}

export function quizScore(result: QuizActivityResult): number | null {
  return result.totalCount === 0 ? null : result.correctCount / result.totalCount;
}
