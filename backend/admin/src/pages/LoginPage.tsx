import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
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
      <form className="login-form" onSubmit={onSubmit}>
        <div className="login-form-heading">
          <BrandLogo size={40} />
          <h2>Sign in to Lony Admin</h2>
          <p className="muted">Use your admin account.</p>
        </div>

        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="you@lony.app"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <span className="input-with-icon">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="input-icon-btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
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

        <p className="login-footnote muted">Access is limited to admin accounts.</p>
      </form>
    </div>
  );
}
