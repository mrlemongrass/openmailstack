import { Mail, Phone, MapPin } from 'lucide-react';
import type { Contact } from '../shared/types';
import { openCrossSuiteCompose } from '../shared/crossSuiteCompose';

export function ContactQuickActions({ contact }: { contact: Contact }) {
    const primaryEmail = contact.email || contact.emails_json?.[0]?.value || '';
    const primaryPhone = contact.phone || contact.phones_json?.[0]?.value || '';
    const primaryAddress = contact.address || contact.addresses_json?.[0]?.value || '';

    const btnStyle: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '8px 14px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-glass)', background: 'transparent',
        color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.82rem',
        fontFamily: 'inherit', fontWeight: 500,
        textDecoration: 'none',
    };
    const disabledStyle: React.CSSProperties = { ...btnStyle, opacity: 0.35, cursor: 'default' };

    const handleEmailClick = (e: React.MouseEvent) => {
        e.preventDefault();
        openCrossSuiteCompose({ to: primaryEmail });
    };

    return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {primaryEmail ? (
                <button onClick={handleEmailClick} style={btnStyle}>
                    <Mail size={14} /> Email
                </button>
            ) : (
                <span style={disabledStyle}><Mail size={14} /> Email</span>
            )}
            {primaryPhone ? (
                <a href={`tel:${primaryPhone}`} style={btnStyle}>
                    <Phone size={14} /> Call
                </a>
            ) : (
                <span style={disabledStyle}><Phone size={14} /> Call</span>
            )}
            {primaryAddress ? (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(primaryAddress)}`}
                    target="_blank" rel="noopener noreferrer" style={btnStyle}>
                    <MapPin size={14} /> Map
                </a>
            ) : (
                <span style={disabledStyle}><MapPin size={14} /> Map</span>
            )}
        </div>
    );
}
