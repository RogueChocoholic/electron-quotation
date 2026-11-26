import { useCallback, useEffect, useMemo, useState } from 'react'
import { DOC_WORDS } from '@shared/calc'
import type { DocMeta } from '@shared/types'
import { createBlankTemplate, duplicateTemplate } from '../app/actions'
import { errorText, formatWhen, useApp } from '../app/context'
import { IconMore, IconPlus, IconTemplate, IconUpload } from '../ui/icons'
import { Button, IconButton, useConfirm, useMenu, useToast } from '../ui/ui'

/** The templates for quotations or for invoices, whichever the app is switched to. */
export function TemplatesView() {
  const { navigate, newDocument, settings, mode, setMode } = useApp()
  const words = DOC_WORDS[mode]
  const toast = useToast()
  const confirm = useConfirm()
  const openMenu = useMenu()
  const [metas, setMetas] = useState<DocMeta[] | null>(null)

  const reload = useCallback(async () => {
    try {
      setMetas(await window.api.docs.list())
    } catch (err) {
      toast({ kind: 'error', message: errorText(err) })
      setMetas([])
    }
  }, [toast])

  useEffect(() => {
    void reload()
  }, [reload])

  const templates = useMemo(
    () => (metas ?? []).filter((m) => m.kind === 'template' && m.docType === mode),
    [metas, mode]
  )
  const edit = (id: string): void => navigate({ name: 'editor', id, from: 'templates' })

  /** Runs an action and reports a failure instead of leaving the button silently doing nothing. */
  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
    } catch (err) {
      toast({ kind: 'error', message: errorText(err) })
    }
  }

  const importTemplates = (): Promise<void> =>
    run(async () => {
      const result = await window.api.templates.importFile(mode)
      if (result.canceled) return
      const count = result.ids?.length ?? 0
      if (count > 0) toast({ kind: 'success', message: count === 1 ? 'Template imported.' : `${count} templates imported.` })
      if (result.error) toast({ kind: 'error', message: result.error })
      // A file can hold a template of the other type; go to where what was imported is listed.
      const imported = (await window.api.docs.list()).filter((m) => result.ids?.includes(m.id))
      if (imported.length > 0 && imported.every((m) => m.docType !== mode)) setMode(imported[0].docType)
      else await reload()
      // A template made from a Word file is a first draft; say what to look over in it.
      if (result.notes?.length && imported.length > 0) {
        const open = await confirm({
          title: 'Template made from the Word file',
          body: (
            <>
              <p>The template is a first draft. Look it over before using it:</p>
              <ul className="modal-list">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </>
          ),
          confirmLabel: imported.length === 1 ? 'Open the template' : 'OK',
          cancelLabel: 'Close'
        })
        if (open && imported.length === 1) edit(imported[0].id)
      }
    })

  const exportTemplate = (m: DocMeta): Promise<void> =>
    run(async () => {
      const result = await window.api.templates.exportFile(m.id)
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
    })

  const remove = async (m: DocMeta): Promise<void> => {
    const ok = await confirm({
      title: 'Delete template',
      body: (
        <>
          Delete the template <strong>{m.name || 'Untitled template'}</strong>? {words.Many} already made from it are
          not affected. This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    await run(async () => {
      await window.api.docs.remove(m.id)
      toast({ message: 'Template deleted.' })
      await reload()
    })
  }

  const addMenu = (anchor: Element): void =>
    openMenu(anchor, [
      {
        label: 'Copy of the built-in design',
        onSelect: () => void run(async () => edit((await window.api.docs.createDefaultTemplate(mode)).id))
      },
      {
        label: 'Blank template',
        onSelect: () => void run(async () => edit((await createBlankTemplate(settings.defaultAccountId, mode)).id))
      }
    ])

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>{words.One} templates</h1>
          <p className="view-sub">A template holds the design and the default text for new {words.many}.</p>
        </div>
        <div className="view-actions">
          <Button
            icon={<IconUpload />}
            title="Import template files, or make a template from a Word document (.docx)"
            onClick={() => void importTemplates()}
          >
            Import
          </Button>
          <Button variant="primary" icon={<IconPlus />} onClick={(e) => addMenu(e.currentTarget)}>
            New template
          </Button>
        </div>
      </header>

      {metas !== null && templates.length === 0 && (
        <div className="empty">
          <div className="empty-icon">
            <IconTemplate />
          </div>
          <h2>No {words.one} templates</h2>
          <p>
            Start from the built-in design or a blank page, or import a template file from another PC or a Word
            document to make one from.
          </p>
          <Button variant="primary" icon={<IconPlus />} onClick={(e) => addMenu(e.currentTarget)}>
            New template
          </Button>
        </div>
      )}

      <div className="cards">
        {templates.map((m) => (
          <div className="card" key={m.id}>
            <button type="button" className="card-main" onClick={() => edit(m.id)} title="Edit this template">
              <span className="card-thumb">
                <IconTemplate />
              </span>
              <span className="card-title">{m.name || 'Untitled template'}</span>
              <span className="card-sub">Edited {formatWhen(m.updatedAt)}</span>
            </button>
            <div className="card-foot">
              <Button small onClick={() => newDocument({ templateId: m.id })}>
                New {words.one}
              </Button>
              <Button small variant="ghost" onClick={() => edit(m.id)}>
                Edit
              </Button>
              <span className="spacer" />
              <IconButton
                label="More actions"
                onClick={(e) =>
                  openMenu(e.currentTarget, [
                    {
                      label: 'Duplicate',
                      onSelect: () =>
                        void run(async () => {
                          await duplicateTemplate(m.id)
                          await reload()
                        })
                    },
                    { label: 'Export to file', onSelect: () => void exportTemplate(m) },
                    { separator: true },
                    { label: 'Delete', danger: true, onSelect: () => void remove(m) }
                  ])
                }
              >
                <IconMore />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
