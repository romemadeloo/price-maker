/**
 * Where the shared workspace lives.
 *
 * Production: Postgres through Prisma (prismaStore.ts) — Prisma Postgres, or
 * any Postgres in DATABASE_URL. Local dev without a database: a JSON file,
 * through the same interface.
 *
 * Each product draft carries a version number. A write names the version it
 * was based on and is refused if someone else has written since — the check
 * and the write are one conditional UPDATE, so two people saving the same
 * product at once can never silently overwrite each other.
 * Records are opaque JSON strings here; the handler owns their shape.
 */

export type WriteResult = { ok: true; version: number } | { ok: false; version: number; record: string | null };

export interface WorkspaceStore {
  kind: 'postgres' | 'file' | 'memory';
  /** Draft versions and snapshot stamps for every product — the cheap poll. */
  readIndex(): Promise<{ versions: Record<string, number>; snapshotStamps: Record<string, string> }>;
  /** Raw draft records; all of them when `slugs` is omitted. */
  readDrafts(slugs?: string[]): Promise<Record<string, string>>;
  readSnapshots(slugs?: string[]): Promise<Record<string, string>>;
  /** Compare-and-set. A null record deletes the draft (and still bumps the version). */
  writeDraft(slug: string, record: string | null, baseVersion: number): Promise<WriteResult>;
  writeSnapshot(slug: string, record: string, stamp: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* In-memory (tests) and file-backed (local dev)                       */
/* ------------------------------------------------------------------ */

export interface StoreData {
  versions: Record<string, number>;
  drafts: Record<string, string>;
  snapshots: Record<string, string>;
  snapshotStamps: Record<string, string>;
}

export function emptyStoreData(): StoreData {
  return { versions: {}, drafts: {}, snapshots: {}, snapshotStamps: {} };
}

function pick(source: Record<string, string>, slugs?: string[]): Record<string, string> {
  if (!slugs) return { ...source };
  return Object.fromEntries(slugs.filter((s) => s in source).map((s) => [s, source[s]]));
}

/**
 * Everything is synchronous inside each method, so compare-and-set is atomic
 * within one process — which is all a dev server or a test needs.
 */
export function memoryStore(data: StoreData = emptyStoreData(), onChange?: (data: StoreData) => void): WorkspaceStore {
  return {
    kind: onChange ? 'file' : 'memory',
    async readIndex() {
      return { versions: { ...data.versions }, snapshotStamps: { ...data.snapshotStamps } };
    },
    async readDrafts(slugs) {
      return pick(data.drafts, slugs);
    },
    async readSnapshots(slugs) {
      return pick(data.snapshots, slugs);
    },
    async writeDraft(slug, record, baseVersion) {
      const current = data.versions[slug] ?? 0;
      if (current !== baseVersion) return { ok: false, version: current, record: data.drafts[slug] ?? null };
      const version = current + 1;
      data.versions[slug] = version;
      if (record == null) delete data.drafts[slug];
      else data.drafts[slug] = record;
      onChange?.(data);
      return { ok: true, version };
    },
    async writeSnapshot(slug, record, stamp) {
      data.snapshots[slug] = record;
      data.snapshotStamps[slug] = stamp;
      onChange?.(data);
    },
  };
}
