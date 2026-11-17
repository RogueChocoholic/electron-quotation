import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtAmount } from '@shared/calc'
import type { DocMeta } from '@shared/types'
import { errorText, formatWhen, useApp } from '../app/context'
import { IconDoc, IconMore, IconPlus, IconSearch } from '../ui/icons'
import { Button, IconButton, useConfirm, useMenu, useToast } from '../ui/ui'

export function QuotationsView() {
  const { navigate, newQuotation } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const openMenu = useMenu()
  const [metas, setMetas] = useState<DocMeta[] | null>(null)
  const [query, setQuery] = useState('')

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

  const quotations = useMemo(() => (metas ?? []).filter((m) => m.kind === 'quotation'), [metas])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return quotations
    return quotations.filter((m) => `${m.number} ${m.customer} ${m.date}`.toLowerCase().includes(q))
  }, [quotations, query])

  const open = (m: DocMeta): void => navigate({ name: 'editor', id: m.id, from: 'quotations' })

  const remove = async (m: DocMeta): Promise<void> => {
    const ok = await confirm({
      title: 'Delete quotation',
      body: (
        <>
          Delete quotation <strong>{m.number || 'without a number'}</strong>
          {m.customer ? ` for ${m.customer}` : ''}? This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.docs.remove(m.id)
      toast({ message: 'Quotation deleted.' })
    } catch (err) {
      toast({ kind: 'error', message: errorText(err) })
    }
    void reload()
  }

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Quotations</h1>
          <p className="view-sub">
            {metas === null ? ' ' : quotations.length === 1 ? '1 quotation' : `${quotations.length} quotations`}
          </p>
        </div>
        <div className="view-actions">
          <label className="search">
            <IconSearch />
            <input
              type="search"
              placeholder="Search number or customer"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Button variant="primary" icon={<IconPlus />} onClick={() => newQuotation()}>
            New quotation
          </Button>
        </div>
      </header>

      {metas !== null && quotations.length === 0 && (
        <div className="empty">
          <div className="empty-icon">
            <IconDoc />
          </div>
          <h2>No quotations yet</h2>
          <p>Create one from a template. The number, date and total are filled in for you.</p>
          <Button variant="primary" icon={<IconPlus />} onClick={() => newQuotation()}>
            New quotation
          </Button>
        </div>
      )}

      {quotations.length > 0 && (
        <table className="list-table">
          <thead>
            <tr>
              <th style={{ width: '17%' }}>Number</th>
              <th>Customer</th>
              <th style={{ width: '13%' }}>Date</th>
              <th style={{ width: '15%' }} className="right">
                Total
              </th>
              <th style={{ width: '20%' }}>Last edited</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.id} tabIndex={0} onClick={() => open(m)} onKeyDown={(e) => e.key === 'Enter' && open(m)}>
                <td className="strong">{m.number || <span className="muted">No number</span>}</td>
                <td>{m.customer || <span className="muted">-</span>}</td>
                <td>{m.date}</td>
                <td className="right num">{fmtAmount(m.total, 'always')}</td>
                <td className="muted">{formatWhen(m.updatedAt)}</td>
                <td className="right">
                  <IconButton
                    label="More actions"
                    onClick={(e) => {
                      e.stopPropagation()
                      openMenu(e.currentTarget, [
                        { label: 'Open', onSelect: () => open(m) },
                        { label: 'Duplicate', onSelect: () => newQuotation({ source: m }) },
                        { separator: true },
                        { label: 'Delete', danger: true, onSelect: () => void remove(m) }
                      ])
                    }}
                  >
                    <IconMore />
                  </IconButton>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr className="no-hover">
                <td colSpan={6} className="muted center">
                  No quotations match "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
