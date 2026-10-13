import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import Overview from './components/Overview';
import ProductWorkspace, { type Tab } from './components/ProductWorkspace';
import { findProduct, PRODUCTS } from './lib/products';
import type { ProductionSnapshot } from './lib/production';
import { useCloudSync } from './hooks/useCloudSync';
import {
  isBlankSheet,
  loadWorkspace,
  productStatus,
  saveWorkspace,
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

  useEffect(() => {
    const id = setTimeout(() => setSaved(saveWorkspace(workspace)), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [workspace]);

  // Never lose the last debounce window to a reload.
  const latest = useRef(workspace);
  latest.current = workspace;
  useEffect(() => {
    const flush = () => saveWorkspace(latest.current);
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const slug = workspace.activeSlug;
  const product = findProduct(slug) ?? PRODUCTS[0];

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
    holdSlug: view === 'product' ? product.slug : null,
    onReplace,
  });

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

  const revision = revisions[product.slug] ?? 0;
  const onSaveDraft = useCallback(
    (sheet: SheetState) => saveDraft(slug, revision, sheet),
    [saveDraft, slug, revision],
  );
  const onSnapshot = useCallback(
    (snapshot: ProductionSnapshot) =>
      setWorkspace((ws) => ({
        ...ws,
        snapshots: { ...ws.snapshots, [slug]: { ...snapshot, savedAt: new Date().toISOString() } },
        dirtySnapshots: { ...ws.dirtySnapshots, [slug]: true },
      })),
    [slug],
  );
  const setOptions = useCallback((options: EngineOptions) => setWorkspace((ws) => ({ ...ws, options })), []);
  const setUserName = useCallback((userName: string) => setWorkspace((ws) => ({ ...ws, userName })), []);
  const setCompareRounding = useCallback(
    (unit: PriceUnit) =>
      setWorkspace((ws) => ({ ...ws, compareRounding: { ...ws.compareRounding, [slug]: unit } })),
    [slug],
  );

  const selectProduct = useCallback((next: string) => {
    setWorkspace((ws) => (ws.activeSlug === next ? ws : { ...ws, activeSlug: next }));
    setView('product');
    setNavOpen(false);
  }, []);

  const statuses = useMemo(() => {
    const out: Record<string, ProductStatus> = {};
    for (const p of PRODUCTS) out[p.slug] = productStatus(workspace, p.slug);
    return out;
    // Options, names and the active slug do not affect statuses; skip recomputing on them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.drafts, workspace.snapshots, workspace.dirty, workspace.compareRounding]);

  const draft = workspace.drafts[product.slug];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        view={view}
        activeSlug={product.slug}
        statuses={statuses}
        onSelectProduct={selectProduct}
        onOverview={() => {
          setView('overview');
          setNavOpen(false);
        }}
        options={workspace.options}
        setOptions={setOptions}
        saved={saved}
        sync={sync}
        userName={workspace.userName}
        setUserName={setUserName}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {view === 'overview' ? (
          <Overview statuses={statuses} onSelectProduct={selectProduct} onOpenNav={() => setNavOpen(true)} />
        ) : (
          <ProductWorkspace
            key={`${product.slug}:${revision}`}
            product={product}
            initialSheet={draft?.sheet ?? null}
            updatedAt={draft?.updatedAt ?? null}
            updatedBy={draft?.updatedBy ?? null}
            unsynced={!!workspace.dirty[product.slug]}
            conflict={sync.conflicts[product.slug] ?? null}
            incoming={sync.incoming[product.slug] ?? null}
            onKeepMine={() => sync.keepMine(product.slug)}
            onTakeTheirs={() => sync.takeTheirs(product.slug)}
            onDismissIncoming={() => sync.dismissIncoming(product.slug)}
            onSaveDraft={onSaveDraft}
            snapshot={workspace.snapshots[product.slug] ?? null}
            onSnapshot={onSnapshot}
            compareRounding={workspace.compareRounding[product.slug] ?? 1}
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
