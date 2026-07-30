import { runRulesPage } from '../shared/api';
import type { RuleMatchCount, RuleRunCount, RuleRunPageResponse } from '../shared/types';

export interface RuleRunSummary {
  folder: string;
  mode: 'preview' | 'apply';
  processed: number;
  matchedMessages: number;
  affectedMessages: number;
  appliedMessages: number;
  copiedMessages: number;
  movedMessages: number;
  deliveryOnlyMatches: number;
  bodySkippedMessages: number;
  invalidDestinations: string[];
  ruleMatches: RuleMatchCount[];
  destinations: RuleRunCount[];
  maxUid: number;
  uidValidity: string;
  ruleRevision: string;
}

interface RunRulesOptions {
  folder: string;
  mode: 'preview' | 'apply';
  maxUid?: number;
  uidValidity?: string;
  ruleRevision?: string;
  copyResolution?: 'completed' | 'retry';
  copyActionKeys?: string[];
  signal?: AbortSignal;
  onProgress?: (summary: RuleRunSummary) => void;
}

export async function runRulesThroughFolder({
  folder,
  mode,
  maxUid,
  uidValidity,
  ruleRevision,
  copyResolution,
  copyActionKeys,
  signal,
  onProgress,
}: RunRulesOptions): Promise<RuleRunSummary> {
  let cursor = 0;
  let snapshotMaxUid = maxUid;
  let snapshotUidValidity = uidValidity;
  let snapshotRuleRevision = ruleRevision;
  const ruleMatches = new Map<string, RuleMatchCount>();
  const destinations = new Map<string, RuleRunCount>();
  const invalidDestinations = new Set<string>();
  const summary: RuleRunSummary = {
    folder,
    mode,
    processed: 0,
    matchedMessages: 0,
    affectedMessages: 0,
    appliedMessages: 0,
    copiedMessages: 0,
    movedMessages: 0,
    deliveryOnlyMatches: 0,
    bodySkippedMessages: 0,
    invalidDestinations: [],
    ruleMatches: [],
    destinations: [],
    maxUid: snapshotMaxUid || 0,
    uidValidity: snapshotUidValidity || '',
    ruleRevision: snapshotRuleRevision || '',
  };

  for (let pageNumber = 0; pageNumber < 10000; pageNumber += 1) {
    const request = {
      folder,
      mode,
      cursor,
      ...(snapshotMaxUid === undefined ? {} : { maxUid: snapshotMaxUid }),
      ...(snapshotUidValidity ? { uidValidity: snapshotUidValidity } : {}),
      ...(snapshotRuleRevision ? { ruleRevision: snapshotRuleRevision } : {}),
      ...(copyResolution ? { copyResolution } : {}),
      ...(copyActionKeys?.length ? { copyActionKeys } : {}),
    };
    const page: RuleRunPageResponse = await runRulesPage(request, signal);
    snapshotMaxUid = page.maxUid;
    if (snapshotUidValidity && page.uidValidity !== snapshotUidValidity) {
      throw new Error('The source folder changed during this run. Preview again before applying.');
    }
    snapshotUidValidity = page.uidValidity;
    if (snapshotRuleRevision && page.ruleRevision !== snapshotRuleRevision) {
      throw new Error('Rules changed during this run. Preview again before applying.');
    }
    snapshotRuleRevision = page.ruleRevision;

    summary.processed += page.processed;
    summary.matchedMessages += page.matchedMessages;
    summary.affectedMessages += page.affectedMessages;
    summary.appliedMessages += page.appliedMessages;
    summary.copiedMessages += page.copiedMessages;
    summary.movedMessages += page.movedMessages;
    summary.deliveryOnlyMatches += page.deliveryOnlyMatches;
    summary.bodySkippedMessages += page.bodySkippedMessages;
    summary.maxUid = page.maxUid;
    summary.uidValidity = page.uidValidity;
    summary.ruleRevision = page.ruleRevision;

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

    if (page.done) return summary;
    if (page.cursor <= cursor) throw new Error('Rule run stopped because mailbox progress stalled.');
    cursor = page.cursor;
  }

  throw new Error('Rule run exceeded its safe page limit.');
}
