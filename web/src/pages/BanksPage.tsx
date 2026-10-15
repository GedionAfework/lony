import { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Pencil, Star, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type BankProfile, type BankProfileShare, type Friendship, type PaymentRail } from '../lib/api';
import { COUNTRIES } from '../lib/catalogs';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field, SelectField } from '../components/Field';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

const FALLBACK_RAILS: PaymentRail[] = [
  { code: 'bank_local', label: 'Local bank', profile_type: 'bank_account', category: 'bank', identifier_hint: 'Account number' },
  { code: 'iban', label: 'IBAN', profile_type: 'iban', category: 'bank', identifier_hint: 'IBAN' },
  { code: 'swift', label: 'SWIFT', profile_type: 'swift', category: 'bank', identifier_hint: 'SWIFT/BIC + account' },
  { code: 'mobile_money', label: 'Mobile money', profile_type: 'mobile_money', category: 'mobile_money', identifier_hint: 'Phone number' },
  { code: 'paypal', label: 'PayPal', profile_type: 'paypal', category: 'wallet', identifier_hint: 'Email' },
  { code: 'wise', label: 'Wise', profile_type: 'wise', category: 'wallet', identifier_hint: 'Wise tag or account' },
  { code: 'crypto_wallet', label: 'Crypto', profile_type: 'crypto_wallet', category: 'wallet', identifier_hint: 'Wallet address' },
  { code: 'other', label: 'Other', profile_type: 'other', category: 'other', identifier_hint: 'Identifier' },
];

