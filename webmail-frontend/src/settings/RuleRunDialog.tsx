import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Play,
  X,
} from 'lucide-react';
import type {
  MailFolder,
  Rule,
  RuleRunMatchCursor,
  RuleRunMatchDetail,
  RuleRunMatchRuleCatalogEntry,
  RuleRunReadState,
} from '../shared/types';
import { useModalFocus } from '../shared/hooks/useModalFocus';
import {
  countSelectedRuleRunMessages,
  createRuleRunMessageSelection,
  getRunnableRuleIds,
  getRuleRunSelectors,
  isRuleRunMessageSelected,
  loadRuleMatchDetailsPage,
  normalizeRuleRunSelection,
  RULE_RUN_MATCH_PAGE_SIZE,
  runRulesThroughFolder,
  serializeRuleRunMessageSelection,
  setRuleRunMessageSelected,
  type RuleRunSummary,
} from './rule-run';

type RuleRunPhase = 'choose' | 'previewing' | 'preview' | 'applying' | 'complete';
type PendingCopy = { actionKey: string; uid: number; destination: string };

const READ_STATE_LABELS: Record<RuleRunReadState, string> = {
  all: 'All messages',
  unread: 'Unread messages',
  read: 'Read messages',
};

const MATCH_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatMatchDate(value: string): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : MATCH_DATE_FORMATTER.format(date);
}

function matchOutcomeLabel(match: RuleRunMatchDetail): string {
  if (match.destinations.length > 0) {
    const visibleDestinations = match.destinations.slice(0, 2);
    const remaining = match.destinations.length - visibleDestinations.length;
    return `Would move to ${visibleDestinations.join(', ')}${remaining > 0 ? ` +${remaining} more` : ''}`;
  }
  if (match.outcome === 'already-in-destination') return 'Already in the planned folder';
  if (match.outcome === 'delivery-only') return 'Delivery-only action; existing mail stays put';
  if (match.outcome === 'missing-destination') return 'Destination missing; message would not move';
  return 'Matched, with no existing-mail Move action';
}

function matchedRuleLabel(
  match: RuleRunMatchDetail,
  catalog: Map<number, RuleRunMatchRuleCatalogEntry>,
): string {
  const visibleRules = match.rules.slice(0, 3).map(({ ruleIndex, name }) => (
    ruleIndex !== undefined
      ? catalog.get(ruleIndex)?.name || `Rule ${ruleIndex + 1}`
      : name || 'Saved rule'
  ));
  const remaining = Math.max(0, match.rules.length - visibleRules.length);
  return `${visibleRules.join(', ')}${remaining > 0 ? ` +${remaining} more` : ''}`;
}

const CRITERION_FIELD_LABELS: Record<string, string> = {
  subject: 'Subject',
  from: 'From',
  to: 'To',
  body: 'Message body',
};

const CRITERION_OPERATOR_LABELS: Record<string, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'equals',
  matches: 'matches pattern',
};

