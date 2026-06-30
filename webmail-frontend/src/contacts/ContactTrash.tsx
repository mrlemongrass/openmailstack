import { RotateCcw, Trash2 } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';

export function ContactTrash({ contacts: c }: {
    contacts: {
        trashContacts: Contact[];
        refreshTrash: () => Promise<void>;
        refreshContacts: () => Promise<void>;
        isTrashLoading: boolean;
    };
}) {
    const handleRestore = async (id: number | string) => {
        await api.restoreContact(id);
        c.refreshTrash();
        c.refreshContacts();
    };

    const handlePermanentDelete = async (id: number | string) => {
        if (!window.confirm('Permanently delete this contact?')) return;
        await api.permanentDeleteContact(id);
        c.refreshTrash();
    };

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
                        <button className="btn btn-ghost" onClick={() => handleRestore(contact.id!)}
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                            <RotateCcw size={14} /> Restore
                        </button>
                        <button className="btn btn-danger" onClick={() => handlePermanentDelete(contact.id!)}
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                            <Trash2 size={14} /> Delete Forever
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
