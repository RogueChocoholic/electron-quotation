import { useEffect, useMemo, useState } from 'react'
import { consumeNumber, peekNumber } from '@shared/calc'
import type { DocMeta, QDoc } from '@shared/types'
import { Button, Field, Modal, Select, TextInput, Toggle, useToast } from '../ui/ui'
import { createQuotation } from './actions'
import { errorText, useApp, type NewQuotationRequest } from './context'

const NONE = '__none__'

interface Props {
  request: NewQuotationRequest
  onClose(): void
  onCreated(doc: QDoc): void
}

/**
 * Everything a new quotation needs is decided here: which template (or quotation) it
 * starts from, which bank account it shows, and its number.
 */
export function NewQuotationDialog({ request, onClose, onCreated }: Props) {
  const { settings, saveSettings, navigate } = useApp()
  const toast = useToast()
  const [metas, setMetas] = useState<DocMeta[] | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [accountId, setAccountId] = useState<string>(NONE)
  const [auto, setAuto] = useState(settings.numbering.auto)
  const [prefix, setPrefix] = useState(settings.numbering.prefix)
  const [typed, setTyped] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasAccount = (id: string | null | undefined): id is string =>
    !!id && settings.accounts.some((a) => a.id === id)

  useEffect(() => {
    let alive = true
    void window.api.docs.list().then((list) => {
      if (!alive) return
      setMetas(list)
      const templates = list.filter((m) => m.kind === 'template')
      const preferred = [request.templateId, settings.lastTemplateId].find((id) => templates.some((t) => t.id === id))
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

  const templates = useMemo(() => (metas ?? []).filter((m) => m.kind === 'template'), [metas])
  const usedNumbers = useMemo(
    () => new Set((metas ?? []).filter((m) => m.kind === 'quotation').map((m) => m.number.trim())),
    [metas]
  )

  const numbering = { ...settings.numbering, auto, prefix }
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
      const doc = await createQuotation(sourceId, number, accountId === NONE ? null : accountId)
      // The counter only advances when the suggested number was actually used.
      const usedSuggestion = auto && number === proposed.number
      saveSettings({
        ...settings,
        numbering: usedSuggestion ? consumeNumber(numbering, proposed.year, proposed.seq) : numbering,
        lastTemplateId: request.source ? settings.lastTemplateId : templateId
      })
      onCreated(doc)
    } catch (err) {
      toast({ kind: 'error', message: errorText(err) })
      setBusy(false)
    }
  }

  if (metas && !request.source && templates.length === 0) {
    return (
      <Modal
        title="New quotation"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                navigate({ name: 'templates' })
              }}
            >
              Go to Templates
            </Button>
          </>
        }
      >
        <div className="modal-text">
          There are no templates yet. A quotation starts from a template, so create or import one first.
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title={request.source ? 'Duplicate quotation' : 'New quotation'}
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
              {[request.source.number, request.source.customer].filter(Boolean).join(' · ') || 'Untitled quotation'}
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

        <div className="form-group">
          <Toggle
            checked={auto}
            onChange={(on) => {
              setAuto(on)
              setTyped(null)
            }}
            label="Generate the quotation number"
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
              label="Quotation number"
              hint={
                number === '' ? (
                  <span className="text-danger">A quotation number is required.</span>
                ) : duplicate ? (
                  <span className="text-warn">Another quotation already uses this number.</span>
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
