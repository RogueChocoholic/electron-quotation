import { createContext, useContext } from 'react'
import type { AppInfo, DocMeta, DocType, Settings, UpdateStatus } from '@shared/types'

export type Route =
  /** The list of quotations or of invoices, whichever the app is switched to. */
  | { name: 'documents' }
  | { name: 'templates' }
  | { name: 'settings' }
  | { name: 'editor'; id: string; from: 'documents' | 'templates' }

export interface NewDocumentRequest {
  /** Quotation or invoice. Defaults to what the app is switched to. */
  docType?: DocType
  /** Preselect this template. */
  templateId?: string
  /** Copy an existing document instead of starting from a template. */
  source?: DocMeta
}

export interface AppContextValue {
  settings: Settings
  /** Updates settings immediately and saves them in the background. */
  saveSettings(next: Settings): void
  info: AppInfo | null
  update: UpdateStatus
  route: Route
  navigate(route: Route): void
  /** Whether the app is showing quotations or invoices: the lists, the templates and what "New" makes. */
  mode: DocType
  setMode(mode: DocType): void
  /** Opens the dialog that creates a quotation or an invoice. */
  newDocument(request?: NewDocumentRequest): void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside the app provider')
  return ctx
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Strip Electron's "Error invoking remote method 'x': Error: " wrapper.
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
