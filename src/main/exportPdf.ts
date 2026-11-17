import { BrowserWindow, ipcMain } from 'electron'
import type { Account, QDoc } from '@shared/types'
import { loadRenderer, PRELOAD } from './windows'

/**
 * PDF export renders the same page component the editor shows, in a hidden window,
 * and prints it. That is what keeps the PDF identical to the on-screen preview.
 */

interface Payload {
  doc: QDoc
  account: Account | null
}

const payloads = new Map<number, Payload>()
const readySignals = new Map<number, () => void>()

export function registerPrintIpc(): void {
  ipcMain.handle('print:payload', (event) => payloads.get(event.sender.id) ?? null)
  ipcMain.on('print:ready', (event) => readySignals.get(event.sender.id)?.())
}

export async function renderPdf(doc: QDoc, account: Account | null): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  const id = win.webContents.id
  let timer: NodeJS.Timeout | undefined
  payloads.set(id, { doc, account })
  try {
    const ready = new Promise<void>((resolve, reject) => {
      readySignals.set(id, resolve)
      timer = setTimeout(() => reject(new Error('Preparing the document for export took too long.')), 30000)
      win.webContents.once('render-process-gone', () => reject(new Error('The export window closed unexpectedly.')))
    })
    await loadRenderer(win, 'print')
    await ready
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
  } finally {
    clearTimeout(timer)
    payloads.delete(id)
    readySignals.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }
}
