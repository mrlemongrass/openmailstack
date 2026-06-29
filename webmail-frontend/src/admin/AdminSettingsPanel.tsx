import { Save } from 'lucide-react';
import type { AdminSettingsMap, MailPolicyAdminSettings, OrganizationAdminSettings, PublicUrlsAdminSettings, SecurityAdminSettings, SystemAdminSettings } from './adminSettingsApi';

interface AdminSettingsPanelProps {
  settings: AdminSettingsMap;
  saving: boolean;
  status: string;
  onChange: (settings: AdminSettingsMap) => void;
  onSave: () => void;
}

export function AdminSettingsPanel({ settings, saving, status, onChange, onSave }: AdminSettingsPanelProps) {
  const update = <K extends keyof AdminSettingsMap>(namespace: K, updates: Partial<AdminSettingsMap[K]>) => {
    onChange({
      ...settings,
      [namespace]: {
        ...settings[namespace],
        ...updates,
      },
    });
  };

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div>
          <div className="settings-eyebrow">Admin Settings</div>
          <h2>Organization Controls</h2>
        </div>
        <button className="btn btn-primary" type="button" onClick={onSave} disabled={saving}>
          <Save size={18} /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {status && <div className="settings-status-banner">{status}</div>}

      <div className="settings-grid">
        <OrganizationSection settings={settings.organization} onChange={updates => update('organization', updates)} />
        <PublicUrlsSection settings={settings.publicUrls} onChange={updates => update('publicUrls', updates)} />
        <SecuritySection settings={settings.security} onChange={updates => update('security', updates)} />
        <MailPolicySection settings={settings.mailPolicy} onChange={updates => update('mailPolicy', updates)} />
        <SystemSection settings={settings.system} onChange={updates => update('system', updates)} />
        <WebhooksSection settings={settings.webhooks} onChange={updates => update('webhooks', updates)} />
      </div>
    </div>
  );
}

function OrganizationSection({ settings, onChange }: { settings: OrganizationAdminSettings; onChange: (updates: Partial<OrganizationAdminSettings>) => void }) {
  return (
    <section className="settings-section">
      <h3>Organization</h3>
      <label className="settings-field">
        <span>Name</span>
        <input className="glass-input" value={settings.organizationName} onChange={event => onChange({ organizationName: event.target.value })} placeholder="Company or team name" />
      </label>
      <label className="settings-field">
        <span>Support Email</span>
        <input className="glass-input" value={settings.supportEmail} onChange={event => onChange({ supportEmail: event.target.value })} placeholder="support@example.com" />
      </label>
      <label className="settings-field">
        <span>Support URL</span>
        <input className="glass-input" value={settings.supportUrl} onChange={event => onChange({ supportUrl: event.target.value })} placeholder="https://example.com/help" />
      </label>
      <div className="settings-form-grid two">
        <label className="settings-field">
          <span>Locale</span>
          <input className="glass-input" value={settings.defaultLocale} onChange={event => onChange({ defaultLocale: event.target.value })} />
        </label>
        <label className="settings-field">
          <span>Time Zone</span>
          <input className="glass-input" value={settings.defaultTimeZone} onChange={event => onChange({ defaultTimeZone: event.target.value })} />
        </label>
      </div>
    </section>
  );
}

function PublicUrlsSection({ settings, onChange }: { settings: PublicUrlsAdminSettings; onChange: (updates: Partial<PublicUrlsAdminSettings>) => void }) {
  return (
    <section className="settings-section">
      <h3>Domains & URLs</h3>
      <label className="settings-field">
        <span>Webmail URL</span>
        <input className="glass-input" value={settings.webmailUrl} onChange={event => onChange({ webmailUrl: event.target.value })} placeholder="https://mail.example.com/" />
      </label>
      <label className="settings-field">
        <span>Mail Host</span>
        <input className="glass-input" value={settings.mailHost} onChange={event => onChange({ mailHost: event.target.value })} placeholder="mail.example.com" />
      </label>
      <label className="settings-field">
        <span>Autodiscover Host</span>
        <input className="glass-input" value={settings.autodiscoverHost} onChange={event => onChange({ autodiscoverHost: event.target.value })} placeholder="autodiscover.example.com" />
      </label>
      <label className="settings-field">
        <span>CalDAV URL</span>
        <input className="glass-input" value={settings.caldavUrl} onChange={event => onChange({ caldavUrl: event.target.value })} placeholder="https://mail.example.com/.well-known/caldav" />
      </label>
      <label className="settings-field">
        <span>CardDAV URL</span>
        <input className="glass-input" value={settings.carddavUrl} onChange={event => onChange({ carddavUrl: event.target.value })} placeholder="https://mail.example.com/.well-known/carddav" />
      </label>
    </section>
  );
}

