import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, isPremiumPlan, type Goal, type GoalDraft, type MoneyAccount, type PlanAssistantSource } from '../lib/api';
import { savingAdvice } from '../lib/planAdvice';
import { formatMoney, stripAmount } from '../lib/format';
import { CURRENCIES } from '../lib/catalogs';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field, SelectField, TextAreaField } from '../components/Field';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { MediaImg } from '../components/Avatar';
import { BrandLoader } from '../components/BrandLoader';

const FALLBACK_GOAL_TYPES = [
  { id: 'travel', label: 'Travel' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'savings', label: 'Savings' },
  { id: 'debt_payoff', label: 'Debt payoff' },
  { id: 'other', label: 'Other' },
];

function typeDisplay(g: Goal, goalTypes: { id: string; label: string }[]): string {
  if (g.goal_type === 'custom' && g.type_label) return g.type_label;
  const id = g.goal_type === 'custom' ? 'other' : g.goal_type;
  return goalTypes.find((t) => t.id === id)?.label || g.goal_type;
}

export function PlanPage() {
  const { user, token } = useAuth();
  const { showError } = useToast();
  const confirm = useConfirm();
  const locale = user?.locale || 'en';

  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [goalTypes, setGoalTypes] = useState(FALLBACK_GOAL_TYPES);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [goalType, setGoalType] = useState('savings');
  const [otherType, setOtherType] = useState('');
  const [currency, setCurrency] = useState((user?.default_currency_code || 'USD').toUpperCase());
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [targetDate, setTargetDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [describeText, setDescribeText] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [extractBusy, setExtractBusy] = useState(false);
  // Product picture: shown as-is, and saved as the cover by the server after the plan is
  // created (a browser is usually not allowed to download other sites' images).
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverThumb, setCoverThumb] = useState<string | null>(null);
  // "$68 a month for 24 months": shown so the total is not a surprise.
  const [monthlyPlan, setMonthlyPlan] = useState<{ amount: string; months: number; currency: string } | null>(null);
  // The product page's own price/currency, so price tracking compares like with like.
  const [listing, setListing] = useState<{ url: string; price?: string; currency?: string } | null>(null);
  const [aiReply, setAiReply] = useState('');
  const [aiSources, setAiSources] = useState<PlanAssistantSource[]>([]);
  const [advice, setAdvice] = useState('');

  const [contributeAmount, setContributeAmount] = useState('');
  const [contributeAccount, setContributeAccount] = useState('');
  const [debitAccount, setDebitAccount] = useState(true);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [g, a, types] = await Promise.all([
        api.listGoals(token),
        api.listAccounts(token).catch(() => ({ accounts: [] })),
        api.listCatalogTypes(token, 'goal_type').catch(() => ({ types: [] })),
      ]);
      setGoals(g.goals ?? []);
      setAccounts(a.accounts ?? []);
      const fromCatalog = (types.types ?? []).filter((t) => t.active !== false).map((t) => ({ id: t.code === 'custom' ? 'other' : t.code, label: t.label }));
      if (fromCatalog.length) {
        const hasOther = fromCatalog.some((t) => t.id === 'other');
        setGoalTypes(hasOther ? fromCatalog : [...fromCatalog, { id: 'other', label: 'Other' }]);
      } else {
        setGoalTypes(FALLBACK_GOAL_TYPES);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load plans');
    }
  }, [token, showError]);

  const [booted, setBooted] = useState(false);
  useEffect(() => {
    void reload().finally(() => setBooted(true));
  }, [reload]);

  const selected = goals.find((g) => g.id === selectedId) ?? null;

  function resetForm() {
    setTitle('');
    setGoalType('savings');
    setOtherType('');
    setCurrency((user?.default_currency_code || 'USD').toUpperCase());
    setTarget('');
    setCurrent('0');
    setTargetDate('');
    setAccountId('');
    setNote('');
    setProductUrl('');
    setDescribeText('');
    setCoverUrl(null);
    setCoverThumb(null);
    setMonthlyPlan(null);
    setListing(null);
    setAiReply('');
    setAiSources([]);
    setAdvice('');
  }

  function applyDraft(d: GoalDraft) {
    if (d.title) setTitle(d.title.slice(0, 120));
    if (d.target_amount) setTarget(d.target_amount);
    const cur = d.currency_code && d.currency_code.length === 3 ? d.currency_code.toUpperCase() : currency;
    if (d.currency_code && d.currency_code.length === 3) setCurrency(cur);
    if (d.source_url) {
      setListing({
        url: d.source_url,
        price: d.source_price || d.target_amount,
        currency: d.source_currency || (d.currency_unknown ? undefined : cur),
      });
    }
    if (d.goal_type) {
      if (d.goal_type === 'custom') {
        setGoalType('other');
        if (d.type_label) setOtherType(d.type_label);
      } else {
        setGoalType(d.goal_type);
      }
    } else if (!goalType || goalType === 'savings') {
      setGoalType('purchase');
    }
    if (d.target_date) setTargetDate(d.target_date);
    if (d.note && !note.trim()) setNote(d.note.slice(0, 400));
    if (d.source_url) setProductUrl(d.source_url);
    if (d.image_url) {
      setCoverUrl(d.image_url);
      setCoverThumb(d.image_thumb_url || null);
    }
    setMonthlyPlan(d.monthly_payment && d.payment_months ? { amount: d.monthly_payment, months: d.payment_months, currency: (d.source_currency || d.currency_code || currency).toUpperCase() } : null);
  }

  /** Warns when the price needs a human check before saving. */
  function draftWarning(d: GoalDraft) {
    if (!d.target_amount) showError('The page opened, but it did not list a full price. Add the amount below.');
    else if (d.currency_unknown) showError(`The page shows ${d.target_amount} but not the currency. Check it is ${currency} before saving.`);
    else if (d.estimated) showError('This price is an estimate, not read from a page. Check it before saving.');
  }

  async function onExtractDescribe() {
    if (!token) return;
    const text = describeText.trim() || productUrl.trim();
    if (!text) {
      showError('Describe what you want, or paste a product link');
      return;
    }
    setExtractBusy(true);
    setAiReply('');
    setAiSources([]);
    setAdvice('');
    try {
      if (/https?:\/\/|www\./i.test(text)) {
        const res = await api.extractGoalDraft(token, text, currency);
        applyDraft(res.draft ?? {});
        draftWarning(res.draft ?? {});
        return;
      }
      // Looks the item up on the web: real listings, the pages used, and a price in this currency.
      const res = await api.planAssistant(token, currency, [{ role: 'user', content: text }]);
      setAiReply(res.reply || '');
      setAiSources(res.sources ?? []);
      const d = res.draft;
      if (d?.title || d?.target_amount) {
        // The listing the price came from, in its own currency, so tracking compares like with like.
        const listing = (res.sources ?? []).find((src) => src.url === d.source_url && src.price && src.currency_code);
        const foreign = listing && listing.currency_code?.toUpperCase() !== (d.currency_code || currency).toUpperCase();
        applyDraft({
          ...d,
          image_url: d.image_url || res.image_url,
          ...(foreign ? { source_price: listing!.price, source_currency: listing!.currency_code?.toUpperCase() } : {}),
        });
        if (d.target_amount) {
          setAdvice(await savingAdvice(token, Number(d.target_amount), (d.currency_code || currency).toUpperCase(), d.target_date, user?.locale));
        }
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not look that up');
    } finally {
      setExtractBusy(false);
    }
  }

  async function onFetchProductUrl() {
    if (!token) return;
    const url = productUrl.trim();
    if (!url) {
      showError('Paste a product link first');
      return;
    }
    setUrlBusy(true);
    try {
      // The server reads the page (no AI needed) and converts a foreign price to this currency.
      const res = await api.extractGoalDraft(token, url, currency);
      const d = res.draft ?? {};
      if (!d.title && !d.target_amount) {
        showError('That page did not include a product title or a price. Try the product page itself.');
        return;
      }
      applyDraft({ ...d, source_url: d.source_url || url, goal_type: d.goal_type || 'purchase' });
      draftWarning(d);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not read that link');
    } finally {
      setUrlBusy(false);
    }
  }

  const accountOptions = useMemo(
    () => accounts.filter((a) => a.currency_code.toUpperCase() === currency.toUpperCase()).map((a) => ({ id: a.id, label: `${a.name} · ${a.balance} ${a.currency_code}` })),
    [accounts, currency],
  );
  const contributeAccountOptions = useMemo(() => {
    const code = (selected?.currency_code || currency).toUpperCase();
    return accounts.filter((a) => a.currency_code.toUpperCase() === code).map((a) => ({ id: a.id, label: `${a.name} · ${a.balance} ${a.currency_code}` }));
  }, [accounts, selected, currency]);

  async function onCreate() {
    if (!token || !title.trim()) {
      showError('Title is required');
      return;
    }
    if (goalType === 'other' && !otherType.trim()) {
      showError('Name your plan type');
      return;
    }
    const amount = stripAmount(target);
    if (!amount || Number(amount) <= 0) {
      showError('Enter a target amount');
      return;
    }
    setBusy(true);
    try {
      const apiType = goalType === 'other' ? 'custom' : (goalType as Goal['goal_type']);
      await api.createGoal(token, {
        title: title.trim(),
        goal_type: apiType,
        currency_code: currency,
        target_amount: amount,
        current_amount: stripAmount(current) || undefined,
        target_date: targetDate || undefined,
        linked_account_id: accountId || undefined,
        note: note.trim() || undefined,
        type_label: goalType === 'other' ? otherType.trim() : undefined,
        source_url: productUrl.trim() || undefined,
        ...(listing && listing.url === productUrl.trim() && listing.currency
          ? { last_seen_price: listing.price, source_currency: listing.currency }
          : {}),
      }).then(async (res) => {
        if (coverUrl && res.goal?.id) {
          // Best effort: a plan without a picture is still a plan.
          await api.setGoalCoverFromUrl(token, res.goal.id, coverUrl).catch(() => undefined);
        }
      });
      setCreateOpen(false);
      resetForm();
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not create plan');
    } finally {
      setBusy(false);
    }
  }

  async function onContribute() {
    if (!token || !selectedId) return;
    const amount = stripAmount(contributeAmount);
    if (!amount || Number(amount) <= 0) {
      showError('Enter a contribution amount');
      return;
    }
    setBusy(true);
    try {
      await api.contributeGoal(token, selectedId, { amount, account_id: contributeAccount || undefined, debit_account: debitAccount && Boolean(contributeAccount) });
      setContributeAmount('');
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not contribute');
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: string) {
    if (!token) return;
    const goal = goals.find((g) => g.id === id);
    const ok = await confirm({
      title: `Archive ${goal?.title || 'this plan'}?`,
      body: 'It leaves your plans. Money you saved toward it stays in your accounts.',
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.updateGoal(token, id, { status: 'archived' });
      setSelectedId(null);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  function onPickCover(goalId: string, file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      if (!token) return;
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      const b64 = idx >= 0 ? result.slice(idx + 1) : result;
      setBusy(true);
      try {
        await api.uploadGoalCover(token, goalId, { filename: file.name, mime: file.type || 'image/jpeg', attachment_base64: b64 });
        await reload();
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Could not upload cover');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function onClearCover(id: string) {
    if (!token) return;
    const ok = await confirm({ title: 'Remove the photo?', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try {
      await api.uploadGoalCover(token, id, { clear: true });
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not remove cover');
    } finally {
      setBusy(false);
    }
  }

  // Lony's loading screen until the first load lands, instead of a page of zeros.
  if (!booted) return <BrandLoader />;

  if (selected) {
    const pct = Math.min(100, Math.max(0, Math.round(selected.progress_percent || 0)));
    const done = selected.status === 'completed';
    return (
      <div className="page page-narrow">
        <PageHeader title={selected.title} back onBack={() => setSelectedId(null)} />
        <Card>
          <MediaImg src={selected.cover_image_url} token={token} alt={selected.title} className="cover-image" />
          <div className="muted">
            {typeDisplay(selected, goalTypes)}
            {selected.target_date ? ` · ${selected.target_date}` : ''}
            {done ? ' · Done' : ''}
          </div>
          <div className="bar-track" style={{ height: 10 }}>
            <div className="bar-fill" style={{ height: 10, width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`, background: done ? 'var(--success)' : 'var(--primary)' }} />
          </div>
          <div className="muted">
            {formatMoney(selected.current_amount, selected.currency_code, locale)} of {formatMoney(selected.target_amount, selected.currency_code, locale)} · {pct}%
          </div>
          {selected.note ? <p>{selected.note}</p> : null}

          {!done && selected.status === 'active' ? (
            <>
              <div className="section-label">Contribute</div>
              <Field label="Amount" value={contributeAmount} onChange={setContributeAmount} money />
              {contributeAccountOptions.length ? (
                <>
                  <SelectField label="From account" value={contributeAccount} onChange={setContributeAccount} options={contributeAccountOptions} placeholder="Log only, no account" />
                  {contributeAccount ? (
                    <label className="checkbox-row">
                      <input type="checkbox" checked={debitAccount} onChange={() => setDebitAccount((v) => !v)} />
                      Debit this account
                    </label>
                  ) : null}
                </>
              ) : null}
              <Button onClick={onContribute} busy={busy} block>
                {busy ? 'Saving…' : 'Add contribution'}
              </Button>
              <div className="flex-row">
                <label className="btn btn-secondary btn-icon" style={{ cursor: 'pointer' }}>
                  <Camera size={15} />
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onPickCover(selected.id, e.target.files[0])} />
                </label>
                {selected.cover_image_url ? (
                  <Button variant="icon" aria-label="Remove photo" onClick={() => onClearCover(selected.id)}>
                    <Trash2 size={15} />
                  </Button>
                ) : null}
                <Button variant="icon" aria-label="Archive" onClick={() => onArchive(selected.id)}>
                  <Trash2 size={15} />
                </Button>
              </div>
            </>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Plan"
        subtitle="Savings goals, travel, and purchases"
        right={
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            <Plus size={15} /> New plan
          </Button>
        }
      />

      <div className="grid grid-3">
        {goals.length === 0 ? (
          <Card style={{ gridColumn: '1 / -1' }}>
            <EmptyState title="No plans yet" body="Create a plan to track savings, travel, or a purchase." />
          </Card>
        ) : (
          goals.map((g) => {
            const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
            return (
              <Card
                key={g.id}
                tight
                onClick={() => {
                  setSelectedId(g.id);
                  setContributeAccount(g.linked_account_id || '');
                  setContributeAmount('');
                  setDebitAccount(true);
                }}
                style={{ cursor: 'pointer' }}
              >
                <MediaImg
                  src={g.cover_image_url}
                  token={token}
                  alt={g.title}
                  className="cover-image"
                  style={{ height: 130 }}
                  fallback={
                    <div className={`goal-cover goal-${g.goal_type}`}>
                      <span>{typeDisplay(g, goalTypes)}</span>
                    </div>
                  }
                />
                <div className="card-row">
                  <div>
                    <div style={{ fontWeight: 700 }}>{g.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {typeDisplay(g, goalTypes)}
                      {g.target_date ? ` · ${g.target_date}` : ''}
                    </div>
                  </div>
                  <span style={{ color: 'var(--primary)', fontWeight: 800, fontSize: 14 }}>{pct}%</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(pct > 0 ? 4 : 0, pct)}%` }} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {formatMoney(g.current_amount, g.currency_code, locale)} of {formatMoney(g.target_amount, g.currency_code, locale)}
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Modal open={createOpen} title="New plan" onClose={() => setCreateOpen(false)}>
        {isPremiumPlan(user) ? (
          <>
        <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Describe with AI
        </div>
        <TextAreaField
          label="What do you want?"
          value={describeText}
          onChange={setDescribeText}
          rows={3}
          placeholder='MacBook Pro 14" around $2,000 by June, or paste a store link…'
        />
        <Button variant="secondary" onClick={() => void onExtractDescribe()} busy={extractBusy} disabled={extractBusy || urlBusy || busy} block>
          {extractBusy ? 'Looking up prices…' : 'Find the price with AI'}
        </Button>
        {aiReply ? <p style={{ fontSize: 13, margin: '6px 0' }}>{aiReply}</p> : null}
        {aiSources.length ? (
          <div className="flex-col" style={{ gap: 4 }}>
            {aiSources.map((src) => (
              <a key={src.url} href={src.url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 12 }}>
                {src.site}
                {src.price ? ` · ${src.currency_code || ''} ${src.price}` : ''}
                {src.price_local && src.currency_code !== currency ? ` (≈ ${currency} ${src.price_local})` : ''}
              </a>
            ))}
          </div>
        ) : null}
        {advice ? <p className="muted" style={{ fontSize: 13, margin: '6px 0' }}>{advice}</p> : null}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            Plan AI is included with Plus and Pro.{' '}
            <Link to="/settings/plan" style={{ color: 'var(--primary)', fontWeight: 600 }}>
              See plans
            </Link>
          </p>
        )}
        <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 }}>
          Or paste a link
        </div>
        <Field label="Product link" value={productUrl} onChange={setProductUrl} placeholder="https://…" />
        <Button variant="secondary" onClick={() => void onFetchProductUrl()} busy={urlBusy} disabled={urlBusy || extractBusy || busy} block>
          {urlBusy ? 'Reading link…' : 'Fetch from link'}
        </Button>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="cover-image"
            style={{ height: 120 }}
            onError={() => {
              // The store refused the picture: use the search engine's copy, which always loads.
              setCoverUrl(coverThumb && coverThumb !== coverUrl ? coverThumb : null);
              setCoverThumb(null);
            }}
          />
        ) : null}
        {monthlyPlan && target ? (
          <div className="notice">
            <div className="notice-text">
              Sold as a monthly plan: {formatMoney(monthlyPlan.amount, monthlyPlan.currency, locale)} a month for {monthlyPlan.months} months. The target is the
              whole plan, {formatMoney(stripAmount(target) || '0', currency, locale)}.
            </div>
          </div>
        ) : null}
        <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 }}>
          Details
        </div>
        <Field label="Title" value={title} onChange={setTitle} />
        <SelectField label="Type" value={goalType} onChange={setGoalType} options={goalTypes} />
        {goalType === 'other' ? <Field label="Type name" value={otherType} onChange={setOtherType} /> : null}
        <div className="form-row">
          <Field label="Target amount" value={target} onChange={setTarget} money />
          <SelectField label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
        </div>
        <Field label="Already saved" value={current} onChange={setCurrent} money />
        <Field label="Target date" type="date" value={targetDate} onChange={setTargetDate} />
        {accountOptions.length ? <SelectField label="Linked account" value={accountId} onChange={setAccountId} options={accountOptions} placeholder="None" /> : null}
        <Field label="Note" value={note} onChange={setNote} />
        <Button onClick={onCreate} busy={busy} block>
          {busy ? 'Saving…' : 'Create'}
        </Button>
      </Modal>
    </div>
  );
}
