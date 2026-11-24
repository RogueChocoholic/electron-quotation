import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DOC_WORDS } from '@shared/calc'
import type { AppInfo, DocType, Settings, UpdateStatus } from '@shared/types'
import { AppContext, useApp, type AppContextValue, type NewDocumentRequest, type Route } from './app/context'
import { NewDocumentDialog } from './app/NewDocumentDialog'
import { loadDocFonts } from './doc/DocumentView'
import { cx } from './doc/util'
import { IconDoc, IconSettings, IconTemplate } from './ui/icons'
import { Segmented, UiProvider } from './ui/ui'
import { DocumentsView } from './views/DocumentsView'
import { EditorView } from './views/EditorView'
import { SettingsView } from './views/SettingsView'
import { TemplatesView } from './views/TemplatesView'

function Sidebar() {
  const { route, navigate, info, update, mode, setMode } = useApp()
  const item = (name: 'documents' | 'templates' | 'settings', label: string, icon: ReactNode) => (
    <button
      type="button"
      className={cx('nav-item', route.name === name && 'is-active')}
      onClick={() => navigate({ name })}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">Q</span>
        <span className="brand-name">Quotation Maker</span>
      </div>
      {/* Everything below follows this switch: the list, the templates and what "New" creates. */}
      <div className="mode-switch" title="Switch between quotations and invoices">
        <Segmented<DocType>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'quotation', label: DOC_WORDS.quotation.Many },
            { value: 'invoice', label: DOC_WORDS.invoice.Many }
          ]}
        />
      </div>
      <nav className="nav">
        {item('documents', DOC_WORDS[mode].Many, <IconDoc />)}
        {item('templates', 'Templates', <IconTemplate />)}
        {item('settings', 'Settings', <IconSettings />)}
      </nav>
      <div className="sidebar-foot">
        {update.state === 'ready' && (
          <button type="button" className="update-pill" onClick={() => void window.api.update.install()}>
            <strong>Update ready</strong>
            <span>Restart to install version {update.version}</span>
          </button>
        )}
        {update.state === 'downloading' && (
          <div className="update-note">Downloading update{update.percent ? ` ${update.percent}%` : ''}...</div>
        )}
        <div className="version">Version {info?.version ?? ''}</div>
      </div>
    </aside>
  )
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [route, setRoute] = useState<Route>({ name: 'documents' })
  const [request, setRequest] = useState<NewDocumentRequest | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.app.info().then(setInfo)
    void window.api.update.status().then(setUpdate)
    void loadDocFonts()
    return window.api.update.onStatus(setUpdate)
  }, [])

  const saveSettings = useCallback((next: Settings) => {
    setSettings(next)
    void window.api.settings.save(next)
  }, [])

  const newDocument = useCallback((req: NewDocumentRequest = {}) => setRequest(req), [])

  const setMode = useCallback(
    (mode: DocType) => {
      if (settings && settings.mode !== mode) saveSettings({ ...settings, mode })
    },
    [settings, saveSettings]
  )

  const value = useMemo<AppContextValue | null>(
    () =>
      settings && {
        settings,
        saveSettings,
        info,
        update,
        route,
        navigate: setRoute,
        mode: settings.mode,
        setMode,
        newDocument
      },
    [settings, saveSettings, info, update, route, setMode, newDocument]
  )

  if (!value) return <div className="boot" />

  return (
    <UiProvider>
      <AppContext.Provider value={value}>
        <div className="app">
          {route.name !== 'editor' && <Sidebar />}
          <main className="main">
            {/* Keyed by the mode so that switching starts each list afresh. */}
            {route.name === 'documents' && <DocumentsView key={value.mode} />}
            {route.name === 'templates' && <TemplatesView key={value.mode} />}
            {route.name === 'settings' && <SettingsView />}
            {route.name === 'editor' && <EditorView key={route.id} id={route.id} from={route.from} />}
          </main>
        </div>
        {request && (
          <NewDocumentDialog
            request={request}
            onClose={() => setRequest(null)}
            onCreated={(doc) => {
              setRequest(null)
              setRoute({ name: 'editor', id: doc.id, from: 'documents' })
            }}
          />
        )}
      </AppContext.Provider>
    </UiProvider>
  )
}
