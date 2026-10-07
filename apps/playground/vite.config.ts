import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { conditions: ['source'] },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
});
