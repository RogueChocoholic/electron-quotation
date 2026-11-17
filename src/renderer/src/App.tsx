import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppInfo, Settings, UpdateStatus } from '@shared/types'
import { AppContext, useApp, type AppContextValue, type NewQuotationRequest, type Route } from './app/context'
import { NewQuotationDialog } from './app/NewQuotationDialog'
import { loadDocFonts } from './doc/DocumentView'
import { cx } from './doc/util'
import { IconDoc, IconSettings, IconTemplate } from './ui/icons'
import { UiProvider } from './ui/ui'
import { EditorView } from './views/EditorView'
import { QuotationsView } from './views/QuotationsView'
import { SettingsView } from './views/SettingsView'
import { TemplatesView } from './views/TemplatesView'

function Sidebar() {
  const { route, navigate, info, update } = useApp()
  const item = (name: 'quotations' | 'templates' | 'settings', label: string, icon: ReactNode) => (
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
      <nav className="nav">
        {item('quotations', 'Quotations', <IconDoc />)}
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
  const [route, setRoute] = useState<Route>({ name: 'quotations' })
  const [request, setRequest] = useState<NewQuotationRequest | null>(null)

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

  const newQuotation = useCallback((req: NewQuotationRequest = {}) => setRequest(req), [])

  const value = useMemo<AppContextValue | null>(
    () => settings && { settings, saveSettings, info, update, route, navigate: setRoute, newQuotation },
    [settings, saveSettings, info, update, route, newQuotation]
  )

  if (!value) return <div className="boot" />

  return (
    <UiProvider>
      <AppContext.Provider value={value}>
        <div className="app">
          {route.name !== 'editor' && <Sidebar />}
          <main className="main">
            {route.name === 'quotations' && <QuotationsView />}
            {route.name === 'templates' && <TemplatesView />}
            {route.name === 'settings' && <SettingsView />}
            {route.name === 'editor' && <EditorView key={route.id} id={route.id} from={route.from} />}
          </main>
        </div>
        {request && (
          <NewQuotationDialog
            request={request}
            onClose={() => setRequest(null)}
            onCreated={(doc) => {
              setRequest(null)
              setRoute({ name: 'editor', id: doc.id, from: 'quotations' })
            }}
          />
        )}
      </AppContext.Provider>
    </UiProvider>
  )
}
