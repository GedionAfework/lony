import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox, WifiOff } from 'lucide-react';

type Props = {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  height?: number;
  children: ReactNode;
  className?: string;
  /** When set, shows an inline state instead of the chart body. */
  state?: 'empty' | 'error' | 'offline';
  stateMessage?: string;
};

const STATE_ICON: Record<NonNullable<Props['state']>, LucideIcon> = {
  empty: Inbox,
  error: AlertTriangle,
  offline: WifiOff,
};

export function ChartCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  height = 260,
  children,
  className,
  state,
  stateMessage,
}: Props) {
  const StateIcon = state ? STATE_ICON[state] : null;
  return (
    <div className={['card', 'chart-card', className || ''].filter(Boolean).join(' ')}>
      <div className="chart-card-header">
        <div className="chart-card-title">
          {Icon ? <Icon size={16} strokeWidth={2} /> : null}
          <div>
            <strong>{title}</strong>
            {subtitle ? <p className="muted chart-card-subtitle">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="chart-card-actions">{actions}</div> : null}
      </div>
      <div className="chart-card-body" style={{ height }}>
        {StateIcon ? (
          <div className={`chart-state chart-state-${state}`}>
            <StateIcon size={28} strokeWidth={1.5} />
            <p>{stateMessage || 'No data to show yet.'}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
