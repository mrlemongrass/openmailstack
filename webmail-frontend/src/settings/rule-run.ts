import { runRulesPage } from '../shared/api';
import type {
  Rule,
  RuleMatchCount,
  RuleRunCount,
  RuleRunMatchCursor,
  RuleRunMatchDetail,
  RuleRunMatchRuleCatalogEntry,
  RuleRunMessageRef,
  RuleRunMessageSelection,
  RuleRunPageResponse,
  RuleRunReadState,
  RuleRunRequest,
  RuleRunScopeSnapshot,
} from '../shared/types';

export const RULE_RUN_MATCH_PAGE_SIZE = 20;

type RuleIdentitySource = Pick<Rule, 'id' | 'name' | 'enabled'> & {
  id?: string;
  name?: string;
};

function baseRuleRunIdentity(rule: RuleIdentitySource, index: number): string {
  return String(rule.id || rule.name || `rule-${index + 1}`);
}

export function getRuleRunSelectors(rules: RuleIdentitySource[]): string[] {
  const identities = rules.map(baseRuleRunIdentity);
  if (new Set(identities).size === identities.length) return identities;
  return rules.map((_rule, index) => `rule-${index + 1}`);
}

export function getRunnableRuleIds(rules: RuleIdentitySource[]): string[] {
  const selectors = getRuleRunSelectors(rules);
  return rules.flatMap((rule, index) => (
    rule.enabled === false ? [] : [selectors[index]]
  ));
}

export function normalizeRuleRunSelection(
  rules: RuleIdentitySource[],
  requestedRuleIds: string[],
): string[] {
  const requested = new Set(requestedRuleIds);
  return getRunnableRuleIds(rules).filter(id => requested.has(id));
}

export async function prepareRuleRun({
  rulesDirty,
  saveRules,
}: {
  rulesDirty: boolean;
  saveRules: () => Promise<boolean>;
}): Promise<boolean> {
  if (!rulesDirty) return true;
  return saveRules();
}

export interface RuleRunMessageSelectionState {
  mode: RuleRunMessageSelection['mode'];
  messages: Map<string, RuleRunMessageRef>;
}

async function runRulesPageWithSelectedApplyRetry(
  request: RuleRunRequest,
  signal?: AbortSignal,
): Promise<RuleRunPageResponse> {
  try {
    return await runRulesPage(request, signal);
  } catch (error) {
    if (
      request.mode !== 'apply-selected'
      || signal?.aborted
      || !(error instanceof TypeError)
    ) throw error;
    return runRulesPage(request, signal);
  }
}

function ruleRunMessageKey(message: RuleRunMessageRef): string {
  return `${message.folder}\u0000${message.uid}`;
}

export function createRuleRunMessageSelection(
  mode: RuleRunMessageSelection['mode'] = 'allExcept',
): RuleRunMessageSelectionState {
  return { mode, messages: new Map() };
}

export function isRuleRunMessageSelected(
  selection: RuleRunMessageSelectionState,
  message: RuleRunMessageRef,
): boolean {
  const listed = selection.messages.has(ruleRunMessageKey(message));
  return selection.mode === 'only' ? listed : !listed;
}

export function setRuleRunMessageSelected(
  selection: RuleRunMessageSelectionState,
  message: RuleRunMessageRef,
  selected: boolean,
): RuleRunMessageSelectionState {
  const messages = new Map(selection.messages);
  const key = ruleRunMessageKey(message);
  const defaultSelected = selection.mode === 'allExcept';
  if (selected === defaultSelected) messages.delete(key);
  else messages.set(key, { folder: message.folder, uid: message.uid });
  return { ...selection, messages };
}

export function countSelectedRuleRunMessages(
  selection: RuleRunMessageSelectionState,
  totalMessages: number,
): number {
  return selection.mode === 'only'
    ? Math.min(totalMessages, selection.messages.size)
    : Math.max(0, totalMessages - selection.messages.size);
}

export function serializeRuleRunMessageSelection(
  selection: RuleRunMessageSelectionState,
): RuleRunMessageSelection {
  const groups = new Map<string, number[]>();
  for (const message of selection.messages.values()) {
    const uids = groups.get(message.folder);
    if (uids) uids.push(message.uid);
    else groups.set(message.folder, [message.uid]);
  }
  return {
    mode: selection.mode,
    groups: [...groups].map(([folder, uids]) => ({ folder, uids })),
  };
}

