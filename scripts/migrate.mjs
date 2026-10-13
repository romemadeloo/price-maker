/**
 * Apply pending Prisma migrations during a deploy (vercel.json buildCommand).
 *
 * Skips quietly when no Postgres URL is configured, so the app still builds
 * and deploys before a database is connected — shared drafts just stay off.
 * Picks the same direct (postgres://) URL the app uses at runtime; see
 * directDatabaseUrl in api/_lib/prismaStore.ts.
 */
import { execSync } from 'node:child_process';

const url = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL']
  .map((key) => process.env[key])
  .find((value) => value && /^postgres(ql)?:\/\//.test(value));

if (!url) {
  console.log('[migrate] No Postgres URL set — skipping migrations. Shared drafts stay off until one is connected.');
  process.exit(0);
}

execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
