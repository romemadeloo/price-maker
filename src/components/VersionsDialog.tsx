import { useEffect, useMemo, useState } from 'react';
import type { SheetState } from '../types';
import { timeAgo } from '../lib/format';
import { SyncError } from '../lib/sync';
import {
  createVersion,
  deleteVersion,
  diffSheets,
  getVersion,
  isSameSheet,
  updateVersion,
  type SheetDiff,
  type StoredSheet,
  type VersionMeta,
  type VersionStatus,
} from '../lib/versions';
import { CloseIcon, HistoryIcon } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  slug: string;
  listName: string;
  /** The table on screen now. */
  sheet: SheetState;
  userName: string;
  /** Null while loading; an Error when the list could not be read. */
  versions: VersionMeta[] | null | Error;
  reload: () => Promise<void>;
  onRestore: (sheet: StoredSheet, version: VersionMeta) => void;
}

function describe(err: unknown): string {
  if (err instanceof SyncError && (err.code === 'not-configured' || err.status === 0)) {
    return 'Version history is kept in the shared database, which is not reachable right now.';
  }
  return (err as Error).message;
}

function Badge({ status }: { status: VersionStatus }) {
  return status === 'actual' ? (
    <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      Actual
    </span>
  ) : (
    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">Draft</span>
  );
}

function DiffLine({ diff }: { diff: SheetDiff }) {
  if (isSameSheet(diff)) return <span className="text-emerald-700">Same prices as the table on screen</span>;
  const parts = [
    diff.changed && `${diff.changed.toLocaleString()} changed`,
    diff.added && `${diff.added.toLocaleString()} only on screen`,
    diff.removed && `${diff.removed.toLocaleString()} only in this version`,
  ].filter(Boolean);
  return (
    <span>
      <span className="font-medium text-amber-700">vs table on screen: {parts.join(' · ')}</span>
      {diff.samples.length > 0 && (
        <span className="ml-1 text-slate-400">
          (e.g.{' '}
          {diff.samples
            .slice(0, 3)
            .map((s) => `${s.baseArea}mm² × ${s.quantity}: ₩${s.from.toLocaleString()} → ₩${s.to.toLocaleString()}`)
            .join('; ')}
          )
        </span>
      )}
    </span>
  );
}

/**
 * Version history for one price list: save the table as a named version
 * (Draft or Actual), see how each differs from what is on screen, restore one,
 * or mark which one is actually live.
 */
