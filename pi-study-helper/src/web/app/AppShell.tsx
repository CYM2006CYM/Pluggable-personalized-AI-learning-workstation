import { NavLink, Outlet } from "react-router-dom";
import { PAGE_VIEW_STATES, useUiStore, type PageViewState } from "../state/ui-store.js";

const sessionId = "session-demo-001";
const navigation = [
  { label: "开始", to: "/" },
  { label: "诊断", to: `/diagnostic/${sessionId}` },
  { label: "路径", to: `/path/${sessionId}` },
  { label: "学习", to: `/learn/${sessionId}/node-missing-values` },
  { label: "活动", to: `/activity/${sessionId}/act-missing` },
  { label: "总结", to: `/summary/${sessionId}` },
] as const;

const stateLabels: Record<PageViewState, string> = {
  ready: "正常",
  empty: "空",
  error: "错误",
  conflict: "冲突",
  recovery: "恢复",
};

export function AppShell() {
  const pageViewState = useUiStore((state) => state.pageViewState);
  const setPageViewState = useUiStore((state) => state.setPageViewState);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">P</span>
          <div>
            <strong>Pi Study Helper</strong>
            <span>本地演示模式</span>
          </div>
        </div>
        <nav className="primary-nav" aria-label="学习流程">
          {navigation.map((item, index) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <span className="nav-index">{String(index + 1).padStart(2, "0")}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="session-identity">
          <span>当前会话</span>
          <code>{sessionId}</code>
          <span>Profile revision 2</span>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <span className="topbar-label">页面状态</span>
            <div className="segmented-control" role="group" aria-label="页面状态">
              {PAGE_VIEW_STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  className={state === pageViewState ? "selected" : ""}
                  aria-pressed={state === pageViewState}
                  onClick={() => setPageViewState(state)}
                >
                  {stateLabels[state]}
                </button>
              ))}
            </div>
          </div>
          <div className="sync-status" role="status">
            <span className="status-dot" aria-hidden="true" />
            Mock DTO 已载入
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
