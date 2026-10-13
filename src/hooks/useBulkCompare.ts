import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSheet } from '../lib/parse';
import type { PriceList } from '../lib/products';
import { draftSizes, fetchSnapshot, STUDIO_PARAMS, type ProductionSnapshot, type Server } from '../lib/production';
import { snapshotKey, type Workspace } from '../state/workspace';

/**
 * "Compare all": fetch prices — live and/or Studio Editor, from the production
 * and/or dev server — for many price lists in one go, one list after another, a few sizes in flight at a
 * time. Each list's result is saved the moment it lands — so it reaches the
 * shared database and every viewer straight away, and a cancelled run keeps
 * whatever already finished.
 */

export type CompareTarget = 'production' | 'studio';

/** One thing to compare every list against: a price (live or Studio Editor) on one server. */
export interface CompareSpec {
  target: CompareTarget;
  server: Server;
}

/** Every combination, in the order runs go through them. */
export const COMPARE_SPECS: readonly CompareSpec[] = [
  { target: 'production', server: 'production' },
  { target: 'studio', server: 'production' },
  { target: 'production', server: 'dev' },
  { target: 'studio', server: 'dev' },
];

export function specId(spec: CompareSpec): string {
  return `${spec.server}:${spec.target}`;
}

export function specLabel(spec: CompareSpec): string {
  const what = spec.target === 'studio' ? 'Studio Editor' : 'Price';
  return `${what} (${spec.server === 'dev' ? 'dev' : 'production'})`;
}

export interface BulkProgress {
  /** 1-based position of the job running now, and how many jobs in all. */
  job: number;
  jobs: number;
  list: PriceList;
  target: CompareTarget;
  server: Server;
  /** Sizes quoted so far for this job. */
  done: number;
  total: number;
}

export interface BulkResult {
  finished: number;
  jobs: number;
  cancelled: boolean;
  /** Drafted lists skipped because no row had a usable base area. */
  skipped: number;
  at: string;
}

/** A little more parallel than one list's Compare tab: these runs are long. */
const CONCURRENCY = 6;

export function useBulkCompare(
  getWorkspace: () => Workspace,
  saveSnapshot: (key: string, snapshot: ProductionSnapshot) => void,
) {
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (lists: PriceList[], specs: readonly CompareSpec[]) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      setResult(null);

      const ws = getWorkspace();
      let skipped = 0;
      const jobs = lists.flatMap((list) => {
        const draft = ws.drafts[list.key];
        if (!draft) return [];
        const sizes = draftSizes(parseSheet(draft.sheet));
        if (sizes.length === 0) {
          skipped += 1;
          return [];
        }
        return specs.map((spec) => ({ list, target: spec.target, server: spec.server, sizes }));
      });

      let finished = 0;
      for (const [i, job] of jobs.entries()) {
        if (ctrl.signal.aborted) break;
        const params = { ...(job.list.variant?.params ?? {}), ...(job.target === 'studio' ? STUDIO_PARAMS : {}) };
        const snapshot = await fetchSnapshot(job.list.product.slug, job.sizes, {
          params,
          server: job.server,
          signal: ctrl.signal,
          concurrency: CONCURRENCY,
          onProgress: (done, total) =>
            setProgress({ job: i + 1, jobs: jobs.length, list: job.list, target: job.target, server: job.server, done, total }),
        });
        if (!snapshot) break;
        saveSnapshot(snapshotKey(job.list.key, job.target, job.server), snapshot);
        finished += 1;
      }

      setProgress(null);
      setResult({ finished, jobs: jobs.length, cancelled: ctrl.signal.aborted, skipped, at: new Date().toISOString() });
    },
    [getWorkspace, saveSnapshot],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { run, cancel, progress, result };
}

export type BulkCompare = ReturnType<typeof useBulkCompare>;
