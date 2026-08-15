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

  // Loading / saving state
  const [loading, setLoading] = useState(true);
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

  // --- Debounced auto-save helpers ---
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const debouncedSave = useCallback((key: string, fn: () => void, delay = 800) => {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      setSettingsSaveState('saving');
      try {
        await fn();
        setSettingsSaveState('saved');
        setTimeout(() => setSettingsSaveState('idle'), 2000);
      } catch (err: unknown) {
        setSettingsSaveState('error');
        setSettingsSyncError(errorMessage(err, 'Failed to save settings'));
      }
    }, delay);
  }, []);

  // --- Load all data on mount ---
  useEffect(() => {
    let cancelled = false;
    const debounceTimersForCleanup = debounceTimers.current;
    async function load() {
      try {
        setLoading(true);
        setSettingsSyncError('');

        const [mail, calendar, contacts, appearanceData, rulesData, foldersData, identitiesData, calendarsData] =
          await Promise.all([
            getUserSettings('mail'),
            getUserSettings('calendar'),
            getUserSettings('contacts'),
            getUserSettings('appearance'),
            fetchRules(),
            fetchFolders(),
            fetchIdentities(),
            fetchCalendars(),
          ]);

        if (cancelled) return;

        setMailSettings(mail);
        setCalendarSettings({ ...defaultCalendarSettings, ...calendar });
        setContactsSettings(contacts);
        setAppearance(appearanceData);
        applyAppearancePreferences(appearanceData);

        setRules(rulesData);
        setRulesDirty(false);
        setFolders(foldersData);

        const senders = [
          identitiesData.address,
          ...(identitiesData.aliases || []).map((a) => a.address),
        ].filter(Boolean);
        setAvailableSenders(senders);
        setSetupMailboxAddress(identitiesData.address);

        const calList = calendarsData.calendars || [];
        setCalendars(calList.map((c) => ({ id: c.id, name: c.name })));

      } catch (err: unknown) {
        if (!cancelled) {
          setSettingsSyncError(errorMessage(err, 'Failed to load settings'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    return () => {
      cancelled = true;
      Object.values(debounceTimersForCleanup).forEach(clearTimeout);
    };
  }, []);

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
    setRulesDirty(true);
    return newRule.id;
  }, []);

  const handleUpdateRule = useCallback((id: string, updates: Partial<Rule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
    setRulesDirty(true);
  }, []);

  const handleDeleteRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
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
    setRulesDirty(true);
  }, []);

  const handleSaveRules = useCallback(async () => {
    setSaving(true);
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
      setRulesDirty(false);
      setSettingsSaveState('saved');
      setTimeout(() => setSettingsSaveState('idle'), 2000);
    } catch (err: unknown) {
      setSettingsSyncError(errorMessage(err, 'Failed to save rules'));
      setSettingsSaveState('error');
    } finally {
      setSaving(false);
    }
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

  // --- Loading state ---
  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        color: 'var(--text-secondary)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 24,
            height: 24,
            border: '3px solid rgba(255,255,255,0.2)',
            borderTopColor: 'var(--accent-primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 12px',
          }} />
          <p>Loading settings...</p>
        </div>
      </div>
    );
  }

  // --- Error state (only when we have no data at all) ---
  if (settingsSyncError && !mailSettings.identity) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        color: 'var(--danger-color)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <p>Failed to load settings</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 8 }}>
            {settingsSyncError}
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <SettingsContent
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
    />
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
