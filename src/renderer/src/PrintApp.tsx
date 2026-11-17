import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, QDoc } from '@shared/types'
import { DocContext, type DocContextValue } from './doc/context'
import { DocumentView, loadDocFonts } from './doc/DocumentView'

const noop = (): void => undefined
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

/**
 * Shown only in the hidden window used for PDF export. It renders the document exactly
 * as the editor does, without editing controls, then tells the main process to print.
 */
export function PrintApp() {
  const [payload, setPayload] = useState<{ doc: QDoc; account: Account | null } | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const stable = useRef(false)

  useEffect(() => {
    void window.api.print.payload().then(setPayload)
    void loadDocFonts().then(() => setFontsReady(true))
  }, [])

  const onLayout = useCallback((isStable: boolean) => {
    stable.current = isStable
  }, [])

  // Print only once the fonts are in, the page breaks have settled and every image has decoded.
  useEffect(() => {
    if (!payload || !fontsReady) return
    let cancelled = false
    void (async () => {
      for (let i = 0; i < 200 && !cancelled; i++) {
        await sleep(40)
        if (!stable.current) continue
        const images = Array.from(document.images)
        if (images.some((img) => !img.complete)) continue
        await Promise.all(images.map((img) => img.decode().catch(() => undefined)))
        if (stable.current) break
      }
      if (!cancelled) window.api.print.ready()
    })()
    return () => {
      cancelled = true
    }
  }, [payload, fontsReady])

  const ctx = useMemo<DocContextValue | null>(
    () =>
      payload && {
        doc: payload.doc,
        account: payload.account,
        editable: false,
        zoom: 1,
        selectedId: null,
        select: noop,
        update: noop,
        pickImage: async () => null,
        openMenu: noop,
        removeBlock: noop
      },
    [payload]
  )

  if (!ctx) return null
  return (
    <DocContext.Provider value={ctx}>
      <DocumentView onLayout={onLayout} />
    </DocContext.Provider>
  )
}
