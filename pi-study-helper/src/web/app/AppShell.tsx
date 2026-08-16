import { NavLink, Outlet, useLocation } from "react-router-dom";

export function AppShell() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const sessionId = parts.length >= 2 ? parts[1] : undefined;
  const navigation = [
    { label: "开始", to: "/" },
    ...(sessionId === undefined ? [] : [
      { label: "诊断", to: `/diagnostic/${sessionId}` },
      { label: "路径", to: `/path/${sessionId}` },
      ...(parts[0] === "learn" ? [{ label: "学习", to: location.pathname }] : []),
      ...(parts[0] === "activity" ? [{ label: "活动", to: location.pathname }] : []),
      { label: "总结", to: `/summary/${sessionId}` },
    ]),
  ];

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
          <span>{sessionId === undefined ? "尚未选择会话" : "当前会话"}</span>
          {sessionId === undefined ? null : <code>{sessionId}</code>}
          <span>服务端快照为权威状态</span>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div><span className="topbar-label">本地确定性学习闭环</span></div>
          <div className="sync-status" role="status">
            <span className="status-dot" aria-hidden="true" />
            真实 API 模式
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
