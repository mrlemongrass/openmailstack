import { Users, Building2, Plus } from 'lucide-react';
import type { useContacts } from './hooks/useContacts';

export function ContactSidebar({ contacts: c }: { contacts: ReturnType<typeof useContacts> }) {

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <button className="btn btn-primary" style={{ width: '100%', marginBottom: 16 }}
        onClick={() => c.setContactsView('personal')}>
        <Plus size={16} /> New Contact
      </button>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
          color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.05em' }}>
          Address Books
        </div>
        <div className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
          background: c.contactsView === 'personal' ? 'rgba(59,130,246,0.15)' : 'transparent',
          fontWeight: c.contactsView === 'personal' ? 600 : 400 }}
          onClick={() => c.setContactsView('personal')}>
          <Users size={16} />
          <span>Personal Contacts</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {c.contacts.length}
          </span>
        </div>
        <div className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
          background: c.contactsView === 'directory' ? 'rgba(59,130,246,0.15)' : 'transparent',
          fontWeight: c.contactsView === 'directory' ? 600 : 400 }}
          onClick={() => { c.setContactsView('directory'); c.refreshDirectoryContacts(); }}>
          <Building2 size={16} />
          <span>Global Directory</span>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
            color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Labels</span>
          <button className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: '0.8rem' }}
            onClick={() => {}}>+</button>
        </div>
        {c.contactLabels.map((label) => (
          <div key={label.id} className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            background: c.selectedLabel === label.id ? 'rgba(59,130,246,0.15)' : 'transparent',
            fontSize: '0.85rem' }}
            onClick={() => c.setSelectedLabel(c.selectedLabel === label.id ? null : label.id)}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: label.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{label.name}</span>
          </div>
        ))}
      </div>

      <div>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
          color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.05em' }}>Groups</div>
        {c.contactGroups.map((group) => (
          <div key={group.id} className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            background: c.selectedGroupId === group.id ? 'rgba(59,130,246,0.15)' : 'transparent',
            fontSize: '0.85rem' }}
            onClick={() => c.setSelectedGroupId(c.selectedGroupId === group.id ? null : group.id)}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: group.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{group.name}</span>
            {group.member_count !== undefined && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{group.member_count}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
