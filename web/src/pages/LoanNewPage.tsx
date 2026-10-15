import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, type Friendship, type PeerTrust, type SearchHit } from '../lib/api';
import { formatAmountCommas, parseAmountNumber, stripAmount } from '../lib/format';
import { CURRENCIES } from '../lib/catalogs';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Field, SelectField } from '../components/Field';
import { Button } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { useToast } from '../components/Toast';

const INSTITUTION_TYPES = [
  { id: 'bank', label: 'Bank' },
  { id: 'sacco', label: 'SACCO / Credit union' },
  { id: 'microfinance', label: 'Microfinance' },
  { id: 'person', label: 'Person' },
  { id: 'hedge_fund', label: 'Hedge fund' },
  { id: 'private_equity', label: 'Private equity' },
  { id: 'fintech', label: 'Fintech / digital lender' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'government', label: 'Government / public lender' },
  { id: 'employer', label: 'Employer' },
  { id: 'other', label: 'Other' },
];

/** Reducing-balance EMI; mirrors apps/api ComputeEMI. */
export function computeMonthlyPayment(principal: number, annualRatePercent: number, months: number): number {
  if (!Number.isFinite(principal) || principal <= 0 || months < 1) return 0;
  if (!annualRatePercent || annualRatePercent <= 0) return round4(principal / months);
  const r = annualRatePercent / 100 / 12;
  const pow = Math.pow(1 + r, months);
  if (pow === 1) return round4(principal / months);
  return round4((principal * r * pow) / (pow - 1));
}

