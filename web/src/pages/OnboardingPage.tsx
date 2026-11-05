import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';
import { Field, SelectField } from '../components/Field';
import { PhoneField } from '../components/PhoneField';
import { Button } from '../components/Button';
import { COUNTRIES, CURRENCIES } from '../lib/catalogs';
import { useToast } from '../components/Toast';

export function OnboardingPage() {
  const { user, setUser, token, logout } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [username, setUsername] = useState(user?.username ?? '');
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [phone, setPhone] = useState(user?.phone_e164 ?? '');
  const [country, setCountry] = useState(user?.country_code ?? '');
  const [currency, setCurrency] = useState(user?.default_currency_code ?? '');
  // Unchecked on purpose: anyone here still has to accept the *current* terms,
  // including people who accepted an older version.
  const [tosAccepted, setTosAccepted] = useState(false);
  const termsUpdated = Boolean(user?.tos_accepted_at);
  const [busy, setBusy] = useState(false);

  const canSave =
    username.trim() && firstName.trim() && lastName.trim() && country.length === 2 && currency.length === 3 && tosAccepted;

  async function onSave() {
    if (!token || !canSave) return;
    setBusy(true);
    try {
      await api.acceptTOS(token);
      const res = await api.patchMe(token, {
        display_name: `${firstName} ${lastName}`.trim(),
        username: username.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_e164: phone.trim() || undefined,
        country_code: country.trim().toUpperCase(),
        default_currency_code: currency.trim().toUpperCase(),
      });
      setUser(res.user);
      if (!res.user.profile_complete) {
        showError('Some details are still missing. Check every field and try again.');
        return;
      }
      navigate('/', { replace: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Modal
      open
      compact
      solid
      title="Finish setup"
      footer={
        <>
          <Button variant="ghost" onClick={onSignOut} disabled={busy}>
            Sign out
          </Button>
          <Button onClick={onSave} disabled={!canSave} busy={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </Button>
        </>
      }
    >
      <Field label="Username" value={username} onChange={setUsername} placeholder="unique handle" />
      <div className="form-row">
        <Field label="First name" value={firstName} onChange={setFirstName} />
        <Field label="Last name" value={lastName} onChange={setLastName} />
      </div>
      <div className="form-row">
        <SelectField label="Country" value={country} onChange={setCountry} options={COUNTRIES} placeholder="Select country" />
        <SelectField label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} placeholder="Select currency" />
      </div>
      <PhoneField label="Phone (optional)" value={phone} onChange={setPhone} defaultCountry={country} />
      <label className="checkbox-row">
        <input type="checkbox" checked={tosAccepted} onChange={() => setTosAccepted((v) => !v)} />
        <span>
          I accept the{' '}
          <a href="/tos" target="_blank" rel="noreferrer">
            Terms of Service
          </a>
          {termsUpdated ? <span className="muted"> (updated, please review)</span> : null}
        </span>
      </label>
    </Modal>
  );
}
