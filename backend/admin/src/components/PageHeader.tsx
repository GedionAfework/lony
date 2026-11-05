import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Props = {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

// Titles only: pages carry no description lines under the heading.
export function PageHeader({ icon: Icon, title, actions }: Props) {
  return (
    <div className="page-header">
      <div className="page-header-title">
        {Icon ? (
          <span className="page-header-icon" aria-hidden>
            <Icon size={22} strokeWidth={2} />
          </span>
        ) : null}
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}
