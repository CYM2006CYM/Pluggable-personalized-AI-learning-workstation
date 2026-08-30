// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { routeForSession } from "../../src/web/api/navigation.js";
import { readStudyResumeLocation, rememberStudyLocation } from "../../src/web/state/study-resume-storage.js";
import { recovery } from "./fixtures/w4-api.js";

afterEach(() => localStorage.clear());

describe("study resume location", () => {
  it("stores only an in-app study route with its session binding", () => {
    rememberStudyLocation({ pathname: "/learn/session-w4/node-basic", search: "", hash: "#study/concepts" }, new Date("2026-08-30T09:00:00.000Z"));
    expect(readStudyResumeLocation()).toEqual({
      sessionId: "session-w4",
      route: "/learn/session-w4/node-basic#study/concepts",
      updatedAt: "2026-08-30T09:00:00.000Z",
    });

    rememberStudyLocation({ pathname: "/showcases", search: "?case=demo", hash: "" });
    expect(readStudyResumeLocation()?.route).toBe("/learn/session-w4/node-basic#study/concepts");
  });

  it("restores an unfinished lesson station but lets an active draft remain authoritative", () => {
    const session = recovery();
    const resume = {
      sessionId: "session-w4",
      route: "/learn/session-w4/node-basic#study/walkthrough",
      updatedAt: "2026-08-30T09:00:00.000Z",
    };
    expect(routeForSession(session, resume)).toBe(resume.route);

    session.currentAttempt = { kind: "quiz", activityId: "act-basic", attemptId: "attempt-1", status: "draft", retryNumber: 0 };
    expect(routeForSession(session, resume)).toBe("/activity/session-w4/act-basic");
  });
});
