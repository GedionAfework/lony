import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Tone = 'default' | 'success' | 'warning' | 'error';

type Props = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
};

export function StatCard({ icon: Icon, label, value, hint, tone = 'default' }: Props) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <Icon size={16} strokeWidth={1.75} className="stat-card-icon" />
      </div>
      <div className="stat-card-body">
        <strong className="stat-card-value">{value}</strong>
        {hint ? (
          <span className="stat-card-hint muted" title={hint}>
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
