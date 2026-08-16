import type { SessionRecoverySafeView } from "../../contracts/index.js";

export function routeForSession(session: SessionRecoverySafeView): string {
  const { view } = session;
  if (view.stage === "diagnostic") return `/diagnostic/${view.sessionId}`;
  if (view.stage === "path") return `/path/${view.sessionId}`;
  if (view.stage === "activity" && session.currentAttempt !== undefined && session.currentAttempt.status !== "submitted") {
    return `/activity/${view.sessionId}/${session.currentAttempt.activityId}`;
  }
  if (view.stage === "completed") return `/summary/${view.sessionId}`;
  const node = session.path?.nodes.find((item) => item.status === "in_progress" || item.status === "available") ?? session.path?.nodes[0];
  return node === undefined ? `/path/${view.sessionId}` : `/learn/${view.sessionId}/${node.nodeId}`;
}
