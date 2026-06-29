import { useState, type ReactNode } from 'react';
import { CalendarDays, Check, Copy, Filter, Lock, Mail, Palette, PenTool, Plus, Send, ShieldAlert, SlidersHorizontal, Smartphone, Trash2, Users } from 'lucide-react';
import type { AppearancePreferences, AccentColor, DensityMode, FontScale, RadiusMode, ThemeMode } from './appearance';
import { normalizeSettingsTab, type SettingsTab } from './tabs';
import type { CalendarUserSettings, ContactsUserSettings, MailUserSettings } from './settingsApi';

interface Rule {
  id: string;
  name: string;
  condition: 'any' | 'all';
  criteria: { id: string; field: string; operator: string; value: string }[];
  actions: { id: string; type: string; folder?: string }[];
}

interface MailFolder {
  path: string;
  unseen: number;
}

interface Signature {
  id: string;
  name: string;
  content: string;
  isDefault?: boolean;
  defaultForNew?: boolean;
  defaultForReply?: boolean;
}

interface CalendarOption {
  id: number;
  name: string;
}

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tab: SettingsTab) => void;
}

interface SettingsContentProps {
  activeTab: string;
  loading: boolean;
  saving: boolean;
  settingsSyncError: string;
  rules: Rule[];
  folders: MailFolder[];
  signatures: Signature[];
  mailSettings: MailUserSettings;
  calendarSettings: CalendarUserSettings;
  contactsSettings: ContactsUserSettings;
  availableSenders: string[];
  calendars: CalendarOption[];
  forwardingGoto: string;
  passwords: { current: string; new: string; confirm: string };
  appearance: AppearancePreferences;
  copiedSetupField: string | null;
  setupValues: {
    caldavDiscoveryUrl: string;
    caldavHomeUrl: string;
    carddavDiscoveryUrl: string;
    carddavAddressBookUrl: string;
    activeSyncUrl: string;
    mailHost: string;
    imapPort: string;
    smtpPort: string;
  };
  setupMailboxAddress: string;
  onAddRule: () => void;
  onUpdateRule: (id: string, updates: Partial<Rule>) => void;
  onDeleteRule: (id: string) => void;
  vacationSettings: { enabled: boolean; subject?: string; body: string; days?: number };
  onUpdateVacationSettings: (settings: { enabled: boolean; subject?: string; body: string; days?: number }) => void;
  onSaveRules: () => void;
  onAddSignature: () => void;
  onUpdateSignatures: (signatures: Signature[]) => void;
  onMailSettingsChange: (settings: MailUserSettings) => void;
  onCalendarSettingsChange: (settings: CalendarUserSettings) => void;
  onContactsSettingsChange: (settings: ContactsUserSettings) => void;
  onForwardingChange: (value: string) => void;
  onSaveForwarding: () => void;
  onPasswordChange: (passwords: { current: string; new: string; confirm: string }) => void;
  onAppearanceChange: (preferences: AppearancePreferences) => void;
  onCopySetupValue: (fieldKey: string, value: string) => void;
}

const navGroups: { title: string; items: { tab: SettingsTab; label: string; icon: typeof Mail }[] }[] = [
  {
    title: 'Personalization',
    items: [
      { tab: 'appearance', label: 'Appearance', icon: Palette },
    ],
  },
  {
    title: 'Mail',
    items: [
      { tab: 'mail_identity', label: 'Identity & Compose', icon: Mail },
      { tab: 'mail_signatures', label: 'Signatures', icon: PenTool },
      { tab: 'mail_reading', label: 'Reading', icon: SlidersHorizontal },
      { tab: 'mail_forwarding', label: 'Forwarding', icon: Send },
      { tab: 'mail_vacation', label: 'Auto-Responder', icon: Send },
      { tab: 'mail_filters', label: 'Filters', icon: Filter },
      { tab: 'mail_spam', label: 'Spam & Senders', icon: ShieldAlert },
    ],
  },
  {
    title: 'Apps',
    items: [
      { tab: 'calendar_defaults', label: 'Calendar', icon: CalendarDays },
      { tab: 'contacts_display', label: 'Contacts', icon: Users },
      { tab: 'sync_devices', label: 'Sync & Devices', icon: Smartphone },
    ],
  },
  {
    title: 'Account',
    items: [
      { tab: 'account_password', label: 'Password', icon: Lock },
      { tab: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
    ],
  },
];

const accentOptions: { value: AccentColor; label: string; color: string }[] = [
  { value: 'blue', label: 'Blue', color: '#3B82F6' },
  { value: 'cyan', label: 'Cyan', color: '#06B6D4' },
  { value: 'green', label: 'Green', color: '#10B981' },
  { value: 'amber', label: 'Amber', color: '#F59E0B' },
  { value: 'rose', label: 'Rose', color: '#F43F5E' },
  { value: 'violet', label: 'Violet', color: '#8B5CF6' },
];

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'contrast', label: 'High contrast' },
];

