import { PolicyDraftContext } from './policy-draft-context';
import { createSettingsSaveQueue } from './settings-save-queue';
import { UnsavedChangesGuard } from '../shared/components/UnsavedChangesGuard';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Routes, Route } from 'react-router';
import { SettingsContent, SettingsSidebar } from './SettingsPanel';
import { settingsNavGroups } from './settingsNavigation';
import { normalizeSettingsTab, type SettingsTab } from './tabs';
import {
  getUserSettings,
  saveUserSettings,
  defaultMailSettings,
  defaultCalendarSettings,
  defaultContactsSettings,
  notifyCalendarSettingsChanged,
  type MailUserSettings,
  type CalendarUserSettings,
  type ContactsUserSettings,
} from './settingsApi';
import type { AppearancePreferences } from './appearance';
import { DEFAULT_APPEARANCE, applyAppearancePreferences, saveAppearancePreferences } from './appearance';
import { fetchFolders, fetchRules, fetchIdentities, fetchCalendars } from '../shared/api';
import type { Rule, MailFolder, Signature } from '../shared/types';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SettingsLoader() {
  const { tab } = useParams();
  const [policyDraft, setPolicyDraft] = useState({ dirty: false, busy: false });
  const [routeBlocked, setRouteBlocked] = useState(false);

  // Loading / saving state
  type Resource = 'mail' | 'calendar' | 'contacts' | 'appearance' | 'rules' | 'folders' | 'identities' | 'calendars';
  type LoadState = { status: 'loading' | 'ready' | 'error'; error?: string };
  const [resources, setResources] = useState<Partial<Record<Resource, LoadState>>>({});
  const resourceRequests = useRef<Partial<Record<Resource, number>>>({});
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  const [settingsSyncError, setSettingsSyncError] = useState('');
  const [settingsSaveState, setSettingsSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Settings namespaces
  const [mailSettings, setMailSettings] = useState<MailUserSettings>(defaultMailSettings);
  const [calendarSettings, setCalendarSettings] = useState<CalendarUserSettings>(defaultCalendarSettings);
  const [contactsSettings, setContactsSettings] = useState<ContactsUserSettings>(defaultContactsSettings);
  const [appearance, setAppearance] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);

  // Rules and folders (loaded separately)
  const [rules, setRules] = useState<Rule[]>([]);
  const [rulesDirty, setRulesDirty] = useState(false);
  const rulesRevision = useRef(0);
  const ruleSave = useRef<Promise<boolean> | null>(null);
  const [folders, setFolders] = useState<MailFolder[]>([]);

  // Identities and calendars
  const [availableSenders, setAvailableSenders] = useState<string[]>([]);
  const [setupMailboxAddress, setSetupMailboxAddress] = useState('');
  const [calendars, setCalendars] = useState<{ id: number; name: string }[]>([]);

  // Passwords (cleared after save)
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });

  // Copy setup field feedback
  const [copiedSetupField, setCopiedSetupField] = useState<string | null>(null);

  // Setup values derived from window location
  const setupValues = {
    caldavDiscoveryUrl: `${window.location.origin}/.well-known/caldav`,
    caldavHomeUrl: `${window.location.origin}/.well-known/caldav`,
    carddavDiscoveryUrl: `${window.location.origin}/.well-known/carddav`,
    carddavAddressBookUrl: `${window.location.origin}/.well-known/carddav`,
    activeSyncUrl: `${window.location.origin}/Microsoft-Server-ActiveSync`,
    mailHost: window.location.hostname,
    imapPort: '993',
    smtpPort: '587',
  };

  const saveQueue = useRef(createSettingsSaveQueue());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingSettings, setPendingSettings] = useState(false);
  const flushSettings = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSettingsSaveState('saving');
    setSettingsSyncError('');
    try {
      await saveQueue.current.flush();
      setPendingSettings(saveQueue.current.pending);
      setSettingsSaveState('saved');
      return true;
    } catch (err) {
      setSettingsSaveState('error');
      setSettingsSyncError(errorMessage(err, 'Failed to save settings'));
      return false;
    }
  }, []);
  const debouncedSave = useCallback((key: string, fn: () => Promise<unknown>) => {
    saveQueue.current.schedule(key, fn);
    setPendingSettings(true);
    setSettingsSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSettings(); }, 800);
  }, [flushSettings]);

  // A failed service blocks only the sections that depend on it. Retry never
  // reloads successful namespaces, so pending edits cannot be replaced by GETs.
  const loadResource = useCallback(async (key: Resource) => {
    const request = (resourceRequests.current[key] || 0) + 1;
    resourceRequests.current[key] = request;
    setResources(current => ({ ...current, [key]: { status: 'loading' } }));
    const current = () => mounted.current && resourceRequests.current[key] === request;
    try {
      switch (key) {
        case 'mail': { const value = await getUserSettings('mail'); if (current()) setMailSettings(value); break; }
        case 'calendar': { const value = await getUserSettings('calendar'); if (current()) setCalendarSettings({ ...defaultCalendarSettings, ...value }); break; }
        case 'contacts': { const value = await getUserSettings('contacts'); if (current()) setContactsSettings(value); break; }
        case 'appearance': {
          const value = await getUserSettings('appearance');
          if (current()) { setAppearance(value); applyAppearancePreferences(value); }
          break;
        }
        case 'rules': { const value = await fetchRules(); if (current()) setRules(value); break; }
        case 'folders': { const value = await fetchFolders(); if (current()) setFolders(value); break; }
        case 'identities': {
          const value = await fetchIdentities();
          if (current()) {
            setAvailableSenders([value.address, ...(value.aliases || []).map(alias => alias.address)].filter(Boolean));
            setSetupMailboxAddress(value.address);
          }
          break;
        }
        case 'calendars': { const value = await fetchCalendars(); if (current()) setCalendars((value.calendars || []).map(calendar => ({ id: calendar.id, name: calendar.name }))); break; }
      }
      if (current()) setResources(previous => ({ ...previous, [key]: { status: 'ready' } }));
    } catch (error) {
      if (current()) setResources(previous => ({ ...previous, [key]: { status: 'error', error: errorMessage(error, 'Could not load this section.') } }));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const keys: Resource[] = ['mail', 'calendar', 'contacts', 'appearance', 'rules', 'folders', 'identities', 'calendars'];
    keys.forEach(key => { void loadResource(key); });
    return () => { mounted.current = false; if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [loadResource]);

  const dependencies: Record<SettingsTab, Resource[]> = {
    appearance: ['appearance'], mail_identity: ['mail', 'identities'], mail_signatures: ['mail'],
    mail_reading: ['mail'], mail_filters: ['rules', 'folders'], mail_spam: ['mail'],
    calendar_defaults: ['calendar', 'calendars'], contacts_display: ['contacts'],
    sync_devices: ['identities'], account_password: [], advanced: [],
  };
  const unavailable = dependencies[normalizeSettingsTab(tab)].filter(key => resources[key]?.status !== 'ready');
  const loading = unavailable.some(key => !resources[key] || resources[key]?.status === 'loading');

  // --- Settings change handlers (debounced auto-save) ---
  const handleMailSettingsChange = useCallback((settings: MailUserSettings) => {
    setMailSettings(settings);
    debouncedSave('mail', () => saveUserSettings('mail', settings));
  }, [debouncedSave]);

  const handleCalendarSettingsChange = useCallback((settings: CalendarUserSettings) => {
    setCalendarSettings(settings);
    notifyCalendarSettingsChanged(settings);
    debouncedSave('calendar', () => saveUserSettings('calendar', settings));
  }, [debouncedSave]);

  const handleContactsSettingsChange = useCallback((settings: ContactsUserSettings) => {
    setContactsSettings(settings);
    debouncedSave('contacts', () => saveUserSettings('contacts', settings));
  }, [debouncedSave]);

  const handleAppearanceChange = useCallback((prefs: AppearancePreferences) => {
    setAppearance(prefs);
    applyAppearancePreferences(prefs);
    saveAppearancePreferences(prefs);
    debouncedSave('appearance', () => saveUserSettings('appearance', prefs));
  }, [debouncedSave]);

  // --- Signature handlers (stored inside mailSettings.signatures) ---
  const handleUpdateSignatures = useCallback((newSignatures: Signature[]) => {
    const updated = { ...mailSettings, signatures: newSignatures };
    setMailSettings(updated);
    debouncedSave('mail', () => saveUserSettings('mail', updated));
  }, [mailSettings, debouncedSave]);

  const handleAddSignature = useCallback(() => {
    const newSig: Signature = {
      id: Date.now().toString(),
      name: 'New Signature',
      content: '',
    };
    handleUpdateSignatures([...mailSettings.signatures, newSig]);
  }, [mailSettings.signatures, handleUpdateSignatures]);

  // --- Rule handlers ---
  const handleAddRule = useCallback(() => {
    const newRule: Rule = {
      id: Date.now().toString(),
      name: 'New Rule',
      enabled: true,
      stopProcessing: true,
      condition: 'any',
      criteria: [],
      actions: [],
    };
    setRules((prev) => [...prev, newRule]);
    rulesRevision.current += 1;
    setRulesDirty(true);
    return newRule.id;
  }, []);

  const handleUpdateRule = useCallback((id: string, updates: Partial<Rule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
    rulesRevision.current += 1;
    setRulesDirty(true);
  }, []);

  const handleDeleteRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    rulesRevision.current += 1;
    setRulesDirty(true);
  }, []);

  const handleMoveRule = useCallback((id: string, direction: 'up' | 'down') => {
    setRules((current) => {
      const index = current.findIndex(rule => rule.id === id);
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
      return reordered;
    });
    rulesRevision.current += 1;
    setRulesDirty(true);
  }, []);

  const handleReplaceRules = useCallback((nextRules: Rule[], dirty = true) => {
    setRules(nextRules);
    rulesRevision.current += 1;
    setRulesDirty(dirty);
  }, []);

  const handleSaveRules = useCallback((): Promise<boolean> => {
    if (ruleSave.current) return ruleSave.current;
    const revision = rulesRevision.current;
    ruleSave.current = (async () => {
      setSaving(true);
      setSettingsSyncError('');
      try {
        const response = await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to save rules');
        }
        if (revision !== rulesRevision.current) return false;
        setRulesDirty(false);
        setSettingsSaveState('saved');
        setTimeout(() => setSettingsSaveState('idle'), 2000);
        return true;
      } catch (err: unknown) {
        setSettingsSyncError(errorMessage(err, 'Failed to save rules'));
        setSettingsSaveState('error');
        return false;
      } finally {
        setSaving(false);
        ruleSave.current = null;
      }
    })();
    return ruleSave.current;
  }, [rules]);

  // --- Password handler ---
  const handlePasswordChange = useCallback((pw: { current: string; new: string; confirm: string }) => {
    setPasswords(pw);
  }, []);

  // --- Copy setup value ---
  const handleCopySetupValue = useCallback((fieldKey: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedSetupField(fieldKey);
      setTimeout(() => setCopiedSetupField(null), 2000);
    }).catch(() => {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedSetupField(fieldKey);
      setTimeout(() => setCopiedSetupField(null), 2000);
    });
  }, []);

  return (
    <>
    <UnsavedChangesGuard dirty={pendingSettings || rulesDirty || policyDraft.dirty || policyDraft.busy} locked={saving || policyDraft.busy} onBlockedChange={setRouteBlocked} onSave={policyDraft.dirty ? undefined : async () => {
      if (!await flushSettings()) return false;
      return !rulesDirty || await handleSaveRules();
    }} />
    {pendingSettings && settingsSaveState === 'error' && <button className="btn btn-primary" onClick={() => { void flushSettings(); }}>Retry saving settings</button>}
    <PolicyDraftContext.Provider value={{ setState: setPolicyDraft, routeBlocked }}>
    {unavailable.length > 0 ? <div className="settings-page">
      <h2>{loading ? 'Loading this section…' : 'This section is unavailable'}</h2>
      <p>Other Settings sections are still available.</p>
      {unavailable.map(key => <div key={key} role={resources[key]?.status === 'error' ? 'alert' : 'status'}>
        <p>{key === 'mail' ? 'Mail settings' : key === 'calendars' ? 'Calendar list' : key.charAt(0).toUpperCase() + key.slice(1)}: {resources[key]?.error || 'Loading…'}</p>
        {resources[key]?.status === 'error' && <button className="btn btn-primary" onClick={() => void loadResource(key)}>Retry {key}</button>}
      </div>)}
    </div> : <SettingsContent
      onFlushSettings={flushSettings}
      activeTab={tab || 'appearance'}
      loading={loading}
      saving={saving}
      settingsSyncError={settingsSyncError}
      settingsSaveState={settingsSaveState}
      rules={rules}
      folders={folders}
      signatures={mailSettings.signatures}
      mailSettings={mailSettings}
      calendarSettings={calendarSettings}
      contactsSettings={contactsSettings}
      availableSenders={availableSenders}
      calendars={calendars}
      passwords={passwords}
      appearance={appearance}
      copiedSetupField={copiedSetupField}
      setupValues={setupValues}
      setupMailboxAddress={setupMailboxAddress}
      onAddRule={handleAddRule}
      onUpdateRule={handleUpdateRule}
      onDeleteRule={handleDeleteRule}
      onMoveRule={handleMoveRule}
      onReplaceRules={handleReplaceRules}
      rulesDirty={rulesDirty}
      onSaveRules={handleSaveRules}
      onAddSignature={handleAddSignature}
      onUpdateSignatures={handleUpdateSignatures}
      onMailSettingsChange={handleMailSettingsChange}
      onCalendarSettingsChange={handleCalendarSettingsChange}
      onContactsSettingsChange={handleContactsSettingsChange}
      onPasswordChange={handlePasswordChange}
      onAppearanceChange={handleAppearanceChange}
      onCopySetupValue={handleCopySetupValue}
    />}
    </PolicyDraftContext.Provider>
    </>
  );
}

function SettingsLayout() {
  const { tab } = useParams();
  const navigate = useNavigate();

  const handleTabChange = (newTab: SettingsTab) => {
    navigate(`/settings/${newTab}`);
  };

  const normalizedTab = normalizeSettingsTab(tab);

  return (
    <div className="settings-layout">
      <nav className="settings-desktop-navigation" aria-label="Settings sections">
        <SettingsSidebar activeTab={normalizedTab} onTabChange={handleTabChange} />
      </nav>
      <label className="settings-mobile-navigation mobile-section-navigation">
        <span>Settings section</span>
        <select
          aria-label="Settings section"
          value={normalizedTab}
          onChange={event => handleTabChange(event.target.value as SettingsTab)}
        >
          {settingsNavGroups.map(group => (
            <optgroup key={group.title} label={group.title}>
              {group.items.map(item => <option key={item.tab} value={item.tab}>{item.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="settings-layout-content">
        <SettingsLoader />
      </div>
    </div>
  );
}

export function SettingsRoutes() {
  return (
    <Routes>
      <Route path=":tab?" element={<SettingsLayout />} />
    </Routes>
  );
}
