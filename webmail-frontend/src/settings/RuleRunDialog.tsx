import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, X } from 'lucide-react';
import type { MailFolder, Rule } from '../shared/types';
import { useModalFocus } from '../shared/hooks/useModalFocus';
import {
  getRunnableRuleIds,
  getRuleRunSelectors,
  normalizeRuleRunSelection,
  runRulesThroughFolder,
  type RuleRunSummary,
} from './rule-run';

type RuleRunPhase = 'choose' | 'previewing' | 'preview' | 'applying' | 'complete';
type PendingCopy = { actionKey: string; uid: number; destination: string };

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
  const latestProgressRef = useRef<RuleRunSummary | null>(null);
  const inbox = folders.find(folder => folder.path.toUpperCase() === 'INBOX');
  const ruleSelectors = getRuleRunSelectors(rules);
  const runnableRuleIds = getRunnableRuleIds(rules);
  const [folder, setFolder] = useState(inbox?.path || folders[0]?.path || 'INBOX');
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
  const busy = phase === 'previewing' || phase === 'applying';

  const requestClose = useCallback(() => {
    if (phase === 'previewing') {
      controllerRef.current?.abort();
      return;
    }
    if (phase === 'applying') return;
    onClose();
  }, [onClose, phase]);

  useModalFocus({ dialogRef, open: true, onClose: requestClose });

  useEffect(() => () => controllerRef.current?.abort(), []);

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
    setPhase(mode === 'preview' ? 'previewing' : 'applying');

    try {
      const summary = await runRulesThroughFolder({
        folder,
        mode,
        ruleIds: selectedRuleIds,
        ...(mode === 'apply' && preview
          ? {
              maxUid: preview.maxUid,
              uidValidity: preview.uidValidity,
              ruleRevision: preview.ruleRevision,
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
        if (mode === 'apply' && !retrySafe && !resolutionRequired) setPreview(null);
        setPhase(mode === 'apply' && (retrySafe || resolutionRequired) ? 'preview' : 'choose');
      }
    } finally {
      controllerRef.current = null;
    }
  };

  const previewDestinationActions = preview?.destinations.reduce((total, item) => total + item.count, 0) || 0;
  const createsCopies = Boolean(preview && previewDestinationActions > preview.affectedMessages);
  const pendingDestinations = pendingCopies.reduce<Map<string, number>>((counts, copy) => {
    counts.set(copy.destination, (counts.get(copy.destination) || 0) + 1);
    return counts;
  }, new Map());

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
              <label className="settings-field">
                <span>Folder to process</span>
                <select
                  className="glass-input glass-select"
                  aria-label="Source folder"
                  value={folder}
                  onChange={event => setFolder(event.target.value)}
                >
                  {folders.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}
                </select>
                <small>Only messages already in this folder are included.</small>
              </label>
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
              <span>{progress?.processed || 0} messages processed in {folder}</span>
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
            <div className="rule-run-summary" aria-live="polite">
              <div className="rule-run-metrics">
                <div><strong>{preview.processed}</strong><span>Scanned</span></div>
                <div><strong>{preview.matchedMessages}</strong><span>Matched</span></div>
                <div><strong>{preview.affectedMessages}</strong><span>Would move</span></div>
              </div>
              {preview.destinations.length > 0 ? (
                <div className="rule-run-destinations">
                  <h3>Planned destinations</h3>
                  {preview.destinations.map(destination => (
                    <div key={destination.folder}>
                      <span>{destination.folder}</span>
                      <strong>{destination.count}</strong>
                    </div>
                  ))}
                </div>
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
              {preview.bodySkippedMessages > 0 && (
                <p className="rule-run-footnote warning">
                  {preview.bodySkippedMessages} large message{preview.bodySkippedMessages === 1 ? '' : 's'} could not be safely checked against Body conditions.
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
                {result.appliedMessages} message{result.appliedMessages === 1 ? '' : 's'} processed with Move actions in {folder}.
              </p>
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
                  setNeedsCopyResolution(false);
                  setPendingCopies([]);
                  setError('');
                  setPhase('choose');
                }}
              >
                Change rules or folder
              </button>
              {needsCopyResolution ? (
                <>
                  <button className="btn btn-ghost" type="button" onClick={() => void run('apply', 'retry')}>
                    Copies are missing
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => void run('apply', 'completed')}>
                    Copies are present
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!preview?.affectedMessages}
                  onClick={() => void run('apply')}
                >
                  Apply rules
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
