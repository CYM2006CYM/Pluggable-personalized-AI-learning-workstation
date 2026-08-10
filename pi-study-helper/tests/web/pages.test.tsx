// @vitest-environment jsdom

import type { ReactElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActivityPage } from "../../src/web/pages/ActivityPage.js";
import { DiagnosticPage } from "../../src/web/pages/DiagnosticPage.js";
import { LearnPage } from "../../src/web/pages/LearnPage.js";
import { PathPage } from "../../src/web/pages/PathPage.js";
import { StartPage } from "../../src/web/pages/StartPage.js";
import { SummaryPage } from "../../src/web/pages/SummaryPage.js";
import { appRoutes } from "../../src/web/app/routes.js";
import { activitySubmissionMock } from "../../src/web/mocks/safe-dtos.js";
import { ACTIVITY_VIEW_MODES, useUiStore, type PageViewState } from "../../src/web/state/ui-store.js";

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const pages: Array<{ name: string; element: ReactElement; marker: string; readyAction: string }> = [
  { name: "开始", element: <StartPage />, marker: "start", readyAction: "开始学习" },
  { name: "诊断", element: <DiagnosticPage />, marker: "diagnostic", readyAction: "保存并继续" },
  { name: "路径", element: <PathPage />, marker: "path", readyAction: "确认这条路径" },
  { name: "学习", element: <LearnPage />, marker: "learn", readyAction: "进入练习活动" },
  { name: "活动", element: <ActivityPage />, marker: "activity", readyAction: "提交正式评测" },
  { name: "总结", element: <SummaryPage />, marker: "summary", readyAction: "继续当前路径" },
];

const stateMarkers: Array<[Exclude<PageViewState, "ready">, string, string, string]> = [
  ["empty", "empty", "暂无", "返回开始页"],
  ["error", "error", "未确认保存", "重试"],
  ["conflict", "session_version_conflict", "另一窗口已有更新", "加载最新版本"],
  ["recovery", "recovery", "发现可恢复进度", "从完整检查点恢复"],
];

