/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy()
  ],
  server: {
    host: true,
  },
  build: {
    // Ionic's component runtime is intentionally isolated below; warn only if it grows beyond this baseline.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('node_modules')) return;
          if (normalizedId.includes('/node_modules/@ionic/react-router/')) {
            return 'vendor-ionic-router';
          }
          if (normalizedId.includes('/node_modules/@ionic/react/')) {
            return 'vendor-ionic-react';
          }
          if (normalizedId.includes('/node_modules/@ionic/core/components/')) {
            return 'vendor-ionic-components';
          }
          if (normalizedId.includes('/node_modules/@ionic/core/')) {
            return 'vendor-ionic-core';
          }
          if (normalizedId.includes('/node_modules/ionicons/')) {
            return 'vendor-icons';
          }
          if (normalizedId.includes('/node_modules/@capacitor/')) {
            return 'vendor-capacitor';
          }
          if (normalizedId.includes('/node_modules/@supabase/')) {
            return 'vendor-supabase';
          }
          if (
            normalizedId.includes('/node_modules/react/')
            || normalizedId.includes('/node_modules/react-dom/')
            || normalizedId.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          return 'vendor-misc';
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  }
})
