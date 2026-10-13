import type { SheetState } from '../types';
import type { ProductionSnapshot } from './production';

/**
 * Browser side of the shared workspace (api/workspace.ts). Plain fetches; the
 * merge and conflict decisions live in useCloudSync.
 */

const ENDPOINT = '/api/workspace';
const PASSCODE_KEY = 'pricer-maker:passcode';

/** A draft as the server holds it. Rows carry no ids. */
export interface RemoteDraft {
  sheet: { quantities: string[]; rows: { size: string; baseArea: string; prices: string[] }[] };
  updatedAt: string;
  updatedBy: string | null;
  version: number;
}

export interface RemoteIndex {
  storage: string;
  versions: Record<string, number>;
  snapshotStamps: Record<string, string>;
}

export interface RemoteWorkspace extends RemoteIndex {
  drafts: Record<string, RemoteDraft>;
  snapshots: Record<string, ProductionSnapshot>;
}

export type PushResult =
  | { ok: true; version: number; updatedAt: string; updatedBy: string | null }
  | { ok: false; version: number; draft: RemoteDraft | null };

/** `status` 0 means the server could not be reached at all. */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

export function loadPasscode(): string {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePasscode(passcode: string): void {
  try {
    localStorage.setItem(PASSCODE_KEY, passcode);
  } catch {
    // Not remembered; it will be asked for again next visit.
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers);
  const passcode = loadPasscode();
  if (passcode) headers.set('x-pricer-passcode', passcode);
  if (init.body) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new SyncError('Shared storage is unreachable.', 0);
  }

  const body = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!body) throw new SyncError(`Shared storage answered ${response.status} without JSON.`, response.status);
  if (response.ok || response.status === 409) return { status: response.status, body };
  throw new SyncError(body.message ?? `Shared storage answered ${response.status}.`, response.status, body.error ?? null);
}

export async function fetchIndex(): Promise<RemoteIndex> {
  return (await call<RemoteIndex>('?summary=1')).body;
}

export async function fetchRemote(slugs?: string[]): Promise<RemoteWorkspace> {
  const query = slugs ? `?slugs=${slugs.map(encodeURIComponent).join(',')}` : '';
  return (await call<RemoteWorkspace>(query)).body;
}

export async function pushDraft(
  slug: string,
  sheet: SheetState | null,
  baseVersion: number,
  updatedBy: string,
): Promise<PushResult> {
  const payload = sheet && {
    quantities: sheet.quantities,
    rows: sheet.rows.map(({ size, baseArea, prices }) => ({ size, baseArea, prices })),
  };
  const { status, body } = await call<{ version: number; updatedAt: string; updatedBy: string | null; draft?: RemoteDraft | null }>(
    `?slug=${encodeURIComponent(slug)}&kind=draft`,
    { method: 'PUT', body: JSON.stringify({ sheet: payload, baseVersion, updatedBy }) },
  );
  if (status === 409) return { ok: false, version: body.version, draft: body.draft ?? null };
  return { ok: true, version: body.version, updatedAt: body.updatedAt, updatedBy: body.updatedBy };
}

export async function pushSnapshot(slug: string, snapshot: ProductionSnapshot): Promise<void> {
  await call(`?slug=${encodeURIComponent(slug)}&kind=snapshot`, { method: 'PUT', body: JSON.stringify(snapshot) });
}
