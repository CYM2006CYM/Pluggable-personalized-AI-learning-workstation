// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityResult, BrowserCodeRunner, PublicExecutionBundle } from "../../src/contracts/index.js";
import { ActivityPage } from "../../src/web/pages/ActivityPage.js";
import { BrowserCodeRunnerError } from "../../src/web/preview/browser-code-runner.js";
import { useUiStore } from "../../src/web/state/ui-store.js";
import { bootstrap, ok, openedCode, preparedCode, recovery, savedCode } from "./fixtures/w4-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const publicResult: ActivityResult = {
  executionStatus: "completed",
  verdict: "pass",
  score: 1,
  safeFeedback: "公开检查通过",
  evaluatorVersion: "browser-public-v1",
  environmentHash: "public-environment",
  assetBundleHash: "public-assets",
};

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

async function renderActivity(fetchMock: ReturnType<typeof vi.fn>, runner: BrowserCodeRunner) {
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[{ pathname: "/activity/session-w4/act-code", state: { opened: openedCode } }]}>
        <Routes><Route path="/activity/:sessionId/:activityId" element={<ActivityPage previewRunner={runner} />} /></Routes>
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

function requestBodies(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.flatMap((call) => {
    const body = (call[1] as RequestInit | undefined)?.body;
    return body === undefined ? [] : [String(body)];
  });
}

function storedDraft(): Record<string, unknown> {
  const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
  const key = keys.find((value) => value?.startsWith("pi-study-helper.activity-draft.v1:"));
  if (key === undefined || key === null) throw new Error("stored_draft_not_found");
  return JSON.parse(sessionStorage.getItem(key)!) as Record<string, unknown>;
}

describe("W5 D2 E runtime evidence", () => {
  it("preview success calls only draft and run and never uploads the preview result", async () => {
    let received: { bundle: PublicExecutionBundle; code: string } | undefined;
    const runner: BrowserCodeRunner = {
      async run(bundle, code) {
        received = { bundle, code };
        return publicResult;
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(savedCode))
      .mockResolvedValueOnce(ok(preparedCode));
    const host = await renderActivity(fetchMock, runner);

    await click(button(host, "运行公开检查"));

    expect(requestPaths(fetchMock)).toEqual([
      "/api/bootstrap?recoverSessionId=session-w4",
      "/api/activities/act-code/draft",
      "/api/activities/act-code/run",
    ]);
    expect(requestPaths(fetchMock).some((path) => path.endsWith("/submit"))).toBe(false);
    expect(received).toEqual({ bundle: preparedCode, code: "print('server draft')" });
    for (const body of requestBodies(fetchMock)) {
      expect(body).not.toContain(publicResult.safeFeedback);
      expect(body).not.toContain(`"verdict":"${publicResult.verdict}"`);
      expect(body).not.toContain(`"executionStatus":"${publicResult.executionStatus}"`);
    }
  });

  it("preview output is displayed but never persisted in sessionStorage", async () => {
    const runner: BrowserCodeRunner = { run: async () => publicResult };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(savedCode))
      .mockResolvedValueOnce(ok(preparedCode));
    const host = await renderActivity(fetchMock, runner);

    await click(button(host, "运行公开检查"));

    expect(host.textContent).toContain(publicResult.safeFeedback);
    const record = storedDraft();
    expect(Object.keys(record).sort()).toEqual([
      "activityId", "attemptId", "draftVersion", "profileRevision", "schemaVersion", "sessionId", "userText",
    ].sort());
    expect(JSON.stringify(record)).not.toContain(publicResult.safeFeedback);
    expect(JSON.stringify(record)).not.toContain("verdict");
    expect(JSON.stringify(record)).not.toContain("executionStatus");
  });

  it("preview unavailable does not call submit and leaves formal submission enabled", async () => {
    const runner: BrowserCodeRunner = {
      run: async () => { throw new BrowserCodeRunnerError("preview_unavailable"); },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(bootstrap(recovery({ stage: "activity" }))))
      .mockResolvedValueOnce(ok(savedCode))
      .mockResolvedValueOnce(ok(preparedCode));
    const host = await renderActivity(fetchMock, runner);

    await click(button(host, "运行公开检查"));

    expect(host.textContent).toContain("PREVIEW_UNAVAILABLE");
    expect(requestPaths(fetchMock).some((path) => path.endsWith("/submit"))).toBe(false);
    expect(button(host, "提交正式评测").disabled).toBe(false);
  });
});
