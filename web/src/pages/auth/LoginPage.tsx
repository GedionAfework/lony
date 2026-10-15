import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { login, busy, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch {
      /* error surfaced via context */
    }
  }

  return (
    <AuthLayout>
      <h2>Sign in</h2>
      <div className="sub">Welcome back — pick up where you left off.</div>
      {error ? <div className="error-text">{error}</div> : null}
      <form className="flex-col" onSubmit={onSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        <Button type="submit" block busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <div className="auth-links">
        <Link to="/forgot">Forgot password?</Link>
        <Link to="/register">Create account</Link>
      </div>
    </AuthLayout>
  );
}
