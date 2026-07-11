import { useRef, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Trash2, Users, X } from 'lucide-react';
import { ContactSkeleton } from './components/ContactSkeleton';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import { useToast } from '../shared/components/Toast';
import { bulkDeleteContacts } from '../shared/api';
import { ScrollToTop } from '../shared/components/ScrollToTop';
import type { useContacts } from './hooks/useContacts';
import type { Contact } from '../shared/types';

export function ContactGrid({ contacts: c, density }: {
  contacts: ReturnType<typeof useContacts>;
  density: 'compact' | 'cozy' | 'comfortable';
}) {
  const { showToast } = useToast();
  const parentRef = useRef<HTMLDivElement>(null);
  const cols = 3;
  const isListMode = c.contactViewMode === 'list';
  const rows = isListMode ? c.contacts.length : Math.ceil(c.contacts.length / cols);
  const visibleContactIds = c.contacts
    .map((contact) => contact.id)
    .filter((id): id is number => typeof id === 'number');
  const allVisibleSelected = visibleContactIds.length > 0 && visibleContactIds.every((id) => c.selectedContactIds.has(id));
  const totalContacts = c.totalContacts || c.loadedContactsCount;
  const loadedSummary = c.contactSearchQuery
    ? `Showing ${c.loadedContactsCount} of ${totalContacts} matching contacts`
    : `Showing ${c.loadedContactsCount} of ${totalContacts} contacts`;
  const remaining = Math.max(totalContacts - c.loadedContactsCount, 0);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack virtualizer is intentional for large address books.
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => isListMode ? 74 : density === 'compact' ? 160 : density === 'cozy' ? 190 : 220, [density, isListMode]),
    overscan: 3,
  });

  const [showExportMenu, setShowExportMenu] = useState(false);

  if (c.isLoading && c.contacts.length === 0) return <ContactSkeleton count={20} />;

  if (c.contactsError) {
    return (
      <div style={{ padding: 20 }}>
        <ErrorBanner error={c.contactsError} onRetry={() => c.refreshContacts()} />
      </div>
    );
  }

  if (!c.isLoading && c.contacts.length === 0 && !c.contactSearchQuery) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>
            <Users size={48} />
          </div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
            No contacts yet
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 320, lineHeight: 1.5 }}>
            Use the New Contact button in the sidebar to create your first contact, or import contacts from a vCard or CSV file.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" className="glass-input" placeholder="Search contacts..."
            value={c.contactSearchQuery} onChange={(e) => c.setContactSearchQuery(e.target.value)}
            style={{ flex: '1 1 220px', fontSize: '0.85rem' }} />
          <select className="glass-input" value={c.contactsSettings.sortBy}
            onChange={(e) => c.updateContactsSettings({ sortBy: e.target.value as typeof c.contactsSettings.sortBy })}
            style={{ width: 136, fontSize: '0.82rem' }} aria-label="Sort contacts">
            <option value="firstName">First name</option>
            <option value="lastName">Last name</option>
            <option value="email">Email</option>
          </select>
          <select className="glass-input" value={c.contactsSettings.nameFormat}
            onChange={(e) => c.updateContactsSettings({ nameFormat: e.target.value as typeof c.contactsSettings.nameFormat })}
            style={{ width: 136, fontSize: '0.82rem' }} aria-label="Contact name format">
            <option value="firstLast">First Last</option>
            <option value="lastFirst">Last, First</option>
          </select>
          <button className="btn btn-ghost" onClick={() => c.setContactViewMode(c.contactViewMode === 'grid' ? 'list' : 'grid')}
            style={{ padding: '6px 10px' }}>
            {c.contactViewMode === 'grid' ? 'List' : 'Grid'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginRight: 'auto' }}>
            {loadedSummary}
          </div>
          {visibleContactIds.length > 0 && (
            <button className="btn btn-ghost" style={{ padding: '5px 9px', fontSize: '0.78rem' }}
              onClick={() => c.setSelectedContactIds(allVisibleSelected ? new Set() : new Set(visibleContactIds))}>
              {allVisibleSelected ? <X size={14} /> : <Check size={14} />}
              {allVisibleSelected ? 'Deselect all' : 'Select all'}
            </button>
          )}
          {c.selectedContactIds.size > 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {c.selectedContactIds.size} selected
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                  <div style={{ height: 1, background: 'var(--border-glass)', margin: '2px 8px' }} />
                  <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem', color: 'var(--danger)' }}
                    onClick={async () => {
                      if (!confirm(`Delete ${c.selectedContactIds.size} selected contact(s)?`)) return;
                      await bulkDeleteContacts(Array.from(c.selectedContactIds));
                      showToast({ type: 'success', message: `${c.selectedContactIds.size} contact(s) deleted` });
                      c.setSelectedContactIds(new Set());
                      c.refreshContacts();
                    }}>
                    <Trash2 size={14} /> Delete Selected ({c.selectedContactIds.size})
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
      <div ref={parentRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vr) => {
            const startIdx = isListMode ? vr.index : vr.index * cols;
            const rowContacts = isListMode ? c.contacts.slice(startIdx, startIdx + 1) : c.contacts.slice(startIdx, startIdx + cols);
            return (
              <div key={vr.key} style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${vr.start}px)`,
                display: 'grid', gridTemplateColumns: isListMode ? '1fr' : `repeat(${cols}, 1fr)`, gap: isListMode ? 8 : 16,
              }}>
                {rowContacts.map((contact) => (
                  <ContactCard key={contact.id} contact={contact}
                    nameFormat={c.contactsSettings.nameFormat}
                    isListMode={isListMode}
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
      {c.hasMore && (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <button className="btn btn-ghost" onClick={c.loadMoreContacts}
            style={{ fontSize: '0.85rem' }}>
            Load more contacts{remaining > 0 ? ` (${remaining} remaining)` : ''}
          </button>
        </div>
      )}
      <ScrollToTop scrollRef={parentRef} />
    </div>
  );
}

function contactDisplayName(contact: Contact, nameFormat: 'firstLast' | 'lastFirst'): string {
    const firstName = contact.first_name?.trim() || '';
    const lastName = contact.last_name?.trim() || '';
    if (nameFormat === 'lastFirst' && (firstName || lastName)) {
        return [lastName, firstName].filter(Boolean).join(', ') || contact.name || contact.email;
    }
    if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(' ');
    return contact.name || contact.email;
}

function ContactCard({ contact, nameFormat, isListMode, onClick, isSelected, onToggleSelect }: {
    contact: Contact;
    nameFormat: 'firstLast' | 'lastFirst';
    isListMode: boolean;
    onClick: () => void;
    isSelected?: boolean;
    onToggleSelect?: () => void;
}) {
    const displayName = contactDisplayName(contact, nameFormat);
    const initials = (displayName || contact.email || '?').split(/[,\s]+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    return (
        <div className="contact-card glass-panel" style={{
            padding: isListMode ? 12 : 16, borderRadius: 'var(--radius-md)', cursor: 'pointer',
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
                <div style={{ flex: 1, minWidth: 0, paddingRight: onToggleSelect ? 24 : 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>
                        {displayName}
                    </div>
                    {contact.email && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.email}</div>}
                    {contact.organization && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.organization}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</div>}
                    {!contact.organization && contact.phone && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>{contact.phone}</div>}
                </div>
            </div>
        </div>
    );
}
