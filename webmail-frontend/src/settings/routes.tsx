import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Routes, Route } from 'react-router';
import { SettingsContent, SettingsSidebar } from './SettingsPanel';
import { normalizeSettingsTab, type SettingsTab } from './tabs';
import {
  getUserSettings,
  saveUserSettings,
  defaultMailSettings,
  defaultCalendarSettings,
  defaultContactsSettings,
  type MailUserSettings,
  type CalendarUserSettings,
  type ContactsUserSettings,
} from './settingsApi';
import type { AppearancePreferences } from './appearance';
import { DEFAULT_APPEARANCE, applyAppearancePreferences, saveAppearancePreferences } from './appearance';
import { fetchFolders, fetchRules, fetchIdentities, fetchCalendars } from '../shared/api';
import type { Rule, MailFolder, Signature } from '../shared/types';

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
  const [folders, setFolders] = useState<MailFolder[]>([]);

  // Identities and calendars
  const [availableSenders, setAvailableSenders] = useState<string[]>([]);
  const [setupMailboxAddress, setSetupMailboxAddress] = useState('');
  const [calendars, setCalendars] = useState<{ id: number; name: string }[]>([]);

  // Forwarding (loaded from mail settings extra fields)
  const [forwardingGoto, setForwardingGoto] = useState('');
  const [keepCopy, setKeepCopy] = useState(false);

  // Vacation / auto-responder
  const [vacationSettings, setVacationSettings] = useState({
    enabled: false,
    subject: '' as string | undefined,
    body: '',
    days: 1,
  });

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
      } catch (err: any) {
        setSettingsSaveState('error');
        setSettingsSyncError(err.message || 'Failed to save settings');
      }
    }, delay);
  }, []);

  // --- Load all data on mount ---
  useEffect(() => {
    let cancelled = false;
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
        setCalendarSettings(calendar);
        setContactsSettings(contacts);
        setAppearance(appearanceData);
        applyAppearancePreferences(appearanceData);

        setRules(rulesData);
        setFolders(foldersData);

        const senders = [
          identitiesData.address,
          ...(identitiesData.aliases || []).map((a) => a.address),
        ].filter(Boolean);
        setAvailableSenders(senders);
        setSetupMailboxAddress(identitiesData.address);

        const calList = calendarsData.calendars || [];
        setCalendars(calList.map((c: any) => ({ id: c.id, name: c.name })));

        // Forwarding and vacation are extra fields on mail settings (not in the TS type)
        const mailExtra = mail as any;
        if (mailExtra.forwarding) {
          setForwardingGoto(mailExtra.forwarding.goto || '');
          setKeepCopy(!!mailExtra.forwarding.keepCopy);
        }
        if (mailExtra.vacation) {
          setVacationSettings({
            enabled: !!mailExtra.vacation.enabled,
            subject: mailExtra.vacation.subject || '',
            body: mailExtra.vacation.body || '',
            days: mailExtra.vacation.days || 1,
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          setSettingsSyncError(err.message || 'Failed to load settings');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    return () => {
      cancelled = true;
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  // --- Settings change handlers (debounced auto-save) ---
  const handleMailSettingsChange = useCallback((settings: MailUserSettings) => {
    setMailSettings(settings);
    debouncedSave('mail', () => saveUserSettings('mail', settings));
  }, [debouncedSave]);

  const handleCalendarSettingsChange = useCallback((settings: CalendarUserSettings) => {
    setCalendarSettings(settings);
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
    const updated = { ...mailSettings, signatures: newSignatures as any };
    setMailSettings(updated);
    debouncedSave('mail', () => saveUserSettings('mail', updated));
  }, [mailSettings, debouncedSave]);

  const handleAddSignature = useCallback(() => {
    const newSig: Signature = {
      id: Date.now().toString(),
      name: 'New Signature',
      content: '',
    };
    handleUpdateSignatures([...mailSettings.signatures, newSig as any]);
  }, [mailSettings.signatures, handleUpdateSignatures]);

  // --- Rule handlers ---
  const handleAddRule = useCallback(() => {
    const newRule: Rule = {
      id: Date.now().toString(),
      name: 'New Rule',
      enabled: true,
      condition: 'any',
      criteria: [],
      actions: [],
    };
    setRules((prev) => [...prev, newRule]);
  }, []);

  const handleUpdateRule = useCallback((id: string, updates: Partial<Rule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  }, []);

  const handleDeleteRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleSaveRules = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      setSettingsSaveState('saved');
      setTimeout(() => setSettingsSaveState('idle'), 2000);
    } catch (err: any) {
      setSettingsSyncError(err.message || 'Failed to save rules');
      setSettingsSaveState('error');
    } finally {
      setSaving(false);
    }
  }, [rules]);

  // --- Forwarding handlers ---
  const handleForwardingChange = useCallback((value: string) => {
    setForwardingGoto(value);
  }, []);

  const handleKeepCopyChange = useCallback((value: boolean) => {
    setKeepCopy(value);
  }, []);

  const handleSaveForwarding = useCallback(async () => {
    setSaving(true);
    try {
      const mailWithForwarding = {
        ...mailSettings,
        forwarding: { goto: forwardingGoto, keepCopy },
      };
      await saveUserSettings('mail', mailWithForwarding as any);
      setSettingsSaveState('saved');
      setTimeout(() => setSettingsSaveState('idle'), 2000);
    } catch (err: any) {
      setSettingsSyncError(err.message || 'Failed to save forwarding');
    } finally {
      setSaving(false);
    }
  }, [mailSettings, forwardingGoto, keepCopy]);

  // --- Vacation handler ---
  const handleUpdateVacationSettings = useCallback((vs: {
    enabled: boolean;
    subject?: string;
    body: string;
    days?: number;
  }) => {
    setVacationSettings({
      enabled: vs.enabled,
      subject: vs.subject,
      body: vs.body,
      days: vs.days || 1,
    });
  }, []);

  const handleSaveVacation = useCallback(async () => {
    setSaving(true);
    try {
      const mailWithVacation = {
        ...mailSettings,
        vacation: {
          enabled: vacationSettings.enabled,
          subject: vacationSettings.subject,
          body: vacationSettings.body,
          days: vacationSettings.days || 1,
        },
      };
      await saveUserSettings('mail', mailWithVacation as any);
      setSettingsSaveState('saved');
      setTimeout(() => setSettingsSaveState('idle'), 2000);
    } catch (err: any) {
      setSettingsSyncError(err.message || 'Failed to save vacation');
      setSettingsSaveState('error');
    } finally {
      setSaving(false);
    }
  }, [mailSettings, vacationSettings]);

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
      forwardingGoto={forwardingGoto}
      keepCopy={keepCopy}
      onKeepCopyChange={handleKeepCopyChange}
      passwords={passwords}
      appearance={appearance}
      copiedSetupField={copiedSetupField}
      setupValues={setupValues}
      setupMailboxAddress={setupMailboxAddress}
      onAddRule={handleAddRule}
      onUpdateRule={handleUpdateRule}
      onDeleteRule={handleDeleteRule}
      vacationSettings={vacationSettings}
      onUpdateVacationSettings={handleUpdateVacationSettings}
      onSaveRules={handleSaveRules}
      onSaveVacation={handleSaveVacation}
      onAddSignature={handleAddSignature}
      onUpdateSignatures={handleUpdateSignatures}
      onMailSettingsChange={handleMailSettingsChange}
      onCalendarSettingsChange={handleCalendarSettingsChange}
      onContactsSettingsChange={handleContactsSettingsChange}
      onForwardingChange={handleForwardingChange}
      onSaveForwarding={handleSaveForwarding}
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
    <div style={{ flex: 1, display: 'flex' }}>
      <nav style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--border-glass)',
        overflowY: 'auto',
        padding: '12px 8px',
        background: 'var(--bg-glass)',
      }}>
        <SettingsSidebar activeTab={normalizedTab} onTabChange={handleTabChange} />
      </nav>
      <div style={{ flex: 1, overflow: 'auto' }}>
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
