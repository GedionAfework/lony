import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth';
import { BrandLogo } from '../components/BrandLogo';

export function LoginPage() {
  const { login, busy, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch {
      /* error surfaced via auth context */
    }
  }

  return (
    <div className="login-page">
      <section className="login-brand" aria-hidden="true">
        <div className="login-brand-glow" />
        <div className="login-brand-logo-wrap">
          <BrandLogo size={64} />
          <div>
            <div className="login-brand-kicker" style={{ marginBottom: 6 }}>
              <ShieldCheck size={14} strokeWidth={2} /> Control panel
            </div>
            <h1 style={{ margin: 0 }}>
              Lony <span>Admin</span>
            </h1>
          </div>
        </div>
        <div className="login-ledger">
          <div className="login-ledger-row login-ledger-head">
            <span />
            <span />
            <span />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="login-ledger-row" key={i}>
              <span className="login-ledger-bar" style={{ width: `${38 + ((i * 13) % 40)}%` }} />
              <span className="login-ledger-bar login-ledger-bar-num" style={{ width: `${20 + ((i * 7) % 18)}%` }} />
              <span
                className={`login-ledger-chip ${i % 3 === 0 ? 'up' : i % 3 === 1 ? 'down' : ''}`}
                style={{ width: `${14 + ((i * 5) % 10)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="login-brand-copy">
          <p>Manage users, catalogs, themes, and platform health from one calm, focused workspace.</p>
        </div>
      </section>

      <section className="login-form-panel">
        <form className="login-form" onSubmit={onSubmit}>
          <div className="login-form-heading">
            <h2>Welcome back</h2>
            <p className="muted">Sign in with an admin account to continue.</p>
          </div>

          <label className="field">
            <span className="field-label">Email</span>
            <span className="input-with-icon">
              <Mail size={16} strokeWidth={2} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@lony.app"
                required
              />
            </span>
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <span className="input-with-icon">
              <LockKeyhole size={16} strokeWidth={2} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                className="input-icon-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
              </button>
            </span>
          </label>

          {error ? (
            <div className="alert alert-error">
              <AlertCircle size={16} strokeWidth={2} />
              <span>{error}</span>
            </div>
          ) : null}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? <Loader2 size={16} strokeWidth={2} className="spin" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="login-footnote muted">Admin role required. Contact a Super Admin for access.</p>
        </form>
      </section>
    </div>
  );
}
