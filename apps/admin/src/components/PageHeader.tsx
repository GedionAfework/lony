import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Props = {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function PageHeader({ icon: Icon, title, subtitle, actions }: Props) {
  return (
    <div className="page-header">
      <div className="page-header-title">
        {Icon ? (
          <span className="page-header-icon">
            <Icon size={20} strokeWidth={2} />
          </span>
        ) : null}
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}
