import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/server.spec.js'],
    testTimeout: 60000,
  },
});
