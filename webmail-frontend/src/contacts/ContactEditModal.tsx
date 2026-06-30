import { useState } from 'react';
import { X, Save } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';

export function ContactEditModal({ contact, onClose, onSaved }: {
    contact: Contact;
    onClose: () => void;
    onSaved: () => void;
}) {
    const isNew = !contact.id;
    const [form, setForm] = useState<Partial<Contact>>({ ...contact });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            const result = await api.saveContact(form);
            if (result.success) {
                onSaved();
                onClose();
            } else {
                setError(result.error || 'Failed to save');
            }
        } catch {
            setError('Network error');
        }
        setSaving(false);
    };

    return (
        <div className="sync-setup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sync-setup-modal glass-panel" style={{ width: 'min(560px, 100%)', maxHeight: 'min(85vh, 700px)' }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sync-setup-header">
                    <div>
                        <div className="sync-setup-eyebrow">{isNew ? 'New' : 'Edit'} Contact</div>
                        <h3>{isNew ? 'Create Contact' : form.name || form.email || 'Edit'}</h3>
                    </div>
                    <button className="btn btn-ghost" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="sync-setup-body" style={{ gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="settings-field">
                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>First Name</label>
                            <input className="glass-input" value={form.first_name || ''} onChange={(e) => handleChange('first_name', e.target.value)} />
                        </div>
                        <div className="settings-field">
                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Last Name</label>
                            <input className="glass-input" value={form.last_name || ''} onChange={(e) => handleChange('last_name', e.target.value)} />
                        </div>
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Email</label>
                        <input className="glass-input" type="email" value={form.email || ''} onChange={(e) => handleChange('email', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Phone</label>
                        <input className="glass-input" value={form.phone || ''} onChange={(e) => handleChange('phone', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Organization</label>
                        <input className="glass-input" value={form.organization || ''} onChange={(e) => handleChange('organization', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Job Title</label>
                        <input className="glass-input" value={form.job_title || ''} onChange={(e) => handleChange('job_title', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Birthday (YYYY-MM-DD)</label>
                        <input className="glass-input" value={form.birthday || ''} onChange={(e) => handleChange('birthday', e.target.value)} placeholder="1990-01-15" />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Notes</label>
                        <textarea className="glass-input" rows={3} value={form.notes || ''} onChange={(e) => handleChange('notes', e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                    {error && <div className="settings-error-banner">{error}</div>}
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ alignSelf: 'flex-end' }}>
                        <Save size={14} /> {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
