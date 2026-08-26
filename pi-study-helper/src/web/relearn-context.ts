import type { SessionRecoverySafeView } from "../contracts/index.js";

export function relearnNodeIdForActivity(
  session: SessionRecoverySafeView | undefined,
  activityId: string,
  preferredNodeId?: string,
): string | undefined {
  const node = session?.path?.nodes.find((candidate) => candidate.activityIds.includes(activityId)
    && (preferredNodeId === undefined || candidate.nodeId === preferredNodeId));
  const activity = session?.activityProgress
    .find((progress) => progress.nodeId === node?.nodeId)
    ?.activities.find((candidate) => candidate.activityId === activityId);
  return node !== undefined && (node.status === "skipped" || activity?.continuedWithGap === true)
    ? node.nodeId
    : undefined;
}
