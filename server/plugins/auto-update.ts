import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const FIRST_UPDATE_DELAY_MS = 5_000
const FIRST_LIVE_SYNC_DELAY_MS = 15_000

export default defineNitroPlugin((nitroApp) => {
  const { autoUpdateHours, liveSyncMinutes, projectRoot } = useRuntimeConfig()
  const tsxBin = join(projectRoot, 'node_modules/.bin/tsx')
  if (!existsSync(tsxBin)) return

  const timers: Array<ReturnType<typeof setTimeout>> = []
  const schedule = (scriptName: string, label: string, intervalMs: number, firstDelayMs: number) => {
    const script = join(projectRoot, 'scripts', scriptName)
    if (!(intervalMs > 0) || !existsSync(script)) return

    let running = false
    const run = () => {
      if (running) return
      running = true
      const child = spawn(tsxBin, [script], { cwd: projectRoot, stdio: 'inherit' })
      child.on('error', (error) => {
        running = false
        console.error(`${label}無法啟動`, error)
      })
      child.on('exit', () => {
        running = false
      })
    }
    timers.push(setTimeout(run, firstDelayMs), setInterval(run, intervalMs))
  }

  schedule('update-data.ts', '資料自動更新', Number(autoUpdateHours) * 3_600_000, FIRST_UPDATE_DELAY_MS)
  schedule('sync-live.ts', '運彩賽果同步', Number(liveSyncMinutes) * 60_000, FIRST_LIVE_SYNC_DELAY_MS)

  nitroApp.hooks.hook('close', () => {
    for (const timer of timers) clearTimeout(timer)
  })
})