export interface RuleRunSummary {
  folder: string;
  sourceFolder: string;
  includeSubfolders: boolean;
  readState: RuleRunReadState;
  scopeSnapshot: RuleRunScopeSnapshot[];
  mode: 'preview' | 'apply';
  processed: number;
  matchedMessages: number;
  affectedMessages: number;
  appliedMessages: number;
  copiedMessages: number;
  movedMessages: number;
  deliveryOnlyMatches: number;
  undecidableMessages: number;
  invalidDestinations: string[];
  ruleMatches: RuleMatchCount[];
  destinations: RuleRunCount[];
  matchDetails: RuleRunMatchDetail[];
  matchDetailsCursor: RuleRunMatchCursor | null;
  matchRuleCatalog: RuleRunMatchRuleCatalogEntry[];
  previewToken: string;
  maxUid: number;
  uidValidity: string;
  ruleRevision: string;
}

interface RunRulesOptions {
  folder: string;
  mode: 'preview' | 'apply';
  includeSubfolders?: boolean;
  readState?: RuleRunReadState;
  scopeSnapshot?: RuleRunScopeSnapshot[];
  ruleIds?: string[];
  maxUid?: number;
  uidValidity?: string;
  ruleRevision?: string;
  previewToken?: string;
  messageSelection?: RuleRunMessageSelection;
  copyResolution?: 'completed' | 'retry';
  copyActionKeys?: string[];
  captureMatchDetails?: boolean;
  signal?: AbortSignal;
  onProgress?: (summary: RuleRunSummary) => void;
}

