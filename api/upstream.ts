import { handleUpstream } from './_lib/upstream.js';

/** Vercel function: quotations from a server URL set in Settings. See _lib/upstream.ts. */
function handle(request: Request): Promise<Response> {
  return handleUpstream(request, { allowedHosts: process.env.UPSTREAM_ALLOWED_HOSTS });
}

export { handle as GET };
