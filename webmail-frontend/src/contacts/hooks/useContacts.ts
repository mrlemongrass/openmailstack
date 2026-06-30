import { useState, useCallback, useEffect } from 'react';
import type { Contact, ContactLabel, ContactGroup } from '../../shared/types';
import * as api from '../../shared/api';

export function useContacts() {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [directoryContacts, setDirectoryContacts] = useState<Contact[]>([]);
    const [contactLabels, setContactLabels] = useState<ContactLabel[]>([]);
    const [contactGroups, setContactGroups] = useState<ContactGroup[]>([]);
    const [duplicateGroups, setDuplicateGroups] = useState<Contact[][]>([]);
    const [selectedLabel, setSelectedLabel] = useState<number | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [contactsView, setContactsView] = useState<'personal' | 'directory' | 'trash'>('personal');
    const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
    const [contactSearchQuery, setContactSearchQuery] = useState('');
    const [contactViewMode, setContactViewMode] = useState<'grid' | 'list'>('grid');
    const [isLoading, setIsLoading] = useState(false);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [trashContacts, setTrashContacts] = useState<Contact[]>([]);
    const [isTrashLoading, setIsTrashLoading] = useState(false);
    const [isDedupLoading, setIsDedupLoading] = useState(false);

    const refreshContacts = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await api.fetchContacts(200, 0);
            if (data.contacts) { setContacts(data.contacts); setOffset(data.contacts.length); setHasMore(data.contacts.length >= 200); }
        } catch (e) { console.error('Failed to fetch contacts', e); }
        setIsLoading(false);
    }, []);

    const loadMoreContacts = useCallback(async () => {
        if (!hasMore) return;
        try {
            const data = await api.fetchContacts(200, offset);
            if (data.contacts) {
                setContacts((prev) => [...prev, ...data.contacts!]);
                setOffset((prev) => prev + data.contacts!.length);
                setHasMore(data.contacts.length >= 200);
            }
        } catch (e) { console.error('Failed to load more contacts', e); }
    }, [offset, hasMore]);

    const refreshDirectoryContacts = useCallback(async (query?: string) => {
        try {
            const data = await api.fetchDirectoryContacts(query);
            if (data.contacts) setDirectoryContacts(data.contacts);
        } catch (e) { console.error('Failed to fetch directory', e); }
    }, []);

    const refreshLabels = useCallback(async () => {
        try { setContactLabels(await api.fetchContactLabels()); } catch (e) { console.error(e); }
    }, []);

    const refreshGroups = useCallback(async () => {
        try { setContactGroups(await api.fetchContactGroups()); } catch (e) { console.error(e); }
    }, []);

    const refreshDuplicates = useCallback(async () => {
        setIsDedupLoading(true);
        try {
            const data = await api.fetchContactDuplicates();
            if (data.groups) setDuplicateGroups(data.groups);
        } catch (e) { console.error(e); }
        setIsDedupLoading(false);
    }, []);

    const refreshTrash = useCallback(async () => {
        setIsTrashLoading(true);
        try {
            const data = await api.fetchTrashContacts();
            if (data.contacts) setTrashContacts(data.contacts);
        } catch (e) { console.error('Failed to fetch trash', e); }
        setIsTrashLoading(false);
    }, []);

    useEffect(() => {
        refreshContacts();
        refreshLabels();
        refreshGroups();
        refreshDuplicates();
    }, []);

    return {
        contacts, directoryContacts, contactLabels, contactGroups,
        duplicateGroups, selectedLabel, setSelectedLabel,
        selectedGroupId, setSelectedGroupId,
        contactsView, setContactsView,
        selectedContactIds, setSelectedContactIds,
        contactSearchQuery, setContactSearchQuery,
        contactViewMode, setContactViewMode,
        isLoading, hasMore,
        refreshContacts, loadMoreContacts, refreshDirectoryContacts,
        refreshLabels, refreshGroups, refreshDuplicates,
        selectedContact, setSelectedContact,
        trashContacts, refreshTrash, isTrashLoading,
        isDedupLoading,
    };
}
