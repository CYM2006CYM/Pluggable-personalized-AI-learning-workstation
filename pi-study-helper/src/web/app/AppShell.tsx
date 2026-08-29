import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useBootstrap } from "../api/use-bootstrap.js";
import { AUX_NAV_LABELS, SHELL_LABELS } from "../copy/ui-copy.js";
import { StudyStepper } from "../components/StudyStepper.js";
import type { StudyStepId } from "../flow/study-flow.js";
import { buildFlowContext, buildStudyFlow } from "../flow/study-flow.js";

/*
 * 全站骨架。侧栏的动线步骤条由动线模型驱动，不再由这里手工拼装导航项。
 *
 * 三件这个组件刻意不做的事：
 * 1. 不判断环节状态——那是动线模型的事。
 * 2. 不展示会话 ID 和「服务端快照为权威状态」这类内部表述。
 * 3. 不让「案例」混进学习动线——它是展示材料，不是学习环节，走顶栏。
 */

function stepFromPathname(pathname: string): StudyStepId | undefined {
  const [head] = pathname.split("/").filter(Boolean);
  switch (head) {
    case "diagnostic":
      return "diagnostic";
    case "path":
      return "analysis";
    case "learn":
      return "lesson";
    case "activity":
      return "activity";
    case "summary":
      return "summary";
    default:
      return undefined;
  }
}

export function AppShell() {
  // 侧栏可折叠。收起后只剩圆点，环节名交给 hover 浮层补。
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const head = parts[0];
  const sessionId = parts.length >= 2 ? parts[1] : undefined;
  const currentStep = stepFromPathname(location.pathname);
  const activeNodeId = head === "learn" ? parts[2] : undefined;

  // 没有会话时侧栏整条动线置灰,不需要请求 bootstrap。页面自己会取数。
  const bootstrap = useBootstrap(sessionId, sessionId !== undefined);
  const session = bootstrap.data?.session;

  const context = buildFlowContext(session, {
    ...(currentStep === undefined ? {} : { currentStep }),
    ...(activeNodeId === undefined ? {} : { activeNodeId }),
    hasActivity: currentStep === "activity",
  });
  const flow = buildStudyFlow(session?.path?.nodes ?? [], context);

  // 没有会话时整条动线置灰。这样结构稳定，不会在有无会话之间跳变。
  const steps = sessionId === undefined
    ? flow.steps.map((step) => ({ ...step, status: "locked" as const, enterable: false }))
    : flow.steps;

  return (
    <div className="app-shell" data-sidebar={sidebarOpen ? "open" : "collapsed"}>
      <aside className="app-sidebar" id="app-sidebar">
        <div className="brand-block">
          <strong>Pi Study Helper</strong>
          <span>本地演示模式</span>
        </div>
        <div className="sidebar-flow">
          <StudyStepper flow={{ ...flow, steps }} orientation="vertical" />
        </div>
        {/* 折叠按钮。它是同一个按钮，靠 aria-expanded 告诉读屏软件现在是哪一边。 */}
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          title={sidebarOpen ? SHELL_LABELS.collapseSidebar : SHELL_LABELS.expandSidebar}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <span className="sidebar-toggle-icon" aria-hidden="true" />
          <span className="sidebar-toggle-text">
            {sidebarOpen ? SHELL_LABELS.collapseSidebar : SHELL_LABELS.expandSidebar}
          </span>
        </button>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div><span className="topbar-label">本地确定性学习闭环</span></div>
          <nav className="topbar-nav" aria-label="主流程之外">
            <NavLink to="/" end>{AUX_NAV_LABELS.start}</NavLink>
            <NavLink to="/showcases">{AUX_NAV_LABELS.showcases}</NavLink>
          </nav>
          <div className="sync-status" role="status">
            <span className="status-dot" aria-hidden="true" />
            本地服务模式
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
