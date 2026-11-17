import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import icon from '../../build/icon.png?asset'

export const PRELOAD = path.join(__dirname, '../preload/index.js')

/** Loads the renderer into a window. `hash` selects the mode: '' for the app, 'print' for PDF rendering. */
export function loadRenderer(win: BrowserWindow, hash = ''): Promise<void> {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) return win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  return win.loadFile(path.join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'Quotation Maker',
    backgroundColor: '#ffffff',
    icon,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // The app never navigates away from its own page or opens new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const page = (u: string): string => u.split('#')[0]
    if (page(url) !== page(win.webContents.getURL())) event.preventDefault()
  })
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }
  void loadRenderer(win)
  return win
}
