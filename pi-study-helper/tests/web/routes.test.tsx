import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { appRoutes } from "../../src/web/app/routes.js";

const routeCases = [
  ["开始", "/", undefined],
  ["诊断", "/diagnostic/session-demo-001", "diagnostic/:sessionId"],
  ["路径", "/path/session-demo-001", "path/:sessionId"],
  ["学习", "/learn/session-demo-001/node-missing-values", "learn/:sessionId/:nodeId"],
  ["活动", "/activity/session-demo-001/act-missing", "activity/:sessionId/:activityId"],
  ["总结", "/summary/session-demo-001", "summary/:sessionId"],
] as const;

describe("W3 D2 web routes", () => {
  it.each(routeCases)("matches the %s page", (_label, pathname, expectedPath) => {
    const matches = matchRoutes(appRoutes, pathname);
    expect(matches).not.toBeNull();
    expect(matches?.at(-1)?.route.path).toBe(expectedPath);
  });

  it("rejects the obsolete learning route without a nodeId", () => {
    const matches = matchRoutes(appRoutes, "/learn/session-demo-001");
    expect(matches?.at(-1)?.route.path).toBe("*");
  });

  it("binds both sessionId and nodeId for the learning page", () => {
    const matches = matchRoutes(appRoutes, "/learn/session-demo-001/node-missing-values");
    expect(matches?.at(-1)?.params).toMatchObject({
      sessionId: "session-demo-001",
      nodeId: "node-missing-values",
    });
  });
});
