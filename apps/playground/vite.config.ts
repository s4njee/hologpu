import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { conditions: ['source'] },
  build: {
    rolldownOptions: {
      input: [
        'index.html',
        'm0.html',
        'lcd.html',
        'fluid-dom.html',
        'fireworks-dom.html',
        'ink-paper.html',
        'attractor-dom.html',
        'cards.html',
        'noir.html',
        'products.html',
        'transitions.html',
        'ambient.html',
        'launch.html',
        'device-check.html',
      ],
    },
  },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
});
