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

/**
 * A saved copy of a product's price table — "version control" for drafts.
 * `status` tells a working draft from the prices that are actually live; at
 * most one version per product is 'actual'.
 */
export type VersionStatus = 'draft' | 'actual';

export interface VersionRow {
  id: string;
  slug: string;
  label: string;
  status: VersionStatus;
  note: string | null;
  /** JSON: { sheet } — opaque here, like draft records. */
  record: string;
  createdAt: string;
  createdBy: string | null;
}

export type VersionMeta = Omit<VersionRow, 'record'>;

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
  /** A product's versions, newest first, without their tables. */
  listVersions(slug: string): Promise<VersionMeta[]>;
  readVersion(slug: string, id: string): Promise<VersionRow | null>;
  countVersions(slug: string): Promise<number>;
  /** Adds a version; when it is 'actual', the product's previous actual becomes a draft. */
  addVersion(row: VersionRow): Promise<void>;
  /** Returns false when there is no such version. Marking one actual demotes the others. */
  updateVersion(slug: string, id: string, patch: { label?: string; status?: VersionStatus; note?: string | null }): Promise<boolean>;
  deleteVersion(slug: string, id: string): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* In-memory (tests) and file-backed (local dev)                       */
/* ------------------------------------------------------------------ */

export interface StoreData {
  versions: Record<string, number>;
  drafts: Record<string, string>;
  snapshots: Record<string, string>;
  snapshotStamps: Record<string, string>;
  /** Saved versions of every product's table. */
  draftVersions: VersionRow[];
}

export function emptyStoreData(): StoreData {
  return { versions: {}, drafts: {}, snapshots: {}, snapshotStamps: {}, draftVersions: [] };
}

const meta = ({ record: _record, ...rest }: VersionRow): VersionMeta => rest;

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
    async listVersions(slug) {
      return data.draftVersions
        .filter((v) => v.slug === slug)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(meta);
    },
    async readVersion(slug, id) {
      return data.draftVersions.find((v) => v.slug === slug && v.id === id) ?? null;
    },
    async countVersions(slug) {
      return data.draftVersions.filter((v) => v.slug === slug).length;
    },
    async addVersion(row) {
      if (row.status === 'actual') demote(row.slug);
      data.draftVersions.push({ ...row });
      onChange?.(data);
    },
    async updateVersion(slug, id, patch) {
      const row = data.draftVersions.find((v) => v.slug === slug && v.id === id);
      if (!row) return false;
      if (patch.status === 'actual') demote(slug);
      Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      onChange?.(data);
      return true;
    },
    async deleteVersion(slug, id) {
      const before = data.draftVersions.length;
      data.draftVersions = data.draftVersions.filter((v) => !(v.slug === slug && v.id === id));
      if (data.draftVersions.length === before) return false;
      onChange?.(data);
      return true;
    },
  };

  function demote(slug: string) {
    for (const v of data.draftVersions) if (v.slug === slug && v.status === 'actual') v.status = 'draft';
  }
}
