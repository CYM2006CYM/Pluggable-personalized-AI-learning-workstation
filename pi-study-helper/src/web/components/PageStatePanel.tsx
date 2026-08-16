import { STABLE_LAYOUT } from "../styles/layout-contract.js";

export type PageKind = "start" | "diagnostic" | "path" | "learn" | "activity" | "summary";
export type PageViewState = "loading" | "empty" | "error" | "conflict" | "recovery";

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
  state: PageViewState;
  code?: string;
  detail?: string;
  onRetry?: () => void;
}

export function PageStatePanel({ page, state, code, detail, onRetry }: PageStatePanelProps) {
  const pageLabel = pageLabels[page];

  if (state === "loading") {
    return <section className="state-panel" data-state="loading" aria-busy="true" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}><p className="state-code">LOADING</p><h2>正在加载{pageLabel}</h2><p>正在从本地服务读取安全快照。</p></section>;
  }

  if (state === "empty") {
    return (
      <section className="state-panel" data-state="empty" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
        <p className="state-code">EMPTY</p>
        <h2>暂无{pageLabel}</h2>
        <p>当前安全视图没有可展示的数据，既有会话和草稿不会被删除。</p>
        <a className="button secondary" href="/">返回开始页</a>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="state-panel error-state" data-state="error" role="alert" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
        <p className="state-code">{code ?? "REQUEST_ERROR"}</p>
        <h2>{pageLabel}未确认保存</h2>
        <p>{detail ?? "本地服务没有完成本次请求。最后一次安全输入仍保留在当前页面。"}</p>
        <div className="button-row">
          {onRetry ? <button type="button" className="button primary" onClick={onRetry}>重试</button> : null}
          <a className="button secondary" href="/">返回开始页</a>
        </div>
      </section>
    );
  }

  if (state === "conflict") {
    return (
      <section className="state-panel conflict-state" data-state="conflict" data-error-code={code ?? "session_version_conflict"} role="alert" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
        <p className="state-code">{code ?? "session_version_conflict"}</p>
        <h2>另一窗口已有更新</h2>
        <p>{detail ?? "服务端会话版本已变化。本地未提交文本仍保留，请加载最新服务端快照。"}</p>
        <div className="button-row">
          {onRetry ? <button type="button" className="button primary" onClick={onRetry}>加载最新版本</button> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="state-panel recovery-state" data-state="recovery" aria-live="polite" style={{ minHeight: STABLE_LAYOUT.statePanelMinHeight }}>
      <p className="state-code">{code ?? "RECOVERY_BLOCKED"}</p>
      <h2>服务端保留了进度，但当前安全投影不足</h2>
      <p>{detail ?? "不会使用浏览器内存补造持久化数据。请等待上游安全恢复合同补齐。"}</p>
      {onRetry ? <button type="button" className="button primary" onClick={onRetry}>重新读取服务端快照</button> : null}
    </section>
  );
}
