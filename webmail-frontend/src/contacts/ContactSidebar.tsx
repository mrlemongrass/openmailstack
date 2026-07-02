import { useState } from 'react';
import { Users, Building2, Plus, ScanLine, Trash2, Check, X } from 'lucide-react';
import * as api from '../shared/api';
import { useToast } from '../shared/components/Toast';
import type { useContacts } from './hooks/useContacts';

const GROUP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

export function ContactSidebar({ contacts: c, onNewContact }: { contacts: ReturnType<typeof useContacts>; onNewContact: () => void }) {
  const { showToast } = useToast();
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;
    try {
      await api.saveContactLabel({ name: newLabelName.trim(), color: GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)] });
      setNewLabelName('');
      setShowNewLabel(false);
      c.refreshLabels();
      showToast({ type: 'success', message: `Label "${newLabelName.trim()}" created` });
    } catch { showToast({ type: 'error', message: 'Failed to create label' }); }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await api.saveContactGroup({ name: newGroupName.trim(), color: GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)] });
      setNewGroupName('');
      setShowNewGroup(false);
      c.refreshGroups();
      showToast({ type: 'success', message: `Group "${newGroupName.trim()}" created` });
    } catch { showToast({ type: 'error', message: 'Failed to create group' }); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-primary" style={{ flex: 1 }}
          onClick={onNewContact}>
          <Plus size={16} /> New Contact
        </button>
        <button className="btn btn-ghost" style={{ padding: '6px 10px' }}
          onClick={() => c.refreshDuplicates()}
          disabled={c.isDedupLoading}
          title="Find Duplicates">
          <ScanLine size={16} />
        </button>
      </div>

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
            onClick={() => setShowNewLabel(!showNewLabel)}>+</button>
        </div>
        {showNewLabel && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <input className="glass-input" placeholder="Label name" value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateLabel(); if (e.key === 'Escape') setShowNewLabel(false); }}
              autoFocus style={{ flex: 1, fontSize: '0.8rem', padding: '4px 8px' }} />
            <button className="btn btn-ghost" onClick={handleCreateLabel} style={{ padding: '4px 6px' }}><Check size={14} /></button>
            <button className="btn btn-ghost" onClick={() => setShowNewLabel(false)} style={{ padding: '4px 6px' }}><X size={14} /></button>
          </div>
        )}
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

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
            color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Groups</span>
          <button className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: '0.8rem' }}
            onClick={() => setShowNewGroup(!showNewGroup)}>+</button>
        </div>
        {showNewGroup && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <input className="glass-input" placeholder="Group name" value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup(); if (e.key === 'Escape') setShowNewGroup(false); }}
              autoFocus style={{ flex: 1, fontSize: '0.8rem', padding: '4px 8px' }} />
            <button className="btn btn-ghost" onClick={handleCreateGroup} style={{ padding: '4px 6px' }}><Check size={14} /></button>
            <button className="btn btn-ghost" onClick={() => setShowNewGroup(false)} style={{ padding: '4px 6px' }}><X size={14} /></button>
          </div>
        )}
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

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-glass)' }}>
        <div className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
          background: c.contactsView === 'trash' ? 'rgba(239,68,68,0.12)' : 'transparent',
          fontWeight: c.contactsView === 'trash' ? 600 : 400 }}
          onClick={() => {
            c.setContactsView('trash');
            c.refreshTrash();
          }}>
          <Trash2 size={16} color={c.contactsView === 'trash' ? 'var(--danger)' : 'currentColor'} />
          <span>Trash</span>
          {c.trashContacts.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {c.trashContacts.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
