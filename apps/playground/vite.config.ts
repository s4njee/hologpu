import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { conditions: ['source'] },
  build: { rolldownOptions: { input: ['index.html', 'm0.html'] } },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
});
