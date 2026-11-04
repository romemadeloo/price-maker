/**
 * A narrow quotation proxy for musticker servers set in Settings.
 *
 * The default servers go through the static rewrites in vercel.json (fast, at
 * the edge). A server URL changed in Settings cannot be a static rewrite, so
 * the browser asks this function instead:
 *
 *   GET /api/upstream?__base=https://host/index.php/sys/kr&__path=pricing/quotation/<slug>&width=…&height=…
 *
 * To stay a quotation proxy and not an open one, it only forwards GETs to
 * https hosts under musticker.com (or ones listed in UPSTREAM_ALLOWED_HOSTS),
 * and only for pricing/quotation paths.
 */

const ALLOWED_SUFFIX = 'musticker.com';
const PATH = /^pricing\/quotation\/[A-Za-z0-9~_-]{1,80}$/;
const TIMEOUT_MS = 20_000;

export interface UpstreamOptions {
  /** Extra allowed hostnames, comma separated (UPSTREAM_ALLOWED_HOSTS). */
  allowedHosts?: string | null;
  fetch?: typeof fetch;
}

/** The base URL as a URL when it may be proxied to, else null. */
export function allowedUpstream(base: string, allowedHosts?: string | null): URL | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  const extra = (allowedHosts ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (host === ALLOWED_SUFFIX || host.endsWith(`.${ALLOWED_SUFFIX}`) || extra.includes(host)) return url;
  return null;
}

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleUpstream(request: Request, options: UpstreamOptions = {}): Promise<Response> {
  if (request.method !== 'GET') return text(405, 'Use GET.');
  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);
  const base = params.get('__base') ?? '';
  const path = params.get('__path') ?? '';
  params.delete('__base');
  params.delete('__path');

  const upstream = allowedUpstream(base, options.allowedHosts);
  if (!upstream) return text(400, `Server URL not allowed: ${base || '(empty)'}. Use an https URL under ${ALLOWED_SUFFIX}.`);
  if (!PATH.test(path)) return text(400, 'Only pricing/quotation requests are proxied.');

  const target = `${upstream.href.replace(/\/+$/, '')}/${path}${params.size ? `?${params}` : ''}`;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(target, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name;
    return text(502, `Could not reach ${upstream.host} (${cause}).`);
  }
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
