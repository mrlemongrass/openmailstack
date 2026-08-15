import { useState, useCallback, useEffect, useMemo, useRef, type SetStateAction } from 'react';
import type {
  Message, MailFolder, Signature, Rule, SavedSearch,
  MailUndoState,
  SearchField, SearchScope,
  SearchIndexStatusResponse, SearchWorkerStatusResponse,
  SendMessageResponse,
  UserIdentities,
} from '../../shared/types';
import * as api from '../../shared/api';
import type { MailUserSettings } from '../../settings/settingsApi';
import {
  createMessageDetailLoader,
  mailboxPathsEqual,
  markMessageBodyLoaded,
  mergeMessageDetails,
} from '../message-cache';
import {
  appendOlderMessagePage,
  applyLoadedMessageAction,
  reconcileNewestMessagePage,
} from '../mail-pagination';
import { createMailSearchInputController } from '../mail-search-input';
import { createMailSearchRequestCoordinator, isMailSearchAbort } from '../mail-search-request';
import { mailIdentities, selectComposeFrom } from '../mail-runtime-settings';
import { createDraftSaveCoordinator } from '../draft-save-coordinator';
import { draftComposeState, hydrateDraftAttachments } from '../draft-resume';
import { outboundIdentityFields } from '../outbound-identity';
import { reopenRestoredScheduledDraft } from '../scheduled-undo-draft';

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
  const messageDetailLoaderRef = useRef(createMessageDetailLoader(async (folder, uid) => {
    const data = await api.fetchMessage(folder, uid);
    return data.message ? markMessageBodyLoaded(data.message) : undefined;
  }));
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
  const [undoSendMode, setUndoSendMode] = useState<'undo' | 'scheduled' | null>(null);
  const [undoSendDelaySeconds, setUndoSendDelaySeconds] = useState(0);
  const undoSendIdRef = useRef(undoSendId);
  useEffect(() => { undoSendIdRef.current = undoSendId; }, [undoSendId]);

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
  const identities = useMemo(() => mailIdentities(_opts.userIdentities), [_opts.userIdentities]);

  // Compose state
  const [isComposing, setIsComposing] = useState(false);
  const isComposingRef = useRef(isComposing);
  useEffect(() => { isComposingRef.current = isComposing; }, [isComposing]);
  const [composeDocked, setComposeDocked] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeReplyTo, setComposeReplyTo] = useState<string | null>(null);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [selectedComposeFrom, setComposeFrom] = useState('');
  const composeFrom = selectComposeFrom(
    selectedComposeFrom,
    identities,
    _opts.mailSettings.identity.defaultFrom,
  );
  const [composeSignature, setComposeSignature] = useState('none');
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [composeMode, setComposeMode] = useState<'rich' | 'plain'>('rich');
  const [draftUid, setDraftUid] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lastSendResult, setLastSendResult] = useState<SendMessageResponse | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveCoordinatorRef = useRef(createDraftSaveCoordinator());
  const draftSaveRevisionRef = useRef(0);

  // Inline reply state
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  const startCompose = useCallback((initial: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
  } = {}) => {
    if (isComposing) return;
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    draftSaveCoordinatorRef.current.reset();
    setDraftUid(null);
    setDraftId(null);
    setDraftSaveStatus(null);
    setComposeError(null);
    setLastSendResult(null);
    setComposeTo(initial.to || '');
    setComposeCc(initial.cc || '');
    setComposeBcc(initial.bcc || '');
    setComposeReplyTo(null);
    setComposeSubject(initial.subject || '');
    setComposeBody(initial.body || '');
    setComposeAttachments([]);
    setComposeFrom('');
    setComposeSignature('none');
    setComposeMode('rich');
    setShowCc(Boolean(initial.cc));
    setShowBcc(Boolean(initial.bcc));
    setComposeDocked(false);
    setIsComposing(true);
  }, [isComposing]);

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
          messageDetailLoaderRef.current.cached(folder, message.uid),
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

  const removeScheduledMessage = useCallback(async (scheduledId: number) => {
    await api.removeScheduledMessage(scheduledId);
    setMessages(current => current.filter(message => (
      message.scheduled_id !== scheduledId && message.uid !== scheduledId + 100000000
    )));
    await fetchFolders();
    return true;
  }, [fetchFolders, setMessages]);

  const saveCurrentDraft = useCallback(async (): Promise<boolean> => {
    const hasDraftContent = Boolean(
      composeTo || composeCc || composeBcc || composeSubject || composeBody || composeAttachments.length,
    );
    if (!hasDraftContent) {
      const existingDraft = await draftSaveCoordinatorRef.current.flush();
      if (!existingDraft.draftId && !existingDraft.draftUid) return true;
    }

    const saveRevision = ++draftSaveRevisionRef.current;
    setDraftSaveStatus('saving');
    try {
      const result = await draftSaveCoordinatorRef.current.enqueue(async currentDraft => {
        const formData = new FormData();
        const identityFields = outboundIdentityFields({
          from: composeFrom,
          replyTo: composeReplyTo ?? _opts.mailSettings.identity.replyTo,
          bcc: composeBcc,
          alwaysBccSelf: _opts.mailSettings.identity.alwaysBccSelf,
          selfAddress: _opts.userIdentities.address || composeFrom,
        });
        if (identityFields.from) formData.append('from', identityFields.from);
        if (identityFields.replyTo) formData.append('replyTo', identityFields.replyTo);
        if (identityFields.bcc) formData.append('bcc', identityFields.bcc);
        formData.append('to', composeTo);
        if (composeCc) formData.append('cc', composeCc);
        formData.append('subject', composeSubject || '(no subject)');
        formData.append('html', composeBody);
        if (currentDraft.draftId) formData.append('draftId', currentDraft.draftId);
        if (currentDraft.draftUid) formData.append('draftUid', currentDraft.draftUid);
        composeAttachments.forEach(file => formData.append('attachments', file));
        return api.saveDraft(formData);
      });
      if (result.draftId) setDraftId(result.draftId);
      if (result.draftUid) setDraftUid(result.draftUid);
      if (saveRevision === draftSaveRevisionRef.current) setDraftSaveStatus('saved');
      return true;
    } catch (error) {
      console.error('Draft save failed', error);
      if (saveRevision === draftSaveRevisionRef.current) setDraftSaveStatus('error');
      return false;
    }
  }, [composeAttachments, composeBcc, composeBody, composeCc, composeFrom, composeReplyTo,
    composeSubject, composeTo, _opts.mailSettings.identity.alwaysBccSelf,
    _opts.mailSettings.identity.replyTo, _opts.userIdentities.address]);

  const resumeDraft = useCallback(async (message: Message, folder: string) => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    await draftSaveCoordinatorRef.current.flush();
    const attachments = await hydrateDraftAttachments(message, folder);
    const state = draftComposeState(message, attachments);
    const restoredFrom = selectComposeFrom(
      state.from,
      identities,
      _opts.mailSettings.identity.defaultFrom,
    );
    const senderChanged = Boolean(
      identities.length > 0
      && state.from
      && restoredFrom.toLowerCase() !== state.from.toLowerCase(),
    );

    draftSaveCoordinatorRef.current.reset({
      draftId: state.draftId,
      draftUid: state.draftUid,
    });
    setDraftUid(state.draftUid);
    setDraftId(state.draftId);
    setDraftSaveStatus('saved');
    setComposeError(null);
    setLastSendResult(null);
    // Preserve the requested alias while identities are still loading. The
    // derived compose sender remains restricted to an allowed identity.
    setComposeFrom(state.from);
    setComposeTo(state.to);
    setComposeCc(state.cc);
    setComposeBcc(state.bcc);
    setComposeReplyTo(state.replyTo);
    setComposeSubject(state.subject);
    setComposeBody(state.body);
    setComposeAttachments(state.attachments);
    setComposeSignature('none');
    setComposeMode('rich');
    setShowCc(Boolean(state.cc));
    setShowBcc(Boolean(state.bcc));
    setComposeDocked(false);
    setIsComposing(true);
    return { senderChanged };
  }, [identities, _opts.mailSettings.identity.defaultFrom]);

  const cancelScheduledDelivery = useCallback(async (scheduledId: number) => {
    const undo = await api.undoAction({ scheduledId });
    if (undoSendIdRef.current === scheduledId) {
      setUndoSendId(null);
      setUndoSendMode(null);
      setUndoSendDelaySeconds(0);
    }
    try {
      return await reopenRestoredScheduledDraft(undo, {
        isComposerOpen: () => isComposingRef.current,
        fetchDraft: async (folder, uid) => {
          const data = await api.fetchMessage(folder, uid);
          return data.message;
        },
        resumeDraft,
      });
    } catch (error) {
      // Cancellation is already durable on the server. A local fetch/hydration
      // failure must not be reported as if the message were still scheduled.
      console.error('Cancelled message Draft could not be reopened', error);
      return {
        ...(undo.draftFolder ? { draftFolder: undo.draftFolder } : {}),
        ...(undo.draftUid ? { draftUid: undo.draftUid } : {}),
        reopened: false,
      };
    }
  }, [resumeDraft]);

  const cancelSendUndo = useCallback(async (scheduledId = undoSendId) => {
    if (!scheduledId) return { reopened: false };
    const restoration = await cancelScheduledDelivery(scheduledId);
    await fetchFolders();
    if (activeFolderRef.current.toUpperCase() === 'SCHEDULED') await fetchMessages('reset');
    return restoration;
  }, [cancelScheduledDelivery, fetchFolders, fetchMessages, undoSendId]);

  const cancelScheduledSend = useCallback(async (scheduledId: number) => {
    const restoration = await cancelScheduledDelivery(scheduledId);
    setMessages(current => current.filter(message => (
      message.scheduled_id !== scheduledId && message.uid !== scheduledId + 100000000
    )));
    await fetchFolders();
    return restoration;
  }, [cancelScheduledDelivery, fetchFolders, setMessages]);

  const closeComposer = useCallback(async (): Promise<boolean> => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    const saved = await saveCurrentDraft();
    if (saved) setIsComposing(false);
    return saved;
  }, [saveCurrentDraft]);

  // Compose send
  const handleSend = useCallback(async (sendAt?: Date | null) => {
    setSending(true);
    setComposeError(null);
    setLastSendResult(null);
    try {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      const currentDraft = await draftSaveCoordinatorRef.current.flush();
      const formData = new FormData();
      const identityFields = outboundIdentityFields({
        from: composeFrom,
        replyTo: composeReplyTo ?? _opts.mailSettings.identity.replyTo,
        bcc: composeBcc,
        alwaysBccSelf: _opts.mailSettings.identity.alwaysBccSelf,
        selfAddress: _opts.userIdentities.address || composeFrom,
      });
      if (identityFields.from) formData.append('from', identityFields.from);
      if (identityFields.replyTo) formData.append('replyTo', identityFields.replyTo);
      if (identityFields.bcc) formData.append('bcc', identityFields.bcc);
      formData.append('to', composeTo);
      if (composeCc) formData.append('cc', composeCc);
      formData.append('subject', composeSubject || '(no subject)');
      formData.append('html', composeBody);
      if (currentDraft.draftId) formData.append('draftId', currentDraft.draftId);
      if (currentDraft.draftUid) formData.append('draftUid', currentDraft.draftUid);
      composeAttachments.forEach((file) => {
        formData.append('attachments', file);
      });
      let delaySeconds = 0;
      let sendMode: 'undo' | 'scheduled' | null = null;
      if (sendAt && sendAt.getTime() > Date.now()) {
        delaySeconds = Math.ceil((sendAt.getTime() - Date.now()) / 1000);
        sendMode = 'scheduled';
      } else if (!sendAt && _opts.mailSettings.compose.undoSendSeconds > 0) {
        delaySeconds = _opts.mailSettings.compose.undoSendSeconds;
        sendMode = 'undo';
      }
      if (delaySeconds > 0) formData.append('delaySeconds', String(delaySeconds));
      const result = await api.sendMessage(formData);
      setLastSendResult(result);
      if (result.scheduledId && sendMode) {
        setUndoSendId(result.scheduledId);
        setUndoSendMode(sendMode);
        setUndoSendDelaySeconds(delaySeconds);
      } else {
        setUndoSendId(null);
        setUndoSendMode(null);
        setUndoSendDelaySeconds(0);
      }
      // Clear compose state on success
      setComposeTo(''); setComposeCc(''); setComposeBcc('');
      setComposeReplyTo(null);
      setComposeSubject(''); setComposeBody('');
      setComposeFrom(''); setComposeSignature('none');
      setComposeAttachments([]);
      setDraftUid(null); setDraftId(null);
      draftSaveCoordinatorRef.current.reset();
      setDraftSaveStatus(null);
      setShowCc(false); setShowBcc(false);
      setIsComposing(false);
      void Promise.all([fetchFolders(), fetchMessages()]);
      return true;
    } catch (e: unknown) {
      console.error('Send failed', e);
      setComposeError(errorMessage(e, 'Failed to send message'));
      return false;
    } finally {
      setSending(false);
    }
  }, [composeFrom, composeReplyTo, composeTo, composeCc, composeBcc, composeSubject, composeBody, composeAttachments,
    fetchFolders, fetchMessages, _opts.mailSettings.compose.undoSendSeconds, _opts.mailSettings.identity.alwaysBccSelf,
    _opts.mailSettings.identity.replyTo, _opts.userIdentities.address]);

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
      const replyFrom = selectComposeFrom(
        '',
        identities,
        _opts.mailSettings.identity.defaultFrom,
      );
      const identityFields = outboundIdentityFields({
        from: replyFrom,
        replyTo: _opts.mailSettings.identity.replyTo,
        alwaysBccSelf: _opts.mailSettings.identity.alwaysBccSelf,
        selfAddress: _opts.userIdentities.address || replyFrom,
      });
      if (identityFields.from) formData.append('from', identityFields.from);
      if (identityFields.replyTo) formData.append('replyTo', identityFields.replyTo);
      if (identityFields.bcc) formData.append('bcc', identityFields.bcc);
      formData.append('to', to);
      formData.append('subject', subject.startsWith('Re:') ? subject : `Re: ${subject}`);
      formData.append('body', replyText);
      formData.append('inReplyTo', inReplyTo);
      formData.append('references', references);
      const undoDelaySeconds = Math.max(0, Math.trunc(_opts.mailSettings.compose.undoSendSeconds));
      if (undoDelaySeconds > 0) formData.append('delaySeconds', String(undoDelaySeconds));
      const result = await api.sendMessage(formData);
      if (result.scheduledId && undoDelaySeconds > 0) {
        setUndoSendId(result.scheduledId);
        setUndoSendMode('undo');
        setUndoSendDelaySeconds(undoDelaySeconds);
      } else {
        setUndoSendId(null);
        setUndoSendMode(null);
        setUndoSendDelaySeconds(0);
      }
      setReplyText('');
      await fetchFolders();
      await fetchMessages();
      return result;
    } catch (e) {
      console.error('Reply failed', e);
      throw e;
    }
    finally { setReplySending(false); }
  }, [identities, replyText, fetchFolders, fetchMessages, _opts.mailSettings.compose.undoSendSeconds,
    _opts.mailSettings.identity.alwaysBccSelf, _opts.mailSettings.identity.defaultFrom,
    _opts.mailSettings.identity.replyTo, _opts.userIdentities.address]);

  // Fetch a single message body (full content)
  const fetchMessageBody = useCallback(async (uid: number, folderPath: string) => {
    try {
      const detail = await messageDetailLoaderRef.current.load(folderPath, uid);
      if (!detail || !mailboxPathsEqual(activeFolderRef.current, folderPath)) return;
      setMessages((prev) => prev.map((m) =>
        m.uid === uid ? mergeMessageDetails(m, detail) : m
      ));
      setViewingThread((prev) => {
        if (prev?.some((m) => m.uid === uid)) {
          return prev.map((m) => m.uid === uid ? mergeMessageDetails(m, detail) : m);
        }
        return [detail];
      });
    } catch (e) { console.error('Failed to fetch message body', e); }
  }, [setMessages]);

  // Pre-fetch message bodies in the background (non-blocking, silent)
  const prefetchBodies = useCallback((uids: number[], folderPath: string) => {
    for (const uid of uids) {
      if (messageDetailLoaderRef.current.cached(folderPath, uid)) continue;
      void messageDetailLoaderRef.current.load(folderPath, uid).then((detail) => {
        if (!detail || !mailboxPathsEqual(activeFolderRef.current, folderPath)) return;
        setMessages((prev) => prev.map((m) =>
          (m.folder || folderPath) === folderPath && m.uid === uid ? mergeMessageDetails(m, detail) : m
        ));
      }).catch(() => {});
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
        messageDetailLoaderRef.current.cached(folder, message.uid),
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
    if (!isComposing || sending) return;

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
    }

    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      void saveCurrentDraft();
    }, 2000);

    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [isComposing, saveCurrentDraft, sending]);

  return {
    folders, activeFolder, setActiveFolder, expandedFolders, setExpandedFolders: setExpandedPersisted,
    messages, setMessages, selectedMessages, setSelectedMessages,
    viewingThread, setViewingThread,
    mailLowestUid, mailMoreAvailable,
    mailLoading, isRefreshing, loadingOlderMessages, mailPaginationError,
    mailUndo, setMailUndo, undoSendId, undoSendMode, undoSendDelaySeconds, cancelSendUndo,
    searchQuery, setSearchQuery, updateSearchQuery, submitSearchQuery, resetSearchState, clearSearch, searchField, setSearchField, changeSearchField,
    searchScope, setSearchScope, changeSearchScope, isSearchActive, setIsSearchActive,
    searchLoading, searchError, searchInfo,
    mailError, setMailError,
    searchIndexStatus, searchWorkerStatus,
    savedSearches,
    showSearchHints, setShowSearchHints,
    isComposing, setIsComposing, startCompose, resumeDraft, composeDocked, setComposeDocked,
    showCc, setShowCc, showBcc, setShowBcc,
    composeTo, setComposeTo, composeCc, setComposeCc, composeBcc, setComposeBcc,
    composeReplyTo, setComposeReplyTo,
    composeSubject, setComposeSubject, composeBody, setComposeBody,
    composeFrom, setComposeFrom, composeIdentities: identities, composeSignature, setComposeSignature,
    composeAttachments, setComposeAttachments,
    composeMode, setComposeMode,
    draftUid, setDraftUid, draftId, setDraftId,
    draftSaveStatus, setDraftSaveStatus, composeError, setComposeError,
    sending, handleSend, lastSendResult, closeComposer,
    replyText, setReplyText, replySending, sendReply,
    signatures, setSignatures, rules, setRules,
    userQuota, loadedImagesForMsg, setLoadedImagesForMsg,
    fetchFolders, fetchMessages, fetchMessageBody, prefetchBodies, loadOlderMessages, refreshMessages,
    messageAction, undoAction, doSearch, snoozeMessages, cancelScheduledSend, removeScheduledMessage,
    mailSettings: _opts.mailSettings,
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
