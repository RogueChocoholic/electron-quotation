import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { exportBaseName, safeFileName } from '@shared/calc'
import { sanitizeDoc } from '@shared/sanitize'
import type { Account, AppInfo, ExportResult, ImportResult, QDoc } from '@shared/types'
import { renderDocx } from './exportDocx'
import { registerPrintIpc, renderPdf } from './exportPdf'
import {
  buildTemplateBundle,
  createDefaultTemplate,
  dataDir,
  deleteDoc,
  getDoc,
  getSettings,
  importAssetFile,
  importTemplateBundle,
  listDocs,
  saveDoc,
  saveSettings
} from './store'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater'

export const TEMPLATE_EXT = 'qtpl'

/** Files this session wrote; only these may be opened or revealed on request from the page. */
const exported = new Set<string>()
let lastDir: string | null = null

function owner(event: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

function startDir(): string {
  return lastDir && fs.existsSync(lastDir) ? lastDir : app.getPath('documents')
}

function message(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return 'The file could not be written. If it is open in another program, close it and try again.'
  }
  return err instanceof Error ? err.message : String(err)
}

function accountFor(doc: QDoc): Account | null {
  return getSettings().accounts.find((a) => a.id === doc.accountId) ?? null
}

async function saveWithDialog(
  event: Electron.IpcMainInvokeEvent,
  opts: { title: string; baseName: string; ext: string; filterName: string },
  produce: () => Promise<Buffer | string>
): Promise<ExportResult> {
  const win = owner(event)
  const options: Electron.SaveDialogOptions = {
    title: opts.title,
    defaultPath: path.join(startDir(), `${opts.baseName}.${opts.ext}`),
    filters: [{ name: opts.filterName, extensions: [opts.ext] }]
  }
  const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
  try {
    const data = await produce()
    await fs.promises.writeFile(picked.filePath, data)
    lastDir = path.dirname(picked.filePath)
    exported.add(picked.filePath)
    return { ok: true, path: picked.filePath }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

function requireDoc(input: unknown): QDoc {
  const doc = sanitizeDoc(input)
  if (!doc) throw new Error('The document data is not valid.')
  return doc
}

export function registerIpc(): void {
  registerPrintIpc()

  ipcMain.handle(
    'app:info',
    (): AppInfo => ({ version: app.getVersion(), dataPath: dataDir(), packaged: app.isPackaged })
  )
  ipcMain.handle('app:openDataFolder', async () => {
    await shell.openPath(dataDir())
  })
  ipcMain.handle('app:openPath', async (_e, file: unknown) => {
    if (typeof file === 'string' && exported.has(file)) await shell.openPath(file)
  })
  ipcMain.handle('app:showInFolder', (_e, file: unknown) => {
    if (typeof file === 'string' && exported.has(file)) shell.showItemInFolder(file)
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, settings: unknown) => saveSettings(settings))

  ipcMain.handle('docs:list', () => listDocs())
  ipcMain.handle('docs:get', (_e, id: unknown) => (typeof id === 'string' ? getDoc(id) : null))
  ipcMain.handle('docs:save', (_e, doc: unknown) => saveDoc(doc))
  // The page calls this while the window is closing, when an asynchronous save could be cut short.
  ipcMain.on('docs:saveSync', (event, doc: unknown) => {
    try {
      saveDoc(doc)
      event.returnValue = true
    } catch {
      event.returnValue = false
    }
  })
  ipcMain.handle('docs:remove', (_e, id: unknown) => {
    if (typeof id === 'string') deleteDoc(id)
  })
  ipcMain.handle('docs:createDefaultTemplate', (_e, docType: unknown) =>
    createDefaultTemplate(docType === 'invoice' ? 'invoice' : 'quotation')
  )

  ipcMain.handle('assets:pick', async (event) => {
    const win = owner(event)
    const options: Electron.OpenDialogOptions = {
      title: 'Choose an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return null
    const image = importAssetFile(picked.filePaths[0])
    if (!image) throw new Error('That file could not be read as a PNG or JPEG image.')
    return image
  })

  ipcMain.handle('templates:export', async (event, id: unknown): Promise<ExportResult> => {
    const doc = typeof id === 'string' ? getDoc(id) : null
    if (!doc) return { ok: false, error: 'The template could not be found.' }
    return saveWithDialog(
      event,
      {
        title: 'Export template',
        baseName: safeFileName(doc.name, 'Template'),
        ext: TEMPLATE_EXT,
        filterName: 'Quotation Maker template'
      },
      async () => buildTemplateBundle(doc)
    )
  })

  ipcMain.handle('templates:import', async (event): Promise<ImportResult> => {
    const win = owner(event)
    const options: Electron.OpenDialogOptions = {
      title: 'Import templates',
      defaultPath: startDir(),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Quotation Maker template', extensions: [TEMPLATE_EXT] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }
    const ids: string[] = []
    const errors: string[] = []
    for (const file of picked.filePaths) {
      try {
        ids.push(importTemplateBundle(await fs.promises.readFile(file, 'utf8')).id)
      } catch (err) {
        errors.push(`${path.basename(file)}: ${message(err)}`)
      }
    }
    lastDir = path.dirname(picked.filePaths[0])
    return { ok: errors.length === 0, ids, error: errors.join('\n') || undefined }
  })

  ipcMain.handle('export:pdf', async (event, input: unknown): Promise<ExportResult> => {
    const doc = requireDoc(input)
    return saveWithDialog(
      event,
      { title: 'Export as PDF', baseName: exportBaseName(doc), ext: 'pdf', filterName: 'PDF document' },
      () => renderPdf(doc, accountFor(doc))
    )
  })

  ipcMain.handle('export:docx', async (event, input: unknown): Promise<ExportResult> => {
    const doc = requireDoc(input)
    return saveWithDialog(
      event,
      { title: 'Export as Word', baseName: exportBaseName(doc), ext: 'docx', filterName: 'Word document' },
      () => renderDocx(doc, accountFor(doc))
    )
  })

  ipcMain.handle('update:status', () => getUpdateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())
}
