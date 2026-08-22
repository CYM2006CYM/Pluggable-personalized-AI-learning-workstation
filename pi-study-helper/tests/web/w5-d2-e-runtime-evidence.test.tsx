// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityPage } from "../../src/web/pages/ActivityPage.js";
import { writeActivityDraft } from "../../src/web/state/activity-draft-storage.js";
import { useUiStore } from "../../src/web/state/ui-store.js";
import { bootstrap, codeSubmission, ok, openedCode, recovery, savedCode } from "./fixtures/w4-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  useUiStore.setState({ activityDrafts: {} });
  sessionStorage.clear();
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderActivity(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[{ pathname: "/activity/session-w4/act-code", state: { opened: openedCode } }]}>
        <Routes><Route path="/activity/:sessionId/:activityId" element={<ActivityPage />} /></Routes>
      </MemoryRouter>,
    );
  });
  await settle();
  return host;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  if (!(found instanceof HTMLButtonElement)) throw new Error(`button_not_found:${label}`);
  return found;
}

async function click(target: HTMLElement) {
  await act(async () => { target.click(); });
  await settle();
}

function requestPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

describe("W5 D4 E Pyodide closed-state evidence", () => {
  it("exposes no preview control or run request while formal submission stays enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(bootstrap(recovery({ stage: "activity" }))));
    const host = await renderActivity(fetchMock);

    expect(host.querySelector('[data-preview-enabled="false"]')).not.toBeNull();
    expect(host.textContent).toContain("PYODIDE_DISABLED_WITH_NODE_FALLBACK");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.includes("预览") || item.textContent?.includes("公开检查"))).toBe(false);
    expect(requestPaths(fetchMock).some((path) => path.endsWith("/run"))).toBe(false);
    expect(button(host, "提交正式评测").disabled).toBe(false);
  });

  it("persists only the version-bound draft through the remaining secondary action", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(savedCode));
    const host = await renderActivity(fetchMock);

    await click(button(host, "保存草稿"));

    expect(requestPaths(fetchMock)).toEqual([
      "/api/bootstrap?recoverSessionId=session-w4",
      "/api/activities/act-code/draft",
    ]);
    const stored = sessionStorage.getItem(sessionStorage.key(0)!);
    expect(stored).toContain("attempt-code-1");
    expect(stored).not.toContain("verdict");
    expect(stored).not.toContain("executionStatus");
  });

  it("uses the Node formal submit route without touching the retained preview route", async () => {
    writeActivityDraft(sessionStorage, { sessionId: "session-w4", activityId: "act-code", attemptId: "attempt-code-1", profileRevision: 3, draftVersion: 1 }, "print('server draft')");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(codeSubmission))
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "learning" }))));
    const host = await renderActivity(fetchMock);

    await click(button(host, "提交正式评测"));

    expect(requestPaths(fetchMock).some((path) => path.endsWith("/submit"))).toBe(true);
    expect(requestPaths(fetchMock).some((path) => path.endsWith("/run"))).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });
});
