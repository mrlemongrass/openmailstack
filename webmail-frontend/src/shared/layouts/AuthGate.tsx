import { Outlet } from 'react-router';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Mail } from 'lucide-react';
import { Spinner } from '../components/Spinner';
import { resolveBrandingPresentation, type BrandingSettings } from '../../branding';
import { useBranding } from '../../branding-context';
import type { LoginResult } from '../hooks/useAuth';

export function AuthGate() {
  const { isLoading, isAuthenticated, login } = useAuth();
  const { branding, isBrandingLoading } = useBranding();

  if (isLoading || isBrandingLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'var(--bg-main)', color: 'var(--text-secondary)',
      }}>
        <Spinner size={20} /> Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage login={login} branding={branding} />;
  }

  return <Outlet />;
}

export function LoginPage({ login, branding }: {
  login: (email: string, password: string, secondFactor?: string) => Promise<LoginResult>;
  branding: BrandingSettings;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secondFactor, setSecondFactor] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const presentation = resolveBrandingPresentation(branding);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(
        email,
        password,
        requiresTwoFactor ? secondFactor : undefined,
      );
      if (result.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setError(result.error === 'Invalid authentication code' ? result.error : '');
      } else if (!result.success) {
        setError(result.error || 'Invalid email or password.');
      }
    } catch {
      setError('Connection failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg-main)',
      backgroundImage: presentation.loginBackgroundDataUrl
        ? `linear-gradient(rgba(7, 12, 20, 0.36), rgba(7, 12, 20, 0.72)), url(${presentation.loginBackgroundDataUrl})`
        : 'radial-gradient(circle at 15% 50%, rgba(59,130,246,0.08) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.08) 0%, transparent 50%)',
      backgroundSize: 'cover', backgroundPosition: 'center',
    }}>
      <div className="glass-panel" style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          {presentation.loginLogoDataUrl ? (
            <span className="login-logo-surface">
              <img
                className="login-logo-image"
                src={presentation.loginLogoDataUrl}
                alt={`${presentation.appName} logo`}
              />
            </span>
          ) : (
            <div className="login-logo-fallback">
              <Mail size={24} color="white" />
            </div>
          )}
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>{presentation.loginTitle}</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: '0.9rem' }}>
            {presentation.loginSubtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16,
              color: 'var(--danger)', fontSize: '0.85rem',
            }}>
              {error}
            </div>
          )}

          {requiresTwoFactor ? (
            <>
              <div style={{
                color: 'var(--text-secondary)', fontSize: '0.86rem',
                marginBottom: 14, overflowWrap: 'anywhere',
              }}>
                Signing in as <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>
              </div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                Authentication or recovery code
                <input
                  type="text"
                  className="glass-input"
                  value={secondFactor}
                  onChange={(e) => setSecondFactor(e.target.value)}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="text"
                  style={{ width: '100%', marginTop: 8, marginBottom: 16 }}
                />
              </label>
            </>
          ) : (
            <>
              <input type="email" className="glass-input" placeholder="Email address"
                value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
                autoComplete="username"
                style={{ width: '100%', marginBottom: 12 }} />

              <input type="password" className="glass-input" placeholder="Password"
                value={password} onChange={(e) => setPassword(e.target.value)} required
                autoComplete="current-password"
                style={{ width: '100%', marginBottom: 24 }} />
            </>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}
            style={{ width: '100%' }}>
            {submitting
              ? <><Spinner size={14} /> Signing in...</>
              : requiresTwoFactor ? 'Verify and Sign In' : 'Sign In'}
          </button>
          {requiresTwoFactor && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={submitting}
              onClick={() => {
                setRequiresTwoFactor(false);
                setSecondFactor('');
                setError('');
              }}
              style={{ width: '100%', marginTop: 8 }}
            >
              Use a different account
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
