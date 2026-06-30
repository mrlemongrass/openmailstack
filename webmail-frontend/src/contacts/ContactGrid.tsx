import { useRef, useCallback, useState } from 'react';
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

  const [showExportMenu, setShowExportMenu] = useState(false);

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
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost" style={{ padding: '6px 10px' }}
            onClick={() => setShowExportMenu(!showExportMenu)}>
            Export
          </button>
          {showExportMenu && (
            <div className="glass-panel" style={{
              position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50,
              padding: 4, minWidth: 160, borderRadius: 'var(--radius-md)',
            }}>
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                onClick={() => { setShowExportMenu(false); window.open('/api/apps/contacts-export?format=vcard', '_blank'); }}>
                Export All (vCard)
              </button>
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                onClick={() => { setShowExportMenu(false); window.open('/api/apps/contacts-export?format=csv', '_blank'); }}>
                Export All (CSV)
              </button>
              {c.selectedContactIds.size > 0 && (
                <>
                  <div style={{ height: 1, background: 'var(--border-glass)', margin: '2px 8px' }} />
                  <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                    onClick={() => {
                      setShowExportMenu(false);
                      const ids = Array.from(c.selectedContactIds).join(',');
                      window.open(`/api/apps/contacts-export?format=vcard&ids=${ids}`, '_blank');
                    }}>
                    Export Selected ({c.selectedContactIds.size}) vCard
                  </button>
                  <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                    onClick={() => {
                      setShowExportMenu(false);
                      const ids = Array.from(c.selectedContactIds).join(',');
                      window.open(`/api/apps/contacts-export?format=csv&ids=${ids}`, '_blank');
                    }}>
                    Export Selected ({c.selectedContactIds.size}) CSV
                  </button>
                </>
              )}
            </div>
          )}
        </div>
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
                  <ContactCard key={contact.id} contact={contact}
                    onClick={() => c.setSelectedContact(contact)}
                    isSelected={c.selectedContactIds.has(contact.id as number)}
                    onToggleSelect={() => {
                      const newSet = new Set(c.selectedContactIds);
                      const id = contact.id as number;
                      if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
                      c.setSelectedContactIds(newSet);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ContactCard({ contact, onClick, isSelected, onToggleSelect }: {
    contact: Contact;
    onClick: () => void;
    isSelected?: boolean;
    onToggleSelect?: () => void;
}) {
    const initials = (contact.name || contact.email || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    return (
        <div className="contact-card glass-panel" style={{
            padding: 16, borderRadius: 'var(--radius-md)', cursor: 'pointer',
            position: 'relative',
            border: isSelected ? '1px solid var(--accent-primary)' : undefined,
            boxShadow: isSelected ? '0 0 0 1px var(--accent-primary)' : undefined,
        }} onClick={onClick}>
            {onToggleSelect && (
                <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}>
                    <div style={{
                        width: 20, height: 20, borderRadius: 4,
                        border: `2px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-glass)'}`,
                        background: isSelected ? 'var(--accent-primary)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {isSelected && <span style={{ color: 'white', fontSize: '0.7rem' }}>✓</span>}
                    </div>
                </div>
            )}
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
