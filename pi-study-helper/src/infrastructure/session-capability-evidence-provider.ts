import {
  CapabilityEvidenceProjectionStaleError,
  type CapabilityEvidenceProvider,
  type CapabilityEvidenceSummary,
} from "../application/capability-task-service.js";
import type { CapabilityDimensionId } from "../contracts/index.js";
import type { Evidence } from "../domain/v2-types.js";
import { LearningSessionRepositoryError, type SessionBindingReader } from "../repositories/learning-session-repository.js";

const DIMENSIONS: CapabilityDimensionId[] = [
  "syntax_api", "data_abstraction", "cleaning_reasoning", "validation_debugging", "engineering_independence",
];
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FORBIDDEN_TEXT = [
  /(?:sk|api)[-_][A-Za-z0-9]{12,}/u,
  /[A-Za-z]:[\\/][^\s]*/u,
  /\\\\[^\\/\s]+[\\/][^\s]*/u,
  /\/(?:home|Users|tmp)\/[A-Za-z0-9._-]+(?:[\\/]\S*)?/iu,
  /\b(?:hidden tests?|reference solutions?|private csv|rubric|correctAnswer|answer key|raw answer)\b/iu,
  /\b(?:authorization|apiKey|password|secret|token)\b/iu,
];

export interface SessionCapabilityEvidenceProviderOptions {
  sessions: SessionBindingReader;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

function assertInput(input: Parameters<CapabilityEvidenceProvider["load"]>[0]): void {
  if (!safeId(input.sessionId)
      || !Number.isInteger(input.profileRevision) || input.profileRevision < 1
      || !Number.isInteger(input.evidenceVersion) || input.evidenceVersion < 0
      || !Array.isArray(input.evidenceIds) || !input.evidenceIds.every(safeId)
      || new Set(input.evidenceIds).size !== input.evidenceIds.length
      || (input.knowledgePointId !== undefined && !safeId(input.knowledgePointId))) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Capability Evidence request is invalid");
  }
}

type ObservableRule = {
  knowledgePointId: string;
  activityId?: string;
  form: Evidence["form"];
  dimensions: readonly CapabilityDimensionId[];
};

// W4-D2 owner-approved revision-3 map. Unknown combinations intentionally
// produce no dimensions instead of guessing from outcome or difficulty.
const REVISION_3_OBSERVABLE_MAP: readonly ObservableRule[] = [
  { knowledgePointId: "basic-python", form: "selected_response", dimensions: ["syntax_api"] },
  { knowledgePointId: "pandas.clean.read-csv", form: "selected_response", dimensions: ["syntax_api"] },
  { knowledgePointId: "pandas.clean.inspect-dataframe", form: "selected_response", dimensions: ["data_abstraction"] },
  { knowledgePointId: "pandas.clean.missing-values", form: "selected_response", dimensions: ["cleaning_reasoning"] },
  { knowledgePointId: "pandas.clean.duplicate-orders", form: "selected_response", dimensions: ["cleaning_reasoning"] },
  { knowledgePointId: "pandas.clean.type-format", form: "selected_response", dimensions: ["syntax_api", "cleaning_reasoning"] },
  { knowledgePointId: "pandas.clean.validate-result", form: "selected_response", dimensions: ["validation_debugging"] },
  { knowledgePointId: "pandas.clean.inspect-dataframe", activityId: "act-inspect-dataframe", form: "code_execution", dimensions: ["syntax_api", "data_abstraction", "validation_debugging"] },
  { knowledgePointId: "pandas.clean.missing-values", activityId: "act-missing", form: "code_execution", dimensions: ["syntax_api", "cleaning_reasoning", "validation_debugging"] },
  { knowledgePointId: "pandas.clean.duplicate-orders", activityId: "act-duplicates", form: "code_execution", dimensions: ["syntax_api", "cleaning_reasoning", "validation_debugging"] },
  { knowledgePointId: "pandas.clean.type-format", activityId: "act-types", form: "code_execution", dimensions: ["syntax_api", "cleaning_reasoning", "validation_debugging"] },
  { knowledgePointId: "pandas.clean.validate-result", activityId: "act-practical", form: "practical_rubric", dimensions: ["data_abstraction", "cleaning_reasoning", "validation_debugging"] },
];

