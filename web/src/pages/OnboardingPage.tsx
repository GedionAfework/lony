import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { SelectField } from '../components/Field';
import { Button } from '../components/Button';
import { COUNTRIES, CURRENCIES } from '../lib/catalogs';
import { useToast } from '../components/Toast';

export function OnboardingPage() {
  const { user, setUser, token } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [username, setUsername] = useState(user?.username ?? '');
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [phone, setPhone] = useState(user?.phone_e164 ?? '');
  const [country, setCountry] = useState(user?.country_code ?? '');
  const [currency, setCurrency] = useState(user?.default_currency_code ?? '');
  const [tosAccepted, setTosAccepted] = useState(Boolean(user?.tos_accepted_at));
  const [busy, setBusy] = useState(false);

  const canSave =
    username.trim() && firstName.trim() && lastName.trim() && country.length === 2 && currency.length === 3 && tosAccepted;

  async function onSave() {
    if (!token || !canSave) return;
    setBusy(true);
    try {
      if (tosAccepted && !user?.tos_accepted_at) {
        await api.acceptTOS(token);
      }
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
      navigate('/', { replace: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1 className="page-title">Finish setup</h1>
      <Card>
        <div className="section-label">Identity</div>
        <Field label="Username" value={username} onChange={setUsername} placeholder="unique handle" />
        <div className="form-row">
          <Field label="First name" value={firstName} onChange={setFirstName} />
          <Field label="Last name" value={lastName} onChange={setLastName} />
        </div>
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="+1 555 000 0000" />
        <div className="section-label">Locale</div>
        <div className="form-row">
          <SelectField label="Country" value={country} onChange={setCountry} options={COUNTRIES} placeholder="Select country" />
          <SelectField label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} placeholder="Select currency" />
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={tosAccepted} onChange={() => setTosAccepted((v) => !v)} />
          I accept the{' '}
          <a href="/tos" target="_blank" rel="noreferrer">
            Terms of Service
          </a>
        </label>
        <Button onClick={onSave} disabled={!canSave} busy={busy} block>
          {busy ? 'Saving…' : 'Continue'}
        </Button>
      </Card>
    </div>
  );
}
