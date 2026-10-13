import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import NavRail, { type RailTarget } from './components/NavRail';
import TopBar from './components/TopBar';
import { useBulkCompare } from './hooks/useBulkCompare';
import Overview from './components/Overview';
import ProductWorkspace, { type Tab } from './components/ProductWorkspace';
import { findPriceList, PRICE_LISTS } from './lib/products';
import type { ProductionSnapshot, Server } from './lib/production';
import { useCloudSync } from './hooks/useCloudSync';
import {
  isBlankSheet,
  loadWorkspace,
  productStatus,
  saveWorkspace,
  snapshotKey,
  withSettings,
  type CompareMode,
  type ProductStatus,
  type Workspace,
} from './state/workspace';
import type { EngineOptions, SheetState } from './types';
import type { PriceUnit } from './lib/calculator';

/** Coalesce bursts of edits into one localStorage write. */
const SAVE_DEBOUNCE_MS = 300;

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace);
  const [view, setView] = useState<'overview' | 'product'>('product');
  const [tab, setTab] = useState<Tab>('table');
  const [navOpen, setNavOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const latest = useRef(workspace);
  latest.current = workspace;

  // The active price list: a product, or one color group of it.
  const list = findPriceList(workspace.activeSlug) ?? PRICE_LISTS[0];
  const slug = list.key;

  /**
   * Bumped when a product's draft is replaced from the server, which remounts
   * its workspace on the new sheet. Saves from the outgoing mount carry the old
   * revision and are dropped, so they cannot write the stale sheet back.
   */
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const revisionRef = useRef(revisions);
  const onReplace = useCallback((target: string) => {
    const next = { ...revisionRef.current, [target]: (revisionRef.current[target] ?? 0) + 1 };
    revisionRef.current = next;
    setRevisions(next);
  }, []);

  const sync = useCloudSync(workspace, setWorkspace, {
    holdSlug: view === 'product' ? slug : null,
    onReplace,
  });

  /**
   * The browser copy. With the shared database live it holds only what the
   * database does not have yet (and your name); everything else loads from the
   * database, so every viewer sees the latest. Without a database it holds all.
   */
  const shared = sync.status === 'synced' || sync.status === 'saving';
  const scopeRef = useRef<'all' | 'pending'>('all');
  scopeRef.current = shared ? 'pending' : 'all';
  const persist = useCallback((ws: Workspace) => {
    // Too big for the browser in full? The unshared part is what matters.
    const ok = saveWorkspace(ws, scopeRef.current) || (scopeRef.current === 'all' && saveWorkspace(ws, 'pending'));
    setSaved(ok);
    return ok;
  }, []);
  useEffect(() => {
    const id = setTimeout(() => persist(workspace), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [workspace, shared, persist]);
  // Never lose the last debounce window to a reload.
  useEffect(() => {
    const flush = () => persist(latest.current);
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [persist]);
  const pendingCount = Object.keys(workspace.dirty).length + Object.keys(workspace.dirtySnapshots).length;

  const saveDraft = useCallback((target: string, revision: number, sheet: SheetState) => {
    if ((revisionRef.current[target] ?? 0) !== revision) return;
    setWorkspace((ws) => {
      const existing = ws.drafts[target];
      if (isBlankSheet(sheet)) {
        // Opening a product must not create a draft; clearing one removes it.
        if (!existing) return ws;
        const drafts = { ...ws.drafts };
        delete drafts[target];
        return { ...ws, drafts, dirty: { ...ws.dirty, [target]: true } };
      }
      if (existing?.sheet === sheet) return ws;
      return {
        ...ws,
        drafts: {
          ...ws.drafts,
          [target]: { sheet, updatedAt: new Date().toISOString(), updatedBy: ws.userName.trim() || null },
        },
        dirty: { ...ws.dirty, [target]: true },
      };
    });
  }, []);

  const revision = revisions[slug] ?? 0;
  const onSaveDraft = useCallback(
    (sheet: SheetState) => saveDraft(slug, revision, sheet),
    [saveDraft, slug, revision],
  );
  /** Store fetched production prices under a key: the list's, or its `@studio` key. */
  const saveSnapshot = useCallback(
    (key: string, snapshot: ProductionSnapshot) =>
      setWorkspace((ws) => ({
        ...ws,
        snapshots: { ...ws.snapshots, [key]: { ...snapshot, savedAt: new Date().toISOString() } },
        dirtySnapshots: { ...ws.dirtySnapshots, [key]: true },
      })),
    [],
  );
  // Fetched prices are stored per server: production's and dev's never mix.
  const server = workspace.server;
  const onSnapshot = useCallback(
    (snapshot: ProductionSnapshot) => saveSnapshot(snapshotKey(slug, 'production', server), snapshot),
    [saveSnapshot, slug, server],
  );
  const onStudioSnapshot = useCallback(
    (snapshot: ProductionSnapshot) => saveSnapshot(snapshotKey(slug, 'studio', server), snapshot),
    [saveSnapshot, slug, server],
  );
  /** Either comparison on either server — the compare tabs fetch and summarise both. */
  const snapshotFor = useCallback(
    (mode: CompareMode, srv: Server) => workspace.snapshots[snapshotKey(slug, mode, srv)] ?? null,
    [workspace.snapshots, slug],
  );
  const onSnapshotFor = useCallback(
    (mode: CompareMode, srv: Server, snapshot: ProductionSnapshot) => saveSnapshot(snapshotKey(slug, mode, srv), snapshot),
    [saveSnapshot, slug],
  );
  const setServer = useCallback((next: Server) => setWorkspace((ws) => ({ ...ws, server: next })), []);
  // Shared with everyone through the database (see withSettings).
  const setOptions = useCallback((options: EngineOptions) => setWorkspace((ws) => withSettings(ws, { options })), []);
  const setUserName = useCallback((userName: string) => setWorkspace((ws) => ({ ...ws, userName })), []);
  const setCompareRounding = useCallback(
    (unit: PriceUnit) =>
      setWorkspace((ws) => withSettings(ws, { compareRounding: { ...ws.compareRounding, [slug]: unit } })),
    [slug],
  );

  const bulk = useBulkCompare(
    useCallback(() => latest.current, []),
    saveSnapshot,
  );

  const selectProduct = useCallback((next: string) => {
    setWorkspace((ws) => (ws.activeSlug === next ? ws : { ...ws, activeSlug: next }));
    setView('product');
    setNavOpen(false);
  }, []);

  const statuses = useMemo(() => {
    const out: Record<string, ProductStatus> = {};
    for (const l of PRICE_LISTS) out[l.key] = productStatus(workspace, l.key);
    return out;
    // Options, names and the active slug do not affect statuses; skip recomputing on them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.drafts, workspace.snapshots, workspace.dirty, workspace.compareRounding, workspace.server]);

  const draft = workspace.drafts[slug];

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f6fa]">
      <NavRail
        active={
          view === 'overview'
            ? 'overview'
            : tab === 'compare' || tab === 'studio' || tab === 'table'
              ? tab
              : null
        }
        onNavigate={(target: RailTarget) => {
          if (target === 'overview') setView('overview');
          else {
            setView('product');
            setTab(target);
          }
        }}
      />
      <Sidebar
        view={view}
        activeSlug={slug}
        statuses={statuses}
        onSelectProduct={selectProduct}
        onOverview={() => {
          setView('overview');
          setNavOpen(false);
        }}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      {/* Bottom padding keeps the floating dock clear of each page's last rows. */}
      <div className="flex min-w-0 flex-1 flex-col pb-[72px]">
        <TopBar
          sync={sync}
          browserSaved={saved}
          pendingCount={pendingCount}
          userName={workspace.userName}
          setUserName={setUserName}
          options={workspace.options}
          setOptions={setOptions}
        />
        {view === 'overview' ? (
          <Overview
            statuses={statuses}
            onSelectProduct={(key) => {
              selectProduct(key);
              setTab('table');
            }}
            onOpenCompare={(key) => {
              selectProduct(key);
              setTab('compare');
            }}
            onOpenNav={() => setNavOpen(true)}
            bulk={bulk}
            server={server}
            onServer={setServer}
          />
        ) : (
          <ProductWorkspace
            key={`${slug}:${revision}`}
            priceList={list}
            initialSheet={draft?.sheet ?? null}
            updatedAt={draft?.updatedAt ?? null}
            updatedBy={draft?.updatedBy ?? null}
            unsynced={!!workspace.dirty[slug]}
            conflict={sync.conflicts[slug] ?? null}
            incoming={sync.incoming[slug] ?? null}
            onKeepMine={() => sync.keepMine(slug)}
            onTakeTheirs={() => sync.takeTheirs(slug)}
            onDismissIncoming={() => sync.dismissIncoming(slug)}
            onSaveDraft={onSaveDraft}
            snapshot={workspace.snapshots[snapshotKey(slug, 'production', server)] ?? null}
            onSnapshot={onSnapshot}
            studioSnapshot={workspace.snapshots[snapshotKey(slug, 'studio', server)] ?? null}
            server={server}
            onServer={setServer}
            snapshotFor={snapshotFor}
            onSnapshotFor={onSnapshotFor}
            onStudioSnapshot={onStudioSnapshot}
            compareRounding={workspace.compareRounding[slug] ?? 1}
            onCompareRounding={setCompareRounding}
            options={workspace.options}
            tab={tab}
            onTabChange={setTab}
            onOpenNav={() => setNavOpen(true)}
          />
        )}
      </div>
    </div>
  );
}
