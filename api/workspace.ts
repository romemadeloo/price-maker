import { handleWorkspace } from './_lib/handler.js';
import { prismaStoreFromEnv } from './_lib/prismaStore.js';

/** Vercel function: the shared workspace. See _lib/handler.ts for the API. */
function handle(request: Request): Promise<Response> {
  return handleWorkspace(request, prismaStoreFromEnv(process.env), { passcode: process.env.PRICER_PASSCODE });
}

export { handle as GET, handle as PUT };
