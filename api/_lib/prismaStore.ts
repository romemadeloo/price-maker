import prismaPackage, { type PrismaClient } from '@prisma/client';
import type { VersionMeta, VersionRow, VersionStatus, WorkspaceStore } from './store.js';

/**
 * The shared workspace in Postgres, through Prisma (schema: prisma/schema.prisma).
 *
 * Optimistic locking: a save is `UPDATE … WHERE slug = ? AND version = ?`.
 * If someone else saved first the version no longer matches, nothing is
 * written, and the caller gets the current row back as a conflict. The very
 * first save of a product is an INSERT, and two of those racing are settled
 * by the primary key (P2002) the same way.
 */

// @prisma/client is CommonJS; a default import works under Node's ESM loader,
// where its named exports may not be detected.
const { PrismaClient: Client } = prismaPackage;

const DIRECT_URL = /^postgres(ql)?:\/\//;

/**
 * The connection string for a direct (TCP) connection. Prisma Postgres also
 * hands out a `prisma+postgres://` Accelerate URL, which this client cannot
 * use without the Accelerate extension, so the first direct URL wins.
 */
export function directDatabaseUrl(env: Record<string, string | undefined>): string | null {
  for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL']) {
    const value = env[key];
    if (value && DIRECT_URL.test(value)) return value;
  }
  return null;
}

/** One client per server instance; serverless functions reuse it while warm. */
const cache = globalThis as unknown as { pricerPrisma?: PrismaClient };

export function prismaStoreFromEnv(env: Record<string, string | undefined>): WorkspaceStore | null {
  const url = directDatabaseUrl(env);
  if (!url) return null;
  cache.pricerPrisma ??= new Client({ datasourceUrl: url });
  return prismaStore(cache.pricerPrisma);
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

export function prismaStore(prisma: PrismaClient): WorkspaceStore {
  return {
    kind: 'postgres',

    async readIndex() {
      const [drafts, snapshots] = await Promise.all([
        prisma.draft.findMany({ select: { slug: true, version: true } }),
        prisma.snapshot.findMany({ select: { slug: true, stamp: true } }),
      ]);
      return {
        versions: Object.fromEntries(drafts.map((d) => [d.slug, d.version])),
        snapshotStamps: Object.fromEntries(snapshots.map((s) => [s.slug, s.stamp])),
      };
    },

    async readDrafts(slugs) {
      const rows = await prisma.draft.findMany({
        where: { record: { not: null }, ...(slugs ? { slug: { in: slugs } } : {}) },
        select: { slug: true, record: true },
      });
      return Object.fromEntries(rows.map((r) => [r.slug, r.record as string]));
    },

    async readSnapshots(slugs) {
      const rows = await prisma.snapshot.findMany({
        where: slugs ? { slug: { in: slugs } } : {},
        select: { slug: true, record: true },
      });
      return Object.fromEntries(rows.map((r) => [r.slug, r.record]));
    },

    async writeDraft(slug, record, baseVersion) {
      if (baseVersion === 0) {
        try {
          await prisma.draft.create({ data: { slug, version: 1, record } });
          return { ok: true, version: 1 };
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      } else {
        const { count } = await prisma.draft.updateMany({
          where: { slug, version: baseVersion },
          data: { version: { increment: 1 }, record },
        });
        if (count === 1) return { ok: true, version: baseVersion + 1 };
      }

      const current = await prisma.draft.findUnique({ where: { slug }, select: { version: true, record: true } });
      return { ok: false, version: current?.version ?? 0, record: current?.record ?? null };
    },

    async writeSnapshot(slug, record, stamp) {
      await prisma.snapshot.upsert({
        where: { slug },
        create: { slug, record, stamp },
        update: { record, stamp },
      });
    },

    async listVersions(slug) {
      const rows = await prisma.draftVersion.findMany({
        where: { slug },
        orderBy: { createdAt: 'desc' },
        select: { id: true, slug: true, label: true, status: true, note: true, createdAt: true, createdBy: true },
      });
      return rows.map((r) => toMeta(r));
    },

    async readVersion(slug, id) {
      const row = await prisma.draftVersion.findFirst({ where: { slug, id } });
      return row ? { ...toMeta(row), record: row.record } : null;
    },

    async countVersions(slug) {
      return prisma.draftVersion.count({ where: { slug } });
    },

    async addVersion(row) {
      const data = { ...row, createdAt: new Date(row.createdAt) };
      if (row.status !== 'actual') {
        await prisma.draftVersion.create({ data });
        return;
      }
      await prisma.$transaction([
        prisma.draftVersion.updateMany({ where: { slug: row.slug, status: 'actual' }, data: { status: 'draft' } }),
        prisma.draftVersion.create({ data }),
      ]);
    },

    async updateVersion(slug, id, patch) {
      const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const update = prisma.draftVersion.updateMany({ where: { slug, id }, data });
      if (patch.status !== 'actual') return (await update).count === 1;
      const [, result] = await prisma.$transaction([
        prisma.draftVersion.updateMany({ where: { slug, status: 'actual', NOT: { id } }, data: { status: 'draft' } }),
        update,
      ]);
      return result.count === 1;
    },

    async deleteVersion(slug, id) {
      const { count } = await prisma.draftVersion.deleteMany({ where: { slug, id } });
      return count === 1;
    },
  };
}

function toMeta(row: Omit<VersionRow, 'record' | 'createdAt' | 'status'> & { status: string; createdAt: Date }): VersionMeta {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    status: (row.status === 'actual' ? 'actual' : 'draft') as VersionStatus,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}
