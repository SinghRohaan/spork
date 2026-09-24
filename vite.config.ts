/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The barcode decoder (~1 MB .wasm) is only for the packaged-food
        // scanner — don't make every install download it; cache it on first use.
        globIgnores: ['**/*.wasm'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'barcode-wasm', expiration: { maxEntries: 2 } },
          },
        ],
      },
      // Include the apple touch icon in the precache
      includeAssets: ['apple-touch-icon.png', 'favicon-32x32.png', 'favicon-16x16.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Spork',
        short_name: 'Spork',
        description: 'Track meals, build streaks, share with friends.',
        theme_color: '#f5f5f4',        // Spork canvas (light default)
        background_color: '#f5f5f4',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',   // rounded icon on Android
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    globals: true,
  },
})
