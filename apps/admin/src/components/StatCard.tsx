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
      <div className="stat-card-icon">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="stat-card-body">
        <span className="stat-card-label">{label}</span>
        <strong className="stat-card-value mono">{value}</strong>
        {hint ? <span className="stat-card-hint muted">{hint}</span> : null}
      </div>
    </div>
  );
}
