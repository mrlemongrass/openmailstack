import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, RefreshCw, X } from 'lucide-react';
import { analyzeRules } from '../shared/api';
import type { Rule, RuleAnalysis, RuleAnalysisFinding, RuleAnalysisRemoval } from '../shared/types';
import { useModalFocus } from '../shared/hooks/useModalFocus';

function FindingList({ findings }: { findings: RuleAnalysisFinding[] }) {
  return (
    <div className="rule-duplicate-findings">
      {findings.map(finding => (
        <article className="rule-duplicate-finding" key={finding.id}>
          <strong>{finding.label}</strong>
          <p>{finding.explanation}</p>
          <div className="rule-duplicate-occurrences">
            {finding.occurrences.map(occurrence => (
              <span key={`${occurrence.ruleIndex}-${occurrence.itemType}-${occurrence.itemIndex}`}>
                {occurrence.ruleName} · {occurrence.itemType === 'criterion' ? 'Condition' : 'Action'} {occurrence.itemIndex + 1}
                {!occurrence.ruleEnabled && <small>Disabled rule</small>}
              </span>
            ))}
            {Boolean(finding.omittedOccurrences) && (
              <span>+ {finding.omittedOccurrences} more</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function RuleDuplicateReviewDialog({
  rules,
  onClose,
  onApplyCleanup,
}: {
  rules: Rule[];
  onClose: () => void;
  onApplyCleanup: (removals: RuleAnalysisRemoval[]) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [analysis, setAnalysis] = useState<RuleAnalysis | null>(null);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);

  const requestClose = useCallback(() => {
    controllerRef.current?.abort();
    onClose();
  }, [onClose]);

  useModalFocus({ dialogRef, open: true, onClose: requestClose });

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;

    void analyzeRules(rules, controller.signal)
      .then(result => setAnalysis(result))
      .catch(reviewError => {
        if (reviewError instanceof Error && reviewError.name === 'AbortError') return;
        setError(reviewError instanceof Error ? reviewError.message : 'Failed to review rule duplicates.');
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
      });

    return () => controller.abort();
  }, [requestVersion, rules]);

  const safeFindings = analysis?.findings.filter(finding => finding.safety === 'safe') || [];
  const reviewFindings = analysis?.findings.filter(finding => finding.safety === 'review') || [];

  return (
    <div className="modal-overlay rule-run-overlay">
      <div
        ref={dialogRef}
        className="modal-content rule-run-dialog rule-duplicate-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-duplicate-review-title"
        tabIndex={-1}
      >
        <div className="rule-run-header">
          <div>
            <span className="settings-eyebrow">Mail automation</span>
            <h2 id="rule-duplicate-review-title">Review duplicate rules</h2>
            <p>Check the rules currently in the editor. Nothing changes on the server until you save.</p>
          </div>
          <button className="icon-btn" type="button" aria-label="Close duplicate review" onClick={requestClose}>
            <X size={18} />
          </button>
        </div>

        <div className="rule-run-body">
          {!analysis && !error && (
            <div className="rule-duplicate-loading" role="status" aria-live="polite">
              <div className="spinner" />
              <strong>Checking this draft…</strong>
              <span>Comparing conditions and actions without opening your mailbox.</span>
            </div>
          )}

          {error && (
            <div className="rule-duplicate-error" role="alert">
              <AlertTriangle size={24} />
              <strong>Duplicate review could not finish</strong>
              <span>{error}</span>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setAnalysis(null);
                  setError('');
                  setRequestVersion(version => version + 1);
                }}
              >
                <RefreshCw size={16} /> Try again
              </button>
            </div>
          )}

          {analysis && (
            <>
              <div className="rule-duplicate-summary" aria-live="polite">
                <div className="safe">
                  <CheckCircle2 size={20} />
                  <span><strong>{analysis.summary.removableItems}</strong> Safe cleanup</span>
                </div>
                <div className="review">
                  <AlertTriangle size={20} />
                  <span><strong>{reviewFindings.length}</strong> Review only</span>
                </div>
              </div>

              {analysis.findings.length === 0 ? (
                <div className="rule-duplicate-empty">
                  <ListChecks size={34} />
                  <h3>No duplicate conditions or actions found</h3>
                  <p>This draft has no exact repeats or likely overlaps.</p>
                </div>
              ) : (
                <>
                  {safeFindings.length > 0 && (
                    <section className="rule-duplicate-section">
                      <div>
                        <h3>Safe cleanup</h3>
                        <p>Later exact copies in the same rule can be removed while the first entry stays in place.</p>
                      </div>
                      <FindingList findings={safeFindings} />
                    </section>
                  )}

                  {reviewFindings.length > 0 && (
                    <section className="rule-duplicate-section review-only">
                      <div>
                        <h3>Review only</h3>
                        <p>These may be intentional because rule order, ANY/ALL matching, and stop-processing affect behavior.</p>
                      </div>
                      <FindingList findings={reviewFindings} />
                    </section>
                  )}
                </>
              )}

              {analysis.truncated && (
                <p className="rule-run-footnote warning">
                  This draft is too large to show or compare every possible overlap. Safe cleanup still includes every verified exact repeat.
                </p>
              )}
            </>
          )}
        </div>

        <div className="rule-run-actions">
          <button className="btn btn-ghost" type="button" onClick={requestClose}>Close</button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!analysis?.summary.removableItems}
            onClick={() => analysis && onApplyCleanup(analysis.removals)}
          >
            <CheckCircle2 size={16} /> Remove exact duplicates
          </button>
        </div>
      </div>
    </div>
  );
}
