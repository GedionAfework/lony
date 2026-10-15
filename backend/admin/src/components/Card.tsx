import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  tight?: boolean;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function Card({ children, className, tight, title, subtitle, actions }: Props) {
  return (
    <div className={['card', tight ? 'card-tight' : '', className || ''].filter(Boolean).join(' ')}>
      {title || actions ? (
        <div className="card-title-row">
          <div>
            {title ? <strong>{title}</strong> : null}
            {subtitle ? <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{subtitle}</div> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
