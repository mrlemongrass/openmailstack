import { useState } from 'react';
import { X, Send } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';

export function ContactShareModal({ contact, onClose }: {
    contact: Contact;
    onClose: () => void;
}) {
    const [recipient, setRecipient] = useState('');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleShare = async () => {
        if (!recipient.trim()) return;
        setSending(true);
        setError('');
        try {
            const result = await api.shareContact(contact.id!, recipient.trim(), message || undefined);
            if (result.success) {
                setSent(true);
                // Open mailto compose if vcard data returned
                if (result.vcard) {
                    const mailtoUrl = `mailto:${encodeURIComponent(recipient.trim())}?subject=${encodeURIComponent(result.mailtoSubject || '')}&body=${encodeURIComponent((result.mailtoBody || '') + result.vcard)}`;
                    window.open(mailtoUrl, '_blank');
                }
                setTimeout(onClose, 500);
            } else {
                setError('Failed to share contact');
            }
        } catch {
            setError('Network error');
        }
        setSending(false);
    };

    return (
        <div className="sync-setup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sync-setup-modal glass-panel" style={{ width: 'min(500px, 100%)', maxHeight: 'min(80vh, 500px)' }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sync-setup-header">
                    <div>
                        <div className="sync-setup-eyebrow">Share Contact</div>
                        <h3>{contact.name || contact.email}</h3>
                    </div>
                    <button className="btn btn-ghost" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="sync-setup-body">
                    {sent ? (
                        <div style={{ textAlign: 'center', padding: 20, color: 'var(--success)' }}>
                            Contact shared! Opening email composer...
                        </div>
                    ) : (
                        <>
                            <div className="settings-field">
                                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                                    Recipient Email
                                </label>
                                <input type="email" className="glass-input" placeholder="colleague@example.com"
                                    value={recipient} onChange={(e) => setRecipient(e.target.value)} />
                            </div>
                            <div className="settings-field">
                                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                                    Message (optional)
                                </label>
                                <textarea className="glass-input" rows={3} placeholder="I'd like to share this contact with you."
                                    value={message} onChange={(e) => setMessage(e.target.value)}
                                    style={{ resize: 'vertical' }} />
                            </div>
                            {error && <div className="settings-error-banner">{error}</div>}
                            <button className="btn btn-primary" onClick={handleShare}
                                disabled={!recipient.trim() || sending} style={{ alignSelf: 'flex-end' }}>
                                <Send size={14} /> {sending ? 'Sending...' : 'Share'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
