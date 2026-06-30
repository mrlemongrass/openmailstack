import { useState, useCallback, useEffect } from 'react';
import type {
  Message, MailFolder, Signature, Rule, SavedSearch,
  MailUndoState,
  SearchField, SearchScope,
} from '../../shared/types';
import * as api from '../../shared/api';

interface UseMailOptions {
  mailSettings: any;
  isThreaded: boolean;
  userIdentities: any;
}

export function useMail(_opts: UseMailOptions) {
  // Folder state
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessages, setSelectedMessages] = useState<number[]>([]);
  const [viewingThread, setViewingThread] = useState<Message[] | null>(null);
  const [mailLowestUid, setMailLowestUid] = useState<number | null>(null);
  const [mailMoreAvailable, setMailMoreAvailable] = useState(false);

  // Loading state
  const [mailLoading, setMailLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

  // Undo
  const [mailUndo, setMailUndo] = useState<MailUndoState | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchInfo, setSearchInfo] = useState('');
  const [searchIndexStatus, _setSearchIndexStatus] = useState<any>(null);
  const [searchWorkerStatus, _setSearchWorkerStatus] = useState<any>(null);
  const [savedSearches, _setSavedSearches] = useState<SavedSearch[]>([]);

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
  const [composeFrom, setComposeFrom] = useState('');
  const [composeSignature, setComposeSignature] = useState('none');
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [composeMode, setComposeMode] = useState<'rich' | 'plain'>('rich');
  const [draftUid, setDraftUid] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [sending, setSending] = useState(false);

  // Inline reply state
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

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
      return true;
    } catch (e) { console.error('Reply failed', e); return false; }
    finally { setReplySending(false); }
  }, [replyText]);

  // Other mail state
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [userQuota, _setUserQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [loadedImagesForMsg, setLoadedImagesForMsg] = useState<Set<string>>(new Set());
  const [showSearchHints, setShowSearchHints] = useState(false);

  // ---- Data fetching ----
  const fetchFolders = useCallback(async () => {
    try {
      const folderList = await api.fetchFolders();
      setFolders(folderList);
    } catch (e) { console.error('Failed to fetch folders', e); }
  }, []);

  const fetchMessages = useCallback(async () => {
    setMailLoading(true);
    try {
      const data = await api.fetchMessages(activeFolder);
      if (data.messages) {
        setMessages(data.messages);
        setMailLowestUid(data.lowestUid || null);
        setMailMoreAvailable(data.moreAvailable || false);
      }
    } catch (e) { console.error('Failed to fetch messages', e); }
    setMailLoading(false);
  }, [activeFolder]);

  // Snooze
  const snoozeMessages = useCallback(async (uids: number[], until: Date) => {
    try {
      await fetch('/api/messages/snooze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: activeFolder, uids, until: until.toISOString() }),
      });
      await fetchMessages();
      await fetchFolders();
    } catch (e) { console.error('Snooze failed', e); }
  }, [activeFolder, fetchMessages, fetchFolders]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderMessages || !mailMoreAvailable || !mailLowestUid) return;
    setLoadingOlderMessages(true);
    try {
      const data = await api.fetchMessages(activeFolder, mailLowestUid);
      if (data.messages) {
        setMessages((prev) => [...prev, ...data.messages!]);
        setMailLowestUid(data.lowestUid || null);
        setMailMoreAvailable(data.moreAvailable || false);
      }
    } catch (e) { console.error('Failed to load older messages', e); }
    setLoadingOlderMessages(false);
  }, [activeFolder, mailLowestUid, mailMoreAvailable, loadingOlderMessages]);

  const refreshMessages = useCallback(async () => {
    setIsRefreshing(true);
    await fetchMessages();
    setIsRefreshing(false);
  }, [fetchMessages]);

  // ---- Message actions ----
  const messageAction = useCallback(async (action: string, uids?: number[]) => {
    const targetUids = uids || selectedMessages;
    if (!targetUids.length) return;
    try {
      const result = await api.messageAction(action, activeFolder, targetUids);
      if (result.undoUids) {
        setMailUndo({
          message: getUndoMessage(action),
          uids: result.undoUids,
          targetFolder: result.targetFolder,
          timestamp: Date.now(),
        });
      }
      setSelectedMessages([]);
      await fetchMessages();
      await fetchFolders();
    } catch (e) { console.error('Action failed', e); }
  }, [activeFolder, selectedMessages, fetchMessages, fetchFolders]);

  const undoAction = useCallback(async () => {
    if (!mailUndo) return;
    try {
      await api.undoAction({ uids: mailUndo.uids, targetFolder: mailUndo.targetFolder });
      setMailUndo(null);
      await fetchMessages();
      await fetchFolders();
    } catch (e) { console.error('Undo failed', e); }
  }, [mailUndo, fetchMessages, fetchFolders]);

  // ---- Search ----
  const doSearch = useCallback(async (query: string, scope: SearchScope) => {
    if (!query.trim()) { setIsSearchActive(false); await fetchMessages(); return; }
    setIsSearchActive(true);
    setSearchLoading(true);
    setSearchError('');
    try {
      const result = await api.searchMessages(query, scope === 'folder' ? activeFolder : undefined);
      if (result.messages) setMessages(result.messages);
      setSearchInfo(result.source ? `Results from ${result.source}` : '');
    } catch (e: any) { setSearchError(e.message || 'Search failed'); }
    setSearchLoading(false);
  }, [activeFolder, fetchMessages]);

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
    return () => es.close();
  }, [isSearchActive, fetchFolders, fetchMessages]);

  // ---- Initial load ----
  useEffect(() => {
    fetchFolders();
    fetchMessages();
    api.fetchSignatures().then(setSignatures).catch(() => {});
    api.fetchRules().then(setRules).catch(() => {});
  }, []);

  return {
    folders, activeFolder, setActiveFolder, expandedFolders, setExpandedFolders,
    messages, setMessages, selectedMessages, setSelectedMessages,
    viewingThread, setViewingThread,
    mailLowestUid, mailMoreAvailable,
    mailLoading, isRefreshing, loadingOlderMessages,
    mailUndo, setMailUndo,
    searchQuery, setSearchQuery, searchField, setSearchField,
    searchScope, setSearchScope, isSearchActive, setIsSearchActive,
    searchLoading, searchError, searchInfo,
    searchIndexStatus, searchWorkerStatus,
    savedSearches,
    showSearchHints, setShowSearchHints,
    isComposing, setIsComposing, composeDocked, setComposeDocked,
    showCc, setShowCc, showBcc, setShowBcc,
    composeTo, setComposeTo, composeCc, setComposeCc, composeBcc, setComposeBcc,
    composeSubject, setComposeSubject, composeBody, setComposeBody,
    composeFrom, setComposeFrom, composeSignature, setComposeSignature,
    composeAttachments, setComposeAttachments,
    composeMode, setComposeMode,
    draftUid, setDraftUid, draftId, setDraftId,
    draftSaveStatus, setDraftSaveStatus,
    sending, setSending, replyText, setReplyText, replySending, sendReply,
    signatures, setSignatures, rules, setRules,
    userQuota, loadedImagesForMsg, setLoadedImagesForMsg,
    fetchFolders, fetchMessages, loadOlderMessages, refreshMessages,
    messageAction, undoAction, doSearch, snoozeMessages,
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
