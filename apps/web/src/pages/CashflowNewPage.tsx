import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  api,
  type CashflowCategory,
  type CashflowEntry,
  type Loan,
  type MoneyAccount,
  type PeerHit,
  type SearchHit,
} from '../lib/api';
import { formatAmountCommas, stripAmount } from '../lib/format';
import { CURRENCIES } from '../lib/catalogs';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Field, SelectField } from '../components/Field';
import { Button } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { useToast } from '../components/Toast';

type Kind = 'income' | 'expense';

const RECURRENCE = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function CashflowNewPage() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError } = useToast();

  const [editing, setEditing] = useState<CashflowEntry | null>(null);
  const [loading, setLoading] = useState(Boolean(entryId));
  const [kind, setKind] = useState<Kind>((params.get('kind') as Kind) || 'expense');
  const [busy, setBusy] = useState(false);

  const [categories, setCategories] = useState<CashflowCategory[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [peers, setPeers] = useState<PeerHit[]>([]);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [currency, setCurrency] = useState((user?.default_currency_code || 'USD').toUpperCase());
  const [accountId, setAccountId] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState('monthly');

  const [isLoanPayment, setIsLoanPayment] = useState(false);
  const [loanId, setLoanId] = useState('');

  const [payWith, setPayWith] = useState<'alone' | 'friends'>('alone');
  const [splitMode, setSplitMode] = useState<'equal' | 'percent' | 'flat'>('equal');
  const [splitFriendId, setSplitFriendId] = useState('');
  const [splitFriendValue, setSplitFriendValue] = useState('');
  const [shareDueAt, setShareDueAt] = useState('');
  const [peerQuery, setPeerQuery] = useState('');
  const [peerHits, setPeerHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (!token || !entryId) return;
    setLoading(true);
    api
      .listCashflow(token, {})
      .then((res) => {
        const found = (res.entries ?? []).find((e) => e.id === entryId) || null;
        setEditing(found);
        if (found) {
          setKind(found.kind === 'income' ? 'income' : 'expense');
          setTitle(found.title);
          setAmount(formatAmountCommas(found.amount));
          setCategoryId(found.category_id || '');
          setNote(found.note || '');
          setDate(found.occurred_at.slice(0, 10));
          setCurrency(found.currency_code.toUpperCase());
          setAccountId(found.account_id || '');
          setRecurring(Boolean(found.recurrence));
          if (found.recurrence) setRecurrence(found.recurrence);
        }
      })
      .catch((e) => showError(e instanceof Error ? e.message : 'Could not load entry'))
      .finally(() => setLoading(false));
  }, [token, entryId, showError]);

  useEffect(() => {
    if (!token) return;
    api
      .listCashflowCategories(token, kind)
      .then((res) => {
        const list = [...(res.categories ?? [])].sort((a, b) => {
          const aOther = (a.slug || a.name).toLowerCase() === 'other' ? 1 : 0;
          const bOther = (b.slug || b.name).toLowerCase() === 'other' ? 1 : 0;
          if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
          if (aOther !== bOther) return aOther - bOther;
          return a.name.localeCompare(b.name);
        });
        setCategories(list);
        if (!categoryId && list[0]) setCategoryId(list[0].id);
      })
      .catch(() => setCategories([]));
    api.listAccounts(token).then((res) => setAccounts(res.accounts ?? [])).catch(() => setAccounts([]));
    api.listLoans(token, { role: 'borrower' }).then((res) => setLoans(res.loans ?? [])).catch(() => setLoans([]));
    api.listPeers(token).then((res) => setPeers(res.peers ?? [])).catch(() => setPeers([]));
  }, [token, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = peerQuery.trim();
    if (!token || q.length < 2) {
      setPeerHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.searchUsers(token, q).then((res) => setPeerHits(res.users ?? [])).catch(() => setPeerHits([]));
    }, 280);
    return () => clearTimeout(t);
  }, [peerQuery, token]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const showNewCategory = selectedCategory && (selectedCategory.slug === 'other' || selectedCategory.name.toLowerCase() === 'other');
  const payableLoans = useMemo(
    () => loans.filter((l) => l.your_role === 'borrower' && ['active', 'overdue', 'repayment_pending'].includes(l.status)),
    [loans],
  );
  const selectedLoan = payableLoans.find((l) => l.id === loanId);

  const categoryOptions = categories.map((c) => ({ id: c.id, label: c.name }));
  const accountOptions = accounts.filter((a) => a.currency_code.toUpperCase() === currency.toUpperCase()).map((a) => ({ id: a.id, label: `${a.name} · ${a.balance} ${a.currency_code}` }));
  const loanOptions = payableLoans.map((l) => ({ id: l.id, label: l.title || l.institution_label || l.reference_code }));

  const peerOptions = peerQuery.trim()
    ? peerHits.map((h) => ({ id: h.id, label: h.display_name }))
    : peers.map((p) => ({ id: p.id, label: p.display_name }));

  const totalAmount = Number(stripAmount(amount) || 0);
  const equalShare = totalAmount > 0 ? round2(totalAmount / 2) : '0.00';

  async function onSave() {
    if (!token) return;
    const cleaned = stripAmount(amount);
    if (!title.trim()) {
      showError('Title is required');
      return;
    }
    if (!cleaned && !(kind === 'expense' && isLoanPayment && loanId)) {
      showError('Enter an amount');
      return;
    }
    if (!accountId) {
      showError('Choose which account this belongs to');
      return;
    }
    setBusy(true);
    try {
      let catId = categoryId || undefined;
      if (showNewCategory && newCategory.trim()) {
        const created = await api.createCashflowCategory(token, { kind, name: newCategory.trim() });
        catId = created.category.id;
      }
      let payAmount = cleaned;
      if (kind === 'expense' && isLoanPayment && selectedLoan) {
        payAmount = cleaned || String(Number(selectedLoan.expected_total || selectedLoan.principal || 0));
      }
      if (!payAmount) {
        showError('Enter an amount');
        setBusy(false);
        return;
      }
      const payload = {
        title: title.trim(),
        amount: payAmount,
        currency_code: currency.trim().toUpperCase(),
        category_id: catId,
        account_id: accountId,
        note: note.trim() || undefined,
        occurred_at: new Date(`${date}T12:00:00.000Z`).toISOString(),
        recurrence: (recurring ? recurrence : 'none') as 'weekly' | 'monthly' | 'yearly' | 'none',
      };

      let entry: CashflowEntry;
      if (editing) {
        const res = await api.updateCashflow(token, editing.id, payload);
        entry = res.entry;
      } else {
        const res = await api.createCashflow(token, { kind, ...payload, is_template: recurring });
        entry = res.entry;

        if (kind === 'expense' && !isLoanPayment && payWith === 'friends' && splitFriendId) {
          if (shareDueAt && shareDueAt < todayIso()) {
            showError('Repayment date cannot be before today');
            setBusy(false);
            return;
          }
          let shareAmount: string | undefined;
          let sharePercent: number | undefined;
          if (splitMode === 'equal') shareAmount = equalShare;
          else if (splitMode === 'percent') sharePercent = Number(splitFriendValue) || 0;
          else shareAmount = stripAmount(splitFriendValue) || '0';
          try {
            const shared = await api.shareCashflow(token, entry.id, {
              friend_id: splitFriendId,
              ...(shareAmount ? { share_amount: shareAmount } : { share_percent: sharePercent }),
              due_at: shareDueAt ? new Date(`${shareDueAt}T12:00:00.000Z`).toISOString() : undefined,
            });
            entry = shared.entry;
          } catch (e) {
            showError(e instanceof Error ? e.message : 'Share failed');
          }
        }

        if (kind === 'expense' && isLoanPayment && loanId) {
          try {
            await api.claimRepayment(token, loanId, { amount: payAmount, note: title.trim() || 'Expense payment' });
          } catch (e) {
            showError(e instanceof Error ? e.message : 'Expense saved, but loan payment failed');
          }
        }
      }
      navigate(`/cashflow/${entry.id}`);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page">Loading…</div>;

  return (
    <div className="page page-narrow">
      <PageHeader title={editing ? 'Edit entry' : kind === 'income' ? 'New income' : 'New expense'} back onBack={() => navigate(-1)} />
      <Card>
        {!editing ? (
          <Segmented value={kind} onChange={(v) => setKind(v as Kind)} options={[{ id: 'income', label: 'Income' }, { id: 'expense', label: 'Expense' }]} />
        ) : null}

        {kind === 'expense' && !editing ? (
          <>
            <div className="section-label">Is this a loan payment?</div>
            <Segmented value={isLoanPayment ? 'yes' : 'no'} onChange={(v) => setIsLoanPayment(v === 'yes')} options={[{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }]} />
          </>
        ) : null}

        {kind === 'expense' && !editing && isLoanPayment ? (
          <SelectField
            label="Loan"
            value={loanId}
            onChange={(id) => {
              setLoanId(id);
              const loan = payableLoans.find((l) => l.id === id);
              if (loan) {
                setTitle(loan.title || loan.institution_label || `Loan ${loan.reference_code}`);
                if (loan.currency_code) setCurrency(loan.currency_code.toUpperCase());
              }
            }}
            options={loanOptions}
            placeholder="Select a loan"
          />
        ) : null}

        <Field label="Title" value={title} onChange={setTitle} />
        <div className="form-row">
          <Field label="Amount" value={amount} onChange={setAmount} money placeholder="0.00" />
          <SelectField label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
        </div>
        <div className="form-row">
          <SelectField label="Account" value={accountId} onChange={setAccountId} options={accountOptions} placeholder={accountOptions.length ? 'Which account?' : `Add a ${currency} account first`} />
          <SelectField
            label="Category"
            value={categoryId}
            onChange={(id) => {
              setCategoryId(id);
              setNewCategory('');
            }}
            options={categoryOptions}
          />
        </div>
        {showNewCategory ? <Field label="Custom category" value={newCategory} onChange={setNewCategory} /> : null}
        <Field label="Date" type="date" value={date} onChange={setDate} />

        {!isLoanPayment && !editing ? (
          <>
            <div className="section-label">Recurring?</div>
            <Segmented value={recurring ? 'yes' : 'no'} onChange={(v) => setRecurring(v === 'yes')} options={[{ id: 'no', label: 'One-time' }, { id: 'yes', label: 'Recurring' }]} />
            {recurring ? <SelectField label="Period" value={recurrence} onChange={setRecurrence} options={RECURRENCE} /> : null}
          </>
        ) : null}

        {kind === 'expense' && !editing && !isLoanPayment ? (
          <>
            <div className="section-label">Who's paying?</div>
            <Segmented value={payWith} onChange={(v) => setPayWith(v as 'alone' | 'friends')} options={[{ id: 'alone', label: 'Alone' }, { id: 'friends', label: 'With a friend' }]} />
            {payWith === 'friends' ? (
              <>
                <Field label="Search friend" value={peerQuery} onChange={setPeerQuery} placeholder="Type a name…" />
                <SelectField label="Friend" value={splitFriendId} onChange={setSplitFriendId} options={peerOptions} placeholder="Pick who's sharing this" />
                <Segmented value={splitMode} onChange={(v) => setSplitMode(v as 'equal' | 'percent' | 'flat')} options={[{ id: 'equal', label: 'Equally' }, { id: 'percent', label: '%' }, { id: 'flat', label: 'Flat' }]} />
                {splitMode === 'percent' ? (
                  <Field label="Their %" value={splitFriendValue} onChange={setSplitFriendValue} placeholder="50" />
                ) : splitMode === 'flat' ? (
                  <Field label="Their amount" value={splitFriendValue} onChange={setSplitFriendValue} money />
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>Share {equalShare} {currency}</div>
                )}
                <Field label="Repayment date" type="date" value={shareDueAt} onChange={setShareDueAt} min={todayIso()} />
                <div className="muted" style={{ fontSize: 12 }}>Their share becomes a loan request. It only becomes active once they accept.</div>
              </>
            ) : null}
          </>
        ) : null}

        <Field label="Note" value={note} onChange={setNote} />
        <Button onClick={onSave} busy={busy} block>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </Card>
    </div>
  );
}