function observableDimensions(evidence: Evidence): CapabilityDimensionId[] {
  if (evidence.impact !== "mastery" || evidence.profileRevision !== 3) return [];
  const rule = REVISION_3_OBSERVABLE_MAP.find((candidate) => candidate.knowledgePointId === evidence.knowledgePointId
    && candidate.form === evidence.form
    && (candidate.activityId === undefined || candidate.activityId === evidence.activityId));
  if (rule === undefined) return [];
  const dimensions = new Set(rule.dimensions);
  if (rule.activityId === "act-practical" && evidence.independence === "independent") {
    dimensions.add("engineering_independence");
  }
  return DIMENSIONS.filter((id) => dimensions.has(id));
}

function safeSummary(evidence: Evidence): string {
  const fields = [
    `evidenceId=${evidence.evidenceId}`,
    `knowledgePointId=${evidence.knowledgePointId}`,
    `kind=${evidence.kind}`,
    `source=${evidence.source}`,
    `form=${evidence.form}`,
    `impact=${evidence.impact}`,
    `outcome=${evidence.outcome}`,
    `independence=${evidence.independence}`,
    `score=${evidence.score ?? "omitted"}`,
    `difficulty=${evidence.difficulty ?? "omitted"}`,
    `activityId=${evidence.activityId ?? "omitted"}`,
  ];
  const summary = `Formal Evidence projection: ${fields.join("; ")}.`;
  if (FORBIDDEN_TEXT.some((pattern) => pattern.test(summary))) {
    throw new LearningSessionRepositoryError("evidence_invalid", "Capability Evidence summary is unsafe");
  }
  return summary;
}

/** D-owned production adapter from A's bound session snapshot to capability-scoring Evidence projections. */
export class SessionCapabilityEvidenceProvider implements CapabilityEvidenceProvider {
  readonly #sessions: SessionBindingReader;

  constructor(options: SessionCapabilityEvidenceProviderOptions) {
    this.#sessions = options.sessions;
  }

  async load(input: Parameters<CapabilityEvidenceProvider["load"]>[0]): Promise<CapabilityEvidenceSummary[]> {
    assertInput(input);
    const snapshot = await this.#sessions.getBoundSnapshot(input.sessionId);
    if (snapshot.view.sessionId !== input.sessionId) {
      throw new LearningSessionRepositoryError("session_not_found", "Bound session identity mismatch");
    }
    if (snapshot.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }
    if (input.evidenceVersion > snapshot.latestCommit.evidenceVersion) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Requested future Evidence version is unavailable");
    }
    if (snapshot.latestCommit.evidenceVersion > input.evidenceVersion) {
      throw new CapabilityEvidenceProjectionStaleError();
    }

    const requested = new Set(input.evidenceIds);
    const eligible = snapshot.evidence.filter((item) => item.evidenceVersion !== undefined
      && item.evidenceVersion <= input.evidenceVersion);
    const byId = new Map(eligible.map((item) => [item.evidenceId, item]));
    if (byId.size !== eligible.length) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Session Evidence identifiers are not unique");
    }
    const selected: Evidence[] = [];
    for (const id of input.evidenceIds) {
      const evidence = byId.get(id);
      if (evidence === undefined
          || evidence.sessionId !== input.sessionId
        || evidence.profileRevision !== input.profileRevision
        || (evidence.evidenceVersion ?? -1) > input.evidenceVersion
          || (input.knowledgePointId !== undefined && evidence.knowledgePointId !== input.knowledgePointId)) {
        throw new LearningSessionRepositoryError("evidence_invalid", "Requested Evidence is not bound to the session, revision, version, and knowledge point");
      }
      selected.push(evidence);
    }
    if (selected.length !== requested.size) {
      throw new LearningSessionRepositoryError("evidence_invalid", "Requested Evidence contains duplicates");
    }
    return selected.map((evidence) => ({
      evidenceId: evidence.evidenceId,
      observableDimensionIds: observableDimensions(evidence),
      safeSummary: safeSummary(evidence),
    }));
  }
}
