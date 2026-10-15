import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { AuthLayout } from './AuthLayout';

type NavState = { email?: string; devCode?: string } | null;

export function ResetPage() {
  const location = useLocation();
  const state = location.state as NavState;
  const navigate = useNavigate();
  const [email, setEmail] = useState(state?.email ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devCode] = useState(state?.devCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(email.trim(), code.trim(), newPassword);
      navigate('/login', { replace: true, state: { justReset: true } });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Could not reset password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h2>Reset password</h2>
      <div className="sub">Enter the code sent to {email || 'your email'} and choose a new password.</div>
      {devCode ? <div className="hint-text">Dev code: {devCode}</div> : null}
      {error ? <div className="error-text">{error}</div> : null}
      <form className="flex-col" onSubmit={onSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} required />
        <Field label="Code" value={code} onChange={setCode} required />
        <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} required minLength={8} />
        <Button type="submit" block busy={busy}>
          {busy ? 'Updating…' : 'Update password'}
        </Button>
      </form>
      <div className="auth-links">
        <span />
        <Link to="/login">Back to sign in</Link>
      </div>
    </AuthLayout>
  );
}
