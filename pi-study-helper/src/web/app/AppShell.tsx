import { useEffect, useState } from "react";
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
  // 侧栏默认收成一条圆点轨道;悬停轨道弹出毛玻璃动线面板,
  // 底部按钮可把面板钉住为常驻展开(触屏没有 hover,靠这个按钮)。
  const [pinned, setPinned] = useState(false);
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const head = parts[0];
  const sessionId = parts.length >= 2 ? parts[1] : undefined;
  const currentStep = stepFromPathname(location.pathname);

  // 没有会话时侧栏整条动线置灰,不需要请求 bootstrap。页面自己会取数。
  const bootstrap = useBootstrap(sessionId, sessionId !== undefined);
  const session = bootstrap.data?.session;

  /*
   * AppShell 是父布局,页面之间切换不会重挂载。bootstrap 若只在进入会话时
   * 拉一次,侧栏就永远停在会话刚建立时的快照上——诊断做完、路径确认、人已经
   * 在第 3 节做测试,侧栏还画着「诊断进行中,其余尚未解锁」。路由每变一次
   * 就对齐一次快照;同一次导航里页面自己也在拉 bootstrap,in-flight 合并
   * 保证不会多发请求。
   */
  const pathname = location.pathname;
  const reloadBootstrap = bootstrap.reload;
  useEffect(() => {
    if (sessionId !== undefined) void reloadBootstrap();
  }, [pathname, reloadBootstrap, sessionId]);

  // 动线模型需要一个 nodeId:学习页 URL 直接带它;活动页 URL 带的是
  // activityId,用路径节点把 activityId 映射回 nodeId。映射不到时维持
  // undefined,由动线模型按「第一个未完成的节」兜底。
  const flowActiveNodeId = head === "learn"
    ? parts[2]
    : head === "activity" && parts[2] !== undefined && session !== undefined
      ? session.path?.nodes.find((node) => node.activityIds.includes(parts[2]!))?.nodeId
      : undefined;

  const context = buildFlowContext(session, {
    ...(currentStep === undefined ? {} : { currentStep }),
    ...(flowActiveNodeId === undefined ? {} : { activeNodeId: flowActiveNodeId }),
    hasActivity: currentStep === "activity",
  });
  const flow = buildStudyFlow(session?.path?.nodes ?? [], context);

  // 没有会话时整条动线置灰。这样结构稳定，不会在有无会话之间跳变。
  const steps = sessionId === undefined
    ? flow.steps.map((step) => ({ ...step, status: "locked" as const, enterable: false }))
    : flow.steps;

  return (
    <div className="app-shell" data-sidebar={pinned ? "pinned" : "rail"}>
      <aside className="app-sidebar" id="app-sidebar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">Pi</span>
          <strong>Pi Study Helper</strong>
          <span>本地演示模式</span>
        </div>
        <div className="sidebar-flow">
          {/*
            两个实例,恰好一个可见:
            - 轨道(rail):只留圆点动线,常驻;
            - 面板:悬停轨道时渐显的毛玻璃卡,逐节进度平铺在内;
              钉住时停靠为常规侧栏内容。
          */}
          <StudyStepper flow={{ ...flow, steps }} orientation="vertical" variant="rail" />
          <div className="sidebar-panel">
            <StudyStepper flow={{ ...flow, steps }} orientation="vertical" progress="inline" />
          </div>
        </div>
        {/* 折叠按钮。它是同一个按钮，靠 aria-expanded 告诉读屏软件现在是哪一边。 */}
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={pinned}
          aria-controls="app-sidebar"
          title={pinned ? SHELL_LABELS.collapseSidebar : SHELL_LABELS.expandSidebar}
          onClick={() => setPinned((open) => !open)}
        >
          <span className="sidebar-toggle-icon" aria-hidden="true" />
          <span className="sidebar-toggle-text">
            {pinned ? SHELL_LABELS.collapseSidebar : SHELL_LABELS.expandSidebar}
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
