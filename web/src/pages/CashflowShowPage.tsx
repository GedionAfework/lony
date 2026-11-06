import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type CashflowEntry, type MoneyAccount } from '../lib/api';
import { formatMoney } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { SelectField } from '../components/Field';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { BrandLoader } from '../components/BrandLoader';

function monthBounds(d = new Date()) {
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  const to = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function CashflowShowPage() {
  const { entryId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError } = useToast();
  const confirm = useConfirm();
  const [entry, setEntry] = useState<CashflowEntry | null>(null);
  const [monthEntries, setMonthEntries] = useState<CashflowEntry[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [receiveAccountId, setReceiveAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const period = useMemo(() => monthBounds(), []);
  const locale = user?.locale || 'en';

  useEffect(() => {
    if (!token || !entryId) return;
    setLoading(true);
    api
      .listCashflow(token, {})
      .then(async (res) => {
        const found = (res.entries ?? []).find((e) => e.id === entryId) || null;
        setEntry(found);
        setReceiveAccountId(found?.account_id || '');
        if (found) {
          const tid = found.is_template ? found.id : found.template_id || found.id;
          const monthRes = await api.listCashflow(token, { kind: found.kind === 'income' ? 'income' : 'expense', from: period.from, to: period.to });
          const rows = found.split_group_id
            ? (monthRes.entries ?? []).filter((e) => e.split_group_id === found.split_group_id)
            : (monthRes.entries ?? []).filter((e) => e.template_id === tid || e.id === tid);
          setMonthEntries(rows.length ? rows : [found]);
        }
      })
      .catch((e) => showError(e instanceof Error ? e.message : 'Could not load entry'))
      .finally(() => setLoading(false));
    api.listAccounts(token).then((res) => setAccounts(res.accounts ?? [])).catch(() => setAccounts([]));
  }, [token, entryId, period.from, period.to, showError]);

  async function onDelete() {
    if (!token || !entry) return;
    const ok = await confirm({
      title: `Delete ${entry.title || 'this entry'}?`,
      body: entry.is_template || entry.recurrence ? 'This also stops it from repeating. This can’t be undone.' : 'This can’t be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteCashflow(token, entry.id);
      navigate('/');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  }

  async function onReceive(target: CashflowEntry) {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.receiveCashflow(token, target.id, receiveAccountId ? { account_id: receiveAccountId } : undefined);
      setEntry(res.entry);
      setMonthEntries((rows) => rows.map((r) => (r.id === res.entry.id ? res.entry : r)));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <BrandLoader />;
  if (!entry) return <div className="page">Not found.</div>;

  const income = entry.kind === 'income';
  const expected = entry.status === 'expected' || entry.is_template;
  const receiveAccountOptions = accounts.filter((a) => a.currency_code.toUpperCase() === entry.currency_code.toUpperCase()).map((a) => ({ id: a.id, label: `${a.name} · ${a.balance} ${a.currency_code}` }));
  const monthLabel = new Date(period.from).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="page page-narrow">
      <PageHeader
        title={entry.title || entry.category}
        back
        onBack={() => navigate('/')}
        right={
          <>
            <Button variant="icon" aria-label="Edit" onClick={() => navigate(`/cashflow/${entry.id}/edit`)}>
              <Pencil size={15} />
            </Button>
            <Button variant="icon" aria-label="Delete" onClick={onDelete} disabled={busy}>
              <Trash2 size={15} />
            </Button>
          </>
        }
      />
      <Card>
        <div style={{ color: income ? 'var(--success)' : 'var(--warning)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase' }}>
          {expected ? (income ? 'Expected' : 'Due') : income ? 'Income' : 'Expense'}
        </div>
        <Money value={`${income ? '+' : '−'}${formatMoney(entry.amount, entry.currency_code, locale)}`} raw size="xl" />
        <div className="muted">{entry.category}</div>
        {entry.split_group_id ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Part of a split payment
            {monthEntries.filter((e) => e.split_group_id === entry.split_group_id).length > 1
              ? ` · ${monthEntries.filter((e) => e.split_group_id === entry.split_group_id).length} lines`
              : ''}
          </div>
        ) : null}
        {entry.trip_id ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Part of a trip budget
          </div>
        ) : null}
        {entry.note ? <p className="text-secondary">{entry.note}</p> : null}
        {expected ? (
          <div className="flex-col">
            {receiveAccountOptions.length ? (
              <SelectField label="Account" value={receiveAccountId} onChange={setReceiveAccountId} options={receiveAccountOptions} placeholder="Which account?" />
            ) : null}
            <Button onClick={() => onReceive(entry)} busy={busy} block>
              {busy ? 'Saving…' : income ? 'Mark received' : 'Mark paid'}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="section-label">{income ? `Received in ${monthLabel}` : `Spent in ${monthLabel}`}</div>
        {monthEntries.length === 0 ? (
          <div className="muted">Nothing yet.</div>
        ) : (
          monthEntries.map((row) => {
            const rowExpected = row.status === 'expected';
            return (
              <div key={row.id} className="list-row">
                <div className="main">
                  <div className="title">{formatMoney(row.amount, row.currency_code, locale)}</div>
                  <div className="sub">
                    {new Date(row.occurred_at).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {rowExpected ? (income ? ' · Expected' : ' · Due') : ''}
                  </div>
                </div>
                {rowExpected ? (
                  <Button size="sm" onClick={() => onReceive(row)} disabled={busy}>
                    {income ? 'Received' : 'Paid'}
                  </Button>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>{income ? 'Received' : 'Paid'}</span>
                )}
              </div>
            );
          })
        )}
      </Card>

      {entry.shared_with?.length ? (
        <Card>
          <div className="section-label">Shared with</div>
          {entry.shared_with.map((sh) => (
            <Button key={sh.loan_id} variant="secondary" onClick={() => navigate(`/loans/${sh.loan_id}`)} block>
              {sh.friend_name} · {formatMoney(sh.amount, sh.currency_code, locale)} · {({ pending: 'waiting for them', active: 'accepted', overdue: 'overdue', repayment_pending: 'paid, to confirm', completed: 'paid back', rejected: 'declined', cancelled: 'cancelled' } as Record<string, string>)[sh.status] || sh.status}
            </Button>
          ))}
        </Card>
      ) : entry.linked_loan_id ? (
        <Card>
          <Button variant="secondary" onClick={() => navigate(`/loans/${entry.linked_loan_id}`)} block>
            Open linked loan
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
