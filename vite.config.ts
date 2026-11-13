import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    allowedHosts: true,
    headers: {
      'X-Frame-Options': 'ALLOWALL',
    },
  },
  preview: {
    host: true,
  },
});

