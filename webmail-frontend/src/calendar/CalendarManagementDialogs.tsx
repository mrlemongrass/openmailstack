import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Palette, Share2, Trash2 } from 'lucide-react';
import type { Calendar, CalendarShare } from '../shared/types';
import * as api from '../shared/api';
import { useModalFocus } from '../shared/hooks/useModalFocus';

const CALENDAR_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B', '#10B981', '#06B6D4', '#64748B'];
const MAX_CALENDAR_IMPORT_BYTES = 5 * 1024 * 1024;

interface CalendarEditorDialogProps {
  calendar?: Calendar;
  onSave: (calendar: Pick<Calendar, 'name' | 'color'> & { subscribed_url?: string; ics_data?: string }) => Promise<void>;
  onClose: () => void;
}

export function CalendarEditorDialog({ calendar, onSave, onClose }: CalendarEditorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(calendar?.name || '');
  const [color, setColor] = useState(calendar?.color || CALENDAR_COLORS[0]);
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const editing = Boolean(calendar);
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useModalFocus({ dialogRef, open: true, onClose: handleClose });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = subscriptionUrl.trim();
    if (!trimmedName) {
      setError('Enter a calendar name.');
      return;
    }
    if (trimmedUrl) {
      try {
        if (new URL(trimmedUrl).protocol !== 'https:') throw new Error();
      } catch {
        setError('Subscribe from web requires a valid HTTPS calendar URL.');
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      const icsData = importFile ? await importFile.text() : undefined;
      if (icsData !== undefined && !icsData.trim()) {
        throw new Error('The selected .ics file is empty.');
      }
      await onSave({
        name: trimmedName,
        color,
        ...(trimmedUrl ? { subscribed_url: trimmedUrl } : {}),
        ...(icsData !== undefined ? { ics_data: icsData } : {}),
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The calendar could not be saved.');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="mail-dialog-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <div
        ref={dialogRef}
        className="glass-panel mail-folder-dialog calendar-management-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-editor-title"
        aria-describedby="calendar-editor-description"
        aria-busy={saving}
        tabIndex={-1}
      >
        <div className="mail-folder-dialog-heading">
          <span className="mail-folder-dialog-icon"><CalendarPlus size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="calendar-editor-title">{editing ? 'Rename calendar' : 'Add calendar'}</h2>
            <p id="calendar-editor-description">
              {editing ? 'Update the name and color shown throughout Calendar.' : 'Create a calendar, import an .ics file, or subscribe to a published calendar.'}
            </p>
          </div>
        </div>
        <form onSubmit={submit}>
          <label className="mail-folder-dialog-field">
            <span>Calendar name</span>
            <input
              className="glass-input"
              autoFocus
              value={name}
              onChange={event => { setName(event.target.value); if (error) setError(''); }}
              maxLength={255}
              autoComplete="off"
              disabled={saving}
              required
            />
          </label>
          <fieldset className="calendar-color-field" disabled={saving}>
            <legend><Palette size={14} aria-hidden="true" /> Calendar color</legend>
            <div className="calendar-color-options">
              {CALENDAR_COLORS.map(option => (
                <button
                  key={option}
                  type="button"
                  className={`calendar-color-option${color === option ? ' is-selected' : ''}`}
                  style={{ background: option }}
                  aria-label={`Use color ${option}`}
                  aria-pressed={color === option}
                  onClick={() => setColor(option)}
                />
              ))}
              <input
                type="color"
                value={color}
                aria-label="Choose a custom calendar color"
                onChange={event => setColor(event.target.value)}
              />
            </div>
          </fieldset>
          {!editing && (
            <div className="calendar-add-sources">
              <label className="mail-folder-dialog-field">
                <span>Import an .ics file <small>(optional)</small></span>
                <input
                  ref={importInputRef}
                  className="glass-input"
                  type="file"
                  accept=".ics,text/calendar"
                  disabled={saving || Boolean(subscriptionUrl.trim())}
                  onChange={event => {
                    const file = event.target.files?.[0] || null;
                    if (file && file.size > MAX_CALENDAR_IMPORT_BYTES) {
                      event.target.value = '';
                      setImportFile(null);
                      setError('Choose an .ics file smaller than 5 MB.');
                      return;
                    }
                    setImportFile(file);
                    if (file) setSubscriptionUrl('');
                    if (error) setError('');
                  }}
                />
                <small>Copies the events into the new calendar once.</small>
              </label>
              <div className="calendar-add-source-divider" aria-hidden="true">or</div>
              <label className="mail-folder-dialog-field">
                <span>Subscribe from web <small>(optional)</small></span>
                <input
                  className="glass-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/calendar.ics"
                  value={subscriptionUrl}
                  onChange={event => {
                    setSubscriptionUrl(event.target.value);
                    if (event.target.value.trim()) {
                      setImportFile(null);
                      if (importInputRef.current) importInputRef.current.value = '';
                    }
                    if (error) setError('');
                  }}
                  disabled={saving || Boolean(importFile)}
                />
                <small>Keeps a read-only copy updated from the source.</small>
              </label>
            </div>
          )}
          {error && <div className="mail-folder-dialog-error" role="alert">{error}</div>}
          <div className="mail-folder-dialog-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={handleClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add calendar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

interface CalendarSharingDialogProps {
  calendar: Calendar;
  onClose: () => void;
}

export function CalendarSharingDialog({ calendar, onClose }: CalendarSharingDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [shares, setShares] = useState<CalendarShare[]>([]);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useModalFocus({ dialogRef, open: true, onClose: handleClose });

  const refreshShares = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setShares(await api.fetchCalendarShares(calendar.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sharing permissions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [calendar.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshShares(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshShares]);

  const addShare = async (event: React.FormEvent) => {
    event.preventDefault();
    const recipient = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(recipient)) {
      setError('Enter a valid email address.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.shareCalendar(calendar.id, recipient, permission);
      setEmail('');
      await refreshShares();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The calendar could not be shared.');
    } finally {
      setSaving(false);
    }
  };

  const removeShare = async (recipient: string) => {
    setSaving(true);
    setError('');
    try {
      await api.unshareCalendar(calendar.id, recipient);
      await refreshShares();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The sharing permission could not be removed.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="mail-dialog-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <div
        ref={dialogRef}
        className="glass-panel mail-folder-dialog calendar-management-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-sharing-title"
        aria-describedby="calendar-sharing-description"
        aria-busy={loading || saving}
        tabIndex={-1}
      >
        <div className="mail-folder-dialog-heading">
          <span className="mail-folder-dialog-icon"><Share2 size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="calendar-sharing-title">Sharing and permissions</h2>
            <p id="calendar-sharing-description">Choose who can see or change <strong>{calendar.name}</strong>.</p>
          </div>
        </div>
        <form className="calendar-share-form" onSubmit={addShare}>
          <label className="mail-folder-dialog-field">
            <span>Email address</span>
            <input
              className="glass-input"
              type="email"
              value={email}
              onChange={event => { setEmail(event.target.value); if (error) setError(''); }}
              disabled={saving}
              autoComplete="email"
              placeholder="person@example.com"
            />
          </label>
          <label className="mail-folder-dialog-field">
            <span>Permission</span>
            <select
              className="glass-input glass-select"
              value={permission}
              onChange={event => setPermission(event.target.value as 'read' | 'write')}
              disabled={saving}
            >
              <option value="read">Can view</option>
              <option value="write">Can edit</option>
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={saving || !email.trim()}>Share</button>
        </form>
        <div className="calendar-share-list" aria-label="Current sharing permissions">
          {loading && <div className="calendar-share-empty">Loading permissions…</div>}
          {!loading && !error && shares.length === 0 && <div className="calendar-share-empty">Only you can access this calendar.</div>}
          {!loading && shares.map(share => (
            <div key={share.email} className="calendar-share-row">
              <div><strong>{share.email}</strong><span>{share.permission === 'write' ? 'Can edit' : 'Can view'}</span></div>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Remove access for ${share.email}`}
                disabled={saving}
                onClick={() => { void removeShare(share.email); }}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        {error && <div className="mail-folder-dialog-error" role="alert">{error}</div>}
        <div className="mail-folder-dialog-actions">
          {error && !loading && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => { void refreshShares(); }}>Retry</button>}
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
