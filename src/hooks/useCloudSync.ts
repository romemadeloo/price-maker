import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { fetchIndex, fetchRemote, pushDraft, pushSnapshot, savePasscode, SyncError, type RemoteWorkspace } from '../lib/sync';
import { draftFromRemote, mergeRemote, staleSlugs, type HeldDraft, type Workspace } from '../state/workspace';

/**
 * Keeps the local workspace and the shared one in step.
 *
 *   pull  — on open, then every POLL_MS while the tab is visible and on focus:
 *           a cheap index read, then only the products that changed.
 *   push  — PUSH_DEBOUNCE_MS after an edit: each unsynced draft, sent with the
 *           version it was based on. If someone saved that product first the
 *           server refuses, and the product is parked in `conflicts` for the
 *           user to resolve — nothing is overwritten silently, either way.
 */

const POLL_MS = 30_000;
const PUSH_DEBOUNCE_MS = 1_000;

export type SyncStatus = 'connecting' | 'synced' | 'saving' | 'offline' | 'not-configured' | 'locked' | 'error';

export interface CloudSync {
  status: SyncStatus;
  message: string | null;
  lastSyncedAt: string | null;
  /** Products where someone else's save beat ours. */
  conflicts: Record<string, HeldDraft>;
  /** Newer server copies of the product on screen, not yet applied. */
  incoming: Record<string, HeldDraft>;
  keepMine: (slug: string) => void;
  takeTheirs: (slug: string) => void;
  dismissIncoming: (slug: string) => void;
  unlock: (passcode: string) => void;
  syncNow: () => void;
}

interface Options {
  /** The product open on screen; newer copies of it wait in `incoming`. */
  holdSlug: string | null;
  /** Called just before a product's draft is replaced from the server. */
  onReplace: (slug: string) => void;
}

