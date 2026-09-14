import { useState, useRef } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';

export function ContactTrash({ contacts: c }: {
    contacts: {
        trashContacts: Contact[];
        refreshTrash: () => Promise<void>;
        refreshContacts: () => Promise<void>;
        isTrashLoading: boolean;
    };
}) {
    const { showToast } = useToast();
    const lock = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | string | null>(null);

    const mutate = async (operation: () => Promise<unknown>, message: string) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try { await operation(); setDeleteConfirmId(null); await Promise.all([c.refreshTrash(), c.refreshContacts()]); showToast({ type: 'success', message }); }
        catch (err) { setError(err instanceof Error ? err.message : 'The change could not be confirmed. Refresh and check before retrying.'); }
        finally { lock.current = false; setBusy(false); }
    };
    const handleRestore = (id: number | string) => mutate(() => api.restoreContact(id), 'Contact restored');
    const handlePermanentDelete = () => deleteConfirmId === null ? undefined : mutate(() => api.permanentDeleteContact(deleteConfirmId), 'Contact permanently deleted');

    if (c.isTrashLoading) {
        return <div style={{ padding: 24, color: 'var(--text-secondary)', textAlign: 'center' }}>Loading trash...</div>;
    }

    if (c.trashContacts.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: '1rem', marginBottom: 8 }}>Trash is empty</div>
                <div style={{ fontSize: '0.82rem' }}>Deleted contacts appear here for 30 days before permanent removal.</div>
            </div>
        );
    }

    return (
        <>
        {error && <p role="alert">{error}</p>}
        <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                Contacts in trash are automatically deleted after 30 days.
            </div>
            {c.trashContacts.map((contact) => (
                <div key={contact.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', marginBottom: 8,
                    border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-glass)',
                }}>
                    <div>
                        <div style={{ fontWeight: 500 }}>{contact.name || contact.email}</div>
                        {contact.email && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{contact.email}</div>}
                        {contact.deleted_at && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                Deleted {new Date(contact.deleted_at).toLocaleDateString()}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button disabled={busy} className="btn btn-ghost" onClick={() => handleRestore(contact.id!)}
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                            <RotateCcw size={14} /> Restore
                        </button>
                        <button disabled={busy} className="btn btn-danger" onClick={() => setDeleteConfirmId(contact.id!)}
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                            <Trash2 size={14} /> Delete Forever
                        </button>
                    </div>
                </div>
            ))}
        </div>
        <ConfirmDialog
          open={deleteConfirmId !== null}
          title={`Delete “${c.trashContacts.find(item => item.id === deleteConfirmId)?.name || 'contact'}” permanently?`}
          message="This contact will be permanently deleted and cannot be recovered."
          confirmLabel="Delete Forever"
          danger busy={busy}
          onConfirm={handlePermanentDelete}
          onCancel={() => setDeleteConfirmId(null)}
        />
        </>
    );
}
