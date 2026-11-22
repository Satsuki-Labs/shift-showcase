import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  // Keep the build timestamp shared by the client and Worker environments.
  builder: { sharedConfigBuild: true },
  define: { __APP_VERSION__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    cloudflare({
      configPath: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      persistState: { path: fileURLToPath(new URL('../.wrangler/state', import.meta.url)) },
    }),
  ],
});
