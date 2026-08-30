const STORAGE_KEY = "pi-study-helper:study-resume:v1";
const MAX_ROUTE_LENGTH = 1_024;
const STUDY_PATH = /^\/(diagnostic|path|learn|activity|summary)\/([^/?#]+)(?:\/([^/?#]+))?$/u;

export interface StudyResumeLocation {
  sessionId: string;
  route: string;
  updatedAt: string;
}
type StudyLocation = Pick<Location, "pathname" | "search" | "hash">;

function parsedStudyRoute(route: string): { sessionId: string } | undefined {
  if (route.length === 0 || route.length > MAX_ROUTE_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(route, "http://pi-study-helper.local");
  } catch {
    return undefined;
  }
  if (url.origin !== "http://pi-study-helper.local") return undefined;
  const match = url.pathname.match(STUDY_PATH);
  if (match === null || match[2] === undefined) return undefined;
  try {
    return { sessionId: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function rememberStudyLocation(location: StudyLocation, now = new Date()): void {
  const route = `${location.pathname}${location.search}${location.hash}`;
  const parsed = parsedStudyRoute(route);
  if (parsed === undefined) return;
  try {
    browserStorage()?.setItem(STORAGE_KEY, JSON.stringify({
      sessionId: parsed.sessionId,
      route,
      updatedAt: now.toISOString(),
    } satisfies StudyResumeLocation));
  } catch {
    // Reading progress is an enhancement; unavailable browser storage must not block learning.
  }
}

export function readStudyResumeLocation(): StudyResumeLocation | undefined {
  let raw: string | null;
  try {
    raw = browserStorage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StudyResumeLocation>;
    if (typeof value.sessionId !== "string" || typeof value.route !== "string" || typeof value.updatedAt !== "string") return undefined;
    const parsed = parsedStudyRoute(value.route);
    if (parsed?.sessionId !== value.sessionId || !Number.isFinite(Date.parse(value.updatedAt))) return undefined;
    return { sessionId: value.sessionId, route: value.route, updatedAt: value.updatedAt };
  } catch {
    return undefined;
  }
}
