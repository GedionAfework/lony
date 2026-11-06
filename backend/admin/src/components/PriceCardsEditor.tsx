import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { api, type BillingOverview, type PlanPrice } from '../api';
import { useAuth } from '../auth';
import { Button } from './Button';

type PaidTier = 'plus' | 'pro';
const PAID: PaidTier[] = ['plus', 'pro'];
const TIER_NAME: Record<PaidTier, string> = { plus: 'Plus', pro: 'Pro' };
const INTERVALS = [
  { id: 'month', label: 'Per month' },
  { id: 'year', label: 'Per year' },
] as const;
const CURRENCIES = ['usd', 'eur', 'gbp', 'etb', 'cad', 'aud', 'inr'];

/** A price row being edited: amounts as typed text so half-typed numbers don't jump. */
type Row = {
  id: string;
  tier: PaidTier;
  interval: 'month' | 'year';
  price: string;
  currency: string;
  discountKind: '' | 'percent' | 'flat';
  discountValue: string;
  discountLabel: string;
  startsAt: string; // datetime-local
  endsAt: string; // datetime-local
};

let seq = 0;
const newId = () => `row-${Date.now()}-${seq++}`;

function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
      discountValue: p.discount ? (p.discount.kind === 'flat' ? (p.discount.value / 100).toFixed(2) : String(p.discount.value)) : '',
      discountLabel: p.discount?.label ?? '',
      startsAt: toLocalInput(p.discount?.starts_at),
      endsAt: toLocalInput(p.discount?.ends_at),
    }));
}

