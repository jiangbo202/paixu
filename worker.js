import { coarseRegion } from './backend/network.js';
import { handleApi, cleanup } from './backend/api.js';
export default {
  async scheduled(_controller, env) { await cleanup(env.DB); },
  async fetch(request, env) {
    const response = await handleApi(request, {
      ...env, platform: 'cloudflare', clientRegion: coarseRegion(request.cf), DB: env.DB, clientIp: request.headers.get('CF-Connecting-IP') || 'unknown',
    });
    if (response) return response;
    // Preserve the public URL: Assets resolves /admin to admin.html itself.
    // Rewriting it to /admin.html would trigger Assets' canonical redirect back to /admin.
    return env.ASSETS.fetch(request);
  },
};
