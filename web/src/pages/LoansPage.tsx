import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type Loan } from '../lib/api';
import { formatSignedMoney } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { Money } from '../components/Money';
import { DueDatePill } from '../components/StatusPill';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'borrower', label: 'I owe' },
  { id: 'lender', label: 'Owed to me' },
  { id: 'pending', label: 'Pending' },
  { id: 'overdue', label: 'Overdue' },
];

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

  useEffect(() => {
    void reload(filter);
  }, [reload, filter]);

  const columns: Column<Loan>[] = [
    {
      key: 'title',
      header: 'Loan',
      render: (loan) => {
        const peer = loan.your_role === 'borrower' ? loan.lender : loan.borrower;
        const title = loan.institution_label || peer.display_name;
        return (
          <div>
            <div style={{ fontWeight: 700 }}>{loan.title || title}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {loan.reference_code}
              {loan.currency_code ? ` · ${loan.currency_code}` : ''}
              {loan.title ? ` · ${title}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      key: 'role',
      header: 'Role',
      render: (loan) => <span className="muted">{loan.your_role === 'lender' ? 'Lending' : 'Borrowing'}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      render: (loan) => <DueDatePill dueAt={nextInstallmentDue(loan)} status={loan.status} locale={locale} />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (loan) =>
        loan.principal ? (
          <Money value={formatSignedMoney(loan.expected_total, loan.currency_code, loan.your_role === 'lender' ? 1 : -1, locale)} raw tone={loan.your_role === 'lender' ? 'positive' : 'negative'} />
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>Waiting for terms</span>
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Loans"
        subtitle="Peer loans, shared expenses, and long-term debt"
        right={
          <Button onClick={() => navigate('/loans/new')}>
            <Plus size={15} /> New loan
          </Button>
        }
      />
      <Segmented value={filter} onChange={setFilter} options={FILTERS} />
      <DataTable
        columns={columns}
        rows={loans}
        rowKey={(l) => l.id}
        onRowClick={(l) => navigate(`/loans/${l.id}`)}
        emptyTitle="No loans in sight"
        emptyBody="Start with a friend, search someone, or set up a long-term debt schedule."
      />
    </div>
  );
}
