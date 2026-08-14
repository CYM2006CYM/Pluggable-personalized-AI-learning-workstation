import { Type, agentNode, defineSingleAgentGraph, type Graph } from "pi-loop-graph-sdk";

const ContextInput = Type.Object({
  runId: Type.String(),
  profileRevision: Type.Number(),
  promptVersion: Type.String(),
  safeContext: Type.Record(Type.String(), Type.Unknown()),
  budget: Type.Object({ timeoutMs: Type.Number(), maxTokens: Type.Optional(Type.Number()) }),
});

const GeneratorOutput = Type.Object({
  artifactId: Type.String(),
  candidateFeedback: Type.String(),
  rationale: Type.String(),
  citedSourceIds: Type.Array(Type.String()),
  riskFlags: Type.Array(Type.String()),
});

const HunterOutput = Type.Object({
  issues: Type.Array(Type.Object({
    issueId: Type.String(),
    severity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    message: Type.String(),
    disputed: Type.Boolean(),
  })),
  requiresDefender: Type.Boolean(),
  recommendedVerdict: Type.Union([Type.Literal("accepted"), Type.Literal("revise")]),
});

const DefenderOutput = Type.Object({
  defenseSummary: Type.String(),
  acceptedIssueIds: Type.Array(Type.String()),
  rebuttedIssueIds: Type.Array(Type.String()),
  residualRisks: Type.Array(Type.String()),
});

const JudgeOutput = Type.Object({
  verdict: Type.Union([Type.Literal("accepted"), Type.Literal("revise"), Type.Literal("rejected")]),
  finalSafeFeedback: Type.String(),
  summary: Type.String(),
  blockedIssueIds: Type.Array(Type.String()),
});

const CapabilityOutput = Type.Object({
  dimensions: Type.Array(Type.Object({
    id: Type.Union([
      Type.Literal("syntax_api"),
      Type.Literal("data_abstraction"),
      Type.Literal("cleaning_reasoning"),
      Type.Literal("validation_debugging"),
      Type.Literal("engineering_independence"),
    ]),
    score: Type.Number(),
    confidence: Type.Number(),
    rationale: Type.String(),
    evidenceRefs: Type.Array(Type.String()),
  })),
});

function graph(id: string, goal: string, output: typeof GeneratorOutput): Graph;
function graph(id: string, goal: string, output: typeof HunterOutput): Graph;
function graph(id: string, goal: string, output: typeof DefenderOutput): Graph;
function graph(id: string, goal: string, output: typeof JudgeOutput): Graph;
function graph(id: string, goal: string, output: typeof CapabilityOutput): Graph;
function graph(id: string, goal: string, output: typeof GeneratorOutput | typeof HunterOutput | typeof DefenderOutput | typeof JudgeOutput | typeof CapabilityOutput): Graph {
  return defineSingleAgentGraph({
    id,
    version: "w4-d2-v1",
    goal,
    input: ContextInput,
    output,
    context: { background: { select: "none" } },
    node: agentNode({
      subGoal: goal,
      input: ContextInput,
      output,
      tools: [],
      prompt: [
        "Use only the supplied safeContext.",
        "Return only the requested JSON schema.",
        "Do not change scores, Evidence, KnowledgeState, paths, rubrics, answers, or hidden assets.",
        "For capability-scorer, every rationale must be Simplified Chinese and cite only supplied formal Evidence.",
      ].join("\n"),
    }),
  });
}

/** D-owned graph registry factory for C's PiGraphModelExecutionAdapter binding. */
export function createW4DModelGraphs(): readonly Graph[] {
  return Object.freeze([
    graph("generator", "Generate a safe adaptive card or quiz candidate.", GeneratorOutput),
    graph("hunter", "Review an adaptive candidate for support, leakage, and boundary issues.", HunterOutput),
    graph("defender", "Respond to disputed Hunter issues using only safe context.", DefenderOutput),
    graph("judge", "Make the final review decision without changing authoritative facts.", JudgeOutput),
    graph("capability-scorer", "Score observable Pandas capability dimensions from safe Evidence projections.", CapabilityOutput),
  ]);
}
