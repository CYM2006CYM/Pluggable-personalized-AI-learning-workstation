import type { DefenderOutput, HunterOutput, JudgeOutput } from "../graphs/v2-learning-graphs.js";

export type DefenderRoute = {
  required: boolean;
  reason: "high_risk" | "deterministic_clear";
};

export function highRiskHunterOutput(hunter: HunterOutput): HunterOutput {
  const issues = hunter.issues.filter((issue) => issue.severity === "high");
  return {
    issues,
    requiresDefender: issues.length > 0,
    recommendedVerdict: issues.length === 0 ? "accepted" : "revise",
  };
}

export function defenderRoute(hunter: HunterOutput): DefenderRoute {
  return hunter.issues.some((issue) => issue.severity === "high")
    ? { required: true, reason: "high_risk" }
    : { required: false, reason: "deterministic_clear" };
}

export function defenderOutputIsClosed(defender: DefenderOutput, routedHunter: HunterOutput): boolean {
  const reviewed = routedHunter.issues.map((issue) => issue.issueId);
  const assessed = defender.issueAssessments.map((assessment) => assessment.issueId);
  return new Set(assessed).size === assessed.length
    && assessed.length === reviewed.length
    && assessed.every((issueId) => reviewed.includes(issueId));
}

export function judgeOutputIsClosed(judge: JudgeOutput, hunter: HunterOutput): boolean {
  const hunterIssueIds = hunter.issues.map((issue) => issue.issueId);
  const decisionIssueIds = judge.issueDecisions.map((decision) => decision.issueId);
  const additionalIssueIds = judge.additionalIssues.map((issue) => issue.issueId);
  const blockableIssueIds = new Set([
    ...judge.issueDecisions
      .filter((decision) => decision.decision === "upheld")
      .map((decision) => decision.issueId),
    ...additionalIssueIds,
  ]);
  return new Set(decisionIssueIds).size === decisionIssueIds.length
    && decisionIssueIds.length === hunterIssueIds.length
    && decisionIssueIds.every((issueId) => hunterIssueIds.includes(issueId))
    && new Set(additionalIssueIds).size === additionalIssueIds.length
    && additionalIssueIds.every((issueId) => !hunterIssueIds.includes(issueId))
    && new Set(judge.blockedIssueIds).size === judge.blockedIssueIds.length
    && judge.blockedIssueIds.every((issueId) => blockableIssueIds.has(issueId))
    && (judge.verdict === "accepted"
      ? judge.blockedIssueIds.length === 0
      : judge.blockedIssueIds.length > 0);
}
