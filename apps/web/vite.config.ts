import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // The browser only ever talks to the Vite origin, so no CORS setup is needed in dev.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
