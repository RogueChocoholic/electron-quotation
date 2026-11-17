import { createContext, useContext } from 'react'
import type { Account, PickedImage, QDoc } from '@shared/types'

export interface MenuItem {
  label?: string
  onSelect?(): void
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  /** A non-clickable section title. */
  heading?: boolean
}

export interface DocContextValue {
  doc: QDoc
  account: Account | null
  /** False when rendering for PDF export. */
  editable: boolean
  zoom: number
  selectedId: string | null
  select(id: string | null): void
  update(fn: (doc: QDoc) => QDoc): void
  pickImage(): Promise<PickedImage | null>
  openMenu(anchor: Element, items: MenuItem[]): void
  /** Removes a block and offers an undo. */
  removeBlock(id: string): void
}

export const DocContext = createContext<DocContextValue | null>(null)

export function useDoc(): DocContextValue {
  const ctx = useContext(DocContext)
  if (!ctx) throw new Error('useDoc must be used inside a DocContext provider')
  return ctx
}
