import { recoverSessionMock, sessionConflictMock } from "../mocks/safe-dtos.js";
import { useUiStore, type PageViewState } from "../state/ui-store.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";

export type PageKind = "start" | "diagnostic" | "path" | "learn" | "activity" | "summary";

const pageLabels: Record<PageKind, string> = {
  start: "资料包",
  diagnostic: "诊断内容",
  path: "路径候选",
  learn: "学习内容",
  activity: "活动内容",
  summary: "会话总结",
};

interface PageStatePanelProps {
  page: PageKind;
  state: Exclude<PageViewState, "ready">;
}

export function PageStatePanel({ page, state }: PageStatePanelProps) {
  const pageLabel = pageLabels[page];
  const setPageViewState = useUiStore((store) => store.setPageViewState);

  if (state === "empty") {
    return (
      <section className="state-panel" data-state="empty" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
        <p className="state-code">EMPTY</p>
        <h2>暂无{pageLabel}</h2>
        <p>当前安全视图没有可展示的数据，既有会话和草稿不会被删除。</p>
        <button type="button" className="button secondary">返回开始页</button>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="state-panel error-state" data-state="error" role="alert" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
        <p className="state-code">STORAGE_ERROR</p>
        <h2>{pageLabel}未确认保存</h2>
        <p>本地服务没有完成本次请求。最后一次安全输入仍保留在当前页面。</p>
        <div className="button-row">
          <button type="button" className="button primary">重试</button>
          <button type="button" className="button secondary">导出草稿</button>
        </div>
      </section>
    );
  }

  if (state === "conflict") {
    return (
      <section className="state-panel conflict-state" data-state="session_version_conflict" role="alert" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
        <p className="state-code">{sessionConflictMock.errorCode}</p>
        <h2>另一窗口已有更新</h2>
        <p>服务端会话版本为 {sessionConflictMock.sessionVersion}。本地草稿尚未覆盖，可以单独保留。</p>
        <div className="button-row">
          <button type="button" className="button primary">加载最新版本</button>
          <button type="button" className="button secondary">保留草稿文本</button>
        </div>
      </section>
    );
  }

  return (
    <section className="state-panel recovery-state" data-state="recovery" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
      <p className="state-code">RECOVERABLE</p>
      <h2>发现可恢复进度</h2>
      <dl className="state-details">
        <div><dt>会话</dt><dd>{recoverSessionMock.view.sessionId}</dd></div>
        <div><dt>Profile revision</dt><dd>{recoverSessionMock.view.profileRevision}</dd></div>
        <div><dt>最后阶段</dt><dd>{recoverSessionMock.view.stage}</dd></div>
      </dl>
      <button type="button" className="button primary" data-action="confirm-recovery" onClick={() => setPageViewState("ready")}>从完整检查点恢复</button>
    </section>
  );
}
