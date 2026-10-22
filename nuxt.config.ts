import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    server: {
      watch: {
        ignored: ['**/.data/**', '**/data/**'],
      },
    },
  },
  nitro: {
    externals: {
      external: ['better-sqlite3'],
    },
  },
  runtimeConfig: {
    dbFile: fileURLToPath(new URL('./.data/badminton.sqlite', import.meta.url)),
    ledgerFile: fileURLToPath(new URL('./.data/ledger.sqlite', import.meta.url)),
    projectRoot: fileURLToPath(new URL('./', import.meta.url)),
    autoUpdateHours: 6,
    liveSyncMinutes: 20,
  },
})
