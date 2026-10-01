const STATUS_MAP: Record<string, { tone: 'success' | 'warning' | 'error' | 'muted'; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  overdue: { tone: 'error', label: 'Overdue' },
  pending: { tone: 'warning', label: 'Pending' },
  repayment_pending: { tone: 'warning', label: 'Awaiting confirm' },
  completed: { tone: 'muted', label: 'Completed' },
  rejected: { tone: 'error', label: 'Rejected' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
  expected: { tone: 'warning', label: 'Expected' },
  confirmed: { tone: 'success', label: 'Confirmed' },
};

export function StatusPill({ status }: { status: string }) {
  const meta = STATUS_MAP[status] ?? { tone: 'muted' as const, label: status.replaceAll('_', ' ') };
  return (
    <span className={`pill pill-${meta.tone}`}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}

export function DueDatePill({ dueAt, status, locale }: { dueAt?: string | null; status: string; locale?: string | null }) {
  if (!dueAt) {
    const pending = status === 'pending';
    return <span className={`pill ${pending ? 'pill-warning' : 'pill-muted'}`}>{pending ? 'Pending' : '—'}</span>;
  }
  const due = new Date(dueAt);
  const label = due.toLocaleDateString(locale || 'en', { month: 'short', day: 'numeric' });
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const overdue = status === 'overdue' || startDue < startToday;
  const soon = !overdue && startDue.getTime() - startToday.getTime() <= 7 * 86400000 && startDue.getTime() >= startToday.getTime();
  let tone: 'success' | 'warning' | 'error' | 'muted' = 'success';
  if (overdue) tone = 'error';
  else if (soon || status === 'repayment_pending' || status === 'pending') tone = 'warning';
  else if (['completed', 'cancelled', 'rejected'].includes(status)) tone = 'muted';
  return <span className={`pill pill-${tone}`}>{label}</span>;
}
