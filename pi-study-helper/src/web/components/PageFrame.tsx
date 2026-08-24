import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface PageFrameProps {
  eyebrow: string;
  title: string;
  summary: string;
  actions?: ReactNode;
  back?: { to: string; label: string };
  children: ReactNode;
}

export function PageFrame({ eyebrow, title, summary, actions, back, children }: PageFrameProps) {
  return (
    <main className="page-frame">
      <header className="page-heading">
        <div>
          {back === undefined ? null : <Link className="page-back" to={back.to} aria-label={back.label}><span aria-hidden="true">←</span>{back.label}</Link>}
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
