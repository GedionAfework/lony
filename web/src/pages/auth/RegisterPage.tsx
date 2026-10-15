import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { AuthLayout } from './AuthLayout';

export function RegisterPage() {
  const { register, busy, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    try {
      const res = await register(email, password, displayName, accepted);
      navigate('/verify', { state: { email: res.email, devCode: res.verification_code } });
    } catch {
      /* error surfaced via context */
    }
  }

  return (
    <AuthLayout>
      <h2>Create account</h2>
      <div className="sub">Start tracking shared money in minutes.</div>
      {error ? <div className="error-text">{error}</div> : null}
      <form className="flex-col" onSubmit={onSubmit}>
        <Field label="Display name" value={displayName} onChange={setDisplayName} required />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" required minLength={8} />
        <label className="checkbox-row">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I understand Lony is a shared ledger, not a bank, wallet, escrow, or payment processor.
        </label>
        <Button type="submit" block busy={busy} disabled={!accepted}>
          {busy ? 'Creating…' : 'Continue'}
        </Button>
      </form>
      <div className="auth-links">
        <span />
        <Link to="/login">Sign in instead</Link>
      </div>
    </AuthLayout>
  );
}