export function BanksPage() {
  const { token } = useAuth();
  const { showError, show } = useToast();

  const [profiles, setProfiles] = useState<BankProfile[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [outgoingShares, setOutgoingShares] = useState<BankProfileShare[]>([]);
  const [incomingShares, setIncomingShares] = useState<BankProfileShare[]>([]);
  const [rails, setRails] = useState<PaymentRail[]>([]);
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const [country, setCountry] = useState('');
  const [rail, setRail] = useState('');
  const [profileType, setProfileType] = useState('');
  const [label, setLabel] = useState('');
  const [institution, setInstitution] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [currency, setCurrency] = useState('');
  const [shareFriendId, setShareFriendId] = useState('');

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [profRes, friendRes, outRes, inRes] = await Promise.all([
        api.listBankProfiles(token),
        api.listFriends(token),
        api.listBankShares(token, false),
        api.listBankShares(token, true),
      ]);
      setProfiles(profRes.bank_profiles ?? []);
      setFriends(friendRes.friends ?? []);
      setOutgoingShares(outRes.shares ?? []);
      setIncomingShares(inRes.shares ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load payment profiles');
    }
  }, [token, showError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const railOptions = useMemo(() => (rails.length ? rails : FALLBACK_RAILS), [rails]);

  function loadRails() {
    api.listPaymentRails().then((res) => setRails(res.rails ?? [])).catch((e) => showError(e instanceof Error ? e.message : 'Could not load payment types'));
  }

  function onRailChange(code: string) {
    setRail(code);
    const hit = railOptions.find((r) => r.code === code);
    if (hit) {
      setProfileType(hit.profile_type);
      setLabel(hit.label);
    }
  }

  async function onCreate() {
    if (!token || !identifier.trim() || !country || !rail) return;
    setBusy(true);
    try {
      await api.createBankProfile(token, {
        profile_type: profileType || 'other',
        label: label.trim() || 'Payment profile',
        institution_name: institution.trim() || undefined,
        account_identifier: identifier.trim(),
        currency_code: currency.trim().toUpperCase() || undefined,
        country_code: country.trim().toUpperCase() || undefined,
        rail_code: rail,
        is_preferred: profiles.length === 0,
      });
      setIdentifier('');
      setLabel('');
      setInstitution('');
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save payment profile');
    } finally {
      setBusy(false);
    }
  }

  async function onPrefer(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      await api.preferBankProfile(token, id);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not set preferred');
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      await api.archiveBankProfile(token, id);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveLabel(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      await api.patchBankProfile(token, id, { label: editLabel.trim() });
      setEditingId(null);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  }

  async function onShare(profileId: string, recipientId: string) {
    if (!token || !recipientId) return;
    setBusy(true);
    try {
      await api.shareBankProfile(token, profileId, { recipient_id: recipientId });
      show('Shared with friend');
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not share');
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (!token) return;
    try {
      await api.revokeBankShare(token, id);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not revoke');
    }
  }

  async function onReveal(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.getBankProfile(token, id, true);
      setRevealedNumber(res.bank_profile.account_identifier ?? null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Reveal requires a recent sign-in');
    } finally {
      setBusy(false);
    }
  }

  const activeShares = outgoingShares.filter((s) => !s.revoked_at);

  return (
    <div className="page page-narrow">
      <PageHeader title="Payment profiles" subtitle="Encrypted destinations for any rail worldwide — lists show last 4 only" />

      <Card>
        <div className="section-label">Your profiles</div>
        {profiles.length === 0 ? (
          <EmptyState icon={<Landmark size={22} />} title="No profiles yet" body="Add a bank, mobile money, wallet, or crypto account below." />
        ) : (
          profiles.map((profile) => (
            <div key={profile.id} className="list-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
              <div className="card-row" style={{ width: '100%' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {profile.label}
                    {profile.is_preferred ? ' · preferred' : ''}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {profile.profile_type} · •••• {profile.account_last4}
                  </div>
                </div>
                <div className="flex-row">
                  {!profile.is_preferred ? (
                    <Button variant="icon" aria-label="Set preferred" onClick={() => onPrefer(profile.id)} disabled={busy}>
                      <Star size={15} />
                    </Button>
                  ) : null}
                  <Button variant="icon" aria-label="Edit" onClick={() => { setEditingId(profile.id); setEditLabel(profile.label); }} disabled={busy}>
                    <Pencil size={15} />
                  </Button>
                  <Button variant="icon" aria-label="Archive" onClick={() => onArchive(profile.id)} disabled={busy}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
              {editingId === profile.id ? (
                <div className="flex-row" style={{ width: '100%' }}>
                  <Field label="Label" value={editLabel} onChange={setEditLabel} />
                  <Button size="sm" onClick={() => onSaveLabel(profile.id)} busy={busy}>
                    Save
                  </Button>
                </div>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => onReveal(profile.id)} disabled={busy}>
                Reveal
              </Button>
              {friends.length > 0 ? (
                <div className="flex-row" style={{ width: '100%' }}>
                  <SelectField label="Share with" value={shareFriendId} onChange={setShareFriendId} options={friends.map((f) => ({ id: f.peer.id, label: f.peer.display_name }))} placeholder="Pick a friend" />
                  <Button size="sm" variant="secondary" onClick={() => onShare(profile.id, shareFriendId)} disabled={busy || !shareFriendId}>
                    Share
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
        {revealedNumber ? <div className="muted" style={{ fontFamily: 'var(--font-mono)' }}>Revealed: {revealedNumber}</div> : null}
      </Card>

      <Card>
        <div className="section-label">Add payment account</div>
        <SelectField label="Account country" value={country} onChange={setCountry} options={COUNTRIES} placeholder="Select country" />
        <Button variant="secondary" size="sm" onClick={loadRails}>
          {rails.length ? `Refresh types (${rails.length})` : 'Load payment types'}
        </Button>
        <SelectField label="Payment type" value={rail} onChange={onRailChange} options={railOptions.map((r) => ({ id: r.code, label: r.label }))} placeholder="Select payment type" />
        <Field label="Label" value={label} onChange={setLabel} />
        <Field label="Institution" value={institution} onChange={setInstitution} />
        <Field label="Account or wallet number" value={identifier} onChange={setIdentifier} />
        <Field label="Currency (optional)" value={currency} onChange={setCurrency} placeholder="USD" />
        <Button onClick={onCreate} disabled={busy || !identifier.trim() || !country || !rail} busy={busy} block>
          {busy ? 'Working…' : 'Save encrypted profile'}
        </Button>
      </Card>

      {activeShares.length > 0 ? (
        <Card>
          <div className="section-label">Shared with</div>
          {activeShares.map((share) => (
            <div key={share.id} className="list-row">
              <div className="main">
                <div className="title">
                  {share.profile.label} · •••• {share.profile.account_last4}
                </div>
                <div className="sub">{share.loan_id ? 'Loan share' : 'Friend share'}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => onRevoke(share.id)} disabled={busy}>
                Revoke
              </Button>
            </div>
          ))}
        </Card>
      ) : null}

      {incomingShares.length > 0 ? (
        <Card>
          <div className="section-label">Shared with me</div>
          {incomingShares.map((share) => (
            <div key={share.id} className="list-row">
              <div className="main">
                <div className="title">
                  {share.profile.label} · •••• {share.profile.account_last4}
                </div>
                <div className="sub">Masked until you reveal</div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => onReveal(share.profile.id)} disabled={busy}>
                Reveal
              </Button>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
