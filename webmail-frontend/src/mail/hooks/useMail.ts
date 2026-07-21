import { useState, useCallback, useEffect, useRef, type SetStateAction } from 'react';
import type {
  Message, MailFolder, Signature, Rule, SavedSearch,
  MailUndoState,
  SearchField, SearchScope,
  SearchIndexStatusResponse, SearchWorkerStatusResponse,
  UserIdentities, MailIdentity,
} from '../../shared/types';
import * as api from '../../shared/api';
import type { MailUserSettings } from '../../settings/settingsApi';
import { markMessageBodyLoaded, mergeMessageDetails, messageCacheKey } from '../message-cache';
import {
  appendOlderMessagePage,
  applyLoadedMessageAction,
  reconcileNewestMessagePage,
} from '../mail-pagination';
import { createMailSearchInputController } from '../mail-search-input';
import { createMailSearchRequestCoordinator, isMailSearchAbort } from '../mail-search-request';

interface UseMailOptions {
  mailSettings: MailUserSettings;
  isThreaded: boolean;
  userIdentities: UserIdentities;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function applyFolderScopedAction(
  messages: Message[],
  action: string,
  folder: string,
  uids: number[],
) {
  const targets = new Set(uids);
  const matches = (message: Message) => (message.folder || folder) === folder && targets.has(message.uid);
  if (['archive', 'delete', 'spam', 'move', 'snooze'].includes(action)) {
    return messages.filter((message) => !matches(message));
  }
  return messages.map((message) => {
    if (!matches(message)) return message;
    if (action === 'read') return { ...message, isRead: true };
    if (action === 'unread') return { ...message, isRead: false };
    if (action === 'star') return { ...message, isStarred: true };
    if (action === 'unstar') return { ...message, isStarred: false };
    return message;
  });
}

export function useMail(_opts: UseMailOptions) {
  // Folder state
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const activeFolderRef = useRef(activeFolder);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('oms_expanded_folders');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  // Persist expanded state to localStorage
  const setExpandedPersisted = (updater: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setExpandedFolders((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('oms_expanded_folders', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Message state
  const [messages, setMessagesState] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const setMessages = useCallback((update: SetStateAction<Message[]>) => {
    setMessagesState((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      messagesRef.current = next;
      return next;
    });
  }, []);
  const [selectedMessages, setSelectedMessages] = useState<number[]>([]);
  const [viewingThread, setViewingThread] = useState<Message[] | null>(null);
  const [mailLowestUid, setMailLowestUid] = useState<number | null>(null);
  const [mailMoreAvailable, setMailMoreAvailable] = useState(false);
  const messageDetailCacheRef = useRef<Map<string, Message>>(new Map());
  const prefetchedRef = useRef<Set<string>>(new Set());
  const messageRequestIdRef = useRef(0);
  const olderMessageRequestIdRef = useRef(0);
  const olderMessageLoadingRef = useRef(false);
  const searchRequestIdRef = useRef(0);
  const searchInputControllerRef = useRef<ReturnType<typeof createMailSearchInputController> | null>(null);
  const searchRequestCoordinatorRef = useRef(createMailSearchRequestCoordinator());

  // Loading state
  const [mailLoading, setMailLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [mailPaginationError, setMailPaginationError] = useState('');

  // Undo
  const [mailUndo, setMailUndo] = useState<MailUndoState | null>(null);
  const [undoSendId, setUndoSendId] = useState<number | null>(null);

  // Cancel an undo-send (delete scheduled message before it sends)
  const cancelSendUndo = useCallback(async () => {
    if (!undoSendId) return;
    try {
      await fetch(`/api/messages/send?scheduledId=${undoSendId}`, { method: 'DELETE' });
      setUndoSendId(null);
    } catch (e) { console.error('Cancel send failed', e); }
  }, [undoSendId]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchInfo, setSearchInfo] = useState('');
  const [mailError, setMailError] = useState('');
  const [searchIndexStatus, _setSearchIndexStatus] = useState<SearchIndexStatusResponse | null>(null);
  const [searchWorkerStatus, _setSearchWorkerStatus] = useState<SearchWorkerStatusResponse | null>(null);
  const [savedSearches, _setSavedSearches] = useState<SavedSearch[]>([]);

  // Derive send-as identities from auth context
  const identities: MailIdentity[] = _opts.userIdentities?.address
    ? [{ address: _opts.userIdentities.address, name: _opts.userIdentities.name || '' },
       ...(_opts.userIdentities.aliases || []).map((a: { address: string; name?: string }) => ({ address: a.address, name: a.name || '' }))]
    : [];

  // Compose state
  const [isComposing, setIsComposing] = useState(false);
  const [composeDocked, setComposeDocked] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFrom, setComposeFrom] = useState(identities[0]?.address || '');
  const [composeSignature, setComposeSignature] = useState('none');
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [composeMode, setComposeMode] = useState<'rich' | 'plain'>('rich');
  const [draftUid, setDraftUid] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline reply state
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  // ---- Data fetching (must be before handleSend) ----
  const fetchFolders = useCallback(async () => {
    try {
      const folderList = await api.fetchFolders();
      setFolders(folderList);
      setMailError('');
    } catch (e: unknown) { setMailError(errorMessage(e, 'Failed to load folders')); console.error('Failed to fetch folders', e); }
  }, []);

  const invalidateOlderMessageRequest = useCallback(() => {
    olderMessageRequestIdRef.current += 1;
    olderMessageLoadingRef.current = false;
    setLoadingOlderMessages(false);
    setMailPaginationError('');
  }, []);

  const fetchMessages = useCallback(async (mode: 'refresh' | 'reset' = 'refresh') => {
    const folder = activeFolder;
    const requestId = ++messageRequestIdRef.current;
    if (mode === 'reset') {
      searchRequestIdRef.current += 1;
      invalidateOlderMessageRequest();
      setSearchLoading(false);
      setMessages([]);
      setMailLowestUid(null);
      setMailMoreAvailable(false);
    }
    setMailLoading(true);
    setMailError('');
    try {
      const data = await api.fetchMessages(folder);
      if (data.messages) {
        if (requestId !== messageRequestIdRef.current || activeFolderRef.current !== folder) return;
        const refreshed = data.messages.map((message) => mergeMessageDetails(
          message,
          messageDetailCacheRef.current.get(messageCacheKey(folder, message.uid)),
        ));
        const result = mode === 'reset'
          ? { messages: refreshed, preservedTail: false }
          : reconcileNewestMessagePage(messagesRef.current, refreshed);
        setMessages(result.messages);
        if (mode === 'reset' || !result.preservedTail) {
          if (mode === 'refresh') invalidateOlderMessageRequest();
          setMailLowestUid(data.lowestUid || null);
          setMailMoreAvailable(Boolean(data.moreAvailable));
        }
      }
    } catch (e: unknown) {
      if (requestId === messageRequestIdRef.current && activeFolderRef.current === folder) {
        setMailError(errorMessage(e, 'Failed to load messages'));
      }
      console.error('Failed to fetch messages', e);
    } finally {
      if (requestId === messageRequestIdRef.current) setMailLoading(false);
    }
  }, [activeFolder, invalidateOlderMessageRequest, setMessages]);

  // Compose send
  const handleSend = useCallback(async (sendAt?: Date | null) => {
    setSending(true);
    setComposeError(null);
    try {
      const formData = new FormData();
      if (composeFrom) formData.append('from', composeFrom);
      formData.append('to', composeTo);
      if (composeCc) formData.append('cc', composeCc);
      if (composeBcc) formData.append('bcc', composeBcc);
      formData.append('subject', composeSubject || '(no subject)');
      formData.append('html', composeBody);
      if (draftUid) formData.append('draftUid', draftUid);
      composeAttachments.forEach((file) => {
        formData.append('attachments', file);
      });
      if (sendAt && sendAt.getTime() > Date.now()) {
        const delaySeconds = Math.ceil((sendAt.getTime() - Date.now()) / 1000);
        formData.append('delaySeconds', String(delaySeconds));
      }
      // Undo send: add 8-second delay so user can cancel
      if (!sendAt) formData.append('delaySeconds', '8');
      const result = await api.sendMessage(formData);
      // Store scheduled ID for undo
      if (result.scheduledId) setUndoSendId(result.scheduledId);
      // Clear compose state on success
      setComposeTo(''); setComposeCc(''); setComposeBcc('');
      setComposeSubject(''); setComposeBody('');
      setComposeAttachments([]);
      setDraftUid(null); setDraftId(null);
      setDraftSaveStatus(null);
      setShowCc(false); setShowBcc(false);
      setIsComposing(false);
      fetchFolders();
    } catch (e: unknown) {
      console.error('Send failed', e);
      setComposeError(errorMessage(e, 'Failed to send message'));
    } finally {
      setSending(false);
    }
  }, [composeFrom, composeTo, composeCc, composeBcc, composeSubject, composeBody, composeAttachments, draftUid, fetchFolders]);

  const handleSendAndArchive = useCallback(async (sendAt?: Date | null) => {
    // For new compose, "Send & Archive" sends the message.
    // If replying, archive would apply to the source thread.
    await handleSend(sendAt);
  }, [handleSend]);

  // Other mail state
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [userQuota, _setUserQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [loadedImagesForMsg, setLoadedImagesForMsg] = useState<Set<string>>(new Set());
  const [showSearchHints, setShowSearchHints] = useState(false);

  const sendReply = useCallback(async (to: string, subject: string, inReplyTo: string, references: string) => {
    setReplySending(true);
    try {
      const formData = new FormData();
      formData.append('to', to);
      formData.append('subject', subject.startsWith('Re:') ? subject : `Re: ${subject}`);
      formData.append('body', replyText);
      formData.append('inReplyTo', inReplyTo);
      formData.append('references', references);
      await api.sendMessage(formData);
      setReplyText('');
      await fetchFolders();
      await fetchMessages();
      return true;
    } catch (e) { console.error('Reply failed', e); return false; }
    finally { setReplySending(false); }
  }, [replyText, fetchFolders, fetchMessages]);

  // Fetch a single message body (full content)
  const fetchMessageBody = useCallback(async (uid: number, folderPath: string) => {
    const cacheKey = messageCacheKey(folderPath, uid);
    if (prefetchedRef.current.has(cacheKey)) return; // already fetched or in-flight
    prefetchedRef.current.add(cacheKey);
    try {
      const data = await api.fetchMessage(folderPath, uid);
      if (data.message) {
        const detail = markMessageBodyLoaded(data.message);
        messageDetailCacheRef.current.set(cacheKey, detail);
        if (activeFolderRef.current !== folderPath) return;
        setMessages((prev) => prev.map((m) =>
          m.uid === uid ? mergeMessageDetails(m, detail) : m
        ));
        setViewingThread((prev) => {
          if (prev?.some((m) => m.uid === uid)) {
            return prev.map((m) => m.uid === uid ? mergeMessageDetails(m, detail) : m);
          }
          return [detail];
        });
      }
    } catch (e) { console.error('Failed to fetch message body', e); prefetchedRef.current.delete(cacheKey); }
  }, [setMessages]);

  // Pre-fetch message bodies in the background (non-blocking, silent)
  const prefetchBodies = useCallback((uids: number[], folderPath: string) => {
    for (const uid of uids) {
      const cacheKey = messageCacheKey(folderPath, uid);
      if (prefetchedRef.current.has(cacheKey)) continue;
      prefetchedRef.current.add(cacheKey);
      api.fetchMessage(folderPath, uid).then((data) => {
        if (data.message) {
          const detail = markMessageBodyLoaded(data.message);
          messageDetailCacheRef.current.set(cacheKey, detail);
          if (activeFolderRef.current !== folderPath) return;
          setMessages((prev) => prev.map((m) =>
            (m.folder || folderPath) === folderPath && m.uid === uid ? mergeMessageDetails(m, detail) : m
          ));
        }
      }).catch(() => { prefetchedRef.current.delete(cacheKey); });
    }
  }, [setMessages]);

  // Snooze
  const snoozeMessages = useCallback(async (uids: number[], until: Date, folderOverride?: string) => {
    const folder = folderOverride || activeFolder;
    try {
      const response = await fetch('/api/messages/snooze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, uids, until: until.toISOString() }),
      });
      if (!response.ok) throw new Error('Failed to snooze messages');
      if (isSearchActive) {
        setMessages((current) => applyFolderScopedAction(current, 'snooze', folder, uids));
        await fetchFolders();
        return;
      }
      if (activeFolderRef.current !== folder) return;
      setMessages((current) => applyLoadedMessageAction(current, 'snooze', uids));
      await fetchMessages();
      await fetchFolders();
    } catch (e) { console.error('Snooze failed', e); }
  }, [activeFolder, fetchMessages, fetchFolders, isSearchActive, setMessages]);

  // Mute thread
  const muteThread = useCallback(async (uids: number[]) => {
    try {
      await fetch('/api/messages/mute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uids }),
      });
      await fetchMessages();
    } catch (e) { console.error('Mute failed', e); }
  }, [fetchMessages]);

  const loadOlderMessages = useCallback(async () => {
    if (olderMessageLoadingRef.current || !mailMoreAvailable || !mailLowestUid || isSearchActive) return;
    const folder = activeFolder;
    const cursor = mailLowestUid;
    const requestId = ++olderMessageRequestIdRef.current;
    olderMessageLoadingRef.current = true;
    setLoadingOlderMessages(true);
    setMailPaginationError('');
    try {
      const data = await api.fetchMessages(folder, cursor);
      if (requestId !== olderMessageRequestIdRef.current || activeFolderRef.current !== folder) return;
      const older = (data.messages || []).map((message) => mergeMessageDetails(
        message,
        messageDetailCacheRef.current.get(messageCacheKey(folder, message.uid)),
      ));
      const nextCursor = data.lowestUid || null;
      setMessages((current) => appendOlderMessagePage(current, older));
      setMailLowestUid(nextCursor);
      setMailMoreAvailable(Boolean(
        data.moreAvailable && older.length > 0 && nextCursor && nextCursor < cursor
      ));
    } catch (e: unknown) {
      if (requestId === olderMessageRequestIdRef.current && activeFolderRef.current === folder) {
        setMailPaginationError(errorMessage(e, 'Failed to load older messages'));
      }
      console.error('Failed to load older messages', e);
    } finally {
      if (requestId === olderMessageRequestIdRef.current) {
        olderMessageLoadingRef.current = false;
        setLoadingOlderMessages(false);
      }
    }
  }, [activeFolder, isSearchActive, mailLowestUid, mailMoreAvailable, setMessages]);

  const refreshMessages = useCallback(async () => {
    setIsRefreshing(true);
    await fetchMessages();
    setIsRefreshing(false);
  }, [fetchMessages]);

  // ---- Message actions ----
  const messageAction = useCallback(async (action: string, uids?: number[], folderOverride?: string, targetFolder?: string) => {
    const targetUids = uids || selectedMessages;
    if (!targetUids.length) return false;
    const folder = folderOverride || activeFolder;
    try {
      const result = await api.messageAction(action, folder, targetUids, targetFolder);
      if (result.undoUids && result.undoUids.length > 0) {
        setMailUndo({
          message: getUndoMessage(action),
          uids: result.undoUids,
          targetFolder: result.targetFolder,
          sourceFolder: folder,
          timestamp: Date.now(),
        });
      }
      if (isSearchActive) {
        if (action !== 'move' || result.targetFolder) {
          setMessages((current) => applyFolderScopedAction(current, action, folder, targetUids));
        }
        setSelectedMessages([]);
        await fetchFolders();
        return true;
      }
      if (activeFolderRef.current !== folder) {
        await fetchFolders();
        return true;
      }
      if (action !== 'move' || result.targetFolder) {
        setMessages((current) => applyLoadedMessageAction(current, action, targetUids));
      }
      setSelectedMessages([]);
      await fetchMessages();
      await fetchFolders();
      return true;
    } catch (e) {
      console.error('Action failed', e);
      return false;
    }
  }, [activeFolder, selectedMessages, fetchMessages, fetchFolders, isSearchActive, setMessages]);

  const undoAction = useCallback(async () => {
    if (!mailUndo) return;
    try {
      await api.undoAction({ uids: mailUndo.uids, targetFolder: mailUndo.targetFolder, sourceFolder: mailUndo.sourceFolder });
      setMailUndo(null);
      await fetchMessages();
      await fetchFolders();
    } catch (e) { console.error('Undo failed', e); }
  }, [mailUndo, fetchMessages, fetchFolders]);

  // ---- Search ----
  const doSearch = useCallback(async (query: string, scope: SearchScope, field: SearchField = searchField) => {
    const requestId = ++searchRequestIdRef.current;
    const allowsBlankQuery = field === 'unread' || field === 'starred';
    if (!query.trim() && !allowsBlankQuery) {
      searchRequestCoordinatorRef.current.cancel();
      setIsSearchActive(false);
      setSearchLoading(false);
      setSearchError('');
      setSearchInfo('');
      await fetchMessages('reset');
      return;
    }
    const folder = activeFolder;
    messageRequestIdRef.current += 1;
    setMailLoading(false);
    invalidateOlderMessageRequest();
    setSelectedMessages([]);
    setIsSearchActive(true);
    setSearchLoading(true);
    setSearchError('');
    const requestController = searchRequestCoordinatorRef.current.begin();
    try {
      const result = await api.searchMessages({
        query,
        field,
        scope,
        folder: scope === 'folder' ? folder : undefined,
        limit: 100,
        signal: requestController.signal,
      });
      if (requestId !== searchRequestIdRef.current || activeFolderRef.current !== folder) return;
      if (result.messages) setMessages(result.messages);
      setSearchInfo(result.partial ? 'Some folders could not be searched. Results may be incomplete.' : '');
    } catch (e: unknown) {
      if (isMailSearchAbort(e)) return;
      if (requestId === searchRequestIdRef.current && activeFolderRef.current === folder) {
        setSearchError(errorMessage(e, 'Search failed'));
      }
    }
    finally {
      searchRequestCoordinatorRef.current.complete(requestController);
      if (requestId === searchRequestIdRef.current) setSearchLoading(false);
    }
  }, [activeFolder, fetchMessages, invalidateOlderMessageRequest, searchField, setMessages]);

  const resetSearchState = useCallback(() => {
    searchInputControllerRef.current?.cancel();
    searchRequestCoordinatorRef.current.cancel();
    searchRequestIdRef.current += 1;
    setSearchQuery('');
    setIsSearchActive(false);
    setSearchLoading(false);
    setSearchError('');
    setSearchInfo('');
  }, []);

  useEffect(() => () => searchRequestCoordinatorRef.current.cancel(), []);

  const clearSearch = useCallback(() => {
    resetSearchState();
    setSearchField('all');
    setSearchScope('folder');
    setSelectedMessages([]);
    void fetchMessages('reset');
  }, [fetchMessages, resetSearchState]);

  useEffect(() => {
    const controller = createMailSearchInputController({
      onQueryChange: setSearchQuery,
      onSearch: query => {
        if (!query.trim()) clearSearch();
        else void doSearch(query, searchScope, searchField);
      },
    });
    searchInputControllerRef.current = controller;
    return () => {
      controller.cancel();
      if (searchInputControllerRef.current === controller) searchInputControllerRef.current = null;
    };
  }, [clearSearch, doSearch, searchField, searchScope]);

  const updateSearchQuery = useCallback((query: string) => {
    searchInputControllerRef.current?.update(query);
  }, []);

  const submitSearchQuery = useCallback(() => {
    if (searchInputControllerRef.current?.flush()) return;
    if (!searchQuery.trim()) clearSearch();
    else void doSearch(searchQuery, searchScope, searchField);
  }, [clearSearch, doSearch, searchField, searchQuery, searchScope]);

  const changeSearchField = useCallback((field: SearchField) => {
    setSearchField(field);
    searchInputControllerRef.current?.cancel();
    if (searchQuery.trim() || field === 'unread' || field === 'starred' || isSearchActive) {
      void doSearch(searchQuery, searchScope, field);
    }
  }, [doSearch, isSearchActive, searchQuery, searchScope]);

  const changeSearchScope = useCallback((scope: SearchScope) => {
    setSearchScope(scope);
    setSelectedMessages([]);
    searchInputControllerRef.current?.cancel();
    if (searchQuery.trim() || searchField === 'unread' || searchField === 'starred') {
      void doSearch(searchQuery, scope, searchField);
    }
  }, [doSearch, searchField, searchQuery]);

  // ---- Real-time events ----
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('newMessage', () => {
      fetchFolders();
      if (!isSearchActive) fetchMessages();
    });
    es.addEventListener('flagsUpdate', () => {
      fetchFolders();
      if (!isSearchActive) fetchMessages();
    });
    es.onerror = () => {
      console.error('SSE connection error');
    };
    return () => es.close();
  }, [isSearchActive, fetchFolders, fetchMessages]);

  // ---- Initial load ----
  useEffect(() => {
    const folderTimer = window.setTimeout(() => { void fetchFolders(); }, 0);
    api.fetchSignatures().then(setSignatures).catch(() => {});
    api.fetchRules().then(setRules).catch(() => {});
    return () => window.clearTimeout(folderTimer);
  }, [fetchFolders]);

  // Refetch messages when folder changes
  useEffect(() => {
    activeFolderRef.current = activeFolder;
    searchInputControllerRef.current?.cancel();
    const messageTimer = window.setTimeout(() => { void fetchMessages('reset'); }, 0);
    return () => window.clearTimeout(messageTimer);
  }, [activeFolder, fetchMessages]);

  // ---- Draft auto-save ----
  useEffect(() => {
    if (!isComposing) return;

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
    }

    draftTimerRef.current = setTimeout(async () => {
      if (!composeTo && !composeSubject && !composeBody && composeAttachments.length === 0) return;

      setDraftSaveStatus('saving');
      try {
        const formData = new FormData();
        if (composeFrom) formData.append('from', composeFrom);
        formData.append('to', composeTo);
        if (composeCc) formData.append('cc', composeCc);
        if (composeBcc) formData.append('bcc', composeBcc);
        formData.append('subject', composeSubject || '(no subject)');
        formData.append('html', composeBody);
        if (draftUid) formData.append('draftUid', draftUid);
        composeAttachments.forEach((file) => {
          formData.append('attachments', file);
        });

        const result = await api.saveDraft(formData);
        if (result.draftId) setDraftId(result.draftId);
        if (result.draftUid) setDraftUid(result.draftUid);
        setDraftSaveStatus('saved');
      } catch (e) {
        console.error('Draft save failed', e);
        setDraftSaveStatus('error');
      }
    }, 2000);

    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
      }
    };
  }, [isComposing, composeFrom, composeTo, composeCc, composeBcc, composeSubject, composeBody, composeAttachments, draftUid]);

  return {
    folders, activeFolder, setActiveFolder, expandedFolders, setExpandedFolders: setExpandedPersisted,
    messages, setMessages, selectedMessages, setSelectedMessages,
    viewingThread, setViewingThread,
    mailLowestUid, mailMoreAvailable,
    mailLoading, isRefreshing, loadingOlderMessages, mailPaginationError,
    mailUndo, setMailUndo, undoSendId, cancelSendUndo,
    searchQuery, setSearchQuery, updateSearchQuery, submitSearchQuery, resetSearchState, clearSearch, searchField, setSearchField, changeSearchField,
    searchScope, setSearchScope, changeSearchScope, isSearchActive, setIsSearchActive,
    searchLoading, searchError, searchInfo,
    mailError, setMailError,
    searchIndexStatus, searchWorkerStatus,
    savedSearches,
    showSearchHints, setShowSearchHints,
    isComposing, setIsComposing, composeDocked, setComposeDocked,
    showCc, setShowCc, showBcc, setShowBcc,
    composeTo, setComposeTo, composeCc, setComposeCc, composeBcc, setComposeBcc,
    composeSubject, setComposeSubject, composeBody, setComposeBody,
    composeFrom, setComposeFrom, composeIdentities: identities, composeSignature, setComposeSignature,
    composeAttachments, setComposeAttachments,
    composeMode, setComposeMode,
    draftUid, setDraftUid, draftId, setDraftId,
    draftSaveStatus, setDraftSaveStatus, composeError, setComposeError,
    sending, handleSend, handleSendAndArchive,
    replyText, setReplyText, replySending, sendReply,
    signatures, setSignatures, rules, setRules,
    userQuota, loadedImagesForMsg, setLoadedImagesForMsg,
    fetchFolders, fetchMessages, fetchMessageBody, prefetchBodies, loadOlderMessages, refreshMessages,
    messageAction, undoAction, doSearch, snoozeMessages, muteThread,
  };
}

function getUndoMessage(action: string): string {
  switch (action) {
    case 'delete': return 'Message moved to Trash.';
    case 'archive': return 'Message archived.';
    case 'spam': return 'Message marked as spam.';
    default: return 'Action undone.';
  }
}