export function RuleRunDialog({
  folders,
  rules,
  initialRuleIds,
  onClose,
}: {
  folders: MailFolder[];
  rules: Rule[];
  initialRuleIds: string[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const matchControllerRef = useRef<AbortController | null>(null);
  const latestProgressRef = useRef<RuleRunSummary | null>(null);
  const selectableFolders = folders.filter(folder => folder.disabled !== true);
  const inbox = selectableFolders.find(folder => folder.path.toUpperCase() === 'INBOX');
  const ruleSelectors = getRuleRunSelectors(rules);
  const runnableRuleIds = getRunnableRuleIds(rules);
  const [folder, setFolder] = useState(inbox?.path || selectableFolders[0]?.path || 'INBOX');
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [readState, setReadState] = useState<RuleRunReadState>('all');
  const [selectedRuleIds, setSelectedRuleIds] = useState(() => (
    normalizeRuleRunSelection(rules, initialRuleIds)
  ));
  const [phase, setPhase] = useState<RuleRunPhase>('choose');
  const [preview, setPreview] = useState<RuleRunSummary | null>(null);
  const [result, setResult] = useState<RuleRunSummary | null>(null);
  const [progress, setProgress] = useState<RuleRunSummary | null>(null);
  const [error, setError] = useState('');
  const [stopped, setStopped] = useState(false);
  const [needsCopyResolution, setNeedsCopyResolution] = useState(false);
  const [pendingCopies, setPendingCopies] = useState<PendingCopy[]>([]);
  const [matchPages, setMatchPages] = useState<RuleRunMatchDetail[][]>([]);
  const [matchPageIndex, setMatchPageIndex] = useState(0);
  const [matchNextCursor, setMatchNextCursor] = useState<RuleRunMatchCursor | null>(null);
  const [matchPageLoading, setMatchPageLoading] = useState(false);
  const [matchPageError, setMatchPageError] = useState('');
  const [expandedMatchKeys, setExpandedMatchKeys] = useState(() => new Set<string>());
  const [messageSelection, setMessageSelection] = useState(() => (
    createRuleRunMessageSelection('allExcept')
  ));
  const [messageSelectionLocked, setMessageSelectionLocked] = useState(false);
  const busy = phase === 'previewing' || phase === 'applying';
  const selectedFolder = selectableFolders.find(item => item.path === folder);
  const childPrefix = selectedFolder?.delimiter ? `${folder}${selectedFolder.delimiter}` : '';
  const subfolderCount = childPrefix
    ? selectableFolders.filter(item => item.path.startsWith(childPrefix)).length
    : 0;
  const previewRuleCatalog = new Map((preview?.matchRuleCatalog || []).map(rule => ([
    rule.ruleIndex,
    rule,
  ])));

  const requestClose = useCallback(() => {
    if (phase === 'previewing') {
      controllerRef.current?.abort();
      return;
    }
    if (phase === 'applying') return;
    onClose();
  }, [onClose, phase]);

  useModalFocus({ dialogRef, open: true, onClose: requestClose });

  useEffect(() => () => {
    controllerRef.current?.abort();
    matchControllerRef.current?.abort();
  }, []);

  const run = async (
    mode: 'preview' | 'apply',
    copyResolution?: 'completed' | 'retry',
  ) => {
    if (selectedRuleIds.length === 0) {
      setError('Select at least one enabled rule to run.');
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    latestProgressRef.current = null;
    setError('');
    setStopped(false);
    setProgress(null);
    if (mode === 'preview') {
      matchControllerRef.current?.abort();
      setMessageSelection(createRuleRunMessageSelection('allExcept'));
      setMessageSelectionLocked(false);
      setMatchPages([]);
      setMatchPageIndex(0);
      setMatchNextCursor(null);
      setMatchPageError('');
      setExpandedMatchKeys(new Set());
    }
    if (mode === 'apply') setMessageSelectionLocked(true);
    setPhase(mode === 'preview' ? 'previewing' : 'applying');

    try {
      const summary = await runRulesThroughFolder({
        folder,
        mode,
        includeSubfolders: mode === 'apply' && preview
          ? preview.includeSubfolders
          : includeSubfolders,
        readState: mode === 'apply' && preview ? preview.readState : readState,
        ruleIds: selectedRuleIds,
        captureMatchDetails: mode === 'preview',
        ...(mode === 'apply' && preview
          ? {
              maxUid: preview.maxUid,
              uidValidity: preview.uidValidity,
              ruleRevision: preview.ruleRevision,
              previewToken: preview.previewToken,
              scopeSnapshot: preview.scopeSnapshot,
              messageSelection: serializeRuleRunMessageSelection(messageSelection),
            }
          : {}),
        ...(copyResolution ? { copyResolution } : {}),
        ...(copyResolution ? {
          copyActionKeys: pendingCopies.map(copy => copy.actionKey),
        } : {}),
        signal: controller.signal,
        onProgress: nextProgress => {
          latestProgressRef.current = nextProgress;
          setProgress(nextProgress);
        },
      });
      if (mode === 'preview') {
        setNeedsCopyResolution(false);
        setPendingCopies([]);
        setPreview(summary);
        setMessageSelection(createRuleRunMessageSelection('allExcept'));
        setMessageSelectionLocked(false);
        setMatchPages(summary.matchDetails.length > 0 ? [summary.matchDetails] : []);
        setMatchPageIndex(0);
        setMatchNextCursor(summary.matchDetailsCursor);
        setPhase('preview');
      } else {
        setResult(summary);
        setPhase('complete');
      }
    } catch (runError) {
      const wasStopped = runError instanceof Error && runError.name === 'AbortError';
      if (wasStopped) {
        setStopped(true);
        if (mode === 'apply' && latestProgressRef.current) {
          setResult(latestProgressRef.current);
          setPhase('complete');
        } else {
          setPhase('choose');
        }
      } else {
        setError(runError instanceof Error ? runError.message : 'Failed to run mail rules.');
        const retrySafe = (
          runError instanceof Error
          && 'retrySafe' in runError
          && runError.retrySafe === true
        );
        const resolutionRequired = (
          mode === 'apply'
          && runError instanceof Error
          && 'retrySafe' in runError
          && runError.retrySafe === false
        );
        const interruptedCopies = (
          runError instanceof Error
          && 'pendingCopies' in runError
          && Array.isArray(runError.pendingCopies)
        )
          ? runError.pendingCopies as PendingCopy[]
          : [];
        setNeedsCopyResolution(resolutionRequired);
        setPendingCopies(resolutionRequired ? interruptedCopies : []);
        if (mode === 'apply' && !retrySafe && !resolutionRequired) {
          setPreview(null);
          setMessageSelectionLocked(false);
        }
        if (mode === 'preview') setMessageSelectionLocked(false);
        setPhase(mode === 'apply' && (retrySafe || resolutionRequired) ? 'preview' : 'choose');
      }
    } finally {
      controllerRef.current = null;
    }
  };

  const showNextMatchPage = async () => {
    if (matchPageIndex + 1 < matchPages.length) {
      setMatchPageIndex(index => index + 1);
      return;
    }
    if (!preview || !matchNextCursor || matchPageLoading || matchControllerRef.current) return;

    const controller = new AbortController();
    matchControllerRef.current = controller;
    setMatchPageLoading(true);
    setMatchPageError('');
    try {
      const nextPage = await loadRuleMatchDetailsPage({
        preview,
        ruleIds: selectedRuleIds,
        cursor: matchNextCursor,
        signal: controller.signal,
      });
      const loadedCount = matchPages.reduce((total, page) => total + page.length, 0);
      const nextLoadedCount = loadedCount + nextPage.matchDetails.length;
      if (nextLoadedCount > preview.matchedMessages) {
        setMatchNextCursor(null);
        setMatchPageError('Matched messages changed after this preview. Preview again to refresh the review list.');
        return;
      }
      if (nextPage.matchDetails.length === 0 && loadedCount < preview.matchedMessages) {
        setMatchNextCursor(null);
        setMatchPageError('Matched messages changed after this preview. Preview again to refresh the review list.');
        return;
      }
      setMatchPages(pages => [...pages, nextPage.matchDetails]);
      setMatchPageIndex(index => index + 1);
      setMatchNextCursor(nextPage.nextCursor);
      if (!nextPage.nextCursor && nextLoadedCount < preview.matchedMessages) {
        setMatchPageError('Matched messages changed after this preview. Preview again to refresh the review list.');
      }
    } catch (loadError) {
      if (!(loadError instanceof Error && loadError.name === 'AbortError')) {
        setMatchPageError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load more matched messages.',
        );
      }
    } finally {
      if (matchControllerRef.current === controller) matchControllerRef.current = null;
      setMatchPageLoading(false);
    }
  };

  const pendingDestinations = pendingCopies.reduce<Map<string, number>>((counts, copy) => {
    counts.set(copy.destination, (counts.get(copy.destination) || 0) + 1);
    return counts;
  }, new Map());
  const previewReadLabel = READ_STATE_LABELS[preview?.readState || 'all'];
  const previewScopeCount = preview?.scopeSnapshot.length || 1;
  const resultReadLabel = READ_STATE_LABELS[result?.readState || 'all'];
  const resultScopeCount = result?.scopeSnapshot.length || 1;
  const currentMatchPage = matchPages[matchPageIndex] || [];
  const matchPageStart = matchPages
    .slice(0, matchPageIndex)
    .reduce((total, page) => total + page.length, 0);
  const loadedMatchCount = matchPages.reduce((total, page) => total + page.length, 0);
  const selectedMoveCount = preview
    ? countSelectedRuleRunMessages(messageSelection, preview.affectedMessages)
    : 0;
  const selectedDestinations = (() => {
    if (!preview) return [];
    const counts = messageSelection.mode === 'allExcept'
      ? new Map(preview.destinations.map(destination => [destination.folder, destination.count]))
      : new Map<string, number>();
    for (const match of matchPages.flat()) {
      if (match.outcome !== 'move') continue;
      const selected = isRuleRunMessageSelected(messageSelection, match);
      for (const destination of match.destinations) {
        if (messageSelection.mode === 'allExcept' && !selected) {
          counts.set(destination, Math.max(0, (counts.get(destination) || 0) - 1));
        } else if (messageSelection.mode === 'only' && selected) {
          counts.set(destination, (counts.get(destination) || 0) + 1);
        }
      }
    }
    return [...counts]
      .filter(([, count]) => count > 0)
      .map(([destination, count]) => ({ folder: destination, count }));
  })();
  const selectedDestinationActions = selectedDestinations.reduce((total, item) => total + item.count, 0);
  const createsCopies = Boolean(preview && selectedDestinationActions > selectedMoveCount);
  const hasNextMatchPage = (
    matchPageIndex + 1 < matchPages.length
    || Boolean(matchNextCursor && preview && loadedMatchCount < preview.matchedMessages)
  );

  return (
    <div className="modal-overlay rule-run-overlay">
      <div
        ref={dialogRef}
        className="modal-content rule-run-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-run-title"
        tabIndex={-1}
      >
        <div className="rule-run-header">
          <div>
            <span className="settings-eyebrow">Mail automation</span>
            <h2 id="rule-run-title">Run rules on existing mail</h2>
            <p>Rules are evaluated from top to bottom using their last saved order.</p>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label={
              phase === 'previewing'
                ? 'Stop preview'
                : phase === 'applying'
                  ? 'Applying rules'
                  : 'Close rule run'
            }
            disabled={phase === 'applying'}
            onClick={requestClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="rule-run-body">
          {phase === 'choose' && (
            <>
              <fieldset className="rule-run-picker">
                <legend>Rules to run</legend>
                <div className="rule-run-picker-toolbar">
                  <span>{selectedRuleIds.length} of {runnableRuleIds.length} active selected</span>
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedRuleIds(runnableRuleIds)}
                      disabled={selectedRuleIds.length === runnableRuleIds.length}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedRuleIds([])}
                      disabled={selectedRuleIds.length === 0}
                    >
                      Clear all
                    </button>
                  </div>
                </div>
                <div className="rule-run-picker-list">
                  {rules.map((rule, index) => {
                    const disabled = rule.enabled === false;
                    const identity = ruleSelectors[index];
                    const checked = selectedRuleIds.includes(identity);
                    return (
                      <label key={identity} className={`rule-run-picker-option ${disabled ? 'disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={event => {
                            const nextSelected = new Set(selectedRuleIds);
                            if (event.target.checked) nextSelected.add(identity);
                            else nextSelected.delete(identity);
                            setSelectedRuleIds(runnableRuleIds.filter(id => nextSelected.has(id)));
                          }}
                        />
                        <span className="rule-run-picker-priority">{index + 1}</span>
                        <span>
                          <strong>{rule.name || 'Untitled Rule'}</strong>
                          <small>
                            {disabled
                              ? 'Disabled'
                              : rule.stopProcessing === false
                                ? 'Continues to rules below'
                                : 'Stops after a match'}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <small>Selected rules keep their saved top-to-bottom order.</small>
              </fieldset>
              <fieldset className="rule-run-picker rule-run-scope">
                <legend>Message scope</legend>
                <label className="settings-field">
                  <span>Folder to process</span>
                  <select
                    className="glass-input glass-select"
                    aria-label="Source folder"
                    value={folder}
                    onChange={event => {
                      setFolder(event.target.value);
                      setIncludeSubfolders(false);
                    }}
                  >
                    {selectableFolders.map(item => (
                      <option key={item.path} value={item.path}>{item.path}</option>
                    ))}
                  </select>
                </label>
                <label className={`rule-run-scope-toggle ${subfolderCount === 0 ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={includeSubfolders}
                    disabled={subfolderCount === 0}
                    onChange={event => setIncludeSubfolders(event.target.checked)}
                  />
                  <span>
                    <strong>Include subfolders</strong>
                    <small>
                      {subfolderCount > 0
                        ? `${subfolderCount} subfolder${subfolderCount === 1 ? '' : 's'} available`
                        : 'No subfolders below this folder'}
                    </small>
                  </span>
                </label>
                <div className="rule-run-read-state" role="radiogroup" aria-label="Messages to process">
                  {([
                    ['all', 'All messages'],
                    ['unread', 'Unread'],
                    ['read', 'Read'],
                  ] as Array<[RuleRunReadState, string]>).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="rule-run-read-state"
                        value={value}
                        checked={readState === value}
                        onChange={() => setReadState(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <small>
                  Apply is limited to the exact messages in this preview. Later arrivals and newly matching messages are excluded.
                </small>
              </fieldset>
              <div className="rule-run-safety-note">
                <AlertTriangle size={17} />
                <div>
                  <strong>Preview comes first.</strong>
                  <span>Reject and discard only apply to new deliveries; this run applies Move actions only.</span>
                </div>
              </div>
            </>
          )}

          {busy && (
            <div className="rule-run-progress" role="status" aria-live="polite">
              <div className="spinner" />
              <strong>{phase === 'previewing' ? 'Checking messages…' : 'Applying rules…'}</strong>
              <span>
                {progress?.processed || 0} messages processed
                {' · '}{progress?.sourceFolder || folder}
              </span>
              {phase === 'previewing' ? (
                <button className="btn btn-ghost" type="button" onClick={() => controllerRef.current?.abort()}>
                  Stop preview
                </button>
              ) : (
                <span>Keep this window open until the run finishes.</span>
              )}
            </div>
          )}

          {phase === 'preview' && preview && (
            <div className="rule-run-summary">
              <div className="rule-run-scope-summary">
                <strong>{previewReadLabel} in {preview.folder}</strong>
                <span>
                  {previewScopeCount} folder{previewScopeCount === 1 ? '' : 's'} snapshotted
                  {preview.includeSubfolders ? ', including subfolders' : ''}
                </span>
              </div>
              <div className="rule-run-order-summary">
                <strong>
                  {preview.matchRuleCatalog.length} rule{preview.matchRuleCatalog.length === 1 ? '' : 's'} in saved order
                </strong>
                <ol aria-label="Selected rule execution order">
                  {preview.matchRuleCatalog.map(rule => (
                    <li key={rule.ruleIndex}>
                      <span>{rule.ruleIndex + 1}</span>
                      {rule.name || 'Untitled Rule'}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rule-run-metrics" role="status" aria-live="polite">
                <div><strong>{preview.processed}</strong><span>Scanned</span></div>
                <div><strong>{preview.matchedMessages}</strong><span>Matched</span></div>
                <div><strong>{selectedMoveCount}</strong><span>Selected to move</span></div>
              </div>
              {preview.matchedMessages > 0 && (
                <section className="rule-run-match-review" aria-labelledby="rule-run-matches-title">
                  <div className="rule-run-match-header">
                    <div>
                      <h3 id="rule-run-matches-title">Matched messages</h3>
                      <p>Choose which messages to move. Expand “Why it matched” to review the exact criteria.</p>
                    </div>
                    {currentMatchPage.length > 0 && (
                      <strong>
                        {matchPageStart + 1}–{matchPageStart + currentMatchPage.length} of {preview.matchedMessages}
                      </strong>
                    )}
                  </div>
                  {preview.affectedMessages > 0 && (
                    <div className="rule-run-message-selection">
                      <span>
                        <strong>{selectedMoveCount}</strong> of {preview.affectedMessages}{' '}
                        message{preview.affectedMessages === 1 ? '' : 's'} selected to move
                      </span>
                      <div>
                        <button
                          type="button"
                          disabled={messageSelectionLocked || selectedMoveCount === preview.affectedMessages}
                          onClick={() => setMessageSelection(createRuleRunMessageSelection('allExcept'))}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          disabled={messageSelectionLocked || selectedMoveCount === 0}
                          onClick={() => setMessageSelection(createRuleRunMessageSelection('only'))}
                        >
                          Deselect all
                        </button>
                      </div>
                    </div>
                  )}
                  {(preview.matchedMessages > RULE_RUN_MATCH_PAGE_SIZE || matchPageError) && (
                    <div className="rule-run-match-pagination">
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={matchPageIndex === 0 || matchPageLoading}
                        onClick={() => setMatchPageIndex(index => Math.max(0, index - 1))}
                      >
                        <ChevronLeft size={16} /> Previous matches
                      </button>
                      <span>
                        Page {matchPageIndex + 1} of {Math.ceil(preview.matchedMessages / RULE_RUN_MATCH_PAGE_SIZE)}
                      </span>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={!hasNextMatchPage || matchPageLoading}
                        onClick={() => void showNextMatchPage()}
                      >
                        {matchPageLoading ? 'Loading…' : 'Next matches'} <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                  <ol className="rule-run-match-list" start={matchPageStart + 1}>
                    {currentMatchPage.map(match => {
                      const canMove = match.outcome === 'move';
                      const selected = canMove && isRuleRunMessageSelected(messageSelection, match);
                      const matchKey = `${match.folder}:${match.uid}`;
                      const explanationOpen = expandedMatchKeys.has(matchKey);
                      return (
                        <li
                          key={matchKey}
                          className={canMove && !selected ? 'not-selected' : ''}
                        >
                          <div className={`rule-run-match-select ${canMove ? '' : 'disabled'}`}>
                            {canMove ? (
                              <label className="rule-run-match-select-control">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={messageSelectionLocked}
                                  aria-label={`Move ${match.subject || 'message'} in this run`}
                                  onChange={event => setMessageSelection(current => (
                                    setRuleRunMessageSelected(current, match, event.target.checked)
                                  ))}
                                />
                              </label>
                            ) : (
                              <span aria-hidden="true" />
                            )}
                          </div>
                          <div className="rule-run-match-message">
                            <strong title={match.subject || 'No subject'}>
                              {match.subject || '(No subject)'}
                            </strong>
                            <span title={match.from || 'Unknown sender'}>
                              {match.from || 'Unknown sender'}
                            </span>
                            <small>
                              {preview.scopeSnapshot.length > 1 && <>{match.folder}<span aria-hidden="true"> · </span></>}
                              <time dateTime={match.date || undefined}>{formatMatchDate(match.date)}</time>
                            </small>
                          </div>
                          <div className="rule-run-match-reason">
                            <span>
                              Matched by <strong>{matchedRuleLabel(match, previewRuleCatalog)}</strong>
                            </span>
                            <span className={`rule-run-match-outcome ${match.outcome} ${canMove && !selected ? 'not-selected' : ''}`}>
                              {canMove && !selected
                                ? `Not selected — ${matchOutcomeLabel(match)}`
                                : matchOutcomeLabel(match)}
                            </span>
                            <details
                              className="rule-run-match-explanation"
                              open={explanationOpen}
                              onToggle={event => {
                                const open = event.currentTarget.open;
                                setExpandedMatchKeys(current => {
                                  if (current.has(matchKey) === open) return current;
                                  const next = new Set(current);
                                  if (open) next.add(matchKey);
                                  else next.delete(matchKey);
                                  return next;
                                });
                              }}
                            >
                              <summary>Why it matched</summary>
                              {explanationOpen && <div>
                                {match.rules.map(rule => {
                                  const catalogRule = rule.ruleIndex === undefined
                                    ? undefined
                                    : previewRuleCatalog.get(rule.ruleIndex);
                                  const matchedCriterionIndexes = rule.matchedCriterionIndexes || [];
                                  const matchedCriterionIndexSet = new Set(matchedCriterionIndexes);
                                  const indexedCriteria = (catalogRule?.criteria || [])
                                    .filter(criterion => matchedCriterionIndexSet.has(criterion.criterionIndex))
                                    .map(criterion => ({
                                      criterion,
                                      criterionIndex: criterion.criterionIndex,
                                    }));
                                  const criteria = rule.matchedCriterionIndexes
                                    ? indexedCriteria
                                    : (rule.matchedCriteria || []).map((criterion, criterionIndex) => ({
                                        criterion,
                                        criterionIndex,
                                      }));
                                  const matchedCriterionCount = rule.matchedCriterionIndexes
                                    ? matchedCriterionIndexes.length
                                    : criteria.length;
                                  const totalCriteria = rule.totalCriteria || matchedCriterionCount;
                                  return (
                                    <section key={rule.ruleIndex ?? rule.id ?? rule.name}>
                                      <header>
                                        <strong>
                                          {catalogRule?.name
                                            || rule.name
                                            || (rule.ruleIndex === undefined ? 'Saved rule' : `Rule ${rule.ruleIndex + 1}`)}
                                        </strong>
                                        <span>
                                          {rule.condition === 'any' ? 'Any' : 'All'} conditions
                                          {' · '}{matchedCriterionCount} of {totalCriteria} matched
                                        </span>
                                      </header>
                                      {criteria.length > 0 ? (
                                        <ul>
                                          {criteria.map(({ criterion, criterionIndex }) => (
                                            <li key={criterionIndex}>
                                              <strong>{CRITERION_FIELD_LABELS[criterion.field] || criterion.field}</strong>{' '}
                                              {CRITERION_OPERATOR_LABELS[criterion.operator] || criterion.operator}{' '}
                                              <q>{criterion.value}</q>
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p>Criteria details are unavailable. Preview again to refresh them.</p>
                                      )}
                                    </section>
                                  );
                                })}
                              </div>}
                            </details>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {matchPageError && (
                    <p className="rule-run-footnote warning" role="alert">{matchPageError}</p>
                  )}
                </section>
              )}
              {selectedDestinations.length > 0 ? (
                <div className="rule-run-destinations">
                  <h3>Selected destinations</h3>
                  {selectedDestinations.map(destination => (
                    <div key={destination.folder}>
                      <span>{destination.folder}</span>
                      <strong>{destination.count}</strong>
                    </div>
                  ))}
                </div>
              ) : preview.affectedMessages > 0 ? (
                <p className="rule-run-empty">No messages are selected to move.</p>
              ) : (
                <p className="rule-run-empty">No saved Move rule matches were found.</p>
              )}
              {createsCopies && (
                <div className="rule-run-safety-note">
                  <AlertTriangle size={17} />
                  <span>Some messages continue into more than one Move rule, so a copy will be filed into each matching destination.</span>
                </div>
              )}
              {needsCopyResolution && (
                <div className="rule-run-safety-note" role="alert">
                  <AlertTriangle size={17} />
                  <div>
                    <strong>Confirm the interrupted copy.</strong>
                    <span>
                      Check {pendingCopies.length} expected {pendingCopies.length === 1 ? 'copy' : 'copies'} in{' '}
                      {[...pendingDestinations].map(([destination, count]) => `${destination} (${count})`).join(', ')}.
                      Then tell OpenMailStack whether this exact group is present or missing.
                    </span>
                    <span>If only some are present, remove those partial copies first, then choose “Copies are missing.”</span>
                  </div>
                </div>
              )}
              {preview.deliveryOnlyMatches > 0 && (
                <p className="rule-run-footnote">
                  {preview.deliveryOnlyMatches} message{preview.deliveryOnlyMatches === 1 ? '' : 's'} matched a delivery-only Reject or Discard action and will be left unchanged.
                </p>
              )}
              {preview.undecidableMessages > 0 && (
                <p className="rule-run-footnote warning">
                  {preview.undecidableMessages} message{preview.undecidableMessages === 1 ? '' : 's'} could not be evaluated safely, so uncertain rule actions were skipped.
                </p>
              )}
              {preview.invalidDestinations.length > 0 && (
                <p className="rule-run-footnote warning">
                  Missing destination folders were skipped: {preview.invalidDestinations.join(', ')}.
                </p>
              )}
            </div>
          )}

          {phase === 'complete' && result && (
            <div className="rule-run-complete" role="status" aria-live="polite">
              <CheckCircle2 size={34} />
              <h3>{stopped ? 'Rule run stopped' : 'Rules applied'}</h3>
              <p>
                {result.appliedMessages} message{result.appliedMessages === 1 ? '' : 's'} processed with Move actions
                {' '}across {resultScopeCount} folder{resultScopeCount === 1 ? '' : 's'}.
              </p>
              <span>
                {resultReadLabel} in {result.folder}
                {result.includeSubfolders ? ' and its subfolders' : ''}.
              </span>
              {stopped && <span>You can safely run another preview to process what remains.</span>}
            </div>
          )}

          {error && <div className="settings-error-banner" role="alert">{error}</div>}
        </div>

        <div className="rule-run-actions">
          {phase === 'choose' && (
            <>
              <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={selectedRuleIds.length === 0}
                onClick={() => void run('preview')}
              >
                <Play size={16} /> Preview matches
              </button>
            </>
          )}
          {phase === 'preview' && (
            <>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  matchControllerRef.current?.abort();
                  setNeedsCopyResolution(false);
                  setPendingCopies([]);
                  setMatchPages([]);
                  setMatchPageIndex(0);
                  setMatchNextCursor(null);
                  setMatchPageError('');
                  setExpandedMatchKeys(new Set());
                  setMessageSelection(createRuleRunMessageSelection('allExcept'));
                  setMessageSelectionLocked(false);
                  setError('');
                  setPhase('choose');
                }}
              >
                Change scope or rules
              </button>
              {needsCopyResolution ? (
                <>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={matchPageLoading}
                    onClick={() => void run('apply', 'retry')}
                  >
                    Copies are missing
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={matchPageLoading}
                    onClick={() => void run('apply', 'completed')}
                  >
                    Copies are present
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={selectedMoveCount === 0 || matchPageLoading}
                  onClick={() => void run('apply')}
                >
                  Apply to {selectedMoveCount} selected
                </button>
              )}
            </>
          )}
          {phase === 'complete' && (
            <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
