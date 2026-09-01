import type { SessionRecoverySafeView } from "../../contracts/index.js";
import type { StudyResumeLocation } from "../state/study-resume-storage.js";

function defaultRouteForSession(session: SessionRecoverySafeView): string {
  const { view } = session;
  if (view.stage === "diagnostic") return `/diagnostic/${view.sessionId}`;
  if (view.stage === "path") return `/path/${view.sessionId}`;
  if (session.currentAttempt !== undefined && session.currentAttempt.status !== "submitted") {
    return `/activity/${view.sessionId}/${session.currentAttempt.activityId}`;
  }
  if (view.stage === "completed") return `/summary/${view.sessionId}`;
  const node = session.path?.nodes.find((item) => item.status === "in_progress" || item.status === "available") ?? session.path?.nodes[0];
  return node === undefined ? `/path/${view.sessionId}` : `/learn/${view.sessionId}/${node.nodeId}`;
}

export function routeForSession(session: SessionRecoverySafeView, resume?: StudyResumeLocation): string {
  const fallback = defaultRouteForSession(session);
  if (resume?.sessionId !== session.view.sessionId || !["learning", "completed"].includes(session.view.stage)) return fallback;
  if (session.currentAttempt !== undefined && session.currentAttempt.status !== "submitted") return fallback;

  let resumed: URL;
  try {
    resumed = new URL(resume.route, "http://pi-study-helper.local");
  } catch {
    return fallback;
  }
  const prefix = `/learn/${encodeURIComponent(session.view.sessionId)}/`;
  if (!resumed.pathname.startsWith(prefix)) return fallback;
  let nodeId: string;
  try {
    nodeId = decodeURIComponent(resumed.pathname.slice(prefix.length));
  } catch {
    return fallback;
  }
  const node = session.path?.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) return fallback;
  if (session.view.stage === "learning" && (node.status === "completed" || node.status === "skipped")) return fallback;
  return `${resumed.pathname}${resumed.search}${resumed.hash}`;
}
