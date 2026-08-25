import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput, FolderPlus, Pencil, Search } from 'lucide-react';
import type { MailFolder } from '../../shared/types';
import { useModalFocus } from '../../shared/hooks/useModalFocus';
import { useToast } from '../../shared/components/Toast';

interface NewFolderDialogProps {
  parent: string | null;
  onCreate: (parent: string | null, name: string) => Promise<string>;
  onClose: () => void;
}

export function NewFolderDialog({ parent, onCreate, onClose }: NewFolderDialogProps) {
  const { showToast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useModalFocus({ dialogRef, open: true, onClose: handleClose });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a name for the new folder.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onCreate(parent, trimmedName);
      showToast({
        type: 'success',
        message: parent ? `Created ${trimmedName} inside ${parent}` : `Created ${trimmedName}`,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The folder could not be created.');
      setSaving(false);
    }
  };

  const title = parent ? 'New subfolder' : 'New folder';
  return createPortal(
    <div className="mail-dialog-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <div
        ref={dialogRef}
        className="glass-panel mail-folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-folder-title"
        aria-describedby="new-folder-description"
        aria-busy={saving}
        tabIndex={-1}
      >
        <div className="mail-folder-dialog-heading">
          <span className="mail-folder-dialog-icon"><FolderPlus size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="new-folder-title">{title}</h2>
            <p id="new-folder-description">
              {parent ? <>Create inside <strong>{parent}</strong></> : 'Create at the top level of your mailbox'}
            </p>
          </div>
        </div>
        <form onSubmit={submit}>
          <label className="mail-folder-dialog-field">
            <span>Folder name</span>
            <input
              className="glass-input"
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={255}
              autoComplete="off"
              disabled={saving}
              required
            />
          </label>
          {error && <div className="mail-folder-dialog-error" role="alert">{error}</div>}
          <div className="mail-folder-dialog-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={handleClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

interface RenameFolderDialogProps {
  path: string;
  currentName: string;
  parent: string | null;
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
}

export function RenameFolderDialog({
  path,
  currentName,
  parent,
  onRename,
  onClose,
}: RenameFolderDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(currentName);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useModalFocus({ dialogRef, open: true, onClose: handleClose });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a name for the folder.');
      return;
    }
    if (trimmedName === currentName) {
      setError('Enter a different folder name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onRename(trimmedName);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The folder could not be renamed.');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="mail-dialog-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <div
        ref={dialogRef}
        className="glass-panel mail-folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-folder-title"
        aria-describedby="rename-folder-description"
        aria-busy={saving}
        tabIndex={-1}
      >
        <div className="mail-folder-dialog-heading">
          <span className="mail-folder-dialog-icon"><Pencil size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="rename-folder-title">Rename folder</h2>
            <p id="rename-folder-description">
              {parent
                ? <>Keep <strong>{path}</strong> inside <strong>{parent}</strong>.</>
                : <>Keep <strong>{path}</strong> at the top level.</>}
            </p>
          </div>
        </div>
        <form onSubmit={submit}>
          <label className="mail-folder-dialog-field">
            <span>Folder name</span>
            <input
              className="glass-input"
              value={name}
              onFocus={event => event.currentTarget.select()}
              onChange={event => {
                setName(event.target.value);
                if (error) setError('');
              }}
              maxLength={255}
              autoComplete="off"
              disabled={saving}
              required
            />
          </label>
          {error && <div className="mail-folder-dialog-error" role="alert">{error}</div>}
          <div className="mail-folder-dialog-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={handleClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !name.trim() || name.trim() === currentName}
            >
              {saving ? 'Renaming…' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

interface FolderDestinationDialogProps {
  title: string;
  description: string;
  folders: MailFolder[];
  includeTopLevel?: boolean;
  onSelect: (path: string | null) => Promise<void>;
  onClose: () => void;
}

export function FolderDestinationDialog({
  title,
  description,
  folders,
  includeTopLevel = false,
  onSelect,
  onClose,
}: FolderDestinationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [savingPath, setSavingPath] = useState<string | null | undefined>(undefined);
  const saving = savingPath !== undefined;
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useModalFocus({ dialogRef, open: true, onClose: handleClose });

  const filteredFolders = folders.filter(folder => (
    folder.path.toLowerCase().includes(filter.trim().toLowerCase())
  ));
  const chooseDestination = async (path: string | null) => {
    setSavingPath(path);
    setError('');
    try {
      await onSelect(path);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The folder could not be moved.');
      setSavingPath(undefined);
    }
  };

  return createPortal(
    <div className="mail-dialog-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <div
        ref={dialogRef}
        className="glass-panel mail-folder-dialog mail-folder-destination-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-destination-title"
        aria-describedby="folder-destination-description"
        aria-busy={saving}
        tabIndex={-1}
      >
        <div className="mail-folder-dialog-heading">
          <span className="mail-folder-dialog-icon"><FolderInput size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="folder-destination-title">{title}</h2>
            <p id="folder-destination-description">{description}</p>
          </div>
        </div>
        <label className="mail-folder-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            aria-label="Filter folders"
            placeholder="Filter folders…"
            value={filter}
            onChange={event => setFilter(event.target.value)}
            disabled={saving}
          />
        </label>
        <div className="mail-folder-destinations">
          {includeTopLevel && (
            <button
              type="button"
              className="mail-folder-destination"
              disabled={saving}
              onClick={() => void chooseDestination(null)}
            >
              <FolderInput size={16} aria-hidden="true" />
              <span>Top level</span>
              {savingPath === null && <span className="mail-folder-destination-status">Moving…</span>}
            </button>
          )}
          {filteredFolders.map(folder => (
            <button
              key={folder.path}
              type="button"
              className="mail-folder-destination"
              disabled={saving}
              onClick={() => void chooseDestination(folder.path)}
            >
              <FolderInput size={16} aria-hidden="true" />
              <span title={folder.path}>{folder.path}</span>
              {savingPath === folder.path && <span className="mail-folder-destination-status">Moving…</span>}
            </button>
          ))}
          {filteredFolders.length === 0 && !includeTopLevel && (
            <div className="mail-folder-destination-empty">No folders match</div>
          )}
        </div>
        {error && <div className="mail-folder-dialog-error" role="alert">{error}</div>}
        <div className="mail-folder-dialog-actions">
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={handleClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