export function useCloudSync(
  workspace: Workspace,
  setWorkspace: Dispatch<SetStateAction<Workspace>>,
  { holdSlug, onReplace }: Options,
): CloudSync {
  const [status, setStatus] = useState<SyncStatus>('connecting');
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, HeldDraft>>({});
  const [incoming, setIncoming] = useState<Record<string, HeldDraft>>({});

  const latest = useRef({ workspace, holdSlug, conflicts, incoming, onReplace });
  latest.current = { workspace, holdSlug, conflicts, incoming, onReplace };

  /** Versions the user chose not to load; their notice stays dismissed. */
  const dismissed = useRef<Record<string, number>>({});
  const loaded = useRef(false);
  const pulling = useRef(false);
  const pushing = useRef(false);
  const pushAgain = useRef(false);
  const [pushTick, setPushTick] = useState(0);

  const fail = useCallback((err: unknown) => {
    const e = err instanceof SyncError ? err : new SyncError((err as Error).message, -1);
    if (e.status === 0) setStatus('offline');
    else if (e.status === 401) setStatus('locked');
    // 404: a static host with no API at all (e.g. a plain `vite preview` elsewhere).
    else if (e.code === 'not-configured' || e.status === 404) setStatus('not-configured');
    else setStatus('error');
    setMessage(e.message);
  }, []);

  const succeed = useCallback(() => {
    setStatus('synced');
    setMessage(null);
    setLastSyncedAt(new Date().toISOString());
  }, []);

  const apply = useCallback(
    (remote: RemoteWorkspace, slugs?: string[]) => {
      const options = { slugs, holdSlug: latest.current.holdSlug };
      setWorkspace((ws) => mergeRemote(ws, remote, options).workspace);

      // Same pure merge against the latest render, only to learn what was held back.
      const { held } = mergeRemote(latest.current.workspace, remote, options);
      setIncoming((current) => {
        const next = { ...current };
        for (const slug of slugs ?? Object.keys(next)) delete next[slug];
        for (const [slug, h] of Object.entries(held)) {
          if (dismissed.current[slug] !== h.version) next[slug] = h;
        }
        return next;
      });
    },
    [setWorkspace],
  );

  const pull = useCallback(async () => {
    if (pulling.current) return;
    pulling.current = true;
    try {
      if (!loaded.current) {
        apply(await fetchRemote());
        loaded.current = true;
      } else {
        const stale = staleSlugs(latest.current.workspace, await fetchIndex());
        if (stale.length > 0) apply(await fetchRemote(stale), stale);
      }
      succeed();
      // Anything edited while offline goes up now.
      const ws = latest.current.workspace;
      if (Object.keys(ws.dirty).length + Object.keys(ws.dirtySnapshots).length > 0) setPushTick((t) => t + 1);
    } catch (err) {
      fail(err);
    } finally {
      pulling.current = false;
    }
  }, [apply, fail, succeed]);

  const push = useCallback(async () => {
    if (!loaded.current) return;
    if (pushing.current) {
      pushAgain.current = true;
      return;
    }
    pushing.current = true;
    setStatus('saving');
    try {
      for (const slug of Object.keys(latest.current.workspace.dirty)) {
        if (latest.current.conflicts[slug]) continue;
        const ws = latest.current.workspace;
        const sheet = ws.drafts[slug]?.sheet ?? null;
        const result = await pushDraft(slug, sheet, ws.versions[slug] ?? 0, ws.userName);

        if (!result.ok) {
          setConflicts((c) => ({ ...c, [slug]: { draft: result.draft, version: result.version } }));
          continue;
        }
        setWorkspace((w) => {
          const current = w.drafts[slug];
          const unchanged = (current?.sheet ?? null) === sheet;
          const dirty = { ...w.dirty };
          // Edited again while this save was in flight: stay dirty, now based on the new version.
          if (unchanged) delete dirty[slug];
          const drafts =
            unchanged && current
              ? { ...w.drafts, [slug]: { ...current, updatedAt: result.updatedAt, updatedBy: result.updatedBy } }
              : w.drafts;
          return { ...w, drafts, dirty, versions: { ...w.versions, [slug]: result.version } };
        });
      }

      for (const slug of Object.keys(latest.current.workspace.dirtySnapshots)) {
        const snapshot = latest.current.workspace.snapshots[slug];
        if (snapshot) await pushSnapshot(slug, snapshot);
        setWorkspace((w) => {
          if (w.snapshots[slug] !== snapshot) return w;
          const dirtySnapshots = { ...w.dirtySnapshots };
          delete dirtySnapshots[slug];
          return { ...w, dirtySnapshots };
        });
      }
      succeed();
    } catch (err) {
      fail(err);
    } finally {
      pushing.current = false;
      if (pushAgain.current) {
        pushAgain.current = false;
        setPushTick((t) => t + 1);
      }
    }
  }, [fail, setWorkspace, succeed]);

  // Pull on open, on an interval while visible, and when the tab comes back.
  useEffect(() => {
    void pull();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void pull();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pull();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pull]);

  // Leaving a product releases any update held back for it: pull it in now.
  useEffect(() => {
    if (loaded.current) void pull();
  }, [holdSlug, pull]);

  // Push shortly after anything becomes unsynced.
  const pending = Object.keys(workspace.dirty).length + Object.keys(workspace.dirtySnapshots).length;
  useEffect(() => {
    if (pending === 0) return;
    const id = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [workspace.dirty, workspace.dirtySnapshots, pending, push, pushTick]);

  const keepMine = useCallback(
    (slug: string) => {
      const conflict = latest.current.conflicts[slug];
      if (!conflict) return;
      // Re-base our draft on theirs; the next push overwrites it deliberately.
      setWorkspace((w) => ({
        ...w,
        versions: { ...w.versions, [slug]: conflict.version },
        dirty: { ...w.dirty, [slug]: true },
      }));
      setConflicts((c) => {
        const next = { ...c };
        delete next[slug];
        return next;
      });
    },
    [setWorkspace],
  );

  const takeTheirs = useCallback(
    (slug: string) => {
      const held = latest.current.conflicts[slug] ?? latest.current.incoming[slug];
      if (!held) return;
      latest.current.onReplace(slug);
      setWorkspace((w) => {
        const drafts = { ...w.drafts };
        if (held.draft) drafts[slug] = draftFromRemote(held.draft);
        else delete drafts[slug];
        const dirty = { ...w.dirty };
        delete dirty[slug];
        return { ...w, drafts, dirty, versions: { ...w.versions, [slug]: held.version } };
      });
      const drop = (c: Record<string, HeldDraft>) => {
        const next = { ...c };
        delete next[slug];
        return next;
      };
      setConflicts(drop);
      setIncoming(drop);
    },
    [setWorkspace],
  );

  const dismissIncoming = useCallback((slug: string) => {
    const held = latest.current.incoming[slug];
    if (held) dismissed.current[slug] = held.version;
    setIncoming((c) => {
      const next = { ...c };
      delete next[slug];
      return next;
    });
  }, []);

  const unlock = useCallback(
    (passcode: string) => {
      savePasscode(passcode.trim());
      setStatus('connecting');
      void pull();
    },
    [pull],
  );

  const syncNow = useCallback(() => {
    void pull();
  }, [pull]);

  return { status, message, lastSyncedAt, conflicts, incoming, keepMine, takeTheirs, dismissIncoming, unlock, syncNow };
}