function cents(text: string): number {
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function toPrices(rows: Row[]): PlanPrice[] {
  return rows.map((r) => {
    const p: PlanPrice = { tier: r.tier, interval: r.interval, amount_cents: cents(r.price), currency: r.currency };
    const raw = Number(r.discountValue.replace(/[^0-9.]/g, ''));
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

/** What the row costs right now, as the apps will show it. */
function preview(r: Row): { now: number; list: number; live: boolean; note: string } {
  const list = cents(r.price);
  const raw = Number(r.discountValue.replace(/[^0-9.]/g, ''));
  const start = r.startsAt ? new Date(r.startsAt).getTime() : null;
  const end = r.endsAt ? new Date(r.endsAt).getTime() : null;
  const t = Date.now();
  const timed = (start === null || t >= start) && (end === null || t < end);
  if (!r.discountKind || !(raw > 0)) return { now: list, list, live: false, note: '' };
  const off = r.discountKind === 'percent' ? Math.round((list * raw) / 100) : Math.round(raw * 100);
  const after = Math.max(0, list - off);
  if (!timed) return { now: list, list, live: false, note: end !== null && t >= end ? 'Discount has ended' : 'Discount not started yet' };
  return { now: after, list, live: true, note: end ? `until ${new Date(end).toLocaleString()}` : 'no end date' };
}

/** Price cards per paid tier: each row is how often it bills and the price, with an optional discount. */
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

  function patch(id: string, change: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  function addRow(tier: PaidTier) {
    const used = rows.filter((r) => r.tier === tier).map((r) => r.interval);
    const interval = used.includes('month') ? 'year' : 'month';
    const monthly = rows.find((r) => r.tier === tier && r.interval === 'month');
    setRows((cur) => [
      ...cur,
      {
        id: newId(),
        tier,
        interval,
        // A yearly row starts at ten months of the monthly price.
        price: interval === 'year' && monthly ? ((cents(monthly.price) * 10) / 100).toFixed(2) : '',
        currency: monthly?.currency ?? cur.find((r) => r.tier === tier)?.currency ?? 'usd',
        discountKind: '',
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
      if (cents(r.price) <= 0) {
        onError(`${TIER_NAME[r.tier]} ${r.interval === 'year' ? 'yearly' : 'monthly'}: enter a price above zero.`);
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
    <section className="card team-card">
      <div className="team-toolbar">
        <h3 className="bill-h3">Prices</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {data.prices_saved ? 'Shown on the plan cards in the web and phone apps' : 'Defaults. Save to make them yours.'}
        </span>
      </div>

      <div className="price-cards">
        {PAID.map((tier) => {
          const mine = rows.filter((r) => r.tier === tier).sort((a, b) => a.interval.localeCompare(b.interval));
          return (
            <div key={tier} className="price-card">
              <div className="price-card-head">
                <strong>{TIER_NAME[tier]}</strong>
                <span className="muted">{mine.length ? `${mine.length} price${mine.length > 1 ? 's' : ''}` : 'Not offered'}</span>
              </div>

              {mine.map((r) => {
                const pv = preview(r);
                const charged = polar[`${tier}_${r.interval}`];
                const mismatch = charged !== undefined && charged !== pv.now;
                const taken = mine.filter((x) => x.id !== r.id).map((x) => x.interval);
                return (
                  <div key={r.id} className="price-row">
                    <div className="price-row-main">
                      <label className="price-field">
                        <span className="field-label">Billing</span>
                        <select value={r.interval} disabled={!canManage} onChange={(e) => patch(r.id, { interval: e.target.value as Row['interval'] })}>
                          {INTERVALS.map((i) => (
                            <option key={i.id} value={i.id} disabled={taken.includes(i.id)}>
                              {i.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="price-field grow">
                        <span className="field-label">Price</span>
                        <input inputMode="decimal" value={r.price} placeholder="10.00" disabled={!canManage} onChange={(e) => patch(r.id, { price: e.target.value })} />
                      </label>
                      <label className="price-field">
                        <span className="field-label">Currency</span>
                        <select value={r.currency} disabled={!canManage} onChange={(e) => patch(r.id, { currency: e.target.value })}>
                          {CURRENCIES.map((c) => (
                            <option key={c} value={c}>
                              {c.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </label>
                      {canManage ? (
                        <button type="button" className="shell-icon-btn bordered price-remove" title="Remove this price" onClick={() => setRows((cur) => cur.filter((x) => x.id !== r.id))}>
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>

                    <div className="price-row-discount">
                      <label className="price-field">
                        <span className="field-label">Discount</span>
                        <select
                          value={r.discountKind}
                          disabled={!canManage}
                          onChange={(e) => patch(r.id, { discountKind: e.target.value as Row['discountKind'] })}
                        >
                          <option value="">None</option>
                          <option value="percent">Percentage (%)</option>
                          <option value="flat">Flat amount</option>
                        </select>
                      </label>
                      {r.discountKind ? (
                        <>
                          <label className="price-field">
                            <span className="field-label">{r.discountKind === 'percent' ? 'Percent off' : `Amount off (${r.currency.toUpperCase()})`}</span>
                            <input
                              inputMode="decimal"
                              value={r.discountValue}
                              placeholder={r.discountKind === 'percent' ? '20' : '5.00'}
                              disabled={!canManage}
                              onChange={(e) => patch(r.id, { discountValue: e.target.value })}
                            />
                          </label>
                          <label className="price-field grow">
                            <span className="field-label">Label (optional)</span>
                            <input value={r.discountLabel} maxLength={40} placeholder="Launch offer" disabled={!canManage} onChange={(e) => patch(r.id, { discountLabel: e.target.value })} />
                          </label>
                          <label className="price-field">
                            <span className="field-label">Starts</span>
                            <input type="datetime-local" value={r.startsAt} disabled={!canManage} onChange={(e) => patch(r.id, { startsAt: e.target.value })} />
                          </label>
                          <label className="price-field">
                            <span className="field-label">Ends (countdown)</span>
                            <input type="datetime-local" value={r.endsAt} disabled={!canManage} onChange={(e) => patch(r.id, { endsAt: e.target.value })} />
                          </label>
                        </>
                      ) : null}
                    </div>

                    <div className="price-preview">
                      {pv.live ? (
                        <>
                          <s className="muted">{money(pv.list, r.currency)}</s> <strong>{money(pv.now, r.currency)}</strong>
                        </>
                      ) : (
                        <strong>{money(pv.list, r.currency)}</strong>
                      )}
                      <span className="muted"> /{r.interval}</span>
                      {pv.note ? <span className="muted"> · {pv.note}</span> : null}
                      {mismatch ? (
                        <span className="price-warn">
                          <AlertTriangle size={13} /> Polar charges {money(charged, r.currency)} for this plan
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {canManage && mine.length < 2 ? (
                <button type="button" className="price-add" onClick={() => addRow(tier)}>
                  <Plus size={14} /> Add {mine.some((r) => r.interval === 'month') ? 'yearly' : mine.length ? 'monthly' : 'a'} price
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="muted ov-note" style={{ padding: '0 16px' }}>
        Checkout charges the price of the Polar product mapped to each plan. Keep Polar’s price (and any Polar discount) in step with what you set here.
      </p>

      {canManage ? (
        <footer className={`role-editor-foot${dirty ? ' dirty' : ''}`}>
          <span className="role-diff">{dirty ? <span className="muted">Unsaved changes</span> : <span className="muted">Saved</span>}</span>
          {dirty ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRows(toRows(data.prices ?? []))}>
              Discard
            </Button>
          ) : null}
          <Button size="sm" busy={busy} disabled={!dirty && data.prices_saved} onClick={() => void save()}>
            Save prices
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
