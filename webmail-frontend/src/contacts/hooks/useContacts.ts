import { useState, useCallback, useEffect, useMemo } from 'react';
import { io as createSocket } from 'socket.io-client';
import type { Contact, ContactLabel, ContactGroup } from '../../shared/types';
import * as api from '../../shared/api';
import {
    defaultContactsSettings,
    getUserSettings,
    saveUserSettings,
    type ContactsUserSettings,
} from '../../settings/settingsApi';

const CONTACTS_PAGE_SIZE = 200;

export function useContacts() {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [totalContacts, setTotalContacts] = useState(0);
    const [directoryContacts, setDirectoryContacts] = useState<Contact[]>([]);
    const [contactLabels, setContactLabels] = useState<ContactLabel[]>([]);
    const [contactGroups, setContactGroups] = useState<ContactGroup[]>([]);
    const [duplicateGroups, setDuplicateGroups] = useState<Contact[][]>([]);
    const [selectedLabel, setSelectedLabel] = useState<number | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [contactsView, setContactsView] = useState<'personal' | 'directory' | 'trash'>('personal');
    const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
    const [contactSearchQuery, setContactSearchQuery] = useState('');
    const [debouncedContactSearchQuery, setDebouncedContactSearchQuery] = useState('');
    const [contactViewMode, setContactViewMode] = useState<'grid' | 'list'>('grid');
    const [isLoading, setIsLoading] = useState(false);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [trashContacts, setTrashContacts] = useState<Contact[]>([]);
    const [isTrashLoading, setIsTrashLoading] = useState(false);
    const [isDedupLoading, setIsDedupLoading] = useState(false);
    const [contactsError, setContactsError] = useState('');
    const [contactsSettings, setContactsSettings] = useState<ContactsUserSettings>(defaultContactsSettings);

    const refreshContacts = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await api.fetchContacts(CONTACTS_PAGE_SIZE, 0, contactsSettings.sortBy, debouncedContactSearchQuery);
            if (data.contacts) {
                setContacts(data.contacts);
                setOffset(data.contacts.length);
                setTotalContacts(data.total ?? data.contacts.length);
                setHasMore(data.hasMore ?? data.contacts.length >= CONTACTS_PAGE_SIZE);
                setContactsError('');
            }
        } catch (e: any) { setContactsError(e?.message || 'Failed to load contacts'); console.error('Failed to fetch contacts', e); }
        setIsLoading(false);
    }, [contactsSettings.sortBy, debouncedContactSearchQuery]);

    const loadMoreContacts = useCallback(async () => {
        if (!hasMore) return;
        try {
            const data = await api.fetchContacts(CONTACTS_PAGE_SIZE, offset, contactsSettings.sortBy, debouncedContactSearchQuery);
            if (data.contacts) {
                const nextOffset = offset + data.contacts.length;
                setContacts((prev) => [...prev, ...data.contacts!]);
                setOffset(nextOffset);
                setTotalContacts(data.total ?? nextOffset);
                setHasMore(data.hasMore ?? nextOffset < (data.total ?? nextOffset));
            }
        } catch (e) { console.error('Failed to load more contacts', e); }
    }, [offset, hasMore, contactsSettings.sortBy, debouncedContactSearchQuery]);

    const updateContactsSettings = useCallback(async (updates: Partial<ContactsUserSettings>) => {
        const next = { ...contactsSettings, ...updates };
        setContactsSettings(next);
        try {
            const saved = await saveUserSettings('contacts', next);
            setContactsSettings(saved);
        } catch (e) {
            console.error('Failed to save contact settings', e);
        }
    }, [contactsSettings]);

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
            setDuplicateGroups(data.groups || []);
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
        let cancelled = false;
        getUserSettings('contacts')
            .then((settings) => { if (!cancelled) setContactsSettings(settings); })
            .catch((e) => { console.error('Failed to load contact settings', e); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const timeout = window.setTimeout(() => setDebouncedContactSearchQuery(contactSearchQuery.trim()), 250);
        return () => window.clearTimeout(timeout);
    }, [contactSearchQuery]);

    useEffect(() => { refreshContacts(); }, [refreshContacts]);
    useEffect(() => {
        let isActive = true;
        let socket: ReturnType<typeof createSocket> | null = null;
        let refreshTimer: ReturnType<typeof window.setTimeout> | undefined;

        const scheduleRefresh = () => {
            if (!isActive) return;
            if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => {
                void refreshContacts();
            }, 250);
        };

        const connectContactUpdates = async () => {
            try {
                const res = await fetch('/api/auth/me');
                if (!res.ok || !isActive) return;
                const data = await res.json();
                const username = data?.user?.username || data?.email;
                if (!username || !isActive) return;

                socket = createSocket({ withCredentials: true });
                socket.emit('join', username);
                socket.on('connect', () => {
                    socket?.emit('join', username);
                });
                socket.on('contacts_updated', scheduleRefresh);
            } catch (e) {
                console.error('Failed to start contact realtime updates', e);
            }
        };

        void connectContactUpdates();

        return () => {
            isActive = false;
            if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
            socket?.off('contacts_updated', scheduleRefresh);
            socket?.disconnect();
        };
    }, [refreshContacts]);
    useEffect(() => {
        refreshLabels();
        refreshGroups();
        refreshDuplicates();
        refreshTrash();
    }, [refreshLabels, refreshGroups, refreshDuplicates, refreshTrash]);

    useEffect(() => {
        setSelectedContact((current) => {
            if (!current?.id) return current;
            const refreshed = contacts.find(contact => String(contact.id) === String(current.id));
            return refreshed || current;
        });
    }, [contacts]);

    // Search is handled by the backend so it can cover contacts beyond the loaded page.
    const filteredContacts = useMemo(() => {
        return contacts.filter((c) => {
            const matchesLabel = selectedLabel === null || (() => {
                try { return (c.labels_json || []).includes(selectedLabel); } catch { return false; }
            })();
            return matchesLabel;
        });
    }, [contacts, selectedLabel]);

    return {
        contacts: filteredContacts, directoryContacts, contactLabels, contactGroups,
        loadedContactsCount: contacts.length,
        totalContacts,
        duplicateGroups, selectedLabel, setSelectedLabel,
        selectedGroupId, setSelectedGroupId,
        contactsView, setContactsView,
        selectedContactIds, setSelectedContactIds,
        contactSearchQuery, setContactSearchQuery,
        contactViewMode, setContactViewMode,
        contactsSettings, updateContactsSettings,
        isLoading, hasMore, contactsError,
        refreshContacts, loadMoreContacts, refreshDirectoryContacts,
        refreshLabels, refreshGroups, refreshDuplicates,
        selectedContact, setSelectedContact,
        trashContacts, refreshTrash, isTrashLoading,
        isDedupLoading,
    };
}
