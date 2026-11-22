import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/server/**'],
          environment: 'node',
          sequence: { groupOrder: 0 },
        },
      },
      './vitest.server.config.ts',
    ],
  },
});
