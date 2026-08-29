// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecoverySafeView } from "../../src/contracts/index.js";
import { appRoutes } from "../../src/web/app/routes.js";
import { bootstrap, nextStep, ok, recovery } from "./fixtures/w4-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/*
 * 侧栏动线回归：AppShell 是父布局，页面之间切换不重挂载。
 * 会话刚建立时 bootstrap 里还没有 path，侧栏显示「诊断进行中，其余未解锁」；
 * 用户做完诊断、确认路径、进到学习页之后，侧栏必须跟着走到「学习进行中」，
 * 不能停留在会话刚建立时的快照上。
 */
describe("AppShell sidebar flow", () => {
  it("advances the stepper as the session progresses within one session", async () => {
    const earlySession: SessionRecoverySafeView = {
      ...recovery(),
      path: undefined,
      knowledgeStates: [],
    };
    const learningSession: SessionRecoverySafeView = {
      ...recovery(),
      knowledgeStates: [
        { knowledgePointId: "basic-python" },
      ] as SessionRecoverySafeView["knowledgeStates"],
    };

    let phase: "early" | "learning" = "early";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/bootstrap")) {
        return ok(bootstrap(phase === "early" ? earlySession : learningSession));
      }
      if (url.includes("next-step")) return ok(nextStep);
      return ok({});
    });

    vi.stubGlobal("fetch", fetchImpl);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/diagnostic/session-w4"] });
    await act(async () => { root!.render(<RouterProvider router={router} />); });
    await settle();

    const sidebarItems = () => [...host.querySelectorAll(".app-sidebar .stepper-item")];
    const statusOf = (label: string) =>
      sidebarItems().find((item) => item.querySelector(".stepper-label")?.textContent === label)
        ?.getAttribute("data-status");

    // 会话初期：诊断进行中，学习尚未解锁。
    expect(statusOf("诊断")).toBe("current");
    expect(statusOf("学习")).toBe("locked");

    // 同一会话内走到学习页：侧栏必须重对齐快照，不能停在旧状态。
    phase = "learning";
    await act(async () => { router.navigate("/learn/session-w4/node-basic"); });
    await settle();

    expect(statusOf("诊断")).toBe("completed");
    expect(statusOf("学习")).toBe("current");
  });
});
