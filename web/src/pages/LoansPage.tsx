import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type Loan } from '../lib/api';
import { formatMoney } from '../lib/format';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Segmented } from '../components/Segmented';
import { DueDatePill } from '../components/StatusPill';
import { Hero, HeroStat, Initials } from '../components/Visuals';
import { useToast } from '../components/Toast';
import { BrandLoader } from '../components/BrandLoader';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'borrower', label: 'I owe' },
  { id: 'lender', label: 'Owed to me' },
  { id: 'pending', label: 'Pending' },
  { id: 'overdue', label: 'Overdue' },
];

const OPEN = ['active', 'overdue', 'repayment_pending', 'pending'];

function remaining(loan: Loan): number {
  return Number(loan.outstanding_amount || loan.expected_total || loan.principal || 0);
}

function nextInstallmentDue(loan: Loan): string | null {
  const rows = loan.installments ?? [];
  const next = rows.find((row) => row.status === 'scheduled' || row.status === 'overdue');
  return next?.due_at ?? loan.due_at ?? null;
}

export function LoansPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [filter, setFilter] = useState('');
  const locale = user?.locale || 'en';

  const reload = useCallback(async (f: string) => {
    if (!token) return;
    try {
      const res = await api.listLoans(token, f ? { filter: f } : {});
      setLoans(res.loans ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load loans');
    }
  }, [token, showError]);

  const [booted, setBooted] = useState(false);
  useEffect(() => {
    void reload(filter).finally(() => setBooted(true));
  }, [reload, filter]);

  // Totals always use every loan, whatever filter is showing.
  const [allLoans, setAllLoans] = useState<Loan[]>([]);
  useEffect(() => {
    if (!token) return;
    api
      .listLoans(token, {})
      .then((res) => setAllLoans(res.loans ?? []))
      .catch(() => setAllLoans([]));
  }, [token]);
  const ccy = (user?.default_currency_code || allLoans[0]?.currency_code || 'USD').toUpperCase();
  const open = allLoans.filter((l) => OPEN.includes(l.status) && (l.currency_code || ccy).toUpperCase() === ccy);
  const owedToMe = open.filter((l) => l.your_role === 'lender').reduce((n, l) => n + remaining(l), 0);
  const iOwe = open.filter((l) => l.your_role === 'borrower').reduce((n, l) => n + remaining(l), 0);
  const overdue = allLoans.filter((l) => l.status === 'overdue').length;

  // Lony's loading screen until the first load lands, instead of a page of zeros.
  if (!booted) return <BrandLoader />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Loans</h1>
          <div className="page-subtitle muted">Money between you and the people you trust</div>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate('/loans/new')}>
            <Plus size={15} /> New loan
          </Button>
        </div>
      </div>

      <Hero
        label="Owed to you"
        value={formatMoney(owedToMe.toFixed(2), ccy, locale)}
        sub={`${open.length} open loan${open.length === 1 ? '' : 's'}`}
        aside={
          <>
            <HeroStat label="You owe" value={formatMoney(iOwe.toFixed(2), ccy, locale)} tone="down" />
            <HeroStat label="Overdue" value={overdue === 0 ? 'None' : `${overdue} loan${overdue === 1 ? '' : 's'}`} />
          </>
        }
      />

      <div className="tabs-row">
        <Segmented value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      <Card>
        {loans.length === 0 ? (
          <EmptyState
            title="No loans here"
            body="Lend to a friend, split a bill, or track a long-term debt."
            action={
              <Button onClick={() => navigate('/loans/new')} style={{ marginTop: 8 }}>
                <Plus size={15} /> New loan
              </Button>
            }
          />
        ) : (
          loans.map((loan) => {
            const peer = loan.your_role === 'borrower' ? loan.lender : loan.borrower;
            const name = loan.institution_label || peer?.display_name || loan.title || 'Loan';
            const lending = loan.your_role === 'lender';
            return (
              <button key={loan.id} type="button" className="tx-row loan-row" onClick={() => navigate(`/loans/${loan.id}`)}>
                <Initials name={name} size={42} />
                <div className="tx-main">
                  <div className="tx-title">{name}</div>
                  <div className="tx-sub">
                    {lending ? 'Owes you' : 'You owe'}
                    {loan.title && loan.title !== name ? ` · ${loan.title}` : ''} · {loan.reference_code}
                  </div>
                </div>
                <DueDatePill dueAt={nextInstallmentDue(loan)} status={loan.status} locale={locale} />
                <div className={`tx-amount loan-amount ${lending ? 'in' : 'out'}`}>
                  {loan.principal ? formatMoney(remaining(loan), loan.currency_code, locale) : <span className="muted">Waiting for terms</span>}
                </div>
              </button>
            );
          })
        )}
      </Card>
    </div>
  );
}
