// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRoutes } from "../../src/web/app/routes.js";
import { parseStudyDeepLinkSearch } from "../../src/web/pages/StudyDeepLinkPage.js";
import { bootstrap, nextStep, ok, recovery } from "./fixtures/w4-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function renderStudy(url: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const router = createMemoryRouter(appRoutes, { initialEntries: [url] });
  await act(async () => { root!.render(<RouterProvider router={router} />); });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, router };
}

describe("W5 D2 study deep link", () => {
  it("accepts exactly one safe session/node/activity tuple", () => {
    expect(parseStudyDeepLinkSearch("?sessionId=session-w4&nodeId=node-basic&activityId=act-basic")).toEqual({ sessionId: "session-w4", nodeId: "node-basic", activityId: "act-basic" });
    for (const search of [
      "?sessionId=session-w4&nodeId=node-basic",
      "?sessionId=session-w4&activityId=act-basic",
      "?sessionId=session-w4&nodeId=node-basic&activityId=act-basic&extra=1",
      "?sessionId=session-w4&sessionId=other&nodeId=node-basic&activityId=act-basic",
      "?sessionId=../bad&nodeId=node-basic&activityId=act-basic",
    ]) expect(() => parseStudyDeepLinkSearch(search)).toThrow();
  });

  it("enters the server-confirmed learning node without starting a session", async () => {
    const session = recovery({ stage: "learning" });
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap(session))).mockResolvedValueOnce(ok(nextStep));
    const { router } = await renderStudy("/study?sessionId=session-w4&nodeId=node-basic&activityId=act-basic", fetchMock);
    expect(router.state.location.pathname).toBe("/learn/session-w4/node-basic");
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === "/api/sessions")).toBe(false);
  });

  it("enters only the matching current Attempt", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = { kind: "quiz", activityId: "act-basic", attemptId: "attempt-1", status: "draft", retryNumber: 0 };
    const fetchMock = vi.fn().mockResolvedValue(ok(bootstrap(session)));
    const { router } = await renderStudy("/study?sessionId=session-w4&nodeId=node-basic&activityId=act-basic", fetchMock);
    expect(router.state.location.pathname).toBe("/activity/session-w4/act-basic");
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === "/api/sessions")).toBe(false);
  });

  it.each([
    ["node mismatch", "/study?sessionId=session-w4&nodeId=node-other&activityId=act-basic", "deep_link_node_mismatch"],
    ["activity mismatch", "/study?sessionId=session-w4&nodeId=node-basic&activityId=act-other", "deep_link_activity_mismatch"],
  ])("rejects %s without creating a replacement session", async (_label, url, code) => {
    const fetchMock = vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "learning" }))));
    const { host } = await renderStudy(url, fetchMock);
    expect(host.querySelector(".state-panel")?.getAttribute("data-error-code")).toBe(code);
    expect(host.textContent).toContain("从开始页恢复");
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === "/api/sessions")).toBe(false);
  });

  it("rejects inconsistent session revision metadata", async () => {
    const session = recovery({ stage: "learning" });
    session.sessionVersion = 99;
    const { host } = await renderStudy("/study?sessionId=session-w4&nodeId=node-basic&activityId=act-basic", vi.fn().mockResolvedValue(ok(bootstrap(session))));
    expect(host.querySelector(".state-panel")?.getAttribute("data-error-code")).toBe("deep_link_session_revision_mismatch");
  });

  it("shows start-page recovery for an unknown session", async () => {
    const { host } = await renderStudy("/study?sessionId=session-missing&nodeId=node-basic&activityId=act-basic", vi.fn().mockResolvedValue(ok(bootstrap())));
    expect(host.querySelector(".state-panel")?.getAttribute("data-error-code")).toBe("deep_link_session_not_found");
    expect(host.textContent).toContain("从开始页恢复");
  });

  it("rejects a current Attempt bound to another activity", async () => {
    const session = recovery({ stage: "activity" });
    session.currentAttempt = { kind: "code", activityId: "act-other", attemptId: "attempt-other", status: "draft", draftVersion: 1 };
    const { host } = await renderStudy("/study?sessionId=session-w4&nodeId=node-basic&activityId=act-basic", vi.fn().mockResolvedValue(ok(bootstrap(session))));
    expect(host.querySelector(".state-panel")?.getAttribute("data-error-code")).toBe("deep_link_attempt_mismatch");
  });
});
