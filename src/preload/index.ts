import { contextBridge, ipcRenderer } from 'electron'
import type { Api, UpdateStatus } from '@shared/types'

const api: Api = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
    openPath: (path) => ipcRenderer.invoke('app:openPath', path),
    showInFolder: (path) => ipcRenderer.invoke('app:showInFolder', path)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings)
  },
  docs: {
    list: () => ipcRenderer.invoke('docs:list'),
    get: (id) => ipcRenderer.invoke('docs:get', id),
    save: (doc) => ipcRenderer.invoke('docs:save', doc),
    saveSync: (doc) => ipcRenderer.sendSync('docs:saveSync', doc) === true,
    remove: (id) => ipcRenderer.invoke('docs:remove', id),
    createDefaultTemplate: (docType) => ipcRenderer.invoke('docs:createDefaultTemplate', docType)
  },
  assets: {
    pick: () => ipcRenderer.invoke('assets:pick')
  },
  templates: {
    exportFile: (id) => ipcRenderer.invoke('templates:export', id),
    importFile: () => ipcRenderer.invoke('templates:import')
  },
  exporter: {
    pdf: (doc) => ipcRenderer.invoke('export:pdf', doc),
    docx: (doc) => ipcRenderer.invoke('export:docx', doc)
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      const listener = (_event: unknown, status: UpdateStatus): void => cb(status)
      ipcRenderer.on('update:status', listener)
      return () => {
        ipcRenderer.removeListener('update:status', listener)
      }
    }
  },
  print: {
    payload: () => ipcRenderer.invoke('print:payload'),
    ready: () => ipcRenderer.send('print:ready')
  }
}

contextBridge.exposeInMainWorld('api', api)