export default function VersionsDialog({ open, onClose, slug, listName, sheet, userName, versions, reload, onRestore }: Props) {
  const list = Array.isArray(versions) ? versions : [];
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<VersionStatus>('draft');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Tables fetched for comparing, by version id. */
  const [sheets, setSheets] = useState<Record<string, StoredSheet>>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLabel('');
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slug]);

  const current: StoredSheet = useMemo(
    () => ({ quantities: sheet.quantities, rows: sheet.rows.map(({ size, baseArea, prices }) => ({ size, baseArea, prices })) }),
    [sheet],
  );
  const blank = sheet.rows.every((r) => r.baseArea.trim() === '' && r.prices.every((p) => p.trim() === ''));

  if (!open) return null;

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  };

  const loadSheet = async (v: VersionMeta): Promise<StoredSheet> => {
    if (sheets[v.id]) return sheets[v.id];
    const full = await getVersion(slug, v.id);
    if (!full.sheet) throw new Error('This version has no table.');
    setSheets((s) => ({ ...s, [v.id]: full.sheet! }));
    return full.sheet;
  };

  const save = () =>
    run('save', async () => {
      await createVersion(slug, {
        label: label.trim() || `v${list.length + 1}`,
        status,
        note: note.trim() || undefined,
        sheet,
        createdBy: userName.trim(),
      });
      setLabel('');
      setNote('');
      setStatus('draft');
      await reload();
    });

  const latestDiff = list[0] && sheets[list[0].id] ? diffSheets(sheets[list[0].id], current) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Versions"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-brand-600">
            <HistoryIcon width={18} height={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-900">Versions · {listName}</h2>
            <p className="text-xs text-slate-500">
              Save the table as a named version. Mark the one that is live as <b>Actual</b> — only one can be. Restoring
              loads a version into the table; Undo takes it back.
            </p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* ---------------------------------------------- save */}
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`Name, e.g. v${list.length + 1} or “Nov price book”`}
              maxLength={80}
              className="min-w-[12rem] flex-1 rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-brand-300"
            />
            <div className="seg bg-white">
              <button aria-pressed={status === 'draft'} onClick={() => setStatus('draft')}>
                Draft
              </button>
              <button aria-pressed={status === 'actual'} onClick={() => setStatus('actual')}>
                Actual
              </button>
            </div>
            <button className="btn btn-primary" onClick={save} disabled={blank || busy != null}>
              {busy === 'save' ? 'Saving…' : 'Save current table'}
            </button>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — what changed, where the prices came from"
            maxLength={500}
            className="mt-2 w-full rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-brand-300"
          />
          {blank && <p className="mt-1.5 text-xs text-slate-400">The table is empty — nothing to save.</p>}
          {latestDiff && isSameSheet(latestDiff) && (
            <p className="mt-1.5 text-xs text-slate-400">The table on screen matches the latest version, “{list[0].label}”.</p>
          )}
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        {/* ---------------------------------------------- history */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {versions instanceof Error ? (
            <p className="py-6 text-center text-xs text-red-600">{describe(versions)}</p>
          ) : versions == null ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading versions…</p>
          ) : list.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No versions yet. Save the table above to start the history.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.map((v) => {
                const diff = sheets[v.id] ? diffSheets(sheets[v.id], current) : null;
                return (
                  <li key={v.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-900">{v.label}</span>
                        <Badge status={v.status} />
                        <span className="text-xs text-slate-400" title={new Date(v.createdAt).toLocaleString()}>
                          {timeAgo(v.createdAt)}
                          {v.createdBy ? ` by ${v.createdBy}` : ''}
                        </span>
                      </div>
                      {v.note && <p className="mt-0.5 text-xs text-slate-500">{v.note}</p>}
                      {diff && (
                        <p className="mt-0.5 text-xs">
                          <DiffLine diff={diff} />
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {!diff && (
                        <button
                          className="btn btn-ghost"
                          disabled={busy != null}
                          onClick={() => run(`cmp:${v.id}`, async () => void (await loadSheet(v)))}
                        >
                          {busy === `cmp:${v.id}` ? 'Comparing…' : 'Compare'}
                        </button>
                      )}
                      <button
                        className="btn btn-default"
                        disabled={busy != null}
                        onClick={() =>
                          run(`status:${v.id}`, async () => {
                            await updateVersion(slug, v.id, { status: v.status === 'actual' ? 'draft' : 'actual' });
                            await reload();
                          })
                        }
                        title={v.status === 'actual' ? 'Mark this version as a draft' : 'Mark this version as the live prices'}
                      >
                        {v.status === 'actual' ? 'Mark draft' : 'Mark actual'}
                      </button>
                      <button
                        className="btn btn-default"
                        disabled={busy != null}
                        onClick={() =>
                          run(`restore:${v.id}`, async () => {
                            const stored = await loadSheet(v);
                            const d = diffSheets(stored, current);
                            if (isSameSheet(d)) return;
                            if (!window.confirm(`Load “${v.label}” into the table? Undo brings back what is there now.`)) return;
                            onRestore(stored, v);
                            onClose();
                          })
                        }
                      >
                        {busy === `restore:${v.id}` ? 'Loading…' : 'Restore'}
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={busy != null}
                        onClick={() => {
                          if (!window.confirm(`Delete version “${v.label}”? This cannot be undone.`)) return;
                          void run(`del:${v.id}`, async () => {
                            await deleteVersion(slug, v.id);
                            await reload();
                          });
                        }}
                        aria-label={`Delete ${v.label}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
