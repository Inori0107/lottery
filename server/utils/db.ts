import { statSync } from 'node:fs'
import { openDatabase, type AppDatabase } from '../db/open'

const globalForDb = globalThis as typeof globalThis & {
  __badmintonDb?: { db: AppDatabase, inode: number }
}

export const useDb = () => {
  const { dbFile } = useRuntimeConfig()
  const file = statSync(dbFile, { throwIfNoEntry: false })
  if (!file) {
    throw createError({ statusCode: 503, statusMessage: '資料庫尚未建立，請先執行 npm run update:data' })
  }

  const cached = globalForDb.__badmintonDb
  if (cached?.inode === file.ino) return cached.db

  cached?.db.sqlite.close()
  const db = openDatabase(dbFile)
  globalForDb.__badmintonDb = { db, inode: file.ino }
  return db
}

export const useOptionalDb = () => {
  const { dbFile } = useRuntimeConfig()
  if (!statSync(dbFile, { throwIfNoEntry: false })) return null
  return useDb().sqlite
}
