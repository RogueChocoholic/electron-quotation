import { createContext, useContext } from 'react'
import type { AppInfo, DocMeta, Settings, UpdateStatus } from '@shared/types'

export type Route =
  | { name: 'quotations' }
  | { name: 'templates' }
  | { name: 'settings' }
  | { name: 'editor'; id: string; from: 'quotations' | 'templates' }

export interface NewQuotationRequest {
  /** Preselect this template. */
  templateId?: string
  /** Copy an existing quotation instead of starting from a template. */
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
  newQuotation(request?: NewQuotationRequest): void
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
