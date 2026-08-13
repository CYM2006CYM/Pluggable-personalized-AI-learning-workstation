import type { NodeActivityProgress, PathNodeSafeView } from "../contracts/index.js";

/** Projects display state from the authoritative activity progress without changing path structure. */
export function projectPathNodes<T extends PathNodeSafeView>(
  nodes: readonly T[],
  activityProgress: readonly NodeActivityProgress[],
): T[] {
  const progressByNode = new Map(activityProgress.map((entry) => [entry.nodeId, entry]));
  return nodes.map((node) => {
    const activities = progressByNode.get(node.nodeId)?.activities ?? [];
    const terminal = activities.length > 0
      && activities.every((activity) => activity.status === "completed" || activity.status === "insufficient");
    const active = activities.some((activity) => activity.status !== "pending");
    const status = terminal ? "completed" as const : active ? "in_progress" as const : node.status;
    return {
      ...structuredClone(node),
      status,
      positionLocked: node.positionLocked || status === "completed" || status === "in_progress",
    };
  });
}
