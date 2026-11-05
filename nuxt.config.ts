import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { LEGACY_REDIRECTS } from './shared/nav'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  routeRules: Object.fromEntries(
    Object.entries(LEGACY_REDIRECTS).map(([from, to]) => [from, { redirect: { to, statusCode: 301 } }]),
  ),
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
