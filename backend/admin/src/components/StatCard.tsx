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

const TAG: Record<Tone, string | null> = {
  default: null,
  success: 'Healthy',
  warning: 'Watch',
  error: 'Action',
};

export function StatCard({ icon: Icon, label, value, hint, tone = 'default' }: Props) {
  const tag = TAG[tone];
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-card-top">
        <div className="stat-card-icon">
          <Icon size={19} strokeWidth={2} />
        </div>
        {tag ? <span className="stat-card-tag">{tag}</span> : null}
      </div>
      <div className="stat-card-body">
        <span className="stat-card-label">{label}</span>
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
