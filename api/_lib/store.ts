/**
 * Where the shared workspace lives.
 *
 * Production: Upstash Redis, through its REST API (no client library). Adding
 * "Upstash for Redis" to the Vercel project from the Marketplace sets the env
 * vars read below. Local dev: a JSON file, through the same interface.
 *
 * Each product draft carries a version number. A write names the version it
 * was based on and is refused if someone else has written since — the check
 * and the write happen atomically (a Lua script in Redis), so two people
 * saving the same product at once can never silently overwrite each other.
 * Records are opaque JSON strings here; the handler owns their shape.
 */

export type WriteResult = { ok: true; version: number } | { ok: false; version: number; record: string | null };

export interface WorkspaceStore {
  kind: 'redis' | 'file' | 'memory';
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

/* ------------------------------------------------------------------ */
/* Upstash Redis                                                       */
/* ------------------------------------------------------------------ */

const PREFIX = 'pricer:v1:';
const K_VERSIONS = `${PREFIX}versions`;
const K_DRAFTS = `${PREFIX}drafts`;
const K_SNAPSHOTS = `${PREFIX}snapshots`;
const K_STAMPS = `${PREFIX}snapshot-stamps`;

/**
 * KEYS: versions, drafts. ARGV: slug, baseVersion, record ('' deletes).
 * Returns {1, newVersion} or {0, currentVersion, currentRecord or ''}.
 */
const CAS_SCRIPT = `
local cur = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
if cur ~= tonumber(ARGV[2]) then
  return {0, cur, redis.call('HGET', KEYS[2], ARGV[1]) or ''}
end
local nextv = cur + 1
redis.call('HSET', KEYS[1], ARGV[1], nextv)
if ARGV[3] == '' then
  redis.call('HDEL', KEYS[2], ARGV[1])
else
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
end
return {1, nextv}
`;

type Command = (string | number)[];

export function redisStore(url: string, token: string): WorkspaceStore {
  const base = url.replace(/\/+$/, '');

  async function post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const message = (json as { error?: string } | null)?.error;
      throw new Error(`Redis ${response.status}${message ? `: ${message}` : ''}`);
    }
    return json;
  }

  async function run(command: Command): Promise<unknown> {
    const json = (await post('', command)) as { result?: unknown; error?: string };
    if (json.error) throw new Error(`Redis: ${json.error}`);
    return json.result;
  }

  async function pipeline(commands: Command[]): Promise<unknown[]> {
    const json = (await post('/pipeline', commands)) as { result?: unknown; error?: string }[];
    return json.map((r) => {
      if (r.error) throw new Error(`Redis: ${r.error}`);
      return r.result;
    });
  }

  /** HGETALL's flat [field, value, …] reply as an object. */
  function pairs(reply: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    const list = Array.isArray(reply) ? reply : [];
    for (let i = 0; i + 1 < list.length; i += 2) out[String(list[i])] = String(list[i + 1]);
    return out;
  }

  async function readHash(key: string, slugs?: string[]): Promise<Record<string, string>> {
    if (!slugs) return pairs(await run(['HGETALL', key]));
    if (slugs.length === 0) return {};
    const values = (await run(['HMGET', key, ...slugs])) as (string | null)[];
    const out: Record<string, string> = {};
    slugs.forEach((slug, i) => {
      if (values[i] != null) out[slug] = values[i] as string;
    });
    return out;
  }

  return {
    kind: 'redis',
    async readIndex() {
      const [versions, stamps] = await pipeline([
        ['HGETALL', K_VERSIONS],
        ['HGETALL', K_STAMPS],
      ]);
      return {
        versions: Object.fromEntries(Object.entries(pairs(versions)).map(([k, v]) => [k, Number(v)])),
        snapshotStamps: pairs(stamps),
      };
    },
    readDrafts: (slugs) => readHash(K_DRAFTS, slugs),
    readSnapshots: (slugs) => readHash(K_SNAPSHOTS, slugs),
    async writeDraft(slug, record, baseVersion) {
      const reply = (await run(['EVAL', CAS_SCRIPT, 2, K_VERSIONS, K_DRAFTS, slug, baseVersion, record ?? ''])) as [
        number,
        number,
        string?,
      ];
      if (Number(reply[0]) === 1) return { ok: true, version: Number(reply[1]) };
      return { ok: false, version: Number(reply[1]), record: reply[2] ? reply[2] : null };
    },
    async writeSnapshot(slug, record, stamp) {
      await pipeline([
        ['HSET', K_SNAPSHOTS, slug, record],
        ['HSET', K_STAMPS, slug, stamp],
      ]);
    },
  };
}

/**
 * Redis when its env vars are present, otherwise null. The Vercel Marketplace
 * integration names them KV_REST_API_*; a direct Upstash setup uses
 * UPSTASH_REDIS_REST_*. Either works.
 */
export function redisStoreFromEnv(env: Record<string, string | undefined>): WorkspaceStore | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? redisStore(url, token) : null;
}
