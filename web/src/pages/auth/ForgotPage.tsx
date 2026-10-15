import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { AuthLayout } from './AuthLayout';

export function ForgotPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.forgotPassword(email.trim());
      navigate('/reset', { state: { email: email.trim(), devCode: res.verification_code } });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Could not send reset code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h2>Forgot password</h2>
      <div className="sub">We'll email a 6-digit code if an account exists for that address.</div>
      {error ? <div className="error-text">{error}</div> : null}
      <form className="flex-col" onSubmit={onSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} required />
        <Button type="submit" block busy={busy}>
          {busy ? 'Sending…' : 'Send code'}
        </Button>
      </form>
      <div className="auth-links">
        <span />
        <Link to="/login">Back to sign in</Link>
      </div>
    </AuthLayout>
  );
}
