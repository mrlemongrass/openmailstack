import { useEffect, useState } from 'react';
import { X, Share2, Pencil, Trash2, Calendar, Mail, MapPin, Phone, Globe, Building2, Briefcase } from 'lucide-react';
import type { Contact } from '../shared/types';
import { ContactQuickActions } from './ContactQuickActions';
import * as api from '../shared/api';

interface ActivityItem {
    subject: string;
    received_at: string;
    snippet: string;
    id: number;
}

interface MeetingItem {
    title: string;
    start: string;
    id: string;
}

export function ContactDetail({ contact, onClose, onEdit, onShare, onDelete }: {
    contact: Contact;
    onClose: () => void;
    onEdit: () => void;
    onShare: () => void;
    onDelete: () => void;
}) {
    const [emails, setEmails] = useState<ActivityItem[]>([]);
    const [meetings, setMeetings] = useState<MeetingItem[]>([]);

    useEffect(() => {
        if (!contact.id) return;
        api.fetchContactActivity(contact.id).then((data) => {
            if (data.emails) setEmails(data.emails);
            if (data.meetings) setMeetings(data.meetings);
        }).catch(() => {});
    }, [contact.id]);

    const initials = (contact.name || contact.email || '?')
        .split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

    const emailItems = contact.emails_json || (contact.email ? [{ value: contact.email, label: 'Primary' }] : []);
    const phoneItems = contact.phones_json || (contact.phone ? [{ value: contact.phone, label: 'Primary' }] : []);
    const addressItems = contact.addresses_json || (contact.address ? [{ value: contact.address, label: 'Primary' }] : []);

    const sectionLabel: React.CSSProperties = {
        fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
        color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: 6,
    };
    const fieldValue: React.CSSProperties = { fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.5 };
    const fieldLabel: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--text-secondary)' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid var(--border-glass)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.1rem', fontWeight: 600, color: 'white', flexShrink: 0 }}>
                        {initials}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{contact.name || contact.email}</div>
                        {contact.job_title && contact.organization && (
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                {contact.job_title} at {contact.organization}
                            </div>
                        )}
                        {contact.job_title && !contact.organization && (
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{contact.job_title}</div>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-ghost" onClick={onShare} style={{ padding: 6 }} title="Share">
                        <Share2 size={16} />
                    </button>
                    <button className="btn btn-ghost" onClick={onEdit} style={{ padding: 6 }} title="Edit">
                        <Pencil size={16} />
                    </button>
                    <button className="btn btn-ghost" onClick={onDelete} style={{ padding: 6 }} title="Delete">
                        <Trash2 size={16} />
                    </button>
                    <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }} title="Close">
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                {/* Quick actions */}
                <div style={{ marginBottom: 20 }}>
                    <ContactQuickActions contact={contact} />
                </div>

                {/* Contact fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {emailItems.length > 0 && (
                        <div>
                            <div style={sectionLabel}><Mail size={12} style={{ marginRight: 4 }} />Email</div>
                            {emailItems.map((item, i) => (
                                <div key={i} style={{ marginBottom: 4 }}>
                                    <a href={`mailto:${item.value}`} style={fieldValue}>{item.value}</a>
                                    {item.label && <span style={fieldLabel}> — {item.label}</span>}
                                </div>
                            ))}
                        </div>
                    )}

                    {phoneItems.length > 0 && (
                        <div>
                            <div style={sectionLabel}><Phone size={12} style={{ marginRight: 4 }} />Phone</div>
                            {phoneItems.map((item, i) => (
                                <div key={i} style={{ marginBottom: 4 }}>
                                    <a href={`tel:${item.value}`} style={fieldValue}>{item.value}</a>
                                    {item.label && <span style={fieldLabel}> — {item.label}</span>}
                                </div>
                            ))}
                        </div>
                    )}

                    {addressItems.length > 0 && (
                        <div>
                            <div style={sectionLabel}><MapPin size={12} style={{ marginRight: 4 }} />Address</div>
                            {addressItems.map((item, i) => (
                                <div key={i} style={{ marginBottom: 4 }}>
                                    <span style={fieldValue}>{item.value}</span>
                                    {item.label && <span style={fieldLabel}> — {item.label}</span>}
                                </div>
                            ))}
                        </div>
                    )}

                    {(contact.organization || contact.department) && (
                        <div>
                            <div style={sectionLabel}><Building2 size={12} style={{ marginRight: 4 }} />Organization</div>
                            <div style={fieldValue}>{contact.organization}{contact.department ? ` — ${contact.department}` : ''}</div>
                        </div>
                    )}

                    {contact.job_title && (
                        <div>
                            <div style={sectionLabel}><Briefcase size={12} style={{ marginRight: 4 }} />Job Title</div>
                            <div style={fieldValue}>{contact.job_title}</div>
                        </div>
                    )}

                    {contact.website_url && (
                        <div>
                            <div style={sectionLabel}><Globe size={12} style={{ marginRight: 4 }} />Website</div>
                            <a href={contact.website_url} target="_blank" rel="noopener noreferrer" style={fieldValue}>{contact.website_url}</a>
                        </div>
                    )}

                    {contact.birthday && (
                        <div>
                            <div style={sectionLabel}><Calendar size={12} style={{ marginRight: 4 }} />Birthday</div>
                            <div style={fieldValue}>{contact.birthday}</div>
                        </div>
                    )}

                    {contact.notes && (
                        <div>
                            <div style={sectionLabel}>Notes</div>
                            <div style={{ ...fieldValue, whiteSpace: 'pre-wrap' }}>{contact.notes}</div>
                        </div>
                    )}
                </div>

                {/* Activity timeline */}
                {(emails.length > 0 || meetings.length > 0) && (
                    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-glass)' }}>
                        <div style={{ ...sectionLabel, marginBottom: 12 }}>Activity</div>
                        {emails.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                                    Recent Emails ({emails.length})
                                </div>
                                {emails.map((e) => (
                                    <div key={e.id} style={{
                                        padding: '6px 0', borderBottom: '1px solid var(--border-glass)',
                                        fontSize: '0.82rem',
                                    }}>
                                        <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>{e.subject}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                                            {e.received_at ? new Date(e.received_at).toLocaleDateString() : ''} — {e.snippet}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {meetings.length > 0 && (
                            <div>
                                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                                    Upcoming Meetings ({meetings.length})
                                </div>
                                {meetings.map((m) => (
                                    <div key={m.id} style={{
                                        padding: '6px 0', borderBottom: '1px solid var(--border-glass)',
                                        fontSize: '0.82rem',
                                    }}>
                                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{m.title}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                                            {m.start ? new Date(m.start).toLocaleDateString() : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
