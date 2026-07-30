import { useRef, useState } from 'react';
import { X, Save } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';
import { useToast } from '../shared/components/Toast';
import { useModalFocus } from '../shared/hooks/useModalFocus';

export function ContactEditModal({ contact, onClose, onSaved }: {
    contact: Contact;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { showToast } = useToast();
    const isNew = !contact.id;
    const [form, setForm] = useState<Partial<Contact>>({ ...contact });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    useModalFocus({ dialogRef, open: true, onClose });

    const handleChange = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            const result = await api.saveContact(form);
            if (result.success) {
                showToast({ type: 'success', message: isNew ? 'Contact created' : 'Contact saved' });
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
        <div
            className="contact-modal-overlay"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) event.preventDefault();
            }}
        >
            <div
                ref={dialogRef}
                className="glass-panel contact-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="contact-dialog-title"
            >
                <div className="contact-dialog-header">
                    <div>
                        <div className="sync-setup-eyebrow">{isNew ? 'New' : 'Edit'} Contact</div>
                        <h3 id="contact-dialog-title">{isNew ? 'Create Contact' : form.name || form.email || 'Edit Contact'}</h3>
                    </div>
                    <button className="btn btn-ghost" aria-label="Close contact editor" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="contact-dialog-body">
                    <div className="contact-name-fields">
                        <div className="settings-field">
                            <label htmlFor="contact-first-name" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>First Name</label>
                            <input id="contact-first-name" className="glass-input" autoFocus value={form.first_name || ''} onChange={(e) => handleChange('first_name', e.target.value)} />
                        </div>
                        <div className="settings-field">
                            <label htmlFor="contact-last-name" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Last Name</label>
                            <input id="contact-last-name" className="glass-input" value={form.last_name || ''} onChange={(e) => handleChange('last_name', e.target.value)} />
                        </div>
                    </div>
                    <div className="settings-field">
                        <label htmlFor="contact-email" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Email</label>
                        <input id="contact-email" className="glass-input" type="email" value={form.email || ''} onChange={(e) => handleChange('email', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="contact-phone" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Phone</label>
                        <input id="contact-phone" className="glass-input" value={form.phone || ''} onChange={(e) => handleChange('phone', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="contact-organization" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Organization</label>
                        <input id="contact-organization" className="glass-input" value={form.organization || ''} onChange={(e) => handleChange('organization', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="contact-job-title" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Job Title</label>
                        <input id="contact-job-title" className="glass-input" value={form.jobTitle || ''} onChange={(e) => handleChange('jobTitle', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="contact-birthday" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Birthday (YYYY-MM-DD)</label>
                        <input id="contact-birthday" className="glass-input" value={form.birthday || ''} onChange={(e) => handleChange('birthday', e.target.value)} placeholder="1990-01-15" />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="contact-notes" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Notes</label>
                        <textarea id="contact-notes" className="glass-input" rows={3} value={form.notes || ''} onChange={(e) => handleChange('notes', e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                    {error && <div className="settings-error-banner">{error}</div>}
                </div>
                <div className="contact-dialog-footer">
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ alignSelf: 'flex-end' }}>
                        <Save size={14} /> {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
