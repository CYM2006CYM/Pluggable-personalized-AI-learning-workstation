import type { ReactNode } from "react";

interface PageFrameProps {
  eyebrow: string;
  title: string;
  summary: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PageFrame({ eyebrow, title, summary, actions, children }: PageFrameProps) {
  return (
    <main className="page-frame">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-summary">{summary}</p>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      <div className="page-body">{children}</div>
    </main>
  );
}