export async function runRulesThroughFolder({
  folder,
  mode,
  includeSubfolders = false,
  readState = 'all',
  scopeSnapshot,
  ruleIds,
  maxUid,
  uidValidity,
  ruleRevision,
  previewToken,
  messageSelection,
  copyResolution,
  copyActionKeys,
  captureMatchDetails = false,
  signal,
  onProgress,
}: RunRulesOptions): Promise<RuleRunSummary> {
  let cursor = 0;
  let snapshotMaxUid = maxUid;
  let snapshotUidValidity = uidValidity;
  let snapshotRuleRevision = ruleRevision;
  let snapshotPreviewToken = previewToken;
  let snapshotFolders = scopeSnapshot;
  let scopeIndex = 0;
  const ruleMatches = new Map<string, RuleMatchCount>();
  const destinations = new Map<string, RuleRunCount>();
  const invalidDestinations = new Set<string>();
  const summary: RuleRunSummary = {
    folder,
    sourceFolder: folder,
    includeSubfolders,
    readState,
    scopeSnapshot: snapshotFolders || [],
    mode,
    processed: 0,
    matchedMessages: 0,
    affectedMessages: 0,
    appliedMessages: 0,
    copiedMessages: 0,
    movedMessages: 0,
    deliveryOnlyMatches: 0,
    undecidableMessages: 0,
    invalidDestinations: [],
    ruleMatches: [],
    destinations: [],
    matchDetails: [],
    matchDetailsCursor: null,
    matchRuleCatalog: [],
    previewToken: snapshotPreviewToken || '',
    maxUid: snapshotMaxUid || 0,
    uidValidity: snapshotUidValidity || '',
    ruleRevision: snapshotRuleRevision || '',
  };

  for (let pageNumber = 0; pageNumber < 10000; pageNumber += 1) {
    const usesScopeSnapshot = Boolean(snapshotFolders?.length);
    const requestScopeIndex = scopeIndex;
    const includeMatchDetails = (
      mode === 'preview'
      && captureMatchDetails
      && summary.matchDetails.length < RULE_RUN_MATCH_PAGE_SIZE
    );
    const request: RuleRunRequest = {
      folder,
      mode: mode === 'apply' && messageSelection ? 'apply-selected' : mode,
      cursor,
      ...(includeMatchDetails ? { includeMatchDetails: true } : {}),
      ...(includeSubfolders ? { includeSubfolders: true } : {}),
      ...(readState === 'all' ? {} : { readState }),
      ...(usesScopeSnapshot ? { scopeIndex, scopeSnapshot: snapshotFolders } : {}),
      ...(ruleIds === undefined ? {} : { ruleIds }),
      ...(usesScopeSnapshot || snapshotMaxUid === undefined ? {} : { maxUid: snapshotMaxUid }),
      ...(usesScopeSnapshot || !snapshotUidValidity ? {} : { uidValidity: snapshotUidValidity }),
      ...(snapshotRuleRevision ? { ruleRevision: snapshotRuleRevision } : {}),
      ...(snapshotPreviewToken ? { previewToken: snapshotPreviewToken } : {}),
      ...(messageSelection && pageNumber === 0 ? { messageSelection } : {}),
      ...(copyResolution ? { copyResolution } : {}),
      ...(copyActionKeys?.length ? { copyActionKeys } : {}),
    };
    const page: RuleRunPageResponse = await runRulesPageWithSelectedApplyRetry(request, signal);
    if (mode === 'preview' && captureMatchDetails) {
      if (pageNumber === 0) {
        if (!Array.isArray(page.matchRuleCatalog)) {
          throw new Error('The server cannot explain this preview safely yet. Refresh after the server update completes.');
        }
        summary.matchRuleCatalog = page.matchRuleCatalog;
      }
      if (typeof page.previewToken !== 'string' || !page.previewToken) {
        throw new Error('The server cannot bind selections to this preview yet. Refresh after the server update completes.');
      }
    }
    if (snapshotPreviewToken && page.previewToken !== snapshotPreviewToken) {
      throw new Error('The matched-message preview expired or changed. Preview again before applying.');
    }
    snapshotPreviewToken = page.previewToken || snapshotPreviewToken;
    const pageScopeSnapshot = Array.isArray(page.scopeSnapshot) ? page.scopeSnapshot : undefined;
    if ((includeSubfolders || readState !== 'all') && !pageScopeSnapshot) {
      throw new Error('The server does not support this folder scope yet. Refresh after the server update completes.');
    }
    if (
      snapshotFolders
      && pageScopeSnapshot
      && JSON.stringify(pageScopeSnapshot) !== JSON.stringify(snapshotFolders)
    ) {
      throw new Error('The folder scope changed during this run. Preview again before applying.');
    }
    snapshotFolders = pageScopeSnapshot || snapshotFolders;
    snapshotMaxUid = page.maxUid;
    if (!snapshotFolders && snapshotUidValidity && page.uidValidity !== snapshotUidValidity) {
      throw new Error('The source folder changed during this run. Preview again before applying.');
    }
    snapshotUidValidity = page.uidValidity;
    if (snapshotRuleRevision && page.ruleRevision !== snapshotRuleRevision) {
      throw new Error('Rules changed during this run. Preview again before applying.');
    }
    snapshotRuleRevision = page.ruleRevision;

    summary.processed += page.processed;
    summary.sourceFolder = page.sourceFolder || page.folder;
    summary.includeSubfolders = page.includeSubfolders ?? includeSubfolders;
    summary.readState = page.readState || readState;
    summary.scopeSnapshot = snapshotFolders || [];
    summary.matchedMessages += page.matchedMessages;
    summary.affectedMessages += page.affectedMessages;
    summary.appliedMessages += page.appliedMessages;
    summary.copiedMessages += page.copiedMessages;
    summary.movedMessages += page.movedMessages;
    summary.deliveryOnlyMatches += page.deliveryOnlyMatches;
    summary.undecidableMessages += page.undecidableMessages ?? page.bodySkippedMessages ?? 0;
    summary.maxUid = page.maxUid;
    summary.uidValidity = page.uidValidity;
    summary.ruleRevision = page.ruleRevision;
    summary.previewToken = snapshotPreviewToken || '';

    if (includeMatchDetails) {
      if (!Array.isArray(page.matchDetails)) {
        throw new Error('The server cannot review matched messages yet. Refresh after the server update completes.');
      }
      const remaining = RULE_RUN_MATCH_PAGE_SIZE - summary.matchDetails.length;
      const accepted = page.matchDetails.slice(0, remaining);
      summary.matchDetails.push(...accepted);
      if (accepted.length === remaining) {
        const lastMatch = accepted.at(-1);
        summary.matchDetailsCursor = lastMatch
          ? { scopeIndex: requestScopeIndex, cursor: lastMatch.uid }
          : null;
      }
    }

    page.invalidDestinations.forEach(destination => invalidDestinations.add(destination));
    page.ruleMatches.forEach(rule => {
      const current = ruleMatches.get(rule.id);
      ruleMatches.set(rule.id, {
        id: rule.id,
        name: rule.name,
        count: (current?.count || 0) + rule.count,
      });
    });
    page.destinations.forEach(destination => {
      const current = destinations.get(destination.folder);
      destinations.set(destination.folder, {
        folder: destination.folder,
        count: (current?.count || 0) + destination.count,
      });
    });

    summary.invalidDestinations = [...invalidDestinations];
    summary.ruleMatches = [...ruleMatches.values()];
    summary.destinations = [...destinations.values()];
    onProgress?.({ ...summary });

    if (page.done) {
      if (summary.matchedMessages <= summary.matchDetails.length) {
        summary.matchDetailsCursor = null;
      }
      return summary;
    }
    const nextScopeIndex = Number.isInteger(page.scopeIndex) ? Number(page.scopeIndex) : scopeIndex;
    if (nextScopeIndex === scopeIndex && page.cursor <= cursor) {
      throw new Error('Rule run stopped because mailbox progress stalled.');
    }
    scopeIndex = nextScopeIndex;
    cursor = page.cursor;
  }

  throw new Error('Rule run exceeded its safe page limit.');
}

