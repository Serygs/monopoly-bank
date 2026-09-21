import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  backAction?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Shared page-level hierarchy; actions remain in one DOM order at every layout size. */
export function PageHeader({ title, eyebrow, description, backAction, actions, className = '', children }: PageHeaderProps) {
  return <section className={`page-header ${className}`.trim()}>
    <div className="page-header-content">
      {backAction !== undefined && <div className="page-header-back">{backAction}</div>}
      {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description !== undefined && <div className="lede">{description}</div>}
      {children}
    </div>
    {actions !== undefined && <div className="page-header-actions">{actions}</div>}
  </section>;
}
