import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * Updates come from the Releases of the GitHub repo named in electron-builder.yml.
 * The app looks for a release with a higher version than its own, downloads the
 * installer in the background, and installs it on the next restart.
 */

const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'dev' }

function set(next: UpdateStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:status', status)
  }
}

function describe(err: unknown): UpdateStatus {
  const raw = err instanceof Error ? err.message : String(err)
  const checkedAt = new Date().toISOString()
  // A repo that has no published release yet is not a failure worth alarming anyone over.
  if (/Unable to find latest version|No published versions|latest\.yml|\b404\b|\b406\b/i.test(raw)) {
    return { state: 'none', checkedAt, message: 'No published release was found.' }
  }
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ETIMEDOUT|ERR_CONNECTION|ERR_NETWORK/i.test(raw)) {
    return { state: 'error', checkedAt, message: 'Could not reach GitHub. Check the internet connection.' }
  }
  return { state: 'error', checkedAt, message: raw.split('\n')[0].slice(0, 200) }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return status
  if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set(describe(err))
  }
  return status
}

export function installUpdate(): void {
  // Silent install, then relaunch the app.
  if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
}

export function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: new Date().toISOString() }))
  autoUpdater.on('download-progress', (progress) =>
    set({ state: 'downloading', version: status.version, percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => set(describe(err)))

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
