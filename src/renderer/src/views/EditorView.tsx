import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { customerOf } from '@shared/calc'
import type { QDoc } from '@shared/types'
import { saveAsTemplate } from '../app/actions'
import { errorText, useApp } from '../app/context'
import { DocContext, type DocContextValue } from '../doc/context'
import { DocumentView } from '../doc/DocumentView'
import { insertBlockAt } from '../doc/ops'
import { PX_PER_MM } from '../doc/util'
import { IconChevronLeft, IconDownload, IconMinus, IconMore, IconPlus } from '../ui/icons'
import { Button, IconButton, useMenu, useToast } from '../ui/ui'
import { Inspector, type InspectorTab } from './Inspector'

const SAVE_DELAY_MS = 600
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const PAGE_WIDTH_PX = 210 * PX_PER_MM

type SaveState = 'saved' | 'saving' | 'error'

export function EditorView({ id, from }: { id: string; from: 'quotations' | 'templates' }) {
  const { settings, navigate, newQuotation } = useApp()
  const toast = useToast()
  const openMenu = useMenu()

  const [doc, setDoc] = useState<QDoc | null>(null)
  const [missing, setMissing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<InspectorTab>('document')
  const [zoom, setZoom] = useState(1)
  const [pages, setPages] = useState(1)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [otherNumbers, setOtherNumbers] = useState<string[]>([])
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)

  // The ref always holds the newest document, so saving never depends on render timing.
  const docRef = useRef<QDoc | null>(null)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const canvasRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef(1)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [loaded, list] = await Promise.all([window.api.docs.get(id), window.api.docs.list()])
        if (!alive) return
        if (!loaded) {
          setMissing(true)
          return
        }
        docRef.current = loaded
        setDoc(loaded)
        setOtherNumbers(
          list.filter((m) => m.kind === 'quotation' && m.id !== id && m.number.trim()).map((m) => m.number.trim())
        )
        // Start zoomed so the whole page width is visible.
        const width = canvasRef.current?.clientWidth ?? 0
        if (width > 0) {
          const fit = Math.floor(((width - 72) / PAGE_WIDTH_PX) * 20) / 20
          setZoom(Math.min(1, Math.max(0.5, fit)))
        }
      } catch (err) {
        if (alive) {
          toast({ kind: 'error', message: errorText(err) })
          setMissing(true)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [id, toast])

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current)
    const current = docRef.current
    if (!dirty.current || !current) return true
    dirty.current = false
    setSaveState('saving')
    try {
      await window.api.docs.save(current)
      if (!dirty.current) setSaveState('saved')
      return true
    } catch {
      dirty.current = true
      setSaveState('error')
      return false
    }
  }, [])

  const update = useCallback(
    (fn: (doc: QDoc) => QDoc) => {
      const current = docRef.current
      if (!current) return
      const next = fn(current)
      if (next === current) return
      docRef.current = next
      setDoc(next)
      dirty.current = true
      setSaveState('saving')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush]
  )

  // Save pending edits when leaving the editor, closing the window, or pressing Ctrl+S.
  useEffect(() => {
    // The window is going away, so this save has to finish before the handler returns.
    const onUnload = (): void => {
      window.clearTimeout(timer.current)
      const current = docRef.current
      if (!dirty.current || !current) return
      dirty.current = !window.api.docs.saveSync(current)
    }
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flush()
      }
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('keydown', onKey)
      void flush()
    }
  }, [flush])

  const select = useCallback((blockId: string | null) => {
    setSelectedId(blockId)
    if (blockId) setTab('section')
  }, [])

  const removeBlock = useCallback(
    (blockId: string) => {
      const current = docRef.current
      if (!current) return
      const index = current.blocks.findIndex((b) => b.id === blockId)
      if (index < 0) return
      const removed = current.blocks[index]
      update((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== blockId) }))
      setSelectedId((sel) => (sel === blockId ? null : sel))
      toast({
        message: 'Section deleted.',
        actions: [{ label: 'Undo', onClick: () => update((d) => insertBlockAt(d, index, removed)) }]
      })
    },
    [update, toast]
  )

  const pickImage = useCallback(async () => {
    try {
      return await window.api.assets.pick()
    } catch (err) {
      toast({ kind: 'error', message: errorText(err) })
      return null
    }
  }, [toast])

  const account = useMemo(
    () => settings.accounts.find((a) => a.id === doc?.accountId) ?? null,
    [settings.accounts, doc?.accountId]
  )

  const ctx = useMemo<DocContextValue | null>(
    () =>
      doc && {
        doc,
        account,
        editable: true,
        zoom,
        selectedId,
        select,
        update,
        pickImage,
        openMenu,
        removeBlock
      },
    [doc, account, zoom, selectedId, select, update, pickImage, openMenu, removeBlock]
  )

  const onLayout = useCallback((_stable: boolean, count: number) => {
    if (pagesRef.current !== count) {
      pagesRef.current = count
      setPages(count)
    }
  }, [])

  const back = (): void => navigate({ name: from })

  const exportAs = async (kind: 'pdf' | 'docx'): Promise<void> => {
    const current = docRef.current
    if (!current || exporting) return
    if (current.kind === 'quotation' && current.number.trim() === '') {
      toast({ kind: 'error', message: 'Enter a quotation number before exporting.' })
      setTab('document')
      window.setTimeout(() => document.getElementById('insp-number')?.focus(), 50)
      return
    }
    setExporting(kind)
    try {
      await flush()
      const result = kind === 'pdf' ? await window.api.exporter.pdf(current) : await window.api.exporter.docx(current)
      if (result.canceled) return
      if (!result.ok || !result.path) {
        toast({ kind: 'error', message: result.error ?? 'The export failed.' })
        return
      }
      const file = result.path
      toast({
        kind: 'success',
        message: kind === 'pdf' ? 'PDF saved.' : 'Word document saved.',
        actions: [
          { label: 'Open', onClick: () => void window.api.app.openPath(file) },
          { label: 'Show in folder', onClick: () => void window.api.app.showInFolder(file) }
        ]
      })
    } catch (err) {
      toast({ kind: 'error', message: errorText(err) })
    } finally {
      setExporting(null)
    }
  }

  const stepZoom = (dir: -1 | 1): void => {
    const index = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001)
    const at = index < 0 ? ZOOM_STEPS.length - 1 : index
    const exact = Math.abs(ZOOM_STEPS[at] - zoom) < 0.001
    const next = dir === 1 ? (exact ? at + 1 : at) : at - 1
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, next))])
  }

  const moreMenu = (anchor: Element): void => {
    const current = docRef.current
    if (!current) return
    if (current.kind === 'quotation') {
      openMenu(anchor, [
        {
          label: 'Save as a new template',
          onSelect: () =>
            void (async () => {
              try {
                await flush()
                const template = await saveAsTemplate(docRef.current ?? current)
                toast({
                  kind: 'success',
                  message: `Template "${template.name}" created.`,
                  actions: [
                    { label: 'Open', onClick: () => navigate({ name: 'editor', id: template.id, from: 'templates' }) }
                  ]
                })
              } catch (err) {
                toast({ kind: 'error', message: errorText(err) })
              }
            })()
        }
      ])
    } else {
      openMenu(anchor, [
        {
          label: 'New quotation from this template',
          onSelect: () => void flush().then(() => newQuotation({ templateId: current.id }))
        },
        {
          label: 'Export template to file',
          onSelect: () =>
            void (async () => {
              await flush()
              const result = await window.api.templates.exportFile(current.id)
              if (result.canceled) return
              if (!result.ok || !result.path) {
                toast({ kind: 'error', message: result.error ?? 'The template could not be exported.' })
                return
              }
              const file = result.path
              toast({
                kind: 'success',
                message: 'Template exported.',
                actions: [{ label: 'Show in folder', onClick: () => void window.api.app.showInFolder(file) }]
              })
            })()
        }
      ])
    }
  }

  if (missing) {
    return (
      <div className="editor">
        <div className="empty">
          <h2>This document could not be opened</h2>
          <p>It may have been deleted.</p>
          <Button onClick={back}>Back</Button>
        </div>
      </div>
    )
  }

  const title = doc
    ? doc.kind === 'template'
      ? doc.name || 'Untitled template'
      : [doc.number || 'No number', customerOf(doc)].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="editor">
      <header className="editor-bar">
        <Button variant="ghost" icon={<IconChevronLeft />} onClick={back}>
          {from === 'templates' ? 'Templates' : 'Quotations'}
        </Button>
        <div className="editor-title">
          <span className="editor-kind">{doc?.kind === 'template' ? 'Template' : 'Quotation'}</span>
          <span className="editor-name" title={title}>
            {title}
          </span>
        </div>
        <span className={`save-state save-${saveState}`}>
          {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving...' : 'Not saved - will retry'}
        </span>
        <span className="spacer" />
        <span className="page-count" title="Content that does not fit moves to another page">
          {pages === 1 ? '1 page' : `${pages} pages`}
        </span>
        <div className="zoom">
          <IconButton label="Zoom out" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0]}>
            <IconMinus />
          </IconButton>
          <button type="button" className="zoom-value" title="Reset to 100%" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <IconButton
            label="Zoom in"
            onClick={() => stepZoom(1)}
            disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          >
            <IconPlus />
          </IconButton>
        </div>
        <IconButton label="More actions" onClick={(e) => moreMenu(e.currentTarget)}>
          <IconMore />
        </IconButton>
        <Button icon={<IconDownload />} disabled={!doc || exporting !== null} onClick={() => void exportAs('docx')}>
          {exporting === 'docx' ? 'Exporting...' : 'Word'}
        </Button>
        <Button
          variant="primary"
          icon={<IconDownload />}
          disabled={!doc || exporting !== null}
          onClick={() => void exportAs('pdf')}
        >
          {exporting === 'pdf' ? 'Exporting...' : 'PDF'}
        </Button>
      </header>

      <div className="editor-main">
        <div
          className="canvas"
          ref={canvasRef}
          onMouseDown={(e) => {
            const target = e.target as HTMLElement
            if (target === e.currentTarget || target.classList.contains('doc-root')) setSelectedId(null)
          }}
        >
          {ctx && (
            <DocContext.Provider value={ctx}>
              <DocumentView onLayout={onLayout} />
            </DocContext.Provider>
          )}
        </div>
        {ctx && (
          <DocContext.Provider value={ctx}>
            <Inspector tab={tab} onTab={setTab} otherNumbers={otherNumbers} />
          </DocContext.Provider>
        )}
      </div>
    </div>
  )
}
