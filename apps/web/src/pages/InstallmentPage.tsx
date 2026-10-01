import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, type Loan, type LoanInstallment } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { DueDatePill } from '../components/StatusPill';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

export function InstallmentPage() {
  const { loanId, installmentId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError } = useToast();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [installment, setInstallment] = useState<LoanInstallment | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const locale = user?.locale || 'en';

  useEffect(() => {
    if (!token || !loanId) return;
    setLoading(true);
    api
      .getLoan(token, loanId)
      .then((res) => {
        setLoan(res.loan);
        setInstallment((res.loan.installments ?? []).find((i) => i.id === installmentId) ?? null);
      })
      .catch((e) => showError(e instanceof Error ? e.message : 'Could not load installment'))
      .finally(() => setLoading(false));
  }, [token, loanId, installmentId, showError]);

  async function onMarkPaid() {
    if (!token || !loan || !installment) return;
    setBusy(true);
    try {
      const res = await api.markInstallmentPaid(token, loan.id, installment.id);
      setLoan(res.loan);
      setInstallment((res.loan.installments ?? []).find((i) => i.id === installment.id) ?? null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not mark installment paid');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page">Loading…</div>;
  if (!loan || !installment) return <div className="page">Not found.</div>;

  const paid = installment.status === 'paid';

  return (
    <div className="page page-narrow">
      <PageHeader
        title={`Payment ${installment.sequence}`}
        back
        onBack={() => navigate(`/loans/${loan.id}`)}
        right={<DueDatePill dueAt={installment.due_at} status={paid ? 'completed' : installment.status} locale={locale} />}
      />
      <Card>
        <div className="flex-col" style={{ gap: 8, padding: 4, background: paid ? 'var(--success-soft)' : 'var(--warning-soft)', borderRadius: 12 }}>
          <Money value={installment.amount} currency={loan.currency_code} size="xl" />
          <div style={{ color: paid ? 'var(--success)' : 'var(--warning)', fontWeight: 700, fontSize: 15 }}>{paid ? 'Paid' : 'Unpaid'}</div>
          <div className="muted">Due {new Date(installment.due_at).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
          {loan.institution_label ? <div className="muted">{loan.institution_label}</div> : null}
        </div>
      </Card>

      {paid && installment.paid_at ? (
        <Card>
          <div className="muted">
            Marked paid {new Date(installment.paid_at).toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </Card>
      ) : null}

      {loan.your_role === 'borrower' && !paid && ['active', 'overdue'].includes(loan.status) ? (
        <Card>
          <Button onClick={onMarkPaid} busy={busy} block>
            {busy ? 'Working…' : 'I paid'}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
