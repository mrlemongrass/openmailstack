import { useState, useCallback, useEffect, useMemo, useRef, type SetStateAction } from 'react';
import type {
  Message, MailFolder, Signature, Rule, SavedSearch, FolderPathMutationResult,
  FolderMutationWarning,
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
import { createComposePreparationCoordinator } from '../compose-preparation-coordinator';
import { buildMessageComposeDraft, type MessageComposeAction } from '../message-compose-actions';
import { outboundIdentityFields } from '../outbound-identity';
import { reopenRestoredScheduledDraft } from '../scheduled-undo-draft';
import {
  reconcileFavoriteFolderReferences,
  removeFavoriteFolderReferences,
  remapExpandedFolderPaths,
  remapFavoriteFolderReferences,
  type FavoriteFolderReferences,
  type FavoriteFolderRenameCandidate,
} from '../folder-mutation-state';
import {
  checkProtectedOutboundSendAttempt,
  createBrowserOutboundSendAttemptCoordinator,
  sendOutboundMessage,
  UncertainSendBlockedError,
  type OutboundSendDelivery,
  type PreparedOutboundSendAttempt,
  type ProtectedOutboundSendCheck,
} from '../immediate-send';

interface UseMailOptions {
  mailSettings: MailUserSettings;
  mailSettingsReady: boolean;
  mailSettingsError: string;
  onRetryMailSettings: () => void;
  onFavoriteSettingsChange: (folders: MailUserSettings['folders']) => Promise<void>;
  isThreaded: boolean;
  userIdentities: UserIdentities;
}

interface PendingFavoritePersistence {
  references: FavoriteFolderReferences;
  action: 'moved' | 'renamed' | 'deleted';
}

export type ImmediateSendPhase = 'idle' | 'pending' | 'retryable' | 'uncertain' | 'blocked';

export interface ImmediateSendNotice {
  tone: 'info' | 'warning';
  message: string;
}

function protectedSendCheckFeedback(
  check: ProtectedOutboundSendCheck,
  subject: 'message' | 'reply',
  attempt?: PreparedOutboundSendAttempt,
): { phase: ImmediateSendPhase; notice: ImmediateSendNotice } {
  if (check.state === 'failed') {
    return {
      phase: 'idle',
      notice: {
        tone: 'info',
        message: `The earlier ${subject} definitively failed and was not delivered. You can safely send it now.`,
      },
    };
  }
  if (check.state === 'accepted') {
    return {
      phase: 'blocked',
      notice: {
        tone: 'info',
        message: `The earlier ${subject} was accepted for delivery. It was not sent again.`,
      },
    };
  }
  if (check.state === 'partial') {
    const rejectedCount = check.result?.rejectedRecipients?.length || 0;
    return {
      phase: 'blocked',
      notice: {
        tone: 'warning',
        message: rejectedCount > 0
          ? `The earlier ${subject} reached some recipients, but ${rejectedCount} ${rejectedCount === 1 ? 'recipient' : 'recipients'} rejected it. It was not sent again.`
          : `The earlier ${subject} reached only some recipients. It was not sent again.`,
      },
    };
  }
  if (check.state === 'scheduled') {
    const scheduledFor = check.result?.sendAt || attempt?.scheduledFor;
    const parsedSendAt = scheduledFor ? Date.parse(scheduledFor) : Number.NaN;
    const sendTime = Number.isFinite(parsedSendAt)
      ? ` for ${new Date(parsedSendAt).toLocaleString()}`
      : '';
    const scheduledMessage = attempt?.deliveryKind === 'undo'
      ? `The earlier ${subject} is already queued by Undo Send${sendTime}. It was not queued again.`
      : `The earlier ${subject} is already scheduled${sendTime}. It was not scheduled again.`;
    return {
      phase: 'blocked',
      notice: {
        tone: 'info',
        message: scheduledMessage,
      },
    };
  }
  if (check.state === 'pending') {
    return {
      phase: 'blocked',
      notice: {
        tone: 'info',
        message: `The earlier ${subject} is still pending. No new message was submitted.`,
      },
    };
  }
  if (check.state === 'uncertain') {
    return {
      phase: 'uncertain',
      notice: {
        tone: 'warning',
        message: `Delivery status for the earlier ${subject} is uncertain. Do not resend until you verify whether the recipient received it.`,
      },
    };
  }
  return {
    phase: 'blocked',
    notice: {
      tone: 'warning',
      message: `OpenMailStack could not check the earlier ${subject} right now. Its protected send key was retained, and no new message was submitted.`,
    },
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function mergeFolderMutationWarnings(
  warnings: FolderMutationWarning[] | undefined,
  warning: FolderMutationWarning | undefined,
): FolderMutationWarning[] | undefined {
  const merged = [...(warnings || []), ...(warning ? [warning] : [])];
  return merged.length ? [...new Set(merged)] : undefined;
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
  const mailSettings = _opts.mailSettings;
  const mailSettingsReady = _opts.mailSettingsReady;
  const onFavoriteSettingsChange = _opts.onFavoriteSettingsChange;
  // Folder state
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folderListReady, setFolderListReady] = useState(false);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const activeFolderRef = useRef(activeFolder);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('oms_expanded_folders');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const configuredFavoriteFolders = mailSettings.folders?.favorites;
  const favoriteFolders = useMemo(
    () => configuredFavoriteFolders || [],
    [configuredFavoriteFolders],
  );
  const configuredFavoriteUidValidities = mailSettings.folders?.favoriteUidValidities;
  const favoriteUidValidities = useMemo(
    () => configuredFavoriteUidValidities || {},
    [configuredFavoriteUidValidities],
  );
  const favoriteReferences = useMemo<FavoriteFolderReferences>(() => ({
    paths: favoriteFolders,
    uidValidities: favoriteUidValidities,
  }), [favoriteFolders, favoriteUidValidities]);
  const favoriteReconciliation = useMemo(() => reconcileFavoriteFolderReferences(
    favoriteReferences,
    folders,
  ), [favoriteReferences, folders]);
  const [dismissedFavoriteRenameCandidates, setDismissedFavoriteRenameCandidates] = useState<string[]>([]);
  const favoriteRenameCandidates = useMemo(() => folderListReady
    ? favoriteReconciliation.renameCandidates.filter(candidate => (
        !dismissedFavoriteRenameCandidates.includes(
          `${candidate.fromPath}\u0000${candidate.toPath}\u0000${candidate.uidValidity}`,
        )
      ))
    : [], [dismissedFavoriteRenameCandidates, favoriteReconciliation.renameCandidates, folderListReady]);
  const [dismissedUnavailableFavoritePaths, setDismissedUnavailableFavoritePaths] = useState<string[]>([]);
  const unavailableFavoritePaths = useMemo(() => folderListReady
    ? favoriteReconciliation.unresolvedPaths.filter(path => (
        !dismissedUnavailableFavoritePaths.includes(path)
      ))
    : [], [dismissedUnavailableFavoritePaths, favoriteReconciliation.unresolvedPaths, folderListReady]);
  const [folderMutationPending, setFolderMutationPending] = useState(false);
  const folderMutationPendingRef = useRef(false);
  const folderRequestIdRef = useRef(0);
  const favoriteReconciliationAttemptRef = useRef('');
  const [pendingFavoritePersistence, setPendingFavoritePersistence] = useState<PendingFavoritePersistence | null>(null);
  const pendingFavoritePersistenceRef = useRef<PendingFavoritePersistence | null>(null);
  const updatePendingFavoritePersistence = useCallback((pending: PendingFavoritePersistence | null) => {
    pendingFavoritePersistenceRef.current = pending;
    setPendingFavoritePersistence(pending);
  }, []);
  const runFolderMutation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (folderMutationPendingRef.current) {
      throw new Error('Wait for the current folder change to finish.');
    }
    folderMutationPendingRef.current = true;
    setFolderMutationPending(true);
    try {
      return await operation();
    } finally {
      folderMutationPendingRef.current = false;
      setFolderMutationPending(false);
    }
  }, []);

  // Persist expanded state to localStorage
  const setExpandedPersisted = useCallback((updater: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setExpandedFolders((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('oms_expanded_folders', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

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
  const [markingReadFolder, setMarkingReadFolder] = useState<string | null>(null);
  const markingReadFolderRef = useRef<string | null>(null);
  const refreshAfterFolderMarkReadRef = useRef<(path: string) => Promise<boolean>>(async () => true);

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
  const [composeInReplyTo, setComposeInReplyTo] = useState('');
  const [composeReferences, setComposeReferences] = useState('');
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
  const [composeAttachmentRevision, setComposeAttachmentRevision] = useState(0);
  const [composeMode, setComposeMode] = useState<'rich' | 'plain'>('plain');
  const [draftUid, setDraftUid] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lastSendResult, setLastSendResult] = useState<SendMessageResponse | null>(null);
  const [immediateSendPhase, setImmediateSendPhase] = useState<ImmediateSendPhase>('idle');
  const [immediateSendNotice, setImmediateSendNotice] = useState<ImmediateSendNotice | null>(null);
  const [protectedSendAttempt, setProtectedSendAttempt] = useState<PreparedOutboundSendAttempt | null>(null);
  const [checkingEarlierComposeSend, setCheckingEarlierComposeSend] = useState(false);
  const [outboundRecoveryNotice, setOutboundRecoveryNotice] = useState<ImmediateSendNotice | null>(null);
  const immediateSendAttemptsRef = useRef(createBrowserOutboundSendAttemptCoordinator());
  const replySendAttemptsRef = useRef(createBrowserOutboundSendAttemptCoordinator());
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveCoordinatorRef = useRef(createDraftSaveCoordinator());
  const draftSaveRevisionRef = useRef(0);
  const composePreparationCoordinatorRef = useRef(createComposePreparationCoordinator());

  // Inline reply state
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replySendPhase, setReplySendPhase] = useState<ImmediateSendPhase>('idle');
  const [replySendNotice, setReplySendNotice] = useState<ImmediateSendNotice | null>(null);
  const [replySendScope, setReplySendScope] = useState<string | null>(null);
  const [protectedReplySend, setProtectedReplySend] = useState<{
    attempt: PreparedOutboundSendAttempt;
    scope: string;
  } | null>(null);
  const [checkingEarlierReplySend, setCheckingEarlierReplySend] = useState(false);

  useEffect(() => {
    const mailbox = _opts.userIdentities.address.trim().toLowerCase();
    let active = true;
    queueMicrotask(() => {
      if (active) setOutboundRecoveryNotice(null);
    });
    if (!mailbox) return () => { active = false; };
    void immediateSendAttemptsRef.current.reconcileMailbox(
      mailbox,
      api.fetchOutboundMessageStatusByKey,
    ).then(result => {
      if (!active || result.checked === 0) return;
      if (result.uncertain > 0) {
        setOutboundRecoveryNotice({
          tone: 'warning',
          message: `${result.uncertain} earlier send ${result.uncertain === 1 ? 'has' : 'have'} an uncertain delivery status. Do not resend without verifying delivery.`,
        });
      } else if (result.failed > 0) {
        setOutboundRecoveryNotice({
          tone: 'warning',
          message: `${result.failed} earlier ${result.failed === 1 ? 'message was' : 'messages were'} not sent. You can safely retry from the original Draft when available.`,
        });
      } else if (result.partial > 0) {
        setOutboundRecoveryNotice({
          tone: 'warning',
          message: `${result.partial} earlier ${result.partial === 1 ? 'message reached' : 'messages reached'} only some recipients. Review the delivery result before retrying.`,
        });
      } else if (result.pending > 0) {
        setOutboundRecoveryNotice({
          tone: 'info',
          message: `OpenMailStack is still confirming ${result.pending} earlier ${result.pending === 1 ? 'send' : 'sends'}. You do not need to resend.`,
        });
      } else if (result.unavailable > 0) {
        setOutboundRecoveryNotice({
          tone: 'info',
          message: `OpenMailStack could not confirm ${result.unavailable} earlier ${result.unavailable === 1 ? 'send' : 'sends'} yet. Protected retry information was retained.`,
        });
      } else if (result.scheduled > 0) {
        setOutboundRecoveryNotice({
          tone: 'info',
          message: `OpenMailStack confirmed ${result.scheduled} earlier scheduled ${result.scheduled === 1 ? 'send' : 'sends'}.`,
        });
      } else if (result.accepted > 0) {
        setOutboundRecoveryNotice({
          tone: 'info',
          message: `OpenMailStack confirmed ${result.accepted} earlier ${result.accepted === 1 ? 'send' : 'sends'}.`,
        });
      }
    }).catch(error => {
      console.error('Outbound send recovery failed', error);
      if (!active) return;
      setOutboundRecoveryNotice({
        tone: 'warning',
        message: 'OpenMailStack could not check earlier send status right now. Do not resend those messages until their status can be confirmed.',
      });
    });
    return () => { active = false; };
  }, [_opts.userIdentities.address]);

  const composeContentFingerprint = useMemo(() => {
    const identity = outboundIdentityFields({
      from: composeFrom,
      replyTo: composeReplyTo ?? _opts.mailSettings.identity.replyTo,
      bcc: composeBcc,
      alwaysBccSelf: _opts.mailSettings.identity.alwaysBccSelf,
      selfAddress: _opts.userIdentities.address || composeFrom,
    });
    const attachments = composeAttachments.map(file => (
      [file.name, file.size, file.type, file.lastModified, file.webkitRelativePath]
    ));
    return JSON.stringify([
      composeAttachmentRevision,
      identity.from || '',
      identity.replyTo || '',
      identity.bcc || '',
      composeTo,
      composeCc,
      composeSubject || '(no subject)',
      composeBody,
      composeMode,
      composeInReplyTo,
      composeReferences,
      attachments,
    ]);
  }, [composeAttachmentRevision, composeAttachments, composeBcc, composeBody, composeCc, composeFrom, composeMode,
    composeInReplyTo, composeReferences, composeReplyTo, composeSubject, composeTo,
    _opts.mailSettings.identity.alwaysBccSelf,
    _opts.mailSettings.identity.replyTo, _opts.userIdentities.address]);

  const updateComposeAttachments = useCallback((update: SetStateAction<File[]>) => {
    setComposeAttachments(update);
    setComposeAttachmentRevision(revision => revision + 1);
  }, []);

  const observedComposeFingerprintRef = useRef(composeContentFingerprint);
  useEffect(() => {
    if (observedComposeFingerprintRef.current === composeContentFingerprint) return;
    observedComposeFingerprintRef.current = composeContentFingerprint;
    setImmediateSendPhase('idle');
    setImmediateSendNotice(null);
    setProtectedSendAttempt(null);
  }, [composeContentFingerprint]);

  const observedReplyTextRef = useRef(replyText);
  useEffect(() => {
    if (observedReplyTextRef.current === replyText) return;
    observedReplyTextRef.current = replyText;
    setReplySendPhase('idle');
    setReplySendNotice(null);
    setReplySendScope(null);
    setProtectedReplySend(null);
  }, [replyText]);

  const claimComposeIntent = useCallback((requestId: number) => {
    if (isComposingRef.current) return false;
    if (!composePreparationCoordinatorRef.current.claim(requestId)) return false;
    isComposingRef.current = true;
    return true;
  }, []);

  const startCompose = useCallback((initial: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    inReplyTo?: string;
    references?: string;
  } = {}, preparationRequestId?: number) => {
    const requestId = preparationRequestId ?? composePreparationCoordinatorRef.current.begin();
    if (!claimComposeIntent(requestId)) return false;
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
    setImmediateSendPhase('idle');
    setImmediateSendNotice(null);
    setProtectedSendAttempt(null);
    setComposeTo(initial.to || '');
    setComposeCc(initial.cc || '');
    setComposeBcc(initial.bcc || '');
    setComposeReplyTo(null);
    setComposeInReplyTo(initial.inReplyTo || '');
    setComposeReferences(initial.references || '');
    setComposeSubject(initial.subject || '');
    setComposeBody(initial.body || '');
    setComposeAttachments([]);
    setComposeFrom('');
    setComposeSignature('none');
    setComposeMode('plain');
    setShowCc(Boolean(initial.cc));
    setShowBcc(Boolean(initial.bcc));
    setComposeDocked(false);
    setIsComposing(true);
    return true;
  }, [claimComposeIntent]);

  // ---- Data fetching (must be before handleSend) ----
  const fetchFolders = useCallback(async () => {
    const requestId = ++folderRequestIdRef.current;
    setFolderListReady(false);
    try {
      const folderList = await api.fetchFolders();
      if (requestId !== folderRequestIdRef.current) return true;
      favoriteReconciliationAttemptRef.current = '';
      setFolders(folderList);
      setFolderListReady(true);
      setMailError('');
      return true;
    } catch (e: unknown) {
      if (requestId !== folderRequestIdRef.current) return true;
      setMailError(errorMessage(e, 'Failed to load folders'));
      console.error('Failed to fetch folders', e);
      return false;
    }
  }, []);

  const createFolder = useCallback(async (parent: string | null, name: string) => {
    const folder = await api.createFolder(parent, name);
    if (parent) setExpandedPersisted(previous => ({ ...previous, [parent]: true }));
    await fetchFolders();
    return folder.path;
  }, [fetchFolders, setExpandedPersisted]);

  const persistFavoriteFolders = useCallback(async (
    references: FavoriteFolderReferences,
  ) => {
    if (!mailSettingsReady) {
      throw new Error('Favorites are still loading. Try again in a moment.');
    }
    await onFavoriteSettingsChange({
      favorites: references.paths,
      favoriteUidValidities: references.uidValidities,
    });
  }, [mailSettingsReady, onFavoriteSettingsChange]);

  const persistFolderMutationFavorites = useCallback(async (
    nextReferences: FavoriteFolderReferences,
    action: 'moved' | 'renamed' | 'deleted',
  ): Promise<FolderMutationWarning | undefined> => {
    if (JSON.stringify(nextReferences) === JSON.stringify(favoriteReferences)) return undefined;
    try {
      await persistFavoriteFolders(nextReferences);
      updatePendingFavoritePersistence(null);
      return undefined;
    } catch (error) {
      console.error(`Failed to preserve Favorites after folder ${action}`, error);
      updatePendingFavoritePersistence({ references: nextReferences, action });
      return 'FAVORITES_NOT_RECONCILED';
    }
  }, [favoriteReferences, persistFavoriteFolders, updatePendingFavoritePersistence]);

  useEffect(() => {
    if (!mailSettingsReady
      || folderMutationPending
      || folderMutationPendingRef.current
      || pendingFavoritePersistence
      || !folderListReady
      || folders.length === 0) {
      return;
    }
    if (!favoriteReconciliation.changed) return;

    const attemptKey = JSON.stringify(favoriteReconciliation.references);
    if (favoriteReconciliationAttemptRef.current === attemptKey) return;
    favoriteReconciliationAttemptRef.current = attemptKey;

    void runFolderMutation(() => persistFavoriteFolders(
      favoriteReconciliation.references,
    )).catch(error => {
      console.error('Failed to record Favorite folder identity', error);
    });
  }, [
    favoriteReconciliation,
    folderMutationPending,
    folderListReady,
    folders,
    mailSettingsReady,
    pendingFavoritePersistence,
    persistFavoriteFolders,
    runFolderMutation,
  ]);

  const retryFavoritePersistence = useCallback(async () => {
    const pending = pendingFavoritePersistenceRef.current;
    if (!pending) return;
    await runFolderMutation(async () => {
      await persistFavoriteFolders(pending.references);
      if (pendingFavoritePersistenceRef.current === pending) {
        updatePendingFavoritePersistence(null);
      }
    });
  }, [persistFavoriteFolders, runFolderMutation, updatePendingFavoritePersistence]);

  const confirmFavoriteRename = useCallback(async (candidate: FavoriteFolderRenameCandidate) => {
    if (!folderListReady) {
      throw new Error('Refresh Mail before updating this Favorite.');
    }
    if (pendingFavoritePersistenceRef.current) {
      throw new Error('Retry the pending Favorites update before changing another folder.');
    }
    const currentCandidate = favoriteReconciliation.renameCandidates.find(item => (
      item.fromPath === candidate.fromPath
      && item.toPath === candidate.toPath
      && item.uidValidity === candidate.uidValidity
    ));
    if (!currentCandidate) {
      throw new Error('That folder changed again. Refresh Mail and review the new location.');
    }
    const nextReferences = remapFavoriteFolderReferences(
      favoriteReferences,
      candidate.fromPath,
      candidate.toPath,
      '',
      '',
      new Set([candidate.fromPath]),
    );
    await runFolderMutation(() => persistFavoriteFolders(nextReferences));
  }, [favoriteReconciliation.renameCandidates, favoriteReferences, folderListReady, persistFavoriteFolders, runFolderMutation]);

  const dismissFavoriteRename = useCallback((candidate: FavoriteFolderRenameCandidate) => {
    const key = `${candidate.fromPath}\u0000${candidate.toPath}\u0000${candidate.uidValidity}`;
    setDismissedFavoriteRenameCandidates(current => current.includes(key) ? current : [...current, key]);
  }, []);

  const removeUnavailableFavorite = useCallback(async (path: string) => {
    if (!folderListReady) {
      throw new Error('Refresh Mail before removing this Favorite.');
    }
    if (pendingFavoritePersistenceRef.current) {
      throw new Error('Retry the pending Favorites update before changing another folder.');
    }
    if (!favoriteReconciliation.unresolvedPaths.includes(path)) {
      throw new Error('That Favorite changed again. Refresh Mail and review it.');
    }
    await runFolderMutation(() => persistFavoriteFolders(
      removeFavoriteFolderReferences(favoriteReferences, path, ''),
    ));
  }, [favoriteReconciliation.unresolvedPaths, favoriteReferences, folderListReady, persistFavoriteFolders, runFolderMutation]);

  const dismissUnavailableFavorite = useCallback((path: string) => {
    setDismissedUnavailableFavoritePaths(current => current.includes(path) ? current : [...current, path]);
  }, []);

  const moveFolder = useCallback(async (path: string, parent: string | null) => {
    if (!mailSettingsReady) {
      throw new Error('Wait for Favorites to finish loading before moving folders.');
    }
    if (pendingFavoritePersistenceRef.current) {
      throw new Error('Retry the pending Favorites update before changing another folder.');
    }
    const sourceFolder = folders.find(folder => folder.path === path);
    const parentFolder = parent === null ? null : folders.find(folder => folder.path === parent);
    if (!sourceFolder?.uidValidity || (parent !== null && !parentFolder?.uidValidity)) {
      throw new Error('The folder list changed. Refresh Mail and try again.');
    }
    return runFolderMutation(async () => {
      const sourceDelimiter = sourceFolder.delimiter || '/';
      const result = await api.moveFolder(
        path,
        parent,
        sourceFolder.uidValidity as string,
        parentFolder?.uidValidity,
      );
      setExpandedPersisted(previous => remapExpandedFolderPaths(
        previous,
        path,
        result.folder.path,
        sourceDelimiter,
        result.folder.delimiter || sourceDelimiter,
      ));
      if (parent) setExpandedPersisted(previous => ({ ...previous, [parent]: true }));
      await fetchFolders();
      const favoriteWarning = await persistFolderMutationFavorites(remapFavoriteFolderReferences(
        favoriteReferences,
        path,
        result.folder.path,
        sourceDelimiter,
        result.folder.delimiter || sourceDelimiter,
        new Set(favoriteReconciliation.visiblePaths),
      ), 'moved');
      const warnings = mergeFolderMutationWarnings(result.warnings, favoriteWarning);
      return {
        path: result.folder.path,
        delimiter: typeof result.folder.delimiter === 'string'
          ? result.folder.delimiter
          : sourceDelimiter,
        ...(warnings ? { warnings } : {}),
      } satisfies FolderPathMutationResult;
    });
  }, [favoriteReconciliation.visiblePaths, favoriteReferences, fetchFolders, folders, mailSettingsReady, persistFolderMutationFavorites, runFolderMutation, setExpandedPersisted]);

  const renameFolder = useCallback(async (path: string, name: string) => {
    if (!mailSettingsReady) {
      throw new Error('Wait for Favorites to finish loading before renaming folders.');
    }
    if (pendingFavoritePersistenceRef.current) {
      throw new Error('Retry the pending Favorites update before changing another folder.');
    }
    const sourceFolder = folders.find(folder => folder.path === path);
    if (!sourceFolder?.uidValidity) {
      throw new Error('The folder list changed. Refresh Mail and try again.');
    }
    return runFolderMutation(async () => {
      const sourceDelimiter = sourceFolder.delimiter || '/';
      const result = await api.renameFolder(path, name, sourceFolder.uidValidity as string);
      setExpandedPersisted(previous => remapExpandedFolderPaths(
        previous,
        path,
        result.folder.path,
        sourceDelimiter,
        result.folder.delimiter || sourceDelimiter,
      ));
      await fetchFolders();
      const favoriteWarning = await persistFolderMutationFavorites(remapFavoriteFolderReferences(
        favoriteReferences,
        path,
        result.folder.path,
        sourceDelimiter,
        result.folder.delimiter || sourceDelimiter,
        new Set(favoriteReconciliation.visiblePaths),
      ), 'renamed');
      const warnings = mergeFolderMutationWarnings(result.warnings, favoriteWarning);
      return {
        path: result.folder.path,
        delimiter: typeof result.folder.delimiter === 'string'
          ? result.folder.delimiter
          : sourceDelimiter,
        ...(warnings ? { warnings } : {}),
      } satisfies FolderPathMutationResult;
    });
  }, [favoriteReconciliation.visiblePaths, favoriteReferences, fetchFolders, folders, mailSettingsReady, persistFolderMutationFavorites, runFolderMutation, setExpandedPersisted]);

  const deleteFolder = useCallback(async (path: string, permanent: boolean) => {
    if (!mailSettingsReady) {
      throw new Error('Wait for Favorites to finish loading before deleting folders.');
    }
    if (pendingFavoritePersistenceRef.current) {
      throw new Error('Retry the pending Favorites update before changing another folder.');
    }
    const sourceFolder = folders.find(folder => folder.path === path);
    if (!sourceFolder?.uidValidity) {
      throw new Error('The folder list changed. Refresh Mail and try again.');
    }
    return runFolderMutation(async () => {
      const sourceDelimiter = sourceFolder.delimiter || '/';
      const result = await api.deleteFolder(path, permanent, sourceFolder.uidValidity as string);
      if (result.disposition === 'trashed') {
        const destinationDelimiter = result.folder.delimiter || sourceDelimiter;
        const trashPath = destinationDelimiter && result.folder.path.includes(destinationDelimiter)
          ? result.folder.path.slice(0, result.folder.path.lastIndexOf(destinationDelimiter))
          : '';
        setExpandedPersisted(previous => ({
          ...remapExpandedFolderPaths(
            previous,
            path,
            result.folder.path,
            sourceDelimiter,
            destinationDelimiter,
          ),
          ...(trashPath ? { [trashPath]: true } : {}),
        }));
      } else {
        setExpandedPersisted(previous => Object.fromEntries(
          Object.entries(previous).filter(([folderPath]) => (
            folderPath !== path
            && !(sourceDelimiter && folderPath.startsWith(`${path}${sourceDelimiter}`))
          )),
        ));
      }
      await fetchFolders();
      const nextReferences = result.disposition === 'trashed'
        ? remapFavoriteFolderReferences(
            favoriteReferences,
            path,
            result.folder.path,
            sourceDelimiter,
            result.folder.delimiter || sourceDelimiter,
            new Set(favoriteReconciliation.visiblePaths),
          )
        : removeFavoriteFolderReferences(
            favoriteReferences,
            path,
            sourceDelimiter,
            new Set(favoriteReconciliation.visiblePaths),
          );
      const favoriteWarning = await persistFolderMutationFavorites(
        nextReferences,
        result.disposition === 'trashed' ? 'moved' : 'deleted',
      );
      const warnings = mergeFolderMutationWarnings(result.warnings, favoriteWarning);
      return warnings ? { ...result, warnings } : result;
    });
  }, [favoriteReconciliation.visiblePaths, favoriteReferences, fetchFolders, folders, mailSettingsReady, persistFolderMutationFavorites, runFolderMutation, setExpandedPersisted]);

  const retryFolderSearchCleanup = useCallback(async () => {
    await api.purgeSearchIndex();
  }, []);

  const toggleFavoriteFolder = useCallback(async (path: string) => {
    if (pendingFavoritePersistenceRef.current) {
      throw new Error('Retry the pending Favorites update before changing another folder.');
    }
    const folder = folders.find(candidate => candidate.path === path);
    if (!folder || folder.disabled || path.toUpperCase() === 'SCHEDULED') {
      throw new Error('That folder cannot be added to Favorites.');
    }
    const isConfigured = favoriteReferences.paths.includes(path);
    const isVisible = favoriteReconciliation.visiblePaths.includes(path);
    if (!isConfigured && favoriteReferences.paths.length >= 100) {
      throw new Error('Favorites can include up to 100 folders. Remove one before adding another.');
    }
    let nextReferences: FavoriteFolderReferences;
    if (isVisible) {
      nextReferences = removeFavoriteFolderReferences(favoriteReferences, path, '');
    } else if (isConfigured) {
      nextReferences = {
        paths: [...favoriteReferences.paths],
        uidValidities: {
          ...favoriteReferences.uidValidities,
          ...(folder.uidValidity ? { [path]: folder.uidValidity } : {}),
        },
      };
    } else {
      nextReferences = {
        paths: [...favoriteReferences.paths, path],
        uidValidities: {
          ...favoriteReferences.uidValidities,
          ...(folder.uidValidity ? { [path]: folder.uidValidity } : {}),
        },
      };
    }
    await runFolderMutation(() => persistFavoriteFolders(nextReferences));
  }, [favoriteReconciliation.visiblePaths, favoriteReferences, folders, persistFavoriteFolders, runFolderMutation]);

  const markFolderRead = useCallback(async (path: string) => {
    if (markingReadFolderRef.current) {
      throw new Error(
        markingReadFolderRef.current === path
          ? 'This folder is already being marked as read.'
          : 'Wait for the current mark-all-read action to finish.',
      );
    }
    markingReadFolderRef.current = path;
    setMarkingReadFolder(path);
    try {
      const result = await api.markFolderRead(path);
      const foldersRefreshed = await fetchFolders();
      const viewRefreshed = await refreshAfterFolderMarkReadRef.current(result.path);
      if (!foldersRefreshed || !viewRefreshed) {
        const message = 'Messages were marked as read, but Mail could not refresh the current view. Use Refresh to try again.';
        setMailError(message);
        throw new Error(message);
      }
      return result.marked;
    } finally {
      markingReadFolderRef.current = null;
      setMarkingReadFolder(null);
    }
  }, [fetchFolders]);

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
        if (requestId !== messageRequestIdRef.current || activeFolderRef.current !== folder) return true;
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
      return true;
    } catch (e: unknown) {
      if (requestId === messageRequestIdRef.current && activeFolderRef.current === folder) {
        setMailError(errorMessage(e, 'Failed to load messages'));
        console.error('Failed to fetch messages', e);
        return false;
      }
      console.error('Failed to fetch messages', e);
      return true;
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
        const composeBodyField = composeMode === 'rich' ? 'html' : 'text';
        formData.append(composeBodyField, composeBody);
        if (composeInReplyTo) formData.append('inReplyTo', composeInReplyTo);
        if (composeReferences) formData.append('references', composeReferences);
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
  }, [composeAttachments, composeBcc, composeBody, composeCc, composeFrom, composeInReplyTo, composeMode,
    composeReferences, composeReplyTo, composeSubject, composeTo, _opts.mailSettings.identity.alwaysBccSelf,
    _opts.mailSettings.identity.replyTo, _opts.userIdentities.address]);

  const resumeDraft = useCallback(async (message: Message, folder: string) => {
    const requestId = composePreparationCoordinatorRef.current.begin();
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
    if (!claimComposeIntent(requestId)) return { senderChanged: false, opened: false };

    draftSaveCoordinatorRef.current.reset({
      draftId: state.draftId,
      draftUid: state.draftUid,
    });
    setDraftUid(state.draftUid);
    setDraftId(state.draftId);
    setDraftSaveStatus('saved');
    setComposeError(null);
    setLastSendResult(null);
    setImmediateSendPhase('idle');
    setImmediateSendNotice(null);
    setProtectedSendAttempt(null);
    // Preserve the requested alias while identities are still loading. The
    // derived compose sender remains restricted to an allowed identity.
    setComposeFrom(state.from);
    setComposeTo(state.to);
    setComposeCc(state.cc);
    setComposeBcc(state.bcc);
    setComposeReplyTo(state.replyTo);
    setComposeInReplyTo(state.inReplyTo);
    setComposeReferences(state.references);
    setComposeSubject(state.subject);
    setComposeBody(state.body);
    setComposeAttachments(state.attachments);
    setComposeSignature('none');
    setComposeMode(state.mode);
    setShowCc(Boolean(state.cc));
    setShowBcc(Boolean(state.bcc));
    setComposeDocked(false);
    setIsComposing(true);
    return { senderChanged, opened: true };
  }, [claimComposeIntent, identities, _opts.mailSettings.identity.defaultFrom]);

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
    if (saved) {
      isComposingRef.current = false;
      setIsComposing(false);
    }
    return saved;
  }, [saveCurrentDraft]);

  const finishComposeAfterConfirmedSend = useCallback(() => {
    setComposeTo(''); setComposeCc(''); setComposeBcc('');
    setComposeReplyTo(null);
    setComposeInReplyTo(''); setComposeReferences('');
    setComposeSubject(''); setComposeBody('');
    setComposeFrom(''); setComposeSignature('none');
    setComposeMode('plain');
    setComposeAttachments([]);
    setDraftUid(null); setDraftId(null);
    draftSaveCoordinatorRef.current.reset();
    setDraftSaveStatus(null);
    setShowCc(false); setShowBcc(false);
    isComposingRef.current = false;
    setIsComposing(false);
    void Promise.all([fetchFolders(), fetchMessages()]);
  }, [fetchFolders, fetchMessages]);

  // Compose send
  const handleSend = useCallback(async (sendAt?: Date | null) => {
    let preparedAttempt: PreparedOutboundSendAttempt | null = null;
    setSending(true);
    setComposeError(null);
    setLastSendResult(null);
    try {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      if (!await saveCurrentDraft()) {
        setComposeError('Your latest Draft could not be saved, so no message was submitted. Try again.');
        return false;
      }
      const currentDraft = await draftSaveCoordinatorRef.current.flush();
      if (!currentDraft.draftId) {
        throw new Error('A stable Draft ID could not be established. No message was submitted.');
      }
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
      const composeBodyField = composeMode === 'rich' ? 'html' : 'text';
      formData.append(composeBodyField, composeBody);
      if (composeInReplyTo) formData.append('inReplyTo', composeInReplyTo);
      if (composeReferences) formData.append('references', composeReferences);
      formData.append('draftId', currentDraft.draftId);
      if (currentDraft.draftUid) formData.append('draftUid', currentDraft.draftUid);
      composeAttachments.forEach((file) => {
        formData.append('attachments', file);
      });
      const requestedAt = Date.now();
      let delaySeconds = 0;
      let delivery: OutboundSendDelivery = { kind: 'immediate' };
      if (sendAt && sendAt.getTime() > requestedAt) {
        delaySeconds = Math.ceil((sendAt.getTime() - requestedAt) / 1000);
        delivery = { kind: 'scheduled', scheduledFor: sendAt.toISOString() };
      } else if (!sendAt && _opts.mailSettings.compose.undoSendSeconds > 0) {
        delaySeconds = _opts.mailSettings.compose.undoSendSeconds;
        delivery = {
          kind: 'undo',
          scheduledFor: new Date(requestedAt + delaySeconds * 1000).toISOString(),
        };
      }
      let preparedDeliveryKind = delivery.kind;
      let preparedScheduledFor = delivery.scheduledFor;
      const result = await sendOutboundMessage({
        scope: {
          mailbox: _opts.userIdentities.address || identityFields.from || '',
          draftId: currentDraft.draftId,
        },
        formData,
        delivery,
        attempts: immediateSendAttemptsRef.current,
        submit: (payload, idempotencyKey) => api.sendMessage(payload, { idempotencyKey }),
        loadStatus: api.fetchOutboundMessageStatus,
        onPrepared: attempt => {
          preparedAttempt = attempt;
          preparedDeliveryKind = attempt.deliveryKind;
          preparedScheduledFor = attempt.scheduledFor;
        },
        onPending: () => {
          setImmediateSendPhase('pending');
          setImmediateSendNotice({
            tone: 'info',
            message: 'OpenMailStack accepted this send request and is confirming delivery.',
          });
        },
      });
      setLastSendResult(result);
      if (result.deliveryStatus === 'failed') {
        setProtectedSendAttempt(null);
        setImmediateSendPhase('idle');
        setImmediateSendNotice(null);
        setComposeError(result.error
          ? `Message was not sent: ${result.error}`
          : 'Message was not sent. You can safely try again.');
        return false;
      }
      if (result.deliveryStatus === 'uncertain') {
        setProtectedSendAttempt(preparedAttempt);
        setImmediateSendPhase('uncertain');
        setImmediateSendNotice({
          tone: 'warning',
          message: 'Delivery status is uncertain. Do not resend until you verify whether the recipient received it.',
        });
        return false;
      }
      setImmediateSendPhase('idle');
      setImmediateSendNotice(null);
      setProtectedSendAttempt(null);
      if (result.scheduledId && preparedDeliveryKind !== 'immediate') {
        const authoritativeSendAt = result.sendAt || preparedScheduledFor;
        const effectiveDelaySeconds = authoritativeSendAt
          ? Math.max(0, Math.ceil((Date.parse(authoritativeSendAt) - Date.now()) / 1000))
          : delaySeconds;
        setUndoSendId(result.scheduledId);
        setUndoSendMode(preparedDeliveryKind);
        setUndoSendDelaySeconds(effectiveDelaySeconds);
      } else {
        setUndoSendId(null);
        setUndoSendMode(null);
        setUndoSendDelaySeconds(0);
      }
      finishComposeAfterConfirmedSend();
      return true;
    } catch (e: unknown) {
      console.error('Send failed', e);
      if (e instanceof UncertainSendBlockedError) {
        setImmediateSendPhase(e.reason === 'delivery_uncertain' ? 'uncertain' : 'blocked');
        setProtectedSendAttempt(preparedAttempt);
        setImmediateSendNotice({ tone: 'warning', message: e.message });
      } else if (!api.isDefinitiveSendError(e)) {
        setImmediateSendPhase('retryable');
        setImmediateSendNotice({
          tone: 'info',
          message: 'Delivery was not confirmed. Use “Check delivery” to safely continue the same send attempt.',
        });
      } else {
        setImmediateSendPhase('idle');
        setImmediateSendNotice(null);
        setProtectedSendAttempt(null);
        setComposeError(errorMessage(e, 'Failed to send message'));
      }
      return false;
    } finally {
      setSending(false);
    }
  }, [composeFrom, composeInReplyTo, composeReferences, composeReplyTo, composeTo, composeCc, composeBcc,
    composeSubject, composeBody, composeMode, composeAttachments,
    finishComposeAfterConfirmedSend, saveCurrentDraft,
    _opts.mailSettings.compose.undoSendSeconds, _opts.mailSettings.identity.alwaysBccSelf,
    _opts.mailSettings.identity.replyTo, _opts.userIdentities.address]);

  const allowRetryAfterVerifiedNonDelivery = useCallback(async () => {
    if (immediateSendPhase !== 'uncertain' || !protectedSendAttempt) return;
    await immediateSendAttemptsRef.current.markDefinitive(protectedSendAttempt);
    setProtectedSendAttempt(null);
    setImmediateSendPhase('idle');
    setImmediateSendNotice({
      tone: 'info',
      message: 'A new send attempt is ready because you confirmed the earlier message was not delivered.',
    });
  }, [immediateSendPhase, protectedSendAttempt]);

  const checkEarlierComposeSend = useCallback(async () => {
    if (!protectedSendAttempt || checkingEarlierComposeSend) return;
    setCheckingEarlierComposeSend(true);
    try {
      const check = await checkProtectedOutboundSendAttempt({
        attempt: protectedSendAttempt,
        attempts: immediateSendAttemptsRef.current,
        loadStatus: api.fetchOutboundMessageStatusByKey,
      });
      const feedback = protectedSendCheckFeedback(check, 'message', protectedSendAttempt);
      if (
        check.state === 'accepted'
        || check.state === 'partial'
        || check.state === 'scheduled'
      ) {
        setLastSendResult(check.result || null);
        if (check.state === 'scheduled' && check.result?.scheduledId) {
          const authoritativeSendAt = check.result.sendAt || protectedSendAttempt.scheduledFor;
          setUndoSendId(check.result.scheduledId);
          setUndoSendMode(protectedSendAttempt.deliveryKind === 'undo' ? 'undo' : 'scheduled');
          setUndoSendDelaySeconds(authoritativeSendAt
            ? Math.max(0, Math.ceil((Date.parse(authoritativeSendAt) - Date.now()) / 1000))
            : 0);
        } else {
          setUndoSendId(null);
          setUndoSendMode(null);
          setUndoSendDelaySeconds(0);
        }
        setOutboundRecoveryNotice(feedback.notice);
        setImmediateSendPhase('idle');
        setImmediateSendNotice(null);
        setProtectedSendAttempt(null);
        finishComposeAfterConfirmedSend();
        await immediateSendAttemptsRef.current.markDefinitive(protectedSendAttempt);
        return;
      }
      setImmediateSendPhase(
        check.state === 'unavailable' && immediateSendPhase === 'uncertain'
          ? 'uncertain'
          : feedback.phase,
      );
      setImmediateSendNotice(feedback.notice);
      if (check.state === 'failed') setProtectedSendAttempt(null);
    } finally {
      setCheckingEarlierComposeSend(false);
    }
  }, [checkingEarlierComposeSend, finishComposeAfterConfirmedSend, immediateSendPhase, protectedSendAttempt]);

  // Other mail state
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [userQuota, _setUserQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [loadedImagesForMsg, setLoadedImagesForMsg] = useState<Set<string>>(new Set());
  const [showSearchHints, setShowSearchHints] = useState(false);

  const sendReply = useCallback(async (to: string, subject: string, inReplyTo: string, references: string) => {
    let preparedAttempt: PreparedOutboundSendAttempt | null = null;
    const replyScope = inReplyTo || references;
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
      formData.append('subject', subject);
      formData.append('body', replyText);
      formData.append('inReplyTo', inReplyTo);
      formData.append('references', references);
      const undoDelaySeconds = Math.max(0, Math.trunc(_opts.mailSettings.compose.undoSendSeconds));
      const requestedAt = Date.now();
      const delivery: OutboundSendDelivery = undoDelaySeconds > 0
        ? {
          kind: 'undo',
          scheduledFor: new Date(requestedAt + undoDelaySeconds * 1000).toISOString(),
        }
        : { kind: 'immediate' };
      let preparedDeliveryKind = delivery.kind;
      let preparedScheduledFor = delivery.scheduledFor;
      const result = await sendOutboundMessage({
        scope: {
          mailbox: _opts.userIdentities.address || identityFields.from || '',
          replyParent: replyScope,
        },
        formData,
        delivery,
        attempts: replySendAttemptsRef.current,
        submit: (payload, idempotencyKey) => api.sendMessage(payload, { idempotencyKey }),
        loadStatus: api.fetchOutboundMessageStatus,
        onPrepared: attempt => {
          preparedAttempt = attempt;
          preparedDeliveryKind = attempt.deliveryKind;
          preparedScheduledFor = attempt.scheduledFor;
        },
      });
      if (result.deliveryStatus === 'failed') {
        throw new Error(result.error
          ? `Message was not sent: ${result.error}`
          : 'Message was not sent. You can safely try again.');
      }
      if (result.deliveryStatus === 'uncertain') {
        if (preparedAttempt) setProtectedReplySend({ attempt: preparedAttempt, scope: replyScope });
        setReplySendScope(replyScope);
        setReplySendPhase('uncertain');
        setReplySendNotice({
          tone: 'warning',
          message: 'Delivery status for the earlier reply is uncertain. Do not resend until you verify whether the recipient received it.',
        });
        throw new UncertainSendBlockedError();
      }
      if (result.scheduledId && preparedDeliveryKind !== 'immediate') {
        const authoritativeSendAt = result.sendAt || preparedScheduledFor;
        const effectiveDelaySeconds = authoritativeSendAt
          ? Math.max(0, Math.ceil((Date.parse(authoritativeSendAt) - Date.now()) / 1000))
          : undoDelaySeconds;
        setUndoSendId(result.scheduledId);
        setUndoSendMode(preparedDeliveryKind);
        setUndoSendDelaySeconds(effectiveDelaySeconds);
      } else {
        setUndoSendId(null);
        setUndoSendMode(null);
        setUndoSendDelaySeconds(0);
      }
      setReplyText('');
      setProtectedReplySend(null);
      setReplySendPhase('idle');
      setReplySendNotice(null);
      setReplySendScope(null);
      await fetchFolders();
      await fetchMessages();
      return result;
    } catch (e) {
      if (e instanceof UncertainSendBlockedError) {
        if (preparedAttempt) setProtectedReplySend({ attempt: preparedAttempt, scope: replyScope });
        setReplySendScope(replyScope);
        setReplySendPhase(e.reason === 'delivery_uncertain' ? 'uncertain' : 'blocked');
        setReplySendNotice({ tone: 'warning', message: e.message });
      }
      console.error('Reply failed', e);
      throw e;
    }
    finally { setReplySending(false); }
  }, [identities, replyText, fetchFolders, fetchMessages, setReplySending, setReplyText,
    _opts.mailSettings.compose.undoSendSeconds,
    _opts.mailSettings.identity.alwaysBccSelf, _opts.mailSettings.identity.defaultFrom,
    _opts.mailSettings.identity.replyTo, _opts.userIdentities.address]);

  const allowReplyRetryAfterVerifiedNonDelivery = useCallback(async () => {
    if (replySendPhase !== 'uncertain' || !protectedReplySend) return;
    await replySendAttemptsRef.current.markDefinitive(protectedReplySend.attempt);
    setProtectedReplySend(null);
    setReplySendPhase('idle');
    setReplySendScope(protectedReplySend.scope);
    setReplySendNotice({
      tone: 'info',
      message: 'A new reply attempt is ready because you confirmed the earlier reply was not delivered.',
    });
  }, [protectedReplySend, replySendPhase]);

  const checkEarlierReplySend = useCallback(async () => {
    if (!protectedReplySend || checkingEarlierReplySend) return;
    setCheckingEarlierReplySend(true);
    try {
      const check = await checkProtectedOutboundSendAttempt({
        attempt: protectedReplySend.attempt,
        attempts: replySendAttemptsRef.current,
        loadStatus: api.fetchOutboundMessageStatusByKey,
      });
      const feedback = protectedSendCheckFeedback(check, 'reply', protectedReplySend.attempt);
      if (
        check.state === 'accepted'
        || check.state === 'partial'
        || check.state === 'scheduled'
      ) {
        if (check.state === 'scheduled' && check.result?.scheduledId) {
          const authoritativeSendAt = check.result.sendAt || protectedReplySend.attempt.scheduledFor;
          setUndoSendId(check.result.scheduledId);
          setUndoSendMode(protectedReplySend.attempt.deliveryKind === 'undo' ? 'undo' : 'scheduled');
          setUndoSendDelaySeconds(authoritativeSendAt
            ? Math.max(0, Math.ceil((Date.parse(authoritativeSendAt) - Date.now()) / 1000))
            : 0);
        } else {
          setUndoSendId(null);
          setUndoSendMode(null);
          setUndoSendDelaySeconds(0);
        }
        observedReplyTextRef.current = '';
        setReplyText('');
        setReplySendPhase('idle');
        setReplySendNotice(feedback.notice);
        setReplySendScope(protectedReplySend.scope);
        setProtectedReplySend(null);
        await replySendAttemptsRef.current.markDefinitive(protectedReplySend.attempt);
        await Promise.all([fetchFolders(), fetchMessages()]);
        return;
      }
      setReplySendPhase(
        check.state === 'unavailable' && replySendPhase === 'uncertain'
          ? 'uncertain'
          : feedback.phase,
      );
      setReplySendNotice(feedback.notice);
      setReplySendScope(protectedReplySend.scope);
      if (check.state === 'failed') setProtectedReplySend(null);
    } finally {
      setCheckingEarlierReplySend(false);
    }
  }, [checkingEarlierReplySend, fetchFolders, fetchMessages, protectedReplySend, replySendPhase]);

  // Fetch a single message body (full content)
  const fetchMessageBody = useCallback(async (uid: number, folderPath: string) => {
    try {
      const detail = await messageDetailLoaderRef.current.load(folderPath, uid);
      if (!detail) return undefined;
      const summary = messagesRef.current.find(message => (
        message.uid === uid && mailboxPathsEqual(message.folder || folderPath, folderPath)
      ));
      const merged = mergeMessageDetails(summary || detail, detail);
      if (!mailboxPathsEqual(activeFolderRef.current, folderPath)) return merged;
      setMessages((prev) => prev.map((m) =>
        m.uid === uid && mailboxPathsEqual(m.folder || folderPath, folderPath)
          ? mergeMessageDetails(m, detail)
          : m
      ));
      setViewingThread((prev) => {
        if (prev?.some((m) => m.uid === uid && mailboxPathsEqual(m.folder || folderPath, folderPath))) {
          return prev.map((m) => (
            m.uid === uid && mailboxPathsEqual(m.folder || folderPath, folderPath)
              ? mergeMessageDetails(m, detail)
              : m
          ));
        }
        return [detail];
      });
      return merged;
    } catch (e) {
      console.error('Failed to fetch message body', e);
      return undefined;
    }
  }, [setMessages]);

  const prepareMessageCompose = useCallback(async (
    action: MessageComposeAction,
    message: Message,
    folderPath: string,
    body = '',
  ) => {
    const requestId = composePreparationCoordinatorRef.current.begin();
    const fullMessage = message.bodyLoaded
      ? message
      : await fetchMessageBody(message.uid, folderPath);
    if (!composePreparationCoordinatorRef.current.isCurrent(requestId)) return 'superseded' as const;
    if (!fullMessage) return 'unavailable' as const;
    const draft = buildMessageComposeDraft(
      action,
      fullMessage,
      identities.map(identity => identity.address),
    );
    if (action !== 'forward' && !draft.to) return 'missing-reply-address' as const;
    return startCompose(body ? { ...draft, body } : draft, requestId)
      ? 'started' as const
      : 'superseded' as const;
  }, [fetchMessageBody, identities, startCompose]);

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
      return fetchMessages('reset');
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
      if (requestId !== searchRequestIdRef.current || activeFolderRef.current !== folder) return true;
      if (result.messages) setMessages(result.messages);
      setSearchInfo(result.partial ? 'Some folders could not be searched. Results may be incomplete.' : '');
      return true;
    } catch (e: unknown) {
      if (isMailSearchAbort(e)) return true;
      if (requestId === searchRequestIdRef.current && activeFolderRef.current === folder) {
        setSearchError(errorMessage(e, 'Search failed'));
        return false;
      }
      return true;
    }
    finally {
      searchRequestCoordinatorRef.current.complete(requestController);
      if (requestId === searchRequestIdRef.current) setSearchLoading(false);
    }
  }, [activeFolder, fetchMessages, invalidateOlderMessageRequest, searchField, setMessages]);

  useEffect(() => {
    refreshAfterFolderMarkReadRef.current = async path => {
      if (isSearchActive) {
        return doSearch(searchQuery, searchScope, searchField);
      }
      if (mailboxPathsEqual(activeFolder, path)) {
        setSelectedMessages([]);
        return fetchMessages('reset');
      }
      return true;
    };
  }, [activeFolder, doSearch, fetchMessages, isSearchActive, searchField, searchQuery, searchScope]);

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
    favoriteFolders: favoriteReconciliation.visiblePaths,
    favoriteRenameCandidates,
    unavailableFavoritePaths,
    favoriteSettingsReady: mailSettingsReady,
    favoritePersistencePending: Boolean(pendingFavoritePersistence),
    favoritePersistenceError: pendingFavoritePersistence
      ? `The folder was ${pendingFavoritePersistence.action}, but Favorites still need to be updated.`
      : '',
    folderMutationPending,
    favoriteSettingsError: _opts.mailSettingsError,
    retryFavoriteSettings: _opts.onRetryMailSettings,
    retryFavoritePersistence,
    confirmFavoriteRename,
    dismissFavoriteRename,
    removeUnavailableFavorite,
    dismissUnavailableFavorite,
    markingReadFolder,
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
    isComposing, setIsComposing, startCompose, prepareMessageCompose, resumeDraft, composeDocked, setComposeDocked,
    showCc, setShowCc, showBcc, setShowBcc,
    composeTo, setComposeTo, composeCc, setComposeCc, composeBcc, setComposeBcc,
    composeReplyTo, setComposeReplyTo,
    composeInReplyTo, setComposeInReplyTo, composeReferences, setComposeReferences,
    composeSubject, setComposeSubject, composeBody, setComposeBody,
    composeFrom, setComposeFrom, composeIdentities: identities, composeSignature, setComposeSignature,
    composeAttachments, setComposeAttachments: updateComposeAttachments,
    composeMode, setComposeMode,
    draftUid, setDraftUid, draftId, setDraftId,
    draftSaveStatus, setDraftSaveStatus, composeError, setComposeError,
    sending, handleSend, lastSendResult, immediateSendPhase, immediateSendNotice, closeComposer,
    allowRetryAfterVerifiedNonDelivery, checkEarlierComposeSend, checkingEarlierComposeSend,
    outboundRecoveryNotice, setOutboundRecoveryNotice,
    replyText, setReplyText, replySending, sendReply,
    replySendPhase, replySendNotice,
    replySendScope,
    checkEarlierReplySend, checkingEarlierReplySend, allowReplyRetryAfterVerifiedNonDelivery,
    signatures, setSignatures, rules, setRules,
    userQuota, loadedImagesForMsg, setLoadedImagesForMsg,
    fetchFolders, createFolder, moveFolder, renameFolder, deleteFolder, retryFolderSearchCleanup,
    toggleFavoriteFolder, markFolderRead,
    fetchMessages, fetchMessageBody, prefetchBodies, loadOlderMessages, refreshMessages,
    messageAction, undoAction, doSearch, snoozeMessages, cancelScheduledSend, removeScheduledMessage,
    mailSettings: _opts.mailSettings,
  };
}

function getUndoMessage(action: string): string {
  switch (action) {
    case 'delete': return 'Message moved to Trash.';
    case 'archive': return 'Message archived.';
    case 'spam': return 'Message marked as spam.';
    case 'move': return 'Message moved.';
    default: return 'Action undone.';
  }
}