describe("W3 D2 page components", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useUiStore.getState().reset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(element: ReactElement) {
    act(() => root.render(<MemoryRouter>{element}</MemoryRouter>));
  }

  function findButton(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
    expect(button, `button ${text}`).not.toBeUndefined();
    return button as HTMLButtonElement;
  }

  async function click(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  for (const page of pages) {
    it(`renders the ${page.name} ready view`, () => {
      render(page.element);
      expect(container.querySelector(`[data-page="${page.marker}"]`)).not.toBeNull();
      const actions = Array.from(container.querySelectorAll("a, button"));
      expect(actions.some((action) => action.textContent?.includes(page.readyAction))).toBe(true);
    });

    for (const [state, marker, content, action] of stateMarkers) {
      it(`renders the ${page.name} ${state} view`, () => {
        useUiStore.getState().setPageViewState(state);
        render(page.element);
        const panel = container.querySelector(`[data-state="${marker}"]`);
        expect(panel).not.toBeNull();
        expect(panel?.textContent).toContain(content);
        const operation = Array.from(panel?.querySelectorAll("button, a") ?? []).find((candidate) => candidate.textContent?.includes(action));
        expect(operation).not.toBeUndefined();
        expect((operation as HTMLButtonElement).disabled).toBe(false);
      });
    }
  }

  it.each(ACTIVITY_VIEW_MODES)("renders the activity %s stage", (mode) => {
    useUiStore.getState().setActivityViewMode(mode);
    render(<ActivityPage />);
    expect(container.querySelector(`[data-activity-mode="${mode}"]`)).not.toBeNull();
  });

  it("renders the frozen ActivityResult score without percentage conversion", () => {
    useUiStore.getState().setActivityViewMode("submitted");
    render(<ActivityPage />);
    expect(activitySubmissionMock.result.score).toBe(0.78);
    expect(container.querySelector(".score-block")?.textContent).toBe("0.78 / 1");
    expect(container.textContent).not.toContain("78 / 100");
  });

  it("shows safe feedback using only public ActivityResult fields", () => {
    useUiStore.getState().setActivityViewMode("safe_feedback");
    render(<ActivityPage />);
    const stage = container.querySelector('[data-activity-mode="safe_feedback"]');
    expect(stage?.textContent).toContain("evaluator_timeout");
    expect(stage?.textContent).toContain("failed");
    expect(stage?.textContent).toContain("node-pandas-v1");
    expect(stage?.textContent).not.toContain("草稿版本");
    expect(stage?.textContent).not.toContain("恢复动作");
  });

  it("preserves a controlled activity draft through conflict, error, recovery, and route changes", async () => {
    const router = createMemoryRouter(appRoutes, {
      initialEntries: ["/activity/session-demo-001/act-missing"],
    });
    act(() => root.render(<RouterProvider router={router} />));

    const uniqueDraft = "# unique W3-D46 draft\ndef clean_missing(df):\n    return df.dropna(subset=['order_id'])\n";
    const textarea = container.querySelector("#code-draft") as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      valueSetter?.call(textarea, uniqueDraft);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((container.querySelector("#code-draft") as HTMLTextAreaElement).value).toBe(uniqueDraft);

    for (const [stateLabel, marker] of [
      ["冲突", "session_version_conflict"],
      ["错误", "error"],
      ["恢复", "recovery"],
    ] as const) {
      await click(findButton(stateLabel));
      expect(container.querySelector(`[data-state="${marker}"]`)).not.toBeNull();
      await click(findButton(stateLabel === "恢复" ? "从完整检查点恢复" : "正常"));
      if (stateLabel !== "恢复") {
        expect(useUiStore.getState().pageViewState).toBe("ready");
      }
      expect((container.querySelector("#code-draft") as HTMLTextAreaElement).value).toBe(uniqueDraft);
    }

    const startLink = Array.from(container.querySelectorAll(".primary-nav a")).find((link) => link.textContent?.includes("开始"));
    await click(startLink as Element);
    await click(findButton("查看检查点"));
    expect(container.querySelector('[data-state="recovery"]')).not.toBeNull();
    await click(findButton("从完整检查点恢复"));
    expect(container.querySelector('[data-page="start"]')).not.toBeNull();

    const activityLink = Array.from(container.querySelectorAll(".primary-nav a")).find((link) => link.textContent?.includes("活动"));
    await click(activityLink as Element);
    expect((container.querySelector("#code-draft") as HTMLTextAreaElement).value).toBe(uniqueDraft);
  });

  it("uses only the node-aware learning link shape in navigation", () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    act(() => root.render(<RouterProvider router={router} />));
    const learningLinks = Array.from(container.querySelectorAll('a[href^="/learn/"]')) as HTMLAnchorElement[];
    expect(learningLinks.length).toBeGreaterThan(0);
    expect(learningLinks.every((link) => /^\/learn\/[^/]+\/[^/]+$/.test(link.getAttribute("href") ?? ""))).toBe(true);
  });

  it.each([
    ["路径", <PathPage />],
    ["活动", <ActivityPage />],
    ["总结", <SummaryPage />],
  ] as const)("uses a node-aware learning entry on the %s page", (_name, page) => {
    render(page);
    const learningLink = container.querySelector('a[href^="/learn/"]') as HTMLAnchorElement | null;
    expect(learningLink).not.toBeNull();
    expect(learningLink?.getAttribute("href")).toMatch(/^\/learn\/[^/]+\/[^/]+$/);
  });

  it("delivers both route parameters to the learning page", () => {
    const router = createMemoryRouter(appRoutes, {
      initialEntries: ["/learn/session-demo-001/node-missing-values"],
    });
    act(() => root.render(<RouterProvider router={router} />));
    const page = container.querySelector('[data-page="learn"]');
    expect(page?.getAttribute("data-session-id")).toBe("session-demo-001");
    expect(page?.getAttribute("data-node-id")).toBe("node-missing-values");
  });

  it("binds stable dimensions to stateful DOM surfaces", () => {
    useUiStore.getState().setPageViewState("empty");
    render(<StartPage />);
    expect((container.querySelector(".state-panel") as HTMLElement).style.minHeight).toBe("430px");

    act(() => root.unmount());
    root = createRoot(container);
    useUiStore.getState().setPageViewState("ready");
    render(<ActivityPage />);
    expect((container.querySelector(".activity-stage") as HTMLElement).style.minHeight).toBe("476px");
    expect((container.querySelector(".activity-tabs") as HTMLElement).style.height).toBe("44px");
  });

  it("does not render sensitive categories in ready pages", () => {
    render(<ActivityPage />);
    for (const forbidden of ["hiddenTest", "referenceSolution", "apiKey", "systemPrompt", "C:\\", "/home/"]) {
      expect(container.innerHTML).not.toContain(forbidden);
    }
  });
});
