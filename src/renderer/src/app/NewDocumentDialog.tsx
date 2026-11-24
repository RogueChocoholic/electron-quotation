import { useEffect, useMemo, useState } from 'react'
import { DOC_WORDS, consumeNumber, lastTemplateOf, numberingOf, peekNumber, withNumbering } from '@shared/calc'
import type { DocMeta, QDoc } from '@shared/types'
import { Button, Field, Modal, Select, TextInput, Toggle, useToast } from '../ui/ui'
import { createDocument } from './actions'
import { errorText, useApp, type NewDocumentRequest } from './context'

const NONE = '__none__'

interface Props {
  request: NewDocumentRequest
  onClose(): void
  onCreated(doc: QDoc): void
}

/**
 * Everything a new quotation or invoice needs is decided here: which template (or existing
 * document) it starts from, which bank account it shows, and its number.
 */
export function NewDocumentDialog({ request, onClose, onCreated }: Props) {
  const { settings, saveSettings, navigate, mode, setMode } = useApp()
  const toast = useToast()
  const docType = request.source?.docType ?? request.docType ?? mode
  const words = DOC_WORDS[docType]
  // Quotations and invoices each continue their own series of numbers.
  const saved = numberingOf(settings, docType)
  const [metas, setMetas] = useState<DocMeta[] | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [accountId, setAccountId] = useState<string>(NONE)
  const [auto, setAuto] = useState(saved.auto)
  const [prefix, setPrefix] = useState(saved.prefix)
  const [typed, setTyped] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasAccount = (id: string | null | undefined): id is string =>
    !!id && settings.accounts.some((a) => a.id === id)

  useEffect(() => {
    let alive = true
    void window.api.docs.list().then((list) => {
      if (!alive) return
      setMetas(list)
      const templates = list.filter((m) => m.kind === 'template' && m.docType === docType)
      const preferred = [request.templateId, lastTemplateOf(settings, docType)].find((id) =>
        templates.some((t) => t.id === id)
      )
      const chosen = preferred ?? templates[0]?.id ?? ''
      setTemplateId(chosen)
      const from = request.source ?? templates.find((t) => t.id === chosen)
      setAccountId(hasAccount(from?.accountId) ? from.accountId : (settings.defaultAccountId ?? NONE))
    })
    return () => {
      alive = false
    }
    // Runs once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const templates = useMemo(
    () => (metas ?? []).filter((m) => m.kind === 'template' && m.docType === docType),
    [metas, docType]
  )
  const usedNumbers = useMemo(
    () =>
      new Set((metas ?? []).filter((m) => m.kind === 'document' && m.docType === docType).map((m) => m.number.trim())),
    [metas, docType]
  )
  /** What the new document is made from. A design without a bank account section has no use for an account. */
  const from = request.source ?? templates.find((t) => t.id === templateId)
  const usesAccount = from?.usesAccount ?? true

  const numbering = { ...saved, auto, prefix }
  const proposed = peekNumber(numbering)
  const number = (typed ?? (auto ? proposed.number : '')).trim()
  const sourceId = request.source?.id ?? templateId
  const duplicate = number !== '' && usedNumbers.has(number)
  const canCreate = !!sourceId && number !== '' && !busy

  const chooseTemplate = (id: string): void => {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (hasAccount(t?.accountId)) setAccountId(t.accountId)
  }

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setBusy(true)
    try {
      const doc = await createDocument(sourceId, number, accountId === NONE ? null : accountId)
      // The counter only advances when the suggested number was actually used.
      const usedSuggestion = auto && number === proposed.number
      saveSettings({
        ...withNumbering(
          settings,
          docType,
          usedSuggestion ? consumeNumber(numbering, proposed.year, proposed.seq) : numbering,
          request.source ? lastTemplateOf(settings, docType) : templateId
        ),
        // The new document is listed under its own type, so the app follows it there.
        mode: docType
      })
      onCreated(doc)
    } catch (err) {
      toast({ kind: 'error', message: errorText(err) })
      setBusy(false)
    }
  }

  // What the form shows depends on the templates, so it waits the moment it takes to read them.
  if (!metas) return null

  if (!request.source && templates.length === 0) {
    return (
      <Modal
        title={`New ${words.one}`}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                setMode(docType)
                navigate({ name: 'templates' })
              }}
            >
              Go to Templates
            </Button>
          </>
        }
      >
        <div className="modal-text">
          There are no {words.one} templates yet. {docType === 'invoice' ? 'An invoice' : 'A quotation'} starts from a
          template, so create or import one first.
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title={request.source ? `Duplicate ${words.one}` : `New ${words.one}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <div className="form">
        {request.source ? (
          <Field label="Copy of">
            <div className="static-value">
              {[request.source.number, request.source.customer].filter(Boolean).join(' · ') || `Untitled ${words.one}`}
            </div>
          </Field>
        ) : (
          <Field label="Template">
            <Select
              value={templateId}
              onChange={chooseTemplate}
              options={templates.map((t) => ({ value: t.id, label: t.name || 'Untitled template' }))}
            />
          </Field>
        )}

        {usesAccount && (
          <Field
            label="Bank account"
            hint={settings.accounts.length === 0 ? 'No accounts yet. Add them in Settings.' : undefined}
          >
            <Select
              value={accountId}
              onChange={setAccountId}
              options={[
                ...settings.accounts.map((a) => ({ value: a.id, label: a.name || a.bank || 'Unnamed account' })),
                { value: NONE, label: 'None' }
              ]}
            />
          </Field>
        )}

        <div className="form-group">
          <Toggle
            checked={auto}
            onChange={(on) => {
              setAuto(on)
              setTyped(null)
            }}
            label={`Generate the ${words.one} number`}
            hint={auto ? 'Continues from the last number used.' : 'Off: type the number yourself.'}
          />
          <div className="form-row">
            {auto && (
              <Field label="Prefix">
                <TextInput
                  value={prefix}
                  maxLength={24}
                  onChange={(v) => {
                    setPrefix(v)
                    setTyped(null)
                  }}
                />
              </Field>
            )}
            <Field
              label={`${words.One} number`}
              hint={
                number === '' ? (
                  <span className="text-danger">{docType === 'invoice' ? 'An invoice' : 'A quotation'} number is required.</span>
                ) : duplicate ? (
                  <span className="text-warn">Another {words.one} already uses this number.</span>
                ) : auto && typed === null ? (
                  'You can still change it.'
                ) : undefined
              }
            >
              <TextInput
                value={typed ?? (auto ? proposed.number : '')}
                invalid={number === ''}
                autoFocus={!auto}
                placeholder={auto ? '' : 'Type the number'}
                onChange={setTyped}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
              />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  )
}