export async function loadRuleMatchDetailsPage({
  preview,
  ruleIds,
  cursor: initialCursor,
  signal,
}: {
  preview: RuleRunSummary;
  ruleIds?: string[];
  cursor: RuleRunMatchCursor;
  signal?: AbortSignal;
}): Promise<{
  matchDetails: RuleRunMatchDetail[];
  nextCursor: RuleRunMatchCursor | null;
}> {
  let scopeIndex = initialCursor.scopeIndex;
  let cursor = initialCursor.cursor;
  const matchDetails: RuleRunMatchDetail[] = [];

  for (let pageNumber = 0; pageNumber < 10000; pageNumber += 1) {
    const requestScopeIndex = scopeIndex;
    const page = await runRulesPage({
      folder: preview.folder,
      mode: 'preview',
      cursor,
      scopeIndex,
      scopeSnapshot: preview.scopeSnapshot,
      ...(preview.includeSubfolders ? { includeSubfolders: true } : {}),
      ...(preview.readState === 'all' ? {} : { readState: preview.readState }),
      ...(ruleIds === undefined ? {} : { ruleIds }),
      ruleRevision: preview.ruleRevision,
      previewToken: preview.previewToken,
      includeMatchDetails: true,
    }, signal);

    if (
      page.ruleRevision !== preview.ruleRevision
      || page.previewToken !== preview.previewToken
      || JSON.stringify(page.scopeSnapshot) !== JSON.stringify(preview.scopeSnapshot)
    ) {
      throw new Error('Rules or message scope changed since preview. Preview again before applying.');
    }
    if (!Array.isArray(page.matchDetails)) {
      throw new Error('The server cannot review matched messages yet. Refresh after the server update completes.');
    }

    const remaining = RULE_RUN_MATCH_PAGE_SIZE - matchDetails.length;
    const accepted = page.matchDetails.slice(0, remaining);
    matchDetails.push(...accepted);
    if (accepted.length === remaining) {
      const lastMatch = accepted.at(-1);
      const consumedWholeResponse = accepted.length === page.matchDetails.length;
      return {
        matchDetails,
        nextCursor: page.done && consumedWholeResponse
          ? null
          : lastMatch
            ? { scopeIndex: requestScopeIndex, cursor: lastMatch.uid }
            : null,
      };
    }
    if (page.done) return { matchDetails, nextCursor: null };

    const nextScopeIndex = Number.isInteger(page.scopeIndex) ? Number(page.scopeIndex) : scopeIndex;
    if (nextScopeIndex === scopeIndex && page.cursor <= cursor) {
      throw new Error('Matched-message review stopped because mailbox progress stalled.');
    }
    scopeIndex = nextScopeIndex;
    cursor = page.cursor;
  }

  throw new Error('Matched-message review exceeded its safe page limit.');
}
