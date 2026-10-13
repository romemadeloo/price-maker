import { handleWorkspace } from './_lib/handler.js';
import { redisStoreFromEnv } from './_lib/store.js';

/** Vercel function: the shared workspace. See _lib/handler.ts for the API. */
function handle(request: Request): Promise<Response> {
  return handleWorkspace(request, redisStoreFromEnv(process.env), { passcode: process.env.PRICER_PASSCODE });
}

export { handle as GET, handle as PUT };