const densityOptions: { value: DensityMode; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'cozy', label: 'Cozy' },
  { value: 'compact', label: 'Compact' },
];

const fontOptions: { value: FontScale; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
];

const radiusOptions: { value: RadiusMode; label: string }[] = [
  { value: 'sharp', label: 'Sharp' },
  { value: 'soft', label: 'Soft' },
  { value: 'round', label: 'Round' },
];

const composeModeOptions: { value: MailUserSettings['compose']['defaultMode']; label: string }[] = [
  { value: 'rich', label: 'Rich text' },
  { value: 'plain', label: 'Plain text' },
];

const composeFontOptions: { value: MailUserSettings['compose']['defaultFont']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
];

const previewPaneOptions: { value: MailUserSettings['reading']['previewPane']; label: string }[] = [
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'off', label: 'Off' },
];

const externalImageOptions: { value: MailUserSettings['reading']['externalImages']; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'trusted', label: 'Trusted' },
  { value: 'always', label: 'Always' },
];

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  const normalizedTab = normalizeSettingsTab(activeTab);

  return (
    <>
      {navGroups.map(group => (
        <div key={group.title} className="settings-nav-group">
          <div className="sidebar-section-title">{group.title}</div>
          {group.items.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.tab}
                type="button"
                className={`nav-item settings-nav-item ${normalizedTab === item.tab ? 'active' : ''}`}
                onClick={() => onTabChange(item.tab)}
              >
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function SettingsContent(props: SettingsContentProps) {
  const activeTab = normalizeSettingsTab(props.activeTab);
  let content: ReactNode;

  if (activeTab === 'appearance') content = <AppearancePane {...props} />;
  else if (activeTab === 'mail_identity') content = <MailIdentityPane {...props} />;
  else if (activeTab === 'mail_signatures') content = <SignaturesPane {...props} />;
  else if (activeTab === 'mail_reading') content = <MailReadingPane {...props} />;
  else if (activeTab === 'mail_forwarding') content = <ForwardingPane {...props} />;
  else if (activeTab === 'mail_vacation') content = <VacationPane {...props} />;
  else if (activeTab === 'mail_filters') content = <FiltersPane {...props} />;
  else if (activeTab === 'mail_spam') content = <MailSpamPane />;
  else if (activeTab === 'calendar_defaults') content = <CalendarPane {...props} />;
  else if (activeTab === 'contacts_display') content = <ContactsPane {...props} />;
  else if (activeTab === 'sync_devices') content = <SyncDevicesPane {...props} />;
  else if (activeTab === 'account_password') content = <AccountPasswordPane {...props} />;
  else content = <AdvancedPane />;

  return (
    <div className="settings-content-stack">
      {props.settingsSyncError && (
        <div className="settings-error-banner" role="status">
          {props.settingsSyncError}
        </div>
      )}
      {content}
    </div>
  );
}

function SettingsHeader({ title, eyebrow, action }: { title: string; eyebrow: string; action?: ReactNode }) {
  return (
    <div className="settings-page-header">
      <div>
        <div className="settings-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function AppearancePane({ appearance, onAppearanceChange }: SettingsContentProps) {
  const updateAppearance = (updates: Partial<AppearancePreferences>) => {
    onAppearanceChange({ ...appearance, ...updates });
  };

  const applyPreset = (preset: 'starship' | 'fish' | 'ghostty') => {
    const presets: Record<typeof preset, Partial<AppearancePreferences>> = {
      starship: { themeMode: 'dark', accentColor: 'violet', density: 'compact', radius: 'sharp' },
      fish: { themeMode: 'dark', accentColor: 'cyan', density: 'cozy', radius: 'soft' },
      ghostty: { themeMode: 'contrast', accentColor: 'green', density: 'compact', radius: 'sharp' },
    };
    updateAppearance(presets[preset]);
  };

  return (
    <div className="settings-page">
      <SettingsHeader title="Appearance" eyebrow="Personalization" />

      <div className="settings-grid">
        <section className="settings-section">
          <h3>Theme</h3>
          <SegmentedControl options={themeOptions} value={appearance.themeMode} onChange={value => updateAppearance({ themeMode: value })} />
        </section>

        <section className="settings-section">
          <h3>Accent</h3>
          <div className="swatch-grid">
            {accentOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className={`color-swatch ${appearance.accentColor === option.value ? 'active' : ''}`}
                style={{ background: option.color }}
                onClick={() => updateAppearance({ accentColor: option.value })}
                title={option.label}
                aria-label={option.label}
              >
                {appearance.accentColor === option.value && <Check size={16} />}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Density</h3>
          <SegmentedControl options={densityOptions} value={appearance.density} onChange={value => updateAppearance({ density: value })} />
        </section>

        <section className="settings-section">
          <h3>Type Size</h3>
          <SegmentedControl options={fontOptions} value={appearance.fontScale} onChange={value => updateAppearance({ fontScale: value })} />
        </section>

        <section className="settings-section">
          <h3>Shape</h3>
          <SegmentedControl options={radiusOptions} value={appearance.radius} onChange={value => updateAppearance({ radius: value })} />
        </section>

        <section className="settings-section">
          <h3>Motion</h3>
          <label className="settings-toggle-row">
            <span>Reduce motion</span>
            <input
              type="checkbox"
              checked={appearance.reduceMotion}
              onChange={event => updateAppearance({ reduceMotion: event.target.checked })}
            />
          </label>
        </section>
      </div>

      <section className="settings-section">
        <h3>Profiles</h3>
        <div className="settings-card-grid">
          <button type="button" className="settings-choice-card" onClick={() => applyPreset('starship')}>
            <strong>Starship</strong>
            <span>Compact, sharp, violet.</span>
          </button>
          <button type="button" className="settings-choice-card" onClick={() => applyPreset('fish')}>
            <strong>Fish</strong>
            <span>Readable, cyan, soft.</span>
          </button>
          <button type="button" className="settings-choice-card" onClick={() => applyPreset('ghostty')}>
            <strong>Ghostty</strong>
            <span>High contrast, compact, green.</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function MailIdentityPane({ mailSettings, availableSenders, setupMailboxAddress, onMailSettingsChange }: SettingsContentProps) {
  const updateMail = (updates: Partial<MailUserSettings>) => {
    onMailSettingsChange({ ...mailSettings, ...updates });
  };

  const updateIdentity = (updates: Partial<MailUserSettings['identity']>) => {
    updateMail({ identity: { ...mailSettings.identity, ...updates } });
  };

  const updateCompose = (updates: Partial<MailUserSettings['compose']>) => {
    updateMail({ compose: { ...mailSettings.compose, ...updates } });
  };

  const senders = availableSenders.length > 0 ? availableSenders : [setupMailboxAddress];

  return (
    <div className="settings-page">
      <SettingsHeader title="Identity & Compose" eyebrow="Mail" />

      <div className="settings-grid">
        <section className="settings-section">
          <h3>Send As</h3>
          <label className="settings-field">
            <span>Default From</span>
            <select className="glass-input glass-select" value={mailSettings.identity.defaultFrom} onChange={event => updateIdentity({ defaultFrom: event.target.value })}>
              <option value="">Use account default</option>
              {senders.map(sender => <option key={sender} value={sender}>{sender}</option>)}
            </select>
          </label>
          <label className="settings-field">
            <span>Reply-To</span>
            <input className="glass-input" value={mailSettings.identity.replyTo} onChange={event => updateIdentity({ replyTo: event.target.value })} placeholder="Optional reply-to address" />
          </label>
          <label className="settings-toggle-row">
            <span>Always Bcc myself</span>
            <input type="checkbox" checked={mailSettings.identity.alwaysBccSelf} onChange={event => updateIdentity({ alwaysBccSelf: event.target.checked })} />
          </label>
        </section>

        <section className="settings-section">
          <h3>Compose</h3>
          <SegmentedControl options={composeModeOptions} value={mailSettings.compose.defaultMode} onChange={value => updateCompose({ defaultMode: value })} />
          <label className="settings-field">
            <span>Default Font</span>
            <SegmentedControl options={composeFontOptions} value={mailSettings.compose.defaultFont} onChange={value => updateCompose({ defaultFont: value })} />
          </label>
          <label className="settings-field">
            <span>Undo Send</span>
            <select className="glass-input glass-select" value={mailSettings.compose.undoSendSeconds} onChange={event => updateCompose({ undoSendSeconds: Number(event.target.value) as MailUserSettings['compose']['undoSendSeconds'] })}>
              <option value={0}>Off</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={20}>20 seconds</option>
              <option value={30}>30 seconds</option>
            </select>
          </label>
          <label className="settings-toggle-row">
            <span>Attachment reminder</span>
            <input type="checkbox" checked={mailSettings.compose.attachmentReminder} onChange={event => updateCompose({ attachmentReminder: event.target.checked })} />
          </label>
        </section>
      </div>
    </div>
  );
}

function SignaturesPane({ signatures, onAddSignature, onUpdateSignatures }: SettingsContentProps) {
  return (
    <div className="settings-page">
      <SettingsHeader
        title="Signatures"
        eyebrow="Mail"
        action={<button className="btn btn-ghost" type="button" onClick={onAddSignature}><Plus size={18} /> New Signature</button>}
      />

      <section className="settings-section">
        {signatures.length === 0 ? (
          <div className="empty-state" style={{ padding: '30px' }}>
            <p>No signatures created yet.</p>
          </div>
        ) : (
          <div className="rules-list">
            {signatures.map(sig => (
              <div key={sig.id} className="condition-row signature-editor">
                <div className="signature-editor-header">
                  <div className="signature-name-row">
                    <input
                      className="rule-name-input"
                      value={sig.name}
                      onChange={event => {
                        onUpdateSignatures(signatures.map(item => item.id === sig.id ? { ...item, name: event.target.value } : item));
                      }}
                      placeholder="Signature name"
                    />
                    {sig.isDefault && <span className="settings-status-pill">Default</span>}
                    {sig.defaultForNew && <span className="settings-status-pill">New</span>}
                    {sig.defaultForReply && <span className="settings-status-pill">Reply</span>}
                  </div>
                  <div className="settings-action-row">
                    {!sig.isDefault && (
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => onUpdateSignatures(signatures.map(item => ({ ...item, isDefault: item.id === sig.id })))}
                      >
                        Set Default
                      </button>
                    )}
                    {!sig.defaultForNew && (
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => onUpdateSignatures(signatures.map(item => ({ ...item, defaultForNew: item.id === sig.id })))}
                      >
                        New
                      </button>
                    )}
                    {!sig.defaultForReply && (
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => onUpdateSignatures(signatures.map(item => ({ ...item, defaultForReply: item.id === sig.id })))}
                      >
                        Reply
                      </button>
                    )}
                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() => {
                        const next = signatures.filter(item => item.id !== sig.id);
                        if (sig.isDefault && next.length > 0) next[0] = { ...next[0], isDefault: true };
                        onUpdateSignatures(next);
                      }}
                      title="Delete signature"
                      aria-label="Delete signature"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <textarea
                  className="glass-input"
                  placeholder="--&#10;Name&#10;Title"
                  value={sig.content}
                  onChange={event => {
                    onUpdateSignatures(signatures.map(item => item.id === sig.id ? { ...item, content: event.target.value } : item));
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MailReadingPane({ mailSettings, onMailSettingsChange }: SettingsContentProps) {
  const updateReading = (updates: Partial<MailUserSettings['reading']>) => {
    onMailSettingsChange({
      ...mailSettings,
      reading: {
        ...mailSettings.reading,
        ...updates,
      },
    });
  };

  return (
    <div className="settings-page">
      <SettingsHeader title="Reading" eyebrow="Mail" />

      <div className="settings-grid">
        <section className="settings-section">
          <h3>Conversation View</h3>
          <label className="settings-toggle-row">
            <span>Group messages by conversation</span>
            <input type="checkbox" checked={mailSettings.reading.threaded} onChange={event => updateReading({ threaded: event.target.checked })} />
          </label>
          <label className="settings-toggle-row">
            <span>Show message snippets</span>
            <input type="checkbox" checked={mailSettings.reading.snippets} onChange={event => updateReading({ snippets: event.target.checked })} />
          </label>
        </section>

        <section className="settings-section">
          <h3>Layout</h3>
          <SegmentedControl
            options={densityOptions}
            value={mailSettings.reading.density}
            onChange={value => updateReading({ density: value })}
          />
          <label className="settings-field">
            <span>Preview Pane</span>
            <SegmentedControl
              options={previewPaneOptions}
              value={mailSettings.reading.previewPane}
              onChange={value => updateReading({ previewPane: value })}
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>Privacy & Read State</h3>
          <label className="settings-field">
            <span>External Images</span>
            <SegmentedControl
              options={externalImageOptions}
              value={mailSettings.reading.externalImages}
              onChange={value => updateReading({ externalImages: value })}
            />
          </label>
          <label className="settings-field">
            <span>Mark Read After</span>
            <select className="glass-input glass-select" value={mailSettings.reading.markReadDelaySeconds} onChange={event => updateReading({ markReadDelaySeconds: Number(event.target.value) as MailUserSettings['reading']['markReadDelaySeconds'] })}>
              <option value={0}>Immediately</option>
              <option value={1}>1 second</option>
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
            </select>
          </label>
          <div className="settings-disabled-note">Preview-pane and external-image behavior are stored now; the message viewer wiring is a follow-up pass.</div>
        </section>
      </div>
    </div>
  );
}

function ForwardingPane({ forwardingGoto, saving, onForwardingChange, onSaveForwarding }: SettingsContentProps) {
  return (
    <div className="settings-page">
      <SettingsHeader
        title="Forwarding"
        eyebrow="Mail"
        action={<button className="btn btn-primary" type="button" onClick={onSaveForwarding} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>}
      />
      <section className="settings-section">
        <label className="settings-field">
          <span>Forward To</span>
          <input
            className="glass-input"
            placeholder="personal@example.com, work@example.com"
            value={forwardingGoto}
            onChange={event => onForwardingChange(event.target.value)}
          />
        </label>
      </section>
    </div>
  );
}

function VacationPane({ vacationSettings, onUpdateVacationSettings, saving, onSaveRules }: SettingsContentProps) {
  return (
    <div className="settings-page">
      <SettingsHeader
        title="Auto-Responder"
        eyebrow="Mail"
        action={<button className="btn btn-primary" type="button" onClick={onSaveRules} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>}
      />
      <section className="settings-section">
        <label className="settings-field">
          <span>Enable Auto-Responder</span>
          <input
            type="checkbox"
            checked={vacationSettings.enabled}
            onChange={event => onUpdateVacationSettings({ ...vacationSettings, enabled: event.target.checked })}
          />
        </label>
        {vacationSettings.enabled && (
          <>
            <label className="settings-field">
              <span>Subject (Optional)</span>
              <input
                className="glass-input"
                placeholder="Out of office"
                value={vacationSettings.subject || ''}
                onChange={event => onUpdateVacationSettings({ ...vacationSettings, subject: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>Message Body</span>
              <textarea
                className="glass-input"
                style={{ minHeight: '150px' }}
                placeholder="I am currently out of the office and will reply when I return."
                value={vacationSettings.body}
                onChange={event => onUpdateVacationSettings({ ...vacationSettings, body: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>Reply Interval (Days)</span>
              <input
                type="number"
                min="1"
                className="glass-input"
                value={vacationSettings.days || 1}
                onChange={event => onUpdateVacationSettings({ ...vacationSettings, days: parseInt(event.target.value, 10) || 1 })}
              />
            </label>
            <div className="settings-disabled-note">
              The reply interval ensures that the same sender will only receive the auto-responder once every X days.
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function FiltersPane({ loading, saving, rules, folders, onAddRule, onUpdateRule, onDeleteRule, onSaveRules }: SettingsContentProps) {
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  
  const activeRule = rules.find(r => r.id === activeRuleId) || rules[0];

  return (
    <div className="settings-page filters-pane">
      <SettingsHeader
        title="Filters"
        eyebrow="Mail"
        action={(
          <div className="settings-action-row">
            <button className="btn btn-ghost" type="button" onClick={onAddRule}><Plus size={18} /> Add Rule</button>
            <button className="btn btn-primary" type="button" onClick={onSaveRules} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        )}
      />

      {loading ? (
        <div className="empty-state">Loading rules...</div>
      ) : rules.length === 0 ? (
        <div className="empty-state glass-panel">
          <Filter className="empty-icon" />
          <h3>No Filter Rules</h3>
          <button className="btn btn-ghost mt-4" type="button" onClick={onAddRule}>Create Rule</button>
        </div>
      ) : (
        <div className="settings-three-pane">
          <div className="settings-list-pane">
            {rules.map(rule => (
              <button
                key={rule.id}
                type="button"
                className={`settings-list-item ${activeRule?.id === rule.id ? 'active' : ''}`}
                onClick={() => setActiveRuleId(rule.id)}
              >
                {rule.name || 'Untitled Rule'}
              </button>
            ))}
          </div>
          <div className="settings-detail-pane">
            {activeRule && (
              <RuleEditor
                key={activeRule.id}
                rule={activeRule}
                folders={folders}
                onUpdate={updates => onUpdateRule(activeRule.id, updates)}
                onDelete={() => {
                  onDeleteRule(activeRule.id);
                  setActiveRuleId(null);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MailSpamPane() {
  return (
    <div className="settings-page">
      <SettingsHeader title="Spam & Senders" eyebrow="Mail" />
      <section className="settings-section">
        <h3>User Sender Lists</h3>
        <div className="settings-readonly-grid">
          <ReadonlySetting label="Blocked senders" value="Planned" />
          <ReadonlySetting label="Safe senders" value="Planned" />
          <ReadonlySetting label="Strict filtering" value="Admin policy" />
        </div>
      </section>
    </div>
  );
}

function CalendarPane({ setupValues, calendarSettings, calendars, onCalendarSettingsChange }: SettingsContentProps) {
  const updateCalendar = (updates: Partial<CalendarUserSettings>) => {
    onCalendarSettingsChange({ ...calendarSettings, ...updates });
  };

  return (
    <div className="settings-page">
      <SettingsHeader title="Calendar" eyebrow="Calendar" />
      <div className="settings-grid">
        <section className="settings-section">
          <h3>Defaults</h3>
          <label className="settings-field">
            <span>Default Calendar</span>
            <select className="glass-input glass-select" value={calendarSettings.defaultCalendarId ?? ''} onChange={event => updateCalendar({ defaultCalendarId: event.target.value ? Number(event.target.value) : null })}>
              <option value="">First visible calendar</option>
              {calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
            </select>
          </label>
          <label className="settings-field">
            <span>Default View</span>
            <SegmentedControl
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
                { value: 'year', label: 'Year' },
              ]}
              value={calendarSettings.defaultView}
              onChange={value => updateCalendar({ defaultView: value })}
            />
          </label>
          <label className="settings-field">
            <span>Event Duration</span>
            <input className="glass-input" type="number" min={5} max={480} value={calendarSettings.defaultEventDurationMinutes} onChange={event => updateCalendar({ defaultEventDurationMinutes: Number(event.target.value) })} />
          </label>
        </section>

        <section className="settings-section">
          <h3>Time & Reminders</h3>
          <label className="settings-field">
            <span>Week Starts On</span>
            <select className="glass-input glass-select" value={calendarSettings.weekStartsOn} onChange={event => updateCalendar({ weekStartsOn: Number(event.target.value) as CalendarUserSettings['weekStartsOn'] })}>
              <option value={0}>Sunday</option>
              <option value={1}>Monday</option>
              <option value={6}>Saturday</option>
            </select>
          </label>
          <label className="settings-field">
            <span>Clock Format</span>
            <SegmentedControl
              options={[
                { value: '12h', label: '12 Hour (AM/PM)' },
                { value: '24h', label: '24 Hour' },
              ]}
              value={calendarSettings.clockFormat || '12h'}
              onChange={value => updateCalendar({ clockFormat: value as '12h' | '24h' })}
            />
          </label>
          <label className="settings-field">
            <span>Time Zone</span>
            <select className="glass-input glass-select" value={calendarSettings.timeZone} onChange={event => updateCalendar({ timeZone: event.target.value })}>
              {((Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [Intl.DateTimeFormat().resolvedOptions().timeZone]).map((tz: string) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>Default Reminder</span>
            <select className="glass-input glass-select" value={calendarSettings.defaultReminderMinutes} onChange={event => updateCalendar({ defaultReminderMinutes: Number(event.target.value) as CalendarUserSettings['defaultReminderMinutes'] })}>
              <option value={0}>None</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={1440}>1 day</option>
            </select>
          </label>
        </section>
      </div>
      <section className="settings-section">
        <h3>CalDAV</h3>
        <code className="settings-code-row">{setupValues.caldavDiscoveryUrl}</code>
      </section>
    </div>
  );
}

function ContactsPane({ setupValues, contactsSettings, onContactsSettingsChange }: SettingsContentProps) {
  const updateContacts = (updates: Partial<ContactsUserSettings>) => {
    onContactsSettingsChange({ ...contactsSettings, ...updates });
  };

  return (
    <div className="settings-page">
      <SettingsHeader title="Contacts" eyebrow="Contacts" />
      <div className="settings-grid">
        <section className="settings-section">
          <h3>Display</h3>
          <label className="settings-field">
            <span>Name Format</span>
            <SegmentedControl
              options={[
                { value: 'firstLast', label: 'First Last' },
                { value: 'lastFirst', label: 'Last, First' },
              ]}
              value={contactsSettings.nameFormat}
              onChange={value => updateContacts({ nameFormat: value })}
            />
          </label>
          <label className="settings-field">
            <span>Sort By</span>
            <SegmentedControl
              options={[
                { value: 'firstName', label: 'First Name' },
                { value: 'lastName', label: 'Last Name' },
                { value: 'email', label: 'Email' },
              ]}
              value={contactsSettings.sortBy}
              onChange={value => updateContacts({ sortBy: value })}
            />
          </label>
          <label className="settings-field">
            <span>List Density</span>
            <SegmentedControl
              options={densityOptions}
              value={contactsSettings.listDensity}
              onChange={value => updateContacts({ listDensity: value })}
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>Collection</h3>
          <label className="settings-toggle-row">
            <span>Auto-create contacts from sent mail</span>
            <input type="checkbox" checked={contactsSettings.autoCreateFromSent} onChange={event => updateContacts({ autoCreateFromSent: event.target.checked })} />
          </label>
          <div className="settings-disabled-note">Auto-create is stored now; send-flow contact collection needs a later backend pass.</div>
        </section>
      </div>
      <section className="settings-section">
        <h3>CardDAV</h3>
        <code className="settings-code-row">{setupValues.carddavDiscoveryUrl}</code>
      </section>
    </div>
  );
}

function SyncDevicesPane({ setupValues, setupMailboxAddress, copiedSetupField, onCopySetupValue }: SettingsContentProps) {
  const rows = [
    ['Username', setupMailboxAddress, 'settings-username'],
    ['IMAP', `${setupValues.mailHost}:${setupValues.imapPort}`, 'settings-imap'],
    ['SMTP', `${setupValues.mailHost}:${setupValues.smtpPort}`, 'settings-smtp'],
    ['ActiveSync', setupValues.activeSyncUrl, 'settings-activesync'],
    ['CalDAV', setupValues.caldavDiscoveryUrl, 'settings-caldav'],
    ['CardDAV', setupValues.carddavDiscoveryUrl, 'settings-carddav'],
  ] as const;

  return (
    <div className="settings-page">
      <SettingsHeader title="Sync & Devices" eyebrow="Devices" />
      <section className="settings-section">
        <div className="settings-sync-grid">
          {rows.map(([label, value, key]) => (
            <div className="settings-copy-row" key={key}>
              <div>
                <span>{label}</span>
                <code>{value}</code>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onCopySetupValue(key, value)}
                title={`Copy ${label}`}
                aria-label={`Copy ${label}`}
              >
                {copiedSetupField === key ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountPasswordPane({ passwords, onPasswordChange }: SettingsContentProps) {
  const mismatch = passwords.new && passwords.confirm && passwords.new !== passwords.confirm;

  return (
    <div className="settings-page">
      <SettingsHeader title="Password" eyebrow="Account & Security" />
      <section className="settings-section">
        <div className="settings-disabled-note">
          Password changes need a backend endpoint before this control can be enabled.
        </div>
        <div className="settings-form-grid">
          <label className="settings-field">
            <span>Current Password</span>
            <input type="password" className="glass-input" value={passwords.current} onChange={event => onPasswordChange({ ...passwords, current: event.target.value })} disabled />
          </label>
          <label className="settings-field">
            <span>New Password</span>
            <input type="password" className="glass-input" value={passwords.new} onChange={event => onPasswordChange({ ...passwords, new: event.target.value })} disabled />
          </label>
          <label className="settings-field">
            <span>Confirm New Password</span>
            <input type="password" className="glass-input" value={passwords.confirm} onChange={event => onPasswordChange({ ...passwords, confirm: event.target.value })} disabled />
            {mismatch && <small>Passwords do not match.</small>}
          </label>
        </div>
      </section>
    </div>
  );
}

function AdvancedPane() {
  return (
    <div className="settings-page">
      <SettingsHeader title="Advanced" eyebrow="Power User" />
      <section className="settings-section">
        <div className="settings-readonly-grid">
          <ReadonlySetting label="Raw Sieve editor" value="Planned" />
          <ReadonlySetting label="Search index controls" value="Planned" />
          <ReadonlySetting label="Settings export" value="Planned" />
          <ReadonlySetting label="Diagnostics" value="Planned" />
        </div>
      </section>
    </div>
  );
}

function ReadonlySetting({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-readonly-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SegmentedControl<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="segmented-control">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RuleEditor({ rule, folders, onUpdate, onDelete }: { rule: Rule; folders: MailFolder[]; onUpdate: (r: Partial<Rule>) => void; onDelete: () => void }) {
  const addCriteria = () => {
    onUpdate({
      criteria: [...rule.criteria, { id: Math.random().toString(), field: 'subject', operator: 'contains', value: '' }],
    });
  };

  const updateCriteria = (id: string, field: string, value: string) => {
    onUpdate({
      criteria: rule.criteria.map(c => c.id === id ? { ...c, [field]: value } : c),
    });
  };

  const removeCriteria = (id: string) => {
    onUpdate({ criteria: rule.criteria.filter(c => c.id !== id) });
  };

  const addAction = () => {
    onUpdate({
      actions: [...rule.actions, { id: Math.random().toString(), type: 'move', folder: folders[0]?.path || 'INBOX' }],
    });
  };

  const updateAction = (id: string, field: string, value: string) => {
    onUpdate({
      actions: rule.actions.map(a => a.id === id ? { ...a, [field]: value } : a),
    });
  };

  const removeAction = (id: string) => {
    onUpdate({ actions: rule.actions.filter(a => a.id !== id) });
  };

  return (
    <div className="rule-card glass-panel">
      <div className="rule-header">
        <input className="rule-name-input" value={rule.name} onChange={event => onUpdate({ name: event.target.value })} placeholder="Rule Name" />
        <button className="btn btn-danger" type="button" onClick={onDelete} title="Delete Rule">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="builder-section">
        <div className="builder-section-title">
          If
          <select className="glass-input glass-select" value={rule.condition} onChange={event => onUpdate({ condition: event.target.value as 'any' | 'all' })}>
            <option value="any">ANY</option>
            <option value="all">ALL</option>
          </select>
          of these conditions are met:
        </div>

        {rule.criteria.map(criteria => (
          <div key={criteria.id} className="condition-row">
            <select className="glass-input glass-select" value={criteria.field} onChange={event => updateCriteria(criteria.id, 'field', event.target.value)}>
              <option value="subject">Subject</option>
              <option value="from">Sender</option>
              <option value="to">Recipient</option>
              <option value="body">Body</option>
            </select>
            <select className="glass-input glass-select" value={criteria.operator} onChange={event => updateCriteria(criteria.id, 'operator', event.target.value)}>
              <option value="contains">contains</option>
              <option value="not_contains">does not contain</option>
              <option value="equals">equals</option>
            </select>
            <input className="glass-input" value={criteria.value} onChange={event => updateCriteria(criteria.id, 'value', event.target.value)} placeholder="newsletter" />
            <button className="btn btn-ghost" type="button" onClick={() => removeCriteria(criteria.id)} title="Remove condition" aria-label="Remove condition">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost add-row-btn" type="button" onClick={addCriteria}>
          <Plus size={14} /> Add Condition
        </button>
      </div>

      <div className="builder-section">
        <div className="builder-section-title">Then perform these actions:</div>

        {rule.actions.map(action => (
          <div key={action.id} className="action-row">
            <select className="glass-input glass-select" value={action.type} onChange={event => updateAction(action.id, 'type', event.target.value)}>
              <option value="move">Move to Folder</option>
              <option value="reject">Reject with Message</option>
              <option value="discard">Silently Discard</option>
            </select>
            {action.type === 'move' && (
              <select className="glass-input glass-select" value={action.folder || ''} onChange={event => updateAction(action.id, 'folder', event.target.value)}>
                {folders.length === 0 && <option value={action.folder || ''}>{action.folder || 'Loading folders...'}</option>}
                {folders.map(folder => <option key={folder.path} value={folder.path}>{folder.path}</option>)}
              </select>
            )}
            <button className="btn btn-ghost" type="button" onClick={() => removeAction(action.id)} title="Remove action" aria-label="Remove action">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost add-row-btn" type="button" onClick={addAction}>
          <Plus size={14} /> Add Action
        </button>
      </div>
    </div>
  );
}
