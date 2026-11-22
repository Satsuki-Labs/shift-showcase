import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const { cloudflareTest } = await import('@cloudflare/vitest-plugin');
  return {
    define: { __APP_VERSION__: JSON.stringify('test-build') },
    plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
    test: {
      name: 'server',
      include: ['tests/server/**/*.test.ts'],
      // Each worker starts workerd and SQLite; bound those runtimes independently of Node tests.
      maxWorkers: Math.min(4, Math.max(1, availableParallelism() - 1)),
      hookTimeout: 30000,
      sequence: { groupOrder: 1 },
    },
  };
});
