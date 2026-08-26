import { Type, agentNode, defineSingleAgentGraph, type Graph } from "pi-loop-graph-sdk";

export const W6_PROFILE_PROMPT_VERSION = "w6-profile-v2";

const Input = Type.Object({
  runId: Type.String(), profileRevision: Type.Number(), promptVersion: Type.String(),
  safeContext: Type.Record(Type.String(), Type.Unknown()),
  budget: Type.Object({ timeoutMs: Type.Number(), maxTokens: Type.Optional(Type.Number()) }),
});
const Output = Type.Object({ summary: Type.String(), evidenceRefs: Type.Array(Type.String()) });

export function createW6ProfileGraph(): Graph {
  return defineSingleAgentGraph({
    id: "learner-profile",
    version: W6_PROFILE_PROMPT_VERSION,
    goal: "Summarize learner progress from formal safe evidence without changing authoritative facts.",
    input: Input,
    output: Output,
    context: { background: { select: "none" } },
    node: agentNode({
      subGoal: "根据正式 Evidence 和知识状态生成简体中文学习画像解释。",
      input: Input,
      output: Output,
      tools: [],
      prompt: [
        "你是学情画像 Agent，只能解释 safeContext 中的正式事实，不能修改、推断或替代 KnowledgeState、Evidence、路径和判分。",
        "summary 必须是简体中文，说明学习前后状态、进步点、仍需支持点和带缺口活动；不得声称没有输入中明确支持的掌握结果。",
        "safeContext.strengths 和 safeContext.supportNeeded 是分类的唯一权威来源：ready 属于已有基础，不属于仍需支持；supportNeeded 为空时必须明确写暂无仍需支持点，不得把 ready 描述成薄弱、未掌握或仍需支持。",
        "safeContext.diagnosticSkippedKnowledgePointIds 是用户在两类客观诊断证据通过后主动跳过的章节；不得把这些章节描述成尚未开始、未覆盖、薄弱或建议继续完成。",
        "safeContext.skippedActivityIds 才表示带缺口继续的活动；该数组为空时必须明确写无带缺口活动。",
        "evidenceRefs 只能逐字复制 safeContext.evidenceIds 中的 ID，至少引用一条；不得输出答案、题目私有内容、hidden tests、Rubric、主机路径、凭据或 token。",
        "只返回 summary 和 evidenceRefs 两个字段。",
      ].join("\n"),
    }),
  });
}
