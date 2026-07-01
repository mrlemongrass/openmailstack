import { useState } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import type { Contact } from '../shared/types';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useContacts } from './hooks/useContacts';
import { ContactSidebar } from './ContactSidebar';
import { ContactGrid } from './ContactGrid';
import { ContactDetail } from './ContactDetail';
import { ContactTrash } from './ContactTrash';
import { ContactShareModal } from './ContactShareModal';
import { ContactEditModal } from './ContactEditModal';
import { useAppearance } from '../shared/hooks/useAppearance';
import * as api from '../shared/api';

function ResizeHandle() {
    return (
        <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
                background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
        </PanelResizeHandle>
    );
}

export function ContactsLayout() {
    const contacts = useContacts();
    const isMobile = useMediaQuery('(max-width: 767px)');
    const { appearance } = useAppearance();
    const density = (appearance.density as 'compact' | 'cozy' | 'comfortable') || 'cozy';
    const [showShare, setShowShare] = useState(false);
    const [editingContact, setEditingContact] = useState<Contact | null>(null);

    const handleNewContact = () => setEditingContact({} as Contact);

    const handleDeleteContact = async (contact: Contact) => {
        if (!contact.id || !confirm('Move this contact to trash?')) return;
        try {
            await api.deleteContact(contact.id);
            contacts.refreshContacts();
            contacts.refreshTrash();
            contacts.setSelectedContact(null);
        } catch (e) { console.error('Delete failed', e); }
    };

    const contactsPanelLayout = useDefaultLayout({
        id: 'oms-contacts-v12',
        panelIds: ['contacts-sidebar', 'contacts-view'],
    });

    // Mobile: detail pushes over list
    if (isMobile) {
        if (contacts.selectedContact) {
            return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <ContactDetail
                        contact={contacts.selectedContact}
                        onClose={() => contacts.setSelectedContact(null)}
                        onEdit={() => setEditingContact(contacts.selectedContact)}
                        onShare={() => setShowShare(true)}
                        onDelete={() => handleDeleteContact(contacts.selectedContact!)}
                    />
                    {showShare && contacts.selectedContact && (
                        <ContactShareModal
                            contact={contacts.selectedContact}
                            onClose={() => setShowShare(false)}
                        />
                    )}
                    {editingContact && (
                        <ContactEditModal
                            contact={editingContact}
                            onClose={() => setEditingContact(null)}
                            onSaved={() => {
                                contacts.refreshContacts();
                                contacts.setSelectedContact(null);
                            }}
                        />
                    )}
                </div>
            );
        }
        if (contacts.contactsView === 'trash') {
            return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
                        <button className="btn btn-ghost" onClick={() => contacts.setContactsView('personal')}>
                            ← Back to Contacts
                        </button>
                    </div>
                    <ContactTrash contacts={contacts} />
                </div>
            );
        }
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <ContactGrid contacts={contacts} density={density} />
            </div>
        );
    }

    // Desktop: three panels when detail open
    const showDetail = contacts.selectedContact !== null;
    const showTrash = contacts.contactsView === 'trash';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <PanelGroup
                id="oms-contacts-v12"
                orientation="horizontal"
                defaultLayout={contactsPanelLayout.defaultLayout}
                onLayoutChange={contactsPanelLayout.onLayoutChange}
                style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}
            >
                <Panel id="contacts-sidebar" defaultSize="20%" minSize="10%" maxSize="35%">
                    <ContactSidebar contacts={contacts} onNewContact={handleNewContact} />
                </Panel>
                <ResizeHandle />
                <Panel id="contacts-view" defaultSize={showDetail ? "50%" : "80%"} minSize="30%">
                    {showTrash ? (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
                                <button className="btn btn-ghost" onClick={() => contacts.setContactsView('personal')}>
                                    ← Back to Contacts
                                </button>
                            </div>
                            <ContactTrash contacts={contacts} />
                        </div>
                    ) : (
                        <ContactGrid contacts={contacts} density={density} />
                    )}
                </Panel>
                {showDetail && contacts.selectedContact && (
                    <>
                        <ResizeHandle />
                        <Panel id="contacts-detail" defaultSize="30%" minSize="20%">
                            <ContactDetail
                                contact={contacts.selectedContact}
                                onClose={() => contacts.setSelectedContact(null)}
                                onEdit={() => setEditingContact(contacts.selectedContact)}
                                onShare={() => setShowShare(true)}
                                onDelete={() => handleDeleteContact(contacts.selectedContact!)}
                            />
                        </Panel>
                    </>
                )}
            </PanelGroup>
            {showShare && contacts.selectedContact && (
                <ContactShareModal
                    contact={contacts.selectedContact}
                    onClose={() => setShowShare(false)}
                />
            )}
            {editingContact && (
                <ContactEditModal
                    contact={editingContact}
                    onClose={() => setEditingContact(null)}
                    onSaved={() => {
                        contacts.refreshContacts();
                        contacts.setSelectedContact(null);
                    }}
                />
            )}
        </div>
    );
}
