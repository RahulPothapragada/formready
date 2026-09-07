/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The app shell is precached. The OCR assets deliberately are not:
        // they are ~4 MB of language data plus one ~3.7 MB core build, and
        // precaching would spend that on a first visit that may never use OCR
        // — on mobile data, before the user has done anything.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/models/**'],
        // Instead they are cached on first use, which is exactly what FR-15
        // describes: "after assets are cached". NFR-06 then requires the first
        // download and later offline operation to be reported as two separate
        // numbers, which is what the feasibility harness measures.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/models/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'formready-ocr-assets',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              // A partial response would poison the cache with a broken core
              // build that then fails offline with no way to re-fetch it.
              rangeRequests: false,
            },
          },
        ],
      },
      manifest: {
        name: 'FormReady',
        short_name: 'FormReady',
        description: 'Show the requirements. Get your document ready.',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
