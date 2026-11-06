import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Clock, Percent, Tag, Wand2 } from 'lucide-react';
import { api, type BillingOverview, type PlanPrice } from '../api';
import { useAuth } from '../auth';
import { Button } from './Button';
import { DateTimePicker, formatWhen, toLocalValue } from './DateTimePicker';

type PaidTier = 'plus' | 'pro';
type Interval = 'month' | 'year';
const PAID: PaidTier[] = ['plus', 'pro'];
const TIER_NAME: Record<PaidTier, string> = { plus: 'Plus', pro: 'Pro' };
const TIER_BLURB: Record<PaidTier, string> = { plus: 'Unlimited AI help and reports', pro: 'Everything, plus bank sync' };
const INTERVALS: Interval[] = ['month', 'year'];
const INTERVAL_NAME: Record<Interval, string> = { month: 'Monthly', year: 'Yearly' };
const CURRENCIES = ['usd', 'eur', 'gbp', 'etb', 'cad', 'aud', 'inr'];
const PERCENT_CHIPS = [10, 20, 25, 30, 50];
const LABEL_CHIPS = ['Launch offer', 'Limited time', 'Holiday sale', 'New year deal'];

/** A price being edited: amounts as typed text so half-typed numbers don't jump. */
type Row = {
  id: string;
  tier: PaidTier;
  interval: Interval;
  price: string;
  currency: string;
  discountKind: '' | 'percent' | 'flat';
  /** Last kind used, so switching the discount off and on keeps it. */
  lastKind: 'percent' | 'flat';
  discountValue: string;
  discountLabel: string;
  startsAt: string; // local YYYY-MM-DDTHH:mm
  endsAt: string;
};

let seq = 0;
const newId = () => `row-${Date.now()}-${seq++}`;

function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : toLocalValue(d);
}

function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toRows(prices: PlanPrice[]): Row[] {
  return prices
    .filter((p): p is PlanPrice & { tier: PaidTier } => p.tier === 'plus' || p.tier === 'pro')
    .map((p) => ({
      id: newId(),
      tier: p.tier,
      interval: p.interval === 'year' ? 'year' : 'month',
      price: (p.amount_cents / 100).toFixed(2),
      currency: (p.currency || 'usd').toLowerCase(),
      discountKind: p.discount?.kind ?? '',
      lastKind: p.discount?.kind ?? 'percent',
      discountValue: p.discount ? (p.discount.kind === 'flat' ? (p.discount.value / 100).toFixed(2) : String(p.discount.value)) : '',
      discountLabel: p.discount?.label ?? '',
      startsAt: toLocalInput(p.discount?.starts_at),
      endsAt: toLocalInput(p.discount?.ends_at),
    }));
}

