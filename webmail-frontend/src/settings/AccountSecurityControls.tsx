import { useEffect, useState } from 'react';
import { Check, Copy, Download, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';

interface AppPasswordSummary {
  id: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

interface SecuritySummary {
  success: boolean;
  twoFactorEnabled: boolean;
  appPasswords: AppPasswordSummary[];
  error?: string;
}

interface MutationResponse {
  success: boolean;
  error?: string;
}

interface TotpSetupResponse extends MutationResponse {
  secret?: string;
  provisioningUri?: string;
}

interface TotpConfirmResponse extends MutationResponse {
  recoveryCodes?: string[];
}

interface AppPasswordResponse extends MutationResponse {
  appPassword?: AppPasswordSummary & { password: string };
}

const postJson = async <T extends MutationResponse>(url: string, body: object): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
};

const downloadRecoveryCodes = (codes: string[]) => {
  const blob = new Blob([
    'OpenMailStack recovery codes\n\n',
    ...codes.map(code => `${code}\n`),
    '\nEach code can be used once.\n',
  ], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'openmailstack-recovery-codes.txt';
  anchor.click();
  URL.revokeObjectURL(url);
};

export function AccountSecurityControls() {
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loadingError, setLoadingError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [appCurrentPassword, setAppCurrentPassword] = useState('');
  const [appCode, setAppCode] = useState('');
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [appLabel, setAppLabel] = useState('');
  const [newAppPassword, setNewAppPassword] = useState<AppPasswordResponse['appPassword']>();

  const loadSummary = async () => {
    try {
      const data = await fetch('/api/account/security').then(response => response.json() as Promise<SecuritySummary>);
      if (!data.success) throw new Error(data.error || 'Failed to load account security');
      setSummary(data);
      setLoadingError('');
    } catch (loadError) {
      setLoadingError(loadError instanceof Error ? loadError.message : 'Failed to load account security');
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSummary(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const run = async (action: string, operation: () => Promise<void>) => {
    setBusy(action);
    setError('');
    setStatus('');
    try {
      await operation();
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Security update failed');
    } finally {
      setBusy('');
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied.`);
    } catch {
      setError(`Could not copy ${label.toLowerCase()}.`);
    }
  };

  const beginSetup = () => run('setup', async () => {
    const data = await postJson<TotpSetupResponse>('/api/account/2fa/setup', {
      currentPassword: setupPassword,
    });
    if (!data.success || !data.secret || !data.provisioningUri) {
      throw new Error(data.error || 'Could not start two-factor setup');
    }
    setSetup(data);
    setSetupCode('');
    setStatus('Add the account to your authenticator, then enter its six-digit code.');
  });

  const confirmSetup = () => run('confirm', async () => {
    const data = await postJson<TotpConfirmResponse>('/api/account/2fa/confirm', { code: setupCode });
    if (!data.success || !data.recoveryCodes) throw new Error(data.error || 'Could not enable two-factor authentication');
    setRecoveryCodes(data.recoveryCodes);
    setSummary(previous => previous ? { ...previous, twoFactorEnabled: true } : previous);
    setSetup(null);
    setSetupPassword('');
    setSetupCode('');
    setStatus('Two-factor authentication is enabled. Save your recovery codes now.');
  });

  const disableTwoFactor = () => run('disable', async () => {
    const data = await postJson<MutationResponse>('/api/account/2fa/disable', {
      currentPassword: disablePassword,
      code: disableCode,
    });
    if (!data.success) throw new Error(data.error || 'Could not disable two-factor authentication');
    setSummary(previous => previous ? {
      ...previous,
      twoFactorEnabled: false,
      appPasswords: [],
    } : previous);
    setDisablePassword('');
    setDisableCode('');
    setAppCurrentPassword('');
    setAppCode('');
    setRecoveryCodes([]);
    setNewAppPassword(undefined);
    setStatus('Two-factor authentication is disabled and all app passwords were revoked.');
  });

  const createAppPassword = () => run('create-app-password', async () => {
    const data = await postJson<AppPasswordResponse>('/api/account/app-passwords', {
      currentPassword: appCurrentPassword,
      code: appCode,
      label: appLabel,
    });
    if (!data.success || !data.appPassword) throw new Error(data.error || 'Could not create app password');
    setNewAppPassword(data.appPassword);
    setSummary(previous => previous ? {
      ...previous,
      appPasswords: [data.appPassword!, ...previous.appPasswords],
    } : previous);
    setAppLabel('');
    setAppCode('');
    setStatus('App password created. Copy it now; it will not be shown again.');
  });

  const revokeAppPassword = (id: string) => run(`revoke-${id}`, async () => {
    if (!appCurrentPassword) throw new Error('Enter your current password before revoking an app password');
    const data = await postJson<MutationResponse>(`/api/account/app-passwords/${encodeURIComponent(id)}/revoke`, {
      currentPassword: appCurrentPassword,
    });
    if (!data.success) throw new Error(data.error || 'Could not revoke app password');
    setSummary(previous => previous ? {
      ...previous,
      appPasswords: previous.appPasswords.filter(appPassword => appPassword.id !== id),
    } : previous);
    if (newAppPassword?.id === id) setNewAppPassword(undefined);
    setStatus('App password revoked.');
  });

  if (!summary) {
    return (
      <section className="settings-section">
        <h3>Two-Factor Authentication</h3>
        <div role="status" aria-live="polite">
          {loadingError || 'Loading account security…'}
        </div>
        {loadingError && (
          <button type="button" className="btn btn-secondary" onClick={() => void loadSummary()}>
            Try Again
          </button>
        )}
      </section>
    );
  }

  return (
    <>
      <section className="settings-section">
        <div className="account-security-heading">
          <div>
            <h3>Two-Factor Authentication</h3>
            <p>Protect web sign-in with an authenticator app or a one-time recovery code.</p>
          </div>
          <span className={summary.twoFactorEnabled ? 'security-state enabled' : 'security-state'}>
            <ShieldCheck size={15} />
            {summary.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
          </span>
        </div>

        {recoveryCodes.length > 0 ? (
          <div className="security-secret-callout">
            <strong>Save these recovery codes now</strong>
            <p>Each code works once. They will not be shown again.</p>
            <div className="recovery-code-grid">
              {recoveryCodes.map(code => <code key={code}>{code}</code>)}
            </div>
            <div className="security-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void copy(recoveryCodes.join('\n'), 'Recovery codes')}>
                <Copy size={15} /> Copy All
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => downloadRecoveryCodes(recoveryCodes)}>
                <Download size={15} /> Save File
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setRecoveryCodes([])}>
                I Saved Them
              </button>
            </div>
          </div>
        ) : setup?.secret && setup.provisioningUri ? (
          <div className="settings-form-grid">
            <p className="security-guidance">
              Open the setup link on this device, or enter the secret manually in your authenticator.
            </p>
            <a className="btn btn-secondary security-link-button" href={setup.provisioningUri}>
              <KeyRound size={15} /> Open Authenticator
            </a>
            <div className="settings-copy-row">
              <div>
                <span>Setup secret</span>
                <code>{setup.secret}</code>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => void copy(setup.secret!, 'Setup secret')} aria-label="Copy setup secret">
                <Copy size={16} />
              </button>
            </div>
            <label className="settings-field">
              <span>Six-digit code</span>
              <input className="glass-input" value={setupCode} onChange={event => setSetupCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} />
            </label>
            <div className="security-actions">
              <button type="button" className="btn btn-primary" disabled={busy !== '' || !/^\d{6}$/.test(setupCode)} onClick={() => void confirmSetup()}>
                {busy === 'confirm' ? 'Verifying…' : 'Verify and Enable'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy !== ''} onClick={() => { setSetup(null); setSetupCode(''); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : summary.twoFactorEnabled ? (
          <div className="settings-form-grid two">
            <label className="settings-field">
              <span>Current password</span>
              <input type="password" className="glass-input" value={disablePassword} onChange={event => setDisablePassword(event.target.value)} autoComplete="current-password" />
            </label>
            <label className="settings-field">
              <span>Authentication or recovery code</span>
              <input className="glass-input" value={disableCode} onChange={event => setDisableCode(event.target.value)} autoComplete="one-time-code" />
            </label>
            <div className="security-actions">
              <button type="button" className="btn btn-danger" disabled={busy !== '' || !disablePassword || !disableCode} onClick={() => void disableTwoFactor()}>
                {busy === 'disable' ? 'Disabling…' : 'Disable Two-Factor Authentication'}
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-form-grid">
            <p className="security-guidance">
              After enabling two-factor authentication, mail and sync apps must use an app password instead of your primary password.
            </p>
            <label className="settings-field">
              <span>Current password</span>
              <input type="password" className="glass-input" value={setupPassword} onChange={event => setSetupPassword(event.target.value)} autoComplete="current-password" />
            </label>
            <div className="security-actions">
              <button type="button" className="btn btn-primary" disabled={busy !== '' || !setupPassword} onClick={() => void beginSetup()}>
                {busy === 'setup' ? 'Starting…' : 'Set Up Two-Factor Authentication'}
              </button>
            </div>
          </div>
        )}
      </section>

      {summary.twoFactorEnabled && recoveryCodes.length === 0 && (
        <section className="settings-section">
          <div className="account-security-heading">
            <div>
              <h3>App Passwords</h3>
              <p>Create a separate password for each mail, calendar, contacts, or mobile sync client.</p>
            </div>
          </div>

          {newAppPassword && (
            <div className="security-secret-callout">
              <strong>{newAppPassword.label}</strong>
              <p>Copy this password now. It will not be shown again.</p>
              <div className="settings-copy-row">
                <code>{newAppPassword.password}</code>
                <button type="button" className="btn btn-secondary" onClick={() => void copy(newAppPassword.password, 'App password')}>
                  <Copy size={15} /> Copy
                </button>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setNewAppPassword(undefined)}>
                <Check size={15} /> Done
              </button>
            </div>
          )}

          <div className="settings-form-grid two">
            <label className="settings-field">
              <span>App or device name</span>
              <input className="glass-input" value={appLabel} onChange={event => setAppLabel(event.target.value)} maxLength={80} placeholder="MacBook Mail" />
            </label>
            <label className="settings-field">
              <span>Authentication or recovery code</span>
              <input className="glass-input" value={appCode} onChange={event => setAppCode(event.target.value)} autoComplete="one-time-code" />
            </label>
            <label className="settings-field">
              <span>Current password</span>
              <input type="password" className="glass-input" value={appCurrentPassword} onChange={event => setAppCurrentPassword(event.target.value)} autoComplete="current-password" />
              <small>Required when creating or revoking an app password.</small>
            </label>
            <div className="security-actions security-actions-end">
              <button type="button" className="btn btn-primary" disabled={busy !== '' || !appLabel.trim() || !appCurrentPassword || !appCode} onClick={() => void createAppPassword()}>
                {busy === 'create-app-password' ? 'Creating…' : 'Create App Password'}
              </button>
            </div>
          </div>

          <div className="app-password-list">
            {summary.appPasswords.map(appPassword => (
              <div className="app-password-row" key={appPassword.id}>
                <div>
                  <strong>{appPassword.label}</strong>
                  <span>{appPassword.prefix} · Created {new Date(appPassword.created_at).toLocaleDateString()}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy !== ''}
                  onClick={() => void revokeAppPassword(appPassword.id)}
                  aria-label={`Revoke ${appPassword.label}`}
                >
                  <Trash2 size={15} /> {busy === `revoke-${appPassword.id}` ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
            {summary.appPasswords.length === 0 && (
              <p className="security-guidance">No active app passwords.</p>
            )}
          </div>
        </section>
      )}

      {(error || status) && (
        <div className={error ? 'security-feedback error' : 'security-feedback'} role="status" aria-live="polite">
          {error || status}
        </div>
      )}
    </>
  );
}
