import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
    // Exclude server tests - they need Node.js to spawn wrangler
    exclude: ['**/server.spec.js', '**/node_modules/**'],
  },
});
