import { app, BrowserWindow, dialog, Menu, net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc'
import { assetPath, ensureSeed } from './store'
import { initUpdater } from './updater'
import { createMainWindow, getMainWindow } from './windows'

// Images are served to the page as qasset://a/<id> from the app's asset store.
protocol.registerSchemesAsPrivileged([
  { scheme: 'qasset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function registerAssetProtocol(): void {
  protocol.handle('qasset', (request) => {
    const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    const file = assetPath(id)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    try {
      ensureSeed()
    } catch (err) {
      dialog.showErrorBox(
        'Quotation Maker could not start',
        `The app's data folder could not be prepared.\n\n${err instanceof Error ? err.message : String(err)}`
      )
      app.quit()
      return
    }
    registerAssetProtocol()
    registerIpc()
    createMainWindow()
    initUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}