function SecuritySection({ settings, onChange }: { settings: SecurityAdminSettings; onChange: (updates: Partial<SecurityAdminSettings>) => void }) {
  return (
    <section className="settings-section">
      <h3>Security</h3>
      <label className="settings-field">
        <span>Session Lifetime</span>
        <select className="glass-input glass-select" value={settings.sessionLifetimeHours} onChange={event => onChange({ sessionLifetimeHours: Number(event.target.value) as SecurityAdminSettings['sessionLifetimeHours'] })}>
          <option value={8}>8 hours</option>
          <option value={12}>12 hours</option>
          <option value={24}>24 hours</option>
          <option value={72}>3 days</option>
          <option value={168}>7 days</option>
        </select>
      </label>
      <ToggleRow label="Require secure cookies" checked={settings.requireSecureCookies} onChange={requireSecureCookies => onChange({ requireSecureCookies })} />
      <ToggleRow label="Allow user password changes" checked={settings.allowUserPasswordChange} onChange={allowUserPasswordChange => onChange({ allowUserPasswordChange })} />
      <ToggleRow label="Show last-login notice" checked={settings.showLastLoginNotice} onChange={showLastLoginNotice => onChange({ showLastLoginNotice })} />
      <div className="settings-disabled-note">Runtime enforcement for these policies needs a later backend/session pass.</div>
    </section>
  );
}

function MailPolicySection({ settings, onChange }: { settings: MailPolicyAdminSettings; onChange: (updates: Partial<MailPolicyAdminSettings>) => void }) {
  return (
    <section className="settings-section">
      <h3>Mail Defaults</h3>
      <div className="settings-form-grid two">
        <label className="settings-field">
          <span>Max Attachment MB</span>
          <input className="glass-input" type="number" min={1} max={100} value={settings.maxAttachmentMb} onChange={event => onChange({ maxAttachmentMb: Number(event.target.value) })} />
        </label>
        <label className="settings-field">
          <span>Default Quota MB</span>
          <input className="glass-input" type="number" min={128} value={settings.defaultQuotaMb} onChange={event => onChange({ defaultQuotaMb: Number(event.target.value) })} />
        </label>
      </div>
      <label className="settings-field">
        <span>Spam Policy</span>
        <select className="glass-input glass-select" value={settings.spamPolicyMode} onChange={event => onChange({ spamPolicyMode: event.target.value as MailPolicyAdminSettings['spamPolicyMode'] })}>
          <option value="standard">Standard</option>
          <option value="strict">Strict</option>
          <option value="permissive">Permissive</option>
        </select>
      </label>
      <ToggleRow label="Allow external forwarding" checked={settings.allowExternalForwarding} onChange={allowExternalForwarding => onChange({ allowExternalForwarding })} />
      <div className="settings-disabled-note">These defaults are stored now; enforcement is intentionally separate from existing Postfix/Rspamd policy.</div>
    </section>
  );
}

function SystemSection({ settings, onChange }: { settings: SystemAdminSettings; onChange: (updates: Partial<SystemAdminSettings>) => void }) {
  return (
    <section className="settings-section">
      <h3>System</h3>
      <label className="settings-field">
        <span>Update Channel</span>
        <select className="glass-input glass-select" value={settings.updateChannel} onChange={event => onChange({ updateChannel: event.target.value as SystemAdminSettings['updateChannel'] })}>
          <option value="stable">Stable</option>
          <option value="preview">Preview</option>
        </select>
      </label>
      <label className="settings-field">
        <span>Maintenance Window</span>
        <input className="glass-input" value={settings.maintenanceWindow} onChange={event => onChange({ maintenanceWindow: event.target.value })} placeholder="Sunday 02:00" />
      </label>
      <label className="settings-field">
        <span>Telemetry</span>
        <select className="glass-input glass-select" value={settings.telemetryMode} onChange={event => onChange({ telemetryMode: event.target.value as SystemAdminSettings['telemetryMode'] })}>
          <option value="off">Off</option>
          <option value="basic">Basic health only</option>
        </select>
      </label>
      <label className="settings-field">
        <span>Admin Notice</span>
        <textarea className="glass-input" value={settings.adminNotice} onChange={event => onChange({ adminNotice: event.target.value })} rows={4} />
      </label>
    </section>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="settings-toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  );
}

function WebhooksSection({ settings, onChange }: { settings: import('./adminSettingsApi').WebhooksAdminSettings; onChange: (updates: Partial<import('./adminSettingsApi').WebhooksAdminSettings>) => void }) {
  return (
    <section className="settings-section" style={{ gridColumn: '1 / -1' }}>
      <h3>Event Webhooks</h3>
      <label className="settings-field">
        <span>Webhook Endpoints (one URL per line)</span>
        <textarea 
          className="glass-input" 
          value={settings?.endpoints?.join('\n') || ''} 
          onChange={event => onChange({ endpoints: event.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} 
          rows={3} 
          placeholder="https://my-service.com/webhook"
        />
      </label>
      <label className="settings-field">
        <span>Subscribed Actions (one per line, leave blank for all)</span>
        <textarea 
          className="glass-input" 
          value={settings?.events?.join('\n') || ''} 
          onChange={event => onChange({ events: event.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} 
          rows={3} 
          placeholder="e.g. Mailbox test@test.com created."
        />
      </label>
      <div className="settings-disabled-note">Webhooks are fired automatically on matching admin actions.</div>
    </section>
  );
}
