import { defineConfig } from 'vite';

export default defineConfig({
  // сайт на GitHub Pages: https://ysatbayeva88-dot.github.io/football-game/
  base: '/football-game/',
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
});