export function estimateLongTermSchedule(principal: number, annualRatePercent: number, months: number) {
  const emi = computeMonthlyPayment(principal, annualRatePercent, months);
  if (months < 1 || principal <= 0) return { emi: 0, totalInterest: 0, totalPayable: 0 };
  let balance = principal;
  const r = annualRatePercent > 0 ? annualRatePercent / 100 / 12 : 0;
  let totalInterest = 0;
  let totalPayable = 0;
  let payment = emi;
  for (let i = 1; i <= months; i++) {
    const interestPart = round4(balance * r);
    let principalPart = round4(payment - interestPart);
    if (i === months || principalPart > balance) {
      principalPart = balance;
      payment = round4(principalPart + interestPart);
    }
    if (principalPart < 0) principalPart = 0;
    totalInterest = round4(totalInterest + interestPart);
    totalPayable = round4(totalPayable + payment);
    balance = round4(balance - principalPart);
    if (balance < 0) balance = 0;
  }
  return { emi, totalInterest, totalPayable };
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function LoanNewPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { showError } = useToast();

  const [loanKind, setLoanKind] = useState<'one_time' | 'long_term'>('one_time');
  const [partyMode, setPartyMode] = useState<'alone' | 'shared'>('alone');
  const [role, setRole] = useState<'borrower' | 'lender'>((params.get('role') as 'borrower' | 'lender') || 'borrower');

  const [friends, setFriends] = useState<Friendship[]>([]);
  const [peerQuery, setPeerQuery] = useState('');
  const [peerHits, setPeerHits] = useState<SearchHit[]>([]);
  const [peerId, setPeerId] = useState(params.get('peer') || '');
  const [peerTrust, setPeerTrust] = useState<PeerTrust | null>(null);

  const [institutionType, setInstitutionType] = useState('');
  const [institutionOther, setInstitutionOther] = useState('');

  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [interestPeriodMonths, setInterestPeriodMonths] = useState('');
  const [installmentCount, setInstallmentCount] = useState('');
  const [currency, setCurrency] = useState((user?.default_currency_code || 'USD').toUpperCase());
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.listFriends(token).then((res) => setFriends(res.friends ?? [])).catch(() => setFriends([]));
  }, [token]);

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

  useEffect(() => {
    if (!token || !peerId || role !== 'lender' || loanKind !== 'one_time') {
      setPeerTrust(null);
      return;
    }
    api.getPeerTrust(token, peerId).then((res) => setPeerTrust(res.trust)).catch(() => setPeerTrust(null));
  }, [token, peerId, role, loanKind]);

  const peerOptions = useMemo(() => {
    const known = friends.map((f) => ({ id: f.peer.id, label: f.peer.display_name }));
    const extra = peerHits.filter((h) => !friends.some((f) => f.peer.id === h.id)).map((h) => ({ id: h.id, label: h.display_name }));
    return [...known, ...extra];
  }, [friends, peerHits]);

  const principalNum = parseAmountNumber(principal);
  const interestNum = parseAmountNumber(interest);
  const months = Math.max(0, Math.floor(Number(stripAmount(installmentCount)) || 0));
  const showInterestPeriod = loanKind === 'one_time' && interestNum > 0;
  const schedule = loanKind === 'long_term' && months >= 2 && principalNum > 0 ? estimateLongTermSchedule(principalNum, interestNum, months) : { emi: 0, totalInterest: 0, totalPayable: 0 };

  const aloneOk = loanKind === 'long_term' ? Boolean(institutionOther.trim()) : true;
  const alone = loanKind === 'long_term' && partyMode === 'alone';

  const canSubmit =
    Boolean(currency && principalNum > 0) &&
    (loanKind === 'long_term'
      ? months >= 2 && aloneOk && institutionType.trim().length > 0 && (partyMode === 'alone' || Boolean(peerId))
      : Boolean(peerId) && Boolean(dueDate) && (!showInterestPeriod || Number(interestPeriodMonths) >= 1));

  async function onCreate() {
    if (!token || !canSubmit) return;
    if (loanKind === 'one_time' && dueDate && dueDate < todayIso()) {
      showError('Due date cannot be before today');
      return;
    }
    if (loanKind === 'one_time' && startDate && dueDate && dueDate < startDate) {
      showError('Due date cannot be before the start date');
      return;
    }
    setBusy(true);
    try {
      const institutionLabel = institutionOther.trim();
      const body = {
        role: alone ? ('borrower' as const) : role,
        counterparty_id: alone ? undefined : peerId || undefined,
        loan_kind: loanKind,
        party_mode: alone ? ('alone' as const) : loanKind === 'long_term' ? ('shared' as const) : ('peer' as const),
        principal: String(principalNum),
        currency_code: currency.toUpperCase(),
        interest_rate_percent: interest ? String(interestNum) : '0',
        due_at: loanKind === 'one_time' ? new Date(`${dueDate}T12:00:00.000Z`).toISOString() : undefined,
        note: note.trim() || undefined,
        title: title.trim() || undefined,
        interest_period_months: showInterestPeriod ? Number(interestPeriodMonths) : undefined,
        installment_count: loanKind === 'long_term' ? months : undefined,
        institution_label: loanKind === 'long_term' ? institutionLabel : undefined,
        institution_type: loanKind === 'long_term' ? institutionType : undefined,
        start_at: loanKind === 'long_term' ? new Date(`${startDate}T12:00:00.000Z`).toISOString() : undefined,
      };
      const res = await api.createLoan(token, body);
      navigate(`/loans/${res.loan.id}`);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not create loan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <PageHeader title="New loan" back onBack={() => navigate('/loans')} />

      <Card>
        <div className="section-label">Loan type</div>
        <Segmented value={loanKind} onChange={(v) => setLoanKind(v as 'one_time' | 'long_term')} options={[{ id: 'one_time', label: 'One-time' }, { id: 'long_term', label: 'Long term' }]} />
      </Card>

      {loanKind === 'long_term' ? (
        <Card>
          <div className="section-label">Lender type</div>
          <SelectField
            label="Financial institution type"
            value={institutionType}
            onChange={(id) => {
              setInstitutionType(id);
              setInstitutionOther('');
            }}
            options={INSTITUTION_TYPES}
            placeholder="Bank, SACCO, person…"
          />
          <Field label={institutionType === 'person' ? 'Person name' : 'Institution name'} value={institutionOther} onChange={setInstitutionOther} placeholder="Type the name" />

          <div className="section-label">Parties</div>
          <Segmented value={partyMode} onChange={(v) => setPartyMode(v as 'alone' | 'shared')} options={[{ id: 'alone', label: 'Alone' }, { id: 'shared', label: 'With someone' }]} />
          {partyMode === 'shared' ? (
            <>
              <Field label="Search friend" value={peerQuery} onChange={setPeerQuery} placeholder="Type a name…" />
              <SelectField label="Co-lender" value={peerId} onChange={setPeerId} options={peerOptions} placeholder="Pick who's involved" />
            </>
          ) : null}

          <Field label="Term (months)" value={installmentCount} onChange={(v) => setInstallmentCount(stripAmount(v).replace(/\./g, ''))} placeholder="e.g. 60" />
          <Field label="Start date" type="date" value={startDate} onChange={setStartDate} max={dueDate || undefined} />
          {months >= 2 && principalNum > 0 ? (
            <div className="card" style={{ background: 'var(--surface-muted)' }}>
              <div className="muted" style={{ fontSize: 12 }}>Reducing-balance schedule</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                {formatAmountCommas(schedule.emi.toFixed(2))} {currency}/mo
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Interest {formatAmountCommas(schedule.totalInterest.toFixed(2))} · Total {formatAmountCommas(schedule.totalPayable.toFixed(2))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card>
          <div className="section-label">With</div>
          <Field label="Search friend" value={peerQuery} onChange={setPeerQuery} placeholder="Type a name or username…" />
          <SelectField label="Friend" value={peerId} onChange={setPeerId} options={peerOptions} placeholder="Pick who's involved" />
          {peerTrust && role === 'lender' ? (
            <div className="card" style={{ background: 'var(--surface-muted)' }}>
              <div className="muted" style={{ fontSize: 12 }}>Their Lony Trust</div>
              <div className="flex-row" style={{ alignItems: 'baseline', gap: 10 }}>
                <span style={{ color: 'var(--primary)', fontWeight: 800, fontSize: 32 }}>{peerTrust.grade}</span>
                <span style={{ fontWeight: 700 }}>{peerTrust.band}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {peerTrust.available ? `Repayment ${Math.round(peerTrust.repayment_score)}${peerTrust.thin_history ? ' · limited history' : ''}` : 'Not enough Lony activity to grade yet'}
              </div>
            </div>
          ) : null}
        </Card>
      )}

      <Card>
        {!alone ? (
          <>
            <div className="section-label">Your role</div>
            <Segmented value={role} onChange={(v) => setRole(v as 'borrower' | 'lender')} options={[{ id: 'borrower', label: 'I borrow' }, { id: 'lender', label: 'I lend' }]} />
          </>
        ) : null}
        <div className="section-label">Terms</div>
        <div className="form-row">
          <Field label="Principal" value={principal} onChange={(v) => setPrincipal(formatAmountCommas(v))} />
          <SelectField label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
        </div>
        <Field label={loanKind === 'long_term' ? 'Annual interest %' : 'Flat interest %'} value={interest} onChange={(v) => setInterest(formatAmountCommas(v))} />
        {showInterestPeriod ? <Field label="Interest period (months)" value={interestPeriodMonths} onChange={setInterestPeriodMonths} placeholder="How long this rate applies" /> : null}
        {loanKind === 'one_time' ? (
          <Field
            label="Due date"
            type="date"
            value={dueDate}
            onChange={setDueDate}
            min={startDate && startDate > todayIso() ? startDate : todayIso()}
          />
        ) : null}
        <Field label="Title" value={title} onChange={setTitle} />
        <Field label="Note" value={note} onChange={setNote} />
        <Button onClick={onCreate} disabled={!canSubmit} busy={busy} block>
          {busy ? 'Working…' : alone ? 'Save debt schedule' : 'Send for acceptance'}
        </Button>
      </Card>
    </div>
  );
}
