import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type BankProfile, type Loan, type Repayment } from '../lib/api';
import { formatMoney } from '../lib/format';
import { CURRENCIES } from '../lib/catalogs';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { StatusPill, DueDatePill } from '../components/StatusPill';
import { Button } from '../components/Button';
import { Field, SelectField } from '../components/Field';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending acceptance',
  active: 'Active',
  overdue: 'Overdue',
  repayment_pending: 'Repayment pending confirmation',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Loan created',
  terms_proposed: 'Terms proposed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  marked_overdue: 'Marked overdue',
  installment_paid: 'Installment paid',
};

function nextInstallmentDue(loan: Loan): string | null {
  const rows = loan.installments ?? [];
  const next = rows.find((row) => row.status === 'scheduled' || row.status === 'overdue');
  return next?.due_at ?? loan.due_at ?? null;
}

export function LoanDetailPage() {
  const { loanId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError, show } = useToast();

  const [loan, setLoan] = useState<Loan | null>(null);
  const [repayments, setRepayments] = useState<Repayment[]>([]);
  const [paymentProfile, setPaymentProfile] = useState<BankProfile | null>(null);
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [bankProfiles, setBankProfiles] = useState<BankProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const locale = user?.locale || 'en';

  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [currency, setCurrency] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [claimAmount, setClaimAmount] = useState('');
  const [claimNote, setClaimNote] = useState('');

  const load = useCallback(async () => {
    if (!token || !loanId) return;
    setLoading(true);
    try {
      const res = await api.getLoan(token, loanId);
      setLoan(res.loan);
      setPrincipal(res.loan.principal || '');
      setInterest(res.loan.interest_rate_percent || '');
      setCurrency((res.loan.currency_code || user?.default_currency_code || 'USD').toUpperCase());
      setDueDate(res.loan.due_at ? res.loan.due_at.slice(0, 10) : '');
      try {
        const repay = await api.listRepayments(token, loanId);
        setRepayments(repay.repayments ?? []);
      } catch {
        setRepayments([]);
      }
      if (res.loan.your_role === 'borrower') {
        try {
          const pay = await api.loanPaymentProfile(token, loanId);
          setPaymentProfile(pay.bank_profile);
        } catch {
          setPaymentProfile(null);
        }
      } else {
        api.listBankProfiles(token).then((r) => setBankProfiles(r.bank_profiles ?? [])).catch(() => setBankProfiles([]));
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load loan');
    } finally {
      setLoading(false);
    }
  }, [token, loanId, user?.default_currency_code, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLoanAction(kind: 'accept' | 'reject' | 'cancel') {
    if (!token || !loan) return;
    setBusy(true);
    try {
      const res = kind === 'accept' ? await api.acceptLoan(token, loan.id) : kind === 'reject' ? await api.rejectLoan(token, loan.id) : await api.cancelLoan(token, loan.id);
      setLoan(res.loan);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Loan action failed');
    } finally {
      setBusy(false);
    }
  }

  async function onProposeTerms() {
    if (!token || !loan || !principal.trim() || !dueDate.trim()) {
      showError('Principal and due date are required to propose terms');
      return;
    }
    setBusy(true);
    try {
      const res = await api.proposeTerms(token, loan.id, {
        principal: principal.trim(),
        currency_code: currency.trim().toUpperCase(),
        interest_rate_percent: interest.trim() || '0',
        due_at: new Date(`${dueDate}T12:00:00.000Z`).toISOString(),
        note: note.trim() || undefined,
      });
      setLoan(res.loan);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not propose terms');
    } finally {
      setBusy(false);
    }
  }

  async function onClaimRepayment() {
    if (!token || !loan) return;
    setBusy(true);
    try {
      await api.claimRepayment(token, loan.id, { amount: claimAmount.trim() || undefined, note: claimNote.trim() || undefined });
      const [loanRes, repayRes] = await Promise.all([api.getLoan(token, loan.id), api.listRepayments(token, loan.id)]);
      setLoan(loanRes.loan);
      setRepayments(repayRes.repayments ?? []);
      setClaimAmount('');
      setClaimNote('');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not claim repayment');
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmRepayment(id: string) {
    if (!token || !loan) return;
    setBusy(true);
    try {
      await api.confirmRepayment(token, id);
      const [loanRes, repayRes] = await Promise.all([api.getLoan(token, loan.id), api.listRepayments(token, loan.id)]);
      setLoan(loanRes.loan);
      setRepayments(repayRes.repayments ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not confirm repayment');
    } finally {
      setBusy(false);
    }
  }

  async function onRejectRepayment(id: string) {
    if (!token || !loan) return;
    const reason = rejectReason[id]?.trim() || 'Amount or proof does not match';
    setBusy(true);
    try {
      await api.rejectRepayment(token, id, reason);
      const [loanRes, repayRes] = await Promise.all([api.getLoan(token, loan.id), api.listRepayments(token, loan.id)]);
      setLoan(loanRes.loan);
      setRepayments(repayRes.repayments ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not reject repayment');
    } finally {
      setBusy(false);
    }
  }

  async function onShareBank(profileId: string) {
    if (!token || !loan) return;
    setBusy(true);
    try {
      await api.shareBankProfile(token, profileId, { recipient_id: loan.borrower.id, loan_id: loan.id });
      show('Payment profile shared');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not share');
    } finally {
      setBusy(false);
    }
  }

  async function onReveal() {
    if (!token || !loan) return;
    setBusy(true);
    try {
      const res = await api.loanPaymentProfile(token, loan.id, true);
      setPaymentProfile(res.bank_profile);
      setRevealedNumber(res.bank_profile.account_identifier ?? null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Reveal requires a recent sign-in');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page">Loading…</div>;
  if (!loan) return <div className="page">Not found.</div>;

  const peer = loan.your_role === 'borrower' ? loan.lender : loan.borrower;
  const peerPrefix = loan.your_role === 'borrower' ? 'From' : 'To';
  const isSelfDebt = loan.borrower.id === loan.lender.id;

  return (
    <div className="page page-narrow">
      <PageHeader
        title={loan.title || loan.reference_code}
        back
        onBack={() => navigate('/loans')}
        right={<DueDatePill dueAt={nextInstallmentDue(loan)} status={loan.status} locale={locale} />}
      />

      <Card>
        <Money value={loan.expected_total ? formatMoney(loan.expected_total, loan.currency_code, locale) : STATUS_LABELS[loan.status] ?? loan.status} raw size="xl" />
        {loan.title ? <div className="muted">{loan.reference_code}</div> : null}
        {loan.institution_label ? (
          <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{loan.institution_label}</div>
        ) : isSelfDebt ? (
          <div className="muted">Your debt</div>
        ) : peer?.id ? (
          <button className="link-btn" onClick={() => navigate(`/chats/${peer.id}`)}>
            {peerPrefix} {peer.display_name}
          </button>
        ) : (
          <div className="muted">{peerPrefix} — Invite to Lony</div>
        )}
        {loan.loan_kind === 'long_term' && loan.installment_amount ? (
          <div className="muted" style={{ marginTop: 6 }}>
            {formatMoney(loan.installment_amount, loan.currency_code, locale)}/mo{loan.installment_count ? ` · ${loan.installment_count} months` : ''}
          </div>
        ) : null}
        {loan.interest_period_months && loan.loan_kind !== 'long_term' ? <div className="muted">Interest period · {loan.interest_period_months} mo</div> : null}
        <StatusPill status={loan.status} />
      </Card>

      {loan.installments && loan.installments.length > 0 ? (
        <Card>
          <div className="section-label">Monthly repayments</div>
          {(() => {
            const nextUnpaidId = loan.installments!.find((row) => row.status === 'scheduled' || row.status === 'overdue')?.id ?? null;
            const startToday = new Date();
            startToday.setHours(0, 0, 0, 0);
            return loan.installments!.map((inst) => {
              const due = new Date(inst.due_at);
              const paid = inst.status === 'paid';
              const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
              const passed = !paid && startDue < startToday;
              const isNext = !paid && inst.id === nextUnpaidId;
              return (
                <div
                  key={inst.id}
                  className="list-row clickable-row"
                  style={{ background: isNext ? 'var(--success-soft)' : passed ? 'var(--warning-soft)' : undefined }}
                  onClick={() => navigate(`/loans/${loan.id}/installments/${inst.id}`)}
                >
                  <div className="main">
                    <div className="title">{due.toLocaleDateString(locale, { month: 'short', year: 'numeric' })}</div>
                    <div className="sub">{paid ? 'Paid' : due.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  </div>
                  <Money value={inst.amount} currency={loan.currency_code} locale={locale} />
                </div>
              );
            });
          })()}
        </Card>
      ) : null}

      {loan.can_accept ? (
        <Card>
          <p className="muted" style={{ fontSize: 12 }}>Only agree to terms with people you trust — Lony does not enforce collections.</p>
          <Button onClick={() => onLoanAction('accept')} busy={busy} block>
            Accept terms
          </Button>
        </Card>
      ) : null}

      {loan.can_propose_terms ? (
        <Card>
          <div className="section-label">Propose or update terms</div>
          <div className="form-row">
            <Field label="Principal" value={principal} onChange={setPrincipal} money />
            <Field label="Flat interest %" value={interest} onChange={setInterest} />
          </div>
          <div className="form-row">
            <SelectField label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
            <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} />
          </div>
          <Field label="Note" value={note} onChange={setNote} />
          <Button onClick={onProposeTerms} busy={busy} block>
            {busy ? 'Working…' : 'Send terms'}
          </Button>
        </Card>
      ) : null}

      {loan.can_reject || loan.can_cancel ? (
        <Card>
          <div className="flex-row">
            {loan.can_reject ? (
              <Button variant="secondary" onClick={() => onLoanAction('reject')} disabled={busy}>
                Reject
              </Button>
            ) : null}
            {loan.can_cancel ? (
              <Button variant="ghost" onClick={() => onLoanAction('cancel')} disabled={busy}>
                Cancel loan
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {loan.your_role === 'borrower' && ['active', 'overdue'].includes(loan.status) && !(loan.installments && loan.installments.length > 0) ? (
        <Card>
          <div className="section-label">Mark as paid</div>
          <Field label="Amount (optional)" value={claimAmount} onChange={setClaimAmount} money placeholder={loan.expected_total || ''} />
          <Field label="Note (optional)" value={claimNote} onChange={setClaimNote} />
          <Button onClick={onClaimRepayment} busy={busy} block>
            {busy ? 'Working…' : 'I paid'}
          </Button>
        </Card>
      ) : null}

      {repayments.length > 0 ? (
        <Card>
          <div className="section-label">Repayments</div>
          {repayments.map((rep) => (
            <div key={rep.id} className="flex-col" style={{ gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700 }}>
                {formatMoney(rep.amount, loan.currency_code, locale)} · <StatusPill status={rep.status} />
              </div>
              {rep.note ? <div className="muted">{rep.note}</div> : null}
              {rep.can_confirm ? (
                <Button size="sm" onClick={() => onConfirmRepayment(rep.id)} disabled={busy}>
                  Confirm received
                </Button>
              ) : null}
              {rep.can_reject ? (
                <>
                  <Field label="Reject reason" value={rejectReason[rep.id] || ''} onChange={(v) => setRejectReason((prev) => ({ ...prev, [rep.id]: v }))} />
                  <Button size="sm" variant="secondary" onClick={() => onRejectRepayment(rep.id)} disabled={busy}>
                    Reject claim
                  </Button>
                </>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}

      {loan.your_role === 'lender' && !isSelfDebt && ['active', 'overdue'].includes(loan.status) ? (
        <Card>
          <div className="section-label">Payment profile</div>
          {bankProfiles.length === 0 ? (
            <Button variant="secondary" onClick={() => navigate('/banks')} block>
              <Landmark size={15} /> Add a payment profile
            </Button>
          ) : (
            bankProfiles.map((profile) => (
              <Button key={profile.id} onClick={() => onShareBank(profile.id)} disabled={busy} block style={{ marginBottom: 8, justifyContent: 'flex-start' }}>
                <Landmark size={15} /> Share {profile.label} · •••• {profile.account_last4}
              </Button>
            ))
          )}
        </Card>
      ) : null}

      {loan.your_role === 'borrower' && !isSelfDebt ? (
        <Card>
          <div className="section-label">Where to send repayment</div>
          {paymentProfile ? (
            <>
              <div style={{ fontWeight: 700 }}>
                {paymentProfile.label} · •••• {paymentProfile.account_last4}
              </div>
              {revealedNumber ? <div className="muted" style={{ fontFamily: 'var(--font-mono)' }}>{revealedNumber}</div> : null}
              <Button variant="secondary" onClick={onReveal} busy={busy}>
                Reveal number
              </Button>
            </>
          ) : (
            <EmptyState title="Waiting on lender" body="The lender has not shared a payment profile yet." />
          )}
        </Card>
      ) : null}

      {loan.events?.length ? (
        <Card>
          <div className="section-label">Timeline</div>
          {loan.events
            .filter((ev) => Object.keys(EVENT_LABELS).includes(ev.event_type))
            .map((ev) => (
              <div key={ev.id} style={{ padding: '6px 0' }}>
                <div style={{ fontWeight: 700 }}>{EVENT_LABELS[ev.event_type] ?? ev.event_type}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(ev.created_at).toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
        </Card>
      ) : null}
    </div>
  );
}
