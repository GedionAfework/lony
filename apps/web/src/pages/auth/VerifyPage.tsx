import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { AuthLayout } from './AuthLayout';

type NavState = { email?: string; devCode?: string } | null;

export function VerifyPage() {
  const location = useLocation();
  const state = location.state as NavState;
  const navigate = useNavigate();
  const { persistSession } = useAuth();
  const [email, setEmail] = useState(state?.email ?? '');
  const [code, setCode] = useState('');
  const [devCode] = useState(state?.devCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.verify(email.trim(), code.trim());
      if (password) {
        const tokens = await api.login(email.trim(), password);
        persistSession(tokens.access_token, tokens.refresh_token, tokens.user);
        navigate('/', { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.resendVerification(email.trim());
      setError(res.verification_hint || 'Code resent');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Could not resend code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h2>Verify email</h2>
      <div className="sub">Enter the code sent to {email || 'your email'}.</div>
      {devCode ? <div className="hint-text">Dev code: {devCode}</div> : null}
      {error ? <div className="error-text">{error}</div> : null}
      <form className="flex-col" onSubmit={onSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} required />
        <Field label="Code" value={code} onChange={setCode} required />
        <Field
          label="Password (to sign in right after)"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="optional"
        />
        <Button type="submit" block busy={busy}>
          {busy ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
      <div className="auth-links">
        <button onClick={onResend} disabled={busy}>
          Resend code
        </button>
        <Link to="/login">Back to sign in</Link>
      </div>
    </AuthLayout>
  );
}
