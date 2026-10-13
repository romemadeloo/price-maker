import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { handleWorkspace } from './handler.js';
import { prismaStoreFromEnv } from './prismaStore.js';
import { emptyStoreData, memoryStore, type StoreData, type WorkspaceStore } from './store.js';

/**
 * Serves /api/workspace from `vite` and `vite preview`, so the shared
 * workspace works locally without the Vercel CLI. Uses Postgres when
 * DATABASE_URL is set (in the shell or .env), otherwise `.data/workspace.json`.
 */

function fileStore(path: string): WorkspaceStore {
  let data: StoreData = emptyStoreData();
  try {
    data = { ...emptyStoreData(), ...(JSON.parse(readFileSync(path, 'utf8')) as StoreData) };
  } catch {
    // No file yet: start empty.
  }
  return memoryStore(data, (next) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next));
  });
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
  return new Request(`http://localhost${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

export function workspaceApi(): Plugin {
  let store: WorkspaceStore | null = null;

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/workspace')) return next();
    store ??= prismaStoreFromEnv(process.env) ?? fileStore(resolve(process.cwd(), '.data/workspace.json'));
    const response = await handleWorkspace(await toRequest(req), store, { passcode: process.env.PRICER_PASSCODE });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };

  return {
    name: 'pricer-workspace-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