const num = (text: string) => {
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const cents = (text: string) => Math.round(num(text) * 100);

function toPrices(rows: Row[]): PlanPrice[] {
  return [...rows]
    .sort((a, b) => (a.tier + a.interval).localeCompare(b.tier + b.interval))
    .map((r) => {
      const p: PlanPrice = { tier: r.tier, interval: r.interval, amount_cents: cents(r.price), currency: r.currency };
      const raw = num(r.discountValue);
      if (r.discountKind && raw > 0) {
        p.discount = {
          kind: r.discountKind,
          value: r.discountKind === 'flat' ? Math.round(raw * 100) : raw,
          label: r.discountLabel.trim() || undefined,
          starts_at: fromLocalInput(r.startsAt),
          ends_at: fromLocalInput(r.endsAt),
        };
      }
      return p;
    });
}

function money(c: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  } catch {
    return `${(c / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function symbol(currency: string) {
  try {
    return (
      new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency.toUpperCase()
    );
  } catch {
    return currency.toUpperCase();
  }
}

type Phase = 'none' | 'scheduled' | 'live' | 'ended';

/** What the row costs at time t, as the apps will show it. */
function priceAt(r: Row, t: number): { now: number; list: number; off: number; phase: Phase } {
  const list = cents(r.price);
  const raw = num(r.discountValue);
  if (!r.discountKind || !(raw > 0)) return { now: list, list, off: 0, phase: 'none' };
  const start = r.startsAt ? new Date(r.startsAt).getTime() : null;
  const end = r.endsAt ? new Date(r.endsAt).getTime() : null;
  const off = Math.min(list, r.discountKind === 'percent' ? Math.round((list * Math.min(raw, 100)) / 100) : Math.round(raw * 100));
  if (end !== null && t >= end) return { now: list, list, off, phase: 'ended' };
  if (start !== null && t < start) return { now: list, list, off, phase: 'scheduled' };
  return { now: list - off, list, off, phase: 'live' };
}

/** Problems that block saving, or a warning to show beside the field. */
function problems(r: Row): { price?: string; discount?: string; schedule?: string } {
  const out: { price?: string; discount?: string; schedule?: string } = {};
  if (cents(r.price) <= 0) out.price = 'Enter a price above zero';
  if (r.discountKind) {
    const v = num(r.discountValue);
    if (!(v > 0)) out.discount = 'Enter how much to take off';
    else if (r.discountKind === 'percent' && v >= 100) out.discount = 'A percentage must be below 100';
    else if (r.discountKind === 'flat' && Math.round(v * 100) >= cents(r.price)) out.discount = 'Take off less than the full price';
    if (r.startsAt && r.endsAt && new Date(r.endsAt) <= new Date(r.startsAt)) out.schedule = 'The end must be after the start';
  }
  return out;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function duration(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

const inHours = (h: number, from?: string) => () => {
  const base = from ? new Date(from) : new Date();
  const d = new Date(Math.max(base.getTime(), Date.now()) + h * 3_600_000);
  d.setSeconds(0, 0);
  return toLocalValue(d);
};
const endOfMonth = () => {
  const n = new Date();
  return toLocalValue(new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59));
};
const startOf = (days: number, hour: number) => () => {
  const n = new Date();
  return toLocalValue(new Date(n.getFullYear(), n.getMonth(), n.getDate() + days, hour, 0));
};
const nextMonday = () => {
  const n = new Date();
  const add = ((8 - n.getDay()) % 7) || 7;
  return toLocalValue(new Date(n.getFullYear(), n.getMonth(), n.getDate() + add, 9, 0));
};

/** Price cards per paid tier: a monthly and a yearly slot, each with an optional timed discount. */
export function PriceCardsEditor({
  data,
  canManage,
  onSaved,
  onError,
}: {
  data: BillingOverview;
  canManage: boolean;
  onSaved: (d: BillingOverview) => void;
  onError: (msg: string) => void;
}) {
  const { token } = useAuth();
  const [rows, setRows] = useState<Row[]>(() => toRows(data.prices ?? []));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(toRows(data.prices ?? []));
  }, [data]);

  const dirty = useMemo(() => JSON.stringify(toPrices(rows)) !== JSON.stringify(toPrices(toRows(data.prices ?? []))), [rows, data]);
  const blocking = rows.some((r) => Object.keys(problems(r)).length > 0);

  function patch(id: string, change: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  function offer(tier: PaidTier, interval: Interval, on: boolean) {
    if (!on) {
      setRows((cur) => cur.filter((r) => !(r.tier === tier && r.interval === interval)));
      return;
    }
    const other = rows.find((r) => r.tier === tier && r.interval !== interval);
    const fromOther = other ? cents(other.price) : 0;
    // Yearly starts at ten months of the monthly price; monthly at a tenth of yearly.
    const start = fromOther ? (interval === 'year' ? fromOther * 10 : Math.round(fromOther / 10)) : 0;
    setRows((cur) => [
      ...cur,
      {
        id: newId(),
        tier,
        interval,
        price: start ? (start / 100).toFixed(2) : '',
        currency: other?.currency ?? 'usd',
        discountKind: '',
        lastKind: 'percent',
        discountValue: '',
        discountLabel: '',
        startsAt: '',
        endsAt: '',
      },
    ]);
  }

  async function save() {
    if (!token) return;
    for (const r of rows) {
      const p = problems(r);
      const first = p.price ?? p.discount ?? p.schedule;
      if (first) {
        onError(`${TIER_NAME[r.tier]} ${INTERVAL_NAME[r.interval].toLowerCase()}: ${first.toLowerCase()}.`);
        return;
      }
    }
    setBusy(true);
    try {
      onSaved(await api.updateBillingSettings(token, { prices: toPrices(rows) }));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save prices');
    } finally {
      setBusy(false);
    }
  }

  const polar = data.polar_prices ?? {};

  return (
    <section className="card team-card pe-card">
      <div className="team-toolbar">
        <div>
          <h3 className="bill-h3">Prices</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {data.prices_saved ? 'What the plan cards in the web and phone apps show.' : 'These are defaults. Save to make them yours.'}
          </span>
        </div>
      </div>

      <div className="pe-tiers">
        {PAID.map((tier) => {
          const mine = rows.filter((r) => r.tier === tier);
          const monthly = mine.find((r) => r.interval === 'month');
          return (
            <div key={tier} className={`pe-tier tier-${tier}`}>
              <div className="pe-tier-head">
                <div>
                  <div className="pe-tier-name">{TIER_NAME[tier]}</div>
                  <div className="muted pe-tier-blurb">{TIER_BLURB[tier]}</div>
                </div>
                <span className={`pe-offer-chip${mine.length ? '' : ' off'}`}>{mine.length ? mine.map((r) => INTERVAL_NAME[r.interval]).sort().reverse().join(' + ') : 'Not offered'}</span>
              </div>

              {INTERVALS.map((interval) => {
                const r = mine.find((x) => x.interval === interval);
                return (
                  <div key={interval} className={`pe-slot${r ? '' : ' off'}`}>
                    <div className="pe-slot-head">
                      <span className="pe-slot-name">{INTERVAL_NAME[interval]}</span>
                      <label className="pe-toggle">
                        <span className="muted">{r ? 'Offered' : 'Off'}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(r)}
                          aria-label={`Offer ${TIER_NAME[tier]} ${INTERVAL_NAME[interval].toLowerCase()}`}
                          className={`switch${r ? ' on' : ''}`}
                          disabled={!canManage}
                          onClick={() => offer(tier, interval, !r)}
                        >
                          <span />
                        </button>
                      </label>
                    </div>
                    {r ? (
                      <PriceSlot row={r} monthly={interval === 'year' ? monthly : undefined} polarCents={polar[`${tier}_${interval}`]} canManage={canManage} patch={(c) => patch(r.id, c)} />
                    ) : (
                      <p className="pe-slot-off muted">Customers won't see a {interval === 'year' ? 'yearly' : 'monthly'} option for {TIER_NAME[tier]}.</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="muted ov-note" style={{ padding: '0 16px' }}>
        Checkout charges the price of the Polar product mapped to each plan. Keep Polar’s price (and any Polar discount) in step with what you set here.
      </p>

      {canManage ? (
        <footer className={`role-editor-foot${dirty ? ' dirty' : ''}`}>
          <span className="role-diff">
            {blocking ? <span className="pe-err-text">Fix the highlighted fields to save</span> : <span className="muted">{dirty ? 'Unsaved changes' : 'Saved'}</span>}
          </span>
          {dirty ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRows(toRows(data.prices ?? []))}>
              Discard
            </Button>
          ) : null}
          <Button size="sm" busy={busy} disabled={blocking || (!dirty && data.prices_saved)} onClick={() => void save()}>
            Save prices
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

function PriceSlot({
  row: r,
  monthly,
  polarCents,
  canManage,
  patch,
}: {
  row: Row;
  monthly?: Row;
  polarCents?: number;
  canManage: boolean;
  patch: (c: Partial<Row>) => void;
}) {
  const now = useNow();
  const pv = priceAt(r, now);
  const err = problems(r);
  const sym = symbol(r.currency);
  const per = r.interval === 'year' ? '/yr' : '/mo';
  const mismatch = polarCents !== undefined && polarCents !== pv.now;
  const monthlyCents = monthly && monthly.currency === r.currency ? cents(monthly.price) : 0;
  const yearCents = cents(r.price);
  const yearSave = r.interval === 'year' && monthlyCents && yearCents ? Math.round((1 - yearCents / (monthlyCents * 12)) * 100) : 0;
  const on = Boolean(r.discountKind);
  const kind = r.discountKind || r.lastKind;

  return (
    <div className="pe-slot-body">
      {/* Price */}
      <div className="pe-field">
        <span className="field-label">Price</span>
        <div className={`pe-money${err.price && r.price ? ' bad' : ''}`}>
          <select className="pe-money-cur" aria-label="Currency" value={r.currency} disabled={!canManage} onChange={(e) => patch({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
          <span className="pe-money-sym">{sym}</span>
          <input
            className="pe-money-input"
            inputMode="decimal"
            value={r.price}
            placeholder={r.interval === 'year' ? '99.00' : '9.99'}
            disabled={!canManage}
            onChange={(e) => patch({ price: e.target.value.replace(/[^0-9.]/g, '') })}
            onBlur={() => r.price && patch({ price: num(r.price).toFixed(2) })}
          />
          <span className="pe-money-per">{per}</span>
        </div>
        {r.interval === 'year' ? (
          <div className="pe-hint-row">
            {yearCents ? (
              <span className="muted">
                ≈ {money(Math.round(yearCents / 12), r.currency)}/mo
                {yearSave > 0 ? <b className="pe-good"> · {yearSave}% less than monthly</b> : yearSave < 0 ? <b className="pe-warn-text"> · costs more than monthly</b> : null}
              </span>
            ) : null}
            {monthlyCents && canManage ? (
              <span className="pe-quick">
                <Wand2 size={12} />
                {[10, 11, 12].map((m) => (
                  <button key={m} type="button" className="chip-btn pe-chip" onClick={() => patch({ price: ((monthlyCents * m) / 100).toFixed(2) })}>
                    {m}× monthly
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
        {mismatch ? (
          <span className="pe-warn">
            <AlertTriangle size={13} /> Polar charges {money(polarCents, r.currency)} for this plan
          </span>
        ) : null}
      </div>

      {/* Discount */}
      <div className={`pe-discount${on ? ' on' : ''}`}>
        <div className="pe-discount-head">
          <span className="pe-discount-title">
            <Tag size={14} /> Discount
            {on ? <PhasePill phase={pv.phase} /> : null}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Discount"
            className={`switch${on ? ' on' : ''}`}
            disabled={!canManage}
            onClick={() => patch(on ? { discountKind: '', lastKind: r.discountKind || r.lastKind } : { discountKind: r.lastKind })}
          >
            <span />
          </button>
        </div>

        {on ? (
          <div className="pe-discount-body">
            <div className="pe-discount-amount">
              <div className="seg pe-kind" role="radiogroup" aria-label="Discount type">
                <button type="button" role="radio" aria-checked={kind === 'percent'} className={kind === 'percent' ? 'active' : ''} disabled={!canManage} onClick={() => patch({ discountKind: 'percent', lastKind: 'percent', discountValue: '' })}>
                  <Percent size={13} /> Percent
                </button>
                <button type="button" role="radio" aria-checked={kind === 'flat'} className={kind === 'flat' ? 'active' : ''} disabled={!canManage} onClick={() => patch({ discountKind: 'flat', lastKind: 'flat', discountValue: '' })}>
                  {sym} Amount
                </button>
              </div>
              <div className={`pe-money pe-off${err.discount && r.discountValue ? ' bad' : ''}`}>
                {kind === 'flat' ? <span className="pe-money-sym">{sym}</span> : null}
                <input
                  className="pe-money-input"
                  inputMode="decimal"
                  aria-label={kind === 'percent' ? 'Percent off' : 'Amount off'}
                  value={r.discountValue}
                  placeholder={kind === 'percent' ? '20' : '2.00'}
                  disabled={!canManage}
                  onChange={(e) => patch({ discountValue: e.target.value.replace(/[^0-9.]/g, '') })}
                />
                <span className="pe-money-per">{kind === 'percent' ? '% off' : 'off'}</span>
              </div>
            </div>
            {kind === 'percent' && canManage ? (
              <div className="pe-chips">
                {PERCENT_CHIPS.map((p) => (
                  <button key={p} type="button" className={`chip-btn pe-chip${num(r.discountValue) === p ? ' active' : ''}`} onClick={() => patch({ discountValue: String(p) })}>
                    {p}%
                  </button>
                ))}
              </div>
            ) : null}
            {err.discount && r.discountValue ? <span className="pe-err-text">{err.discount}</span> : null}

            <div className="pe-field">
              <span className="field-label">Badge text <span className="muted">(optional)</span></span>
              <input value={r.discountLabel} maxLength={40} placeholder="e.g. Launch offer" disabled={!canManage} onChange={(e) => patch({ discountLabel: e.target.value })} />
              {canManage ? (
                <div className="pe-chips">
                  {LABEL_CHIPS.map((l) => (
                    <button key={l} type="button" className={`chip-btn pe-chip${r.discountLabel === l ? ' active' : ''}`} onClick={() => patch({ discountLabel: l })}>
                      {l}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="pe-field">
              <span className="field-label">
                <Clock size={13} /> When it runs
              </span>
              <div className="pe-when">
                <div className="pe-when-col">
                  <span className="pe-when-label">Starts</span>
                  <DateTimePicker
                    value={r.startsAt}
                    onChange={(v) => patch({ startsAt: v })}
                    placeholder="Right away"
                    clearLabel="Start right away"
                    disabled={!canManage}
                    presets={[
                      { label: 'Now', value: () => toLocalValue(new Date()) },
                      { label: 'Tomorrow 9:00', value: startOf(1, 9) },
                      { label: 'Next Monday', value: nextMonday },
                    ]}
                  />
                </div>
                <ArrowRight size={15} className="pe-when-arrow" />
                <div className="pe-when-col">
                  <span className="pe-when-label">Ends · countdown</span>
                  <DateTimePicker
                    value={r.endsAt}
                    onChange={(v) => patch({ endsAt: v })}
                    placeholder="No end date"
                    clearLabel="No end date"
                    min={r.startsAt || toLocalValue(new Date())}
                    disabled={!canManage}
                    presets={[
                      { label: '24 hours', value: inHours(24, r.startsAt) },
                      { label: '3 days', value: inHours(72, r.startsAt) },
                      { label: '7 days', value: inHours(168, r.startsAt) },
                      { label: '30 days', value: inHours(720, r.startsAt) },
                      { label: 'End of month', value: endOfMonth },
                    ]}
                  />
                </div>
              </div>
              <span className={err.schedule ? 'pe-err-text' : 'muted pe-when-sum'}>
                {err.schedule ??
                  (r.endsAt
                    ? `Runs ${r.startsAt ? `from ${formatWhen(r.startsAt)} ` : 'from now '}for ${duration(new Date(r.endsAt).getTime() - (r.startsAt ? new Date(r.startsAt).getTime() : now))}. Customers see a countdown.`
                    : 'No end date: no countdown is shown, and the offer runs until you switch it off.')}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <Preview row={r} pv={pv} now={now} />
    </div>
  );
}

function PhasePill({ phase }: { phase: Phase }) {
  if (phase === 'none') return null;
  const text = phase === 'live' ? 'Live' : phase === 'scheduled' ? 'Scheduled' : 'Ended';
  return <span className={`pe-phase ${phase}`}>{text}</span>;
}

/** A small copy of the plan card so the admin sees what customers will. */
function Preview({ row: r, pv, now }: { row: Row; pv: ReturnType<typeof priceAt>; now: number }) {
  const per = r.interval === 'year' ? '/year' : '/month';
  const end = r.endsAt ? new Date(r.endsAt).getTime() : null;
  const start = r.startsAt ? new Date(r.startsAt).getTime() : null;
  const offText = r.discountKind === 'percent' ? `${Math.round(num(r.discountValue))}% off` : `${money(pv.off, r.currency)} off`;
  const live = pv.phase === 'live';
  return (
    <div className="pe-preview">
      <span className="pe-preview-tag">Customers see</span>
      {pv.list ? (
        <>
          <div className="pe-preview-price">
            {live && pv.off ? <s>{money(pv.list, r.currency)}</s> : null}
            <strong>{money(pv.now, r.currency)}</strong>
            <span>{per}</span>
          </div>
          {live && pv.off ? (
            <div className="pe-preview-deal">
              <span className="pe-preview-badge">{offText}</span>
              {r.discountLabel ? <span className="pe-preview-label">{r.discountLabel}</span> : null}
              {end ? (
                <span className="pe-preview-timer">
                  Ends in <b>{countdown(end - now)}</b>
                </span>
              ) : null}
            </div>
          ) : pv.phase === 'scheduled' && start ? (
            <div className="muted pe-preview-note">
              From {formatWhen(r.startsAt)}: {money(pv.list - pv.off, r.currency)} ({offText})
            </div>
          ) : pv.phase === 'ended' ? (
            <div className="muted pe-preview-note">The discount has ended, so the full price shows.</div>
          ) : null}
        </>
      ) : (
        <div className="muted pe-preview-note">Enter a price to see the card.</div>
      )}
    </div>
  );
}
