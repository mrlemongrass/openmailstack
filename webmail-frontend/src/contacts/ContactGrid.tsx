import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ContactSkeleton } from './components/ContactSkeleton';
import type { useContacts } from './hooks/useContacts';
import type { Contact } from '../shared/types';

export function ContactGrid({ contacts: c, density }: {
  contacts: ReturnType<typeof useContacts>;
  density: 'compact' | 'cozy' | 'comfortable';
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const cols = 3;
  const rows = Math.ceil(c.contacts.length / cols);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => density === 'compact' ? 160 : density === 'cozy' ? 190 : 220, [density]),
    overscan: 3,
  });

  if (c.isLoading && c.contacts.length === 0) return <ContactSkeleton count={20} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
        <input type="text" className="glass-input" placeholder="Search contacts..."
          value={c.contactSearchQuery} onChange={(e) => c.setContactSearchQuery(e.target.value)}
          style={{ flex: 1, fontSize: '0.85rem' }} />
        <button className="btn btn-ghost" onClick={() => c.setContactViewMode(c.contactViewMode === 'grid' ? 'list' : 'grid')}
          style={{ padding: '6px 10px' }}>
          {c.contactViewMode === 'grid' ? 'List' : 'Grid'}
        </button>
      </div>
      <div ref={parentRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vr) => {
            const startIdx = vr.index * cols;
            const rowContacts = c.contacts.slice(startIdx, startIdx + cols);
            return (
              <div key={vr.key} style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${vr.start}px)`,
                display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16,
              }}>
                {rowContacts.map((contact) => (
                  <ContactCard key={contact.id} contact={contact} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ContactCard({ contact }: { contact: Contact }) {
  const initials = (contact.name || contact.email || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="contact-card glass-panel" style={{ padding: 16, borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.9rem', fontWeight: 600, color: 'white', flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>
            {contact.name || contact.email}
          </div>
          {contact.email && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.email}</div>}
          {contact.phone && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>{contact.phone}</div>}
        </div>
      </div>
    </div>
  );
}
