import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../auth';
import { BrandLogo } from '../components/BrandLogo';

// Purely decorative bar heights for the preview tile.
const BARS = [38, 52, 44, 66, 58, 74, 62, 88, 70, 94, 80, 100];

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
      <section className="login-brand">
        <div className="login-brand-glow" aria-hidden />

        <div className="login-brand-logo-wrap">
          <BrandLogo size={48} />
          <h1>
            Lony <span>Admin</span>
          </h1>
        </div>

        <div className="login-brand-copy">
          <span className="login-brand-kicker">
            <Sparkles size={13} strokeWidth={2} /> Control center
          </span>
          <h2>
            Run the whole platform <em>from one place.</em>
          </h2>
          <p>Users, catalogs, themes, languages and live platform health, all in one fast, focused workspace.</p>
        </div>

        <div className="login-preview" aria-hidden>
          <div className="login-tile login-tile-wide">
            <small>Watch</small>
            <strong>
              Platform pulse <span className="login-tile-up">● live</span>
            </strong>
            <div className="login-ledger">
              {BARS.map((h, i) => (
                <span key={i} className="login-ledger-bar" style={{ height: `${h}%`, animationDelay: `${0.3 + i * 0.05}s` }} />
              ))}
            </div>
          </div>
          <div className="login-tile">
            <small>Manage</small>
            <strong>Users & roles</strong>
          </div>
          <div className="login-tile">
            <small>Curate</small>
            <strong>Catalogs</strong>
          </div>
        </div>

        <div className="login-brand-foot">© {new Date().getFullYear()} Lony · Restricted area</div>
      </section>

      <section className="login-form-panel">
        <form className="login-form" onSubmit={onSubmit}>
          <div className="login-form-heading">
            <h2>Welcome back</h2>
            <p className="muted">Sign in with your admin account to continue.</p>
          </div>

          <label className="field">
            <span className="field-label">Email</span>
            <span className="input-with-icon">
              <Mail size={17} strokeWidth={2} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@lony.app"
                required
                autoFocus
              />
            </span>
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <span className="input-with-icon">
              <LockKeyhole size={17} strokeWidth={2} />
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
            {busy ? <Loader2 size={17} strokeWidth={2} className="spin" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
            {busy ? null : <ArrowRight size={17} strokeWidth={2} />}
          </button>

          <p className="login-footnote muted">
            <ShieldCheck size={14} strokeWidth={2} /> Admin role required. Ask a Super Admin for access.
          </p>
        </form>
      </section>
    </div>
  );
}
