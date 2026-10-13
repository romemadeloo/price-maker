import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { workspaceApi } from './api/_lib/devServer';

/**
 * The production quotation API sends no CORS headers for other origins, so it
 * is reached through this same-origin proxy (and the matching rewrite in
 * vercel.json once deployed).
 */
const productionApi: Record<string, ProxyOptions> = {
  '/api/musticker': {
    target: 'https://api.musticker.com',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/api\/musticker/, '/index.php/sys/kr'),
  },
};

export default defineConfig({
  // workspaceApi serves the shared drafts API (api/workspace.ts on Vercel) locally.
  plugins: [react(), workspaceApi()],
  server: { port: 5173, open: false, proxy: productionApi },
  preview: { proxy: productionApi },
});
