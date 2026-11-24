import { useCallback } from 'react'
import {
  ACCOUNT_LABEL_W,
  DOC_WORDS,
  MUTED_COLOR,
  PAGE_W,
  accountRows,
  fmtPrice,
  itemsSummary,
  itemsWidths,
  resolveTokens,
  uid,
  type SummaryRow
} from '@shared/calc'
import type {
  AccountBlock,
  Block,
  FieldBind,
  FieldRow,
  FieldsBlock,
  ImagesBlock,
  ItemRow,
  ItemsBlock,
  ListBlock,
  TextBlock
} from '@shared/types'
import { focusEid } from './caret'
import { useDoc, type MenuItem } from './context'
import { EditableText } from './EditableText'
import { moveItem, updateBlock } from './ops'
import type { Fragment } from './paginate'
import { assetUrl, cx, mm, pt } from './util'

/** Returns a function that applies a change to one block of the document. */
function useMutate<T extends Block>(id: string): (fn: (block: T) => T) => void {
  const { update } = useDoc()
  return useCallback((fn) => update((d) => updateBlock<T>(d, id, fn)), [update, id])
}

// --------------------------------------------------------------------- text

export function TextBlockView({ block: b }: { block: TextBlock }) {
  const { doc } = useDoc()
  const mutate = useMutate<TextBlock>(b.id)
  const style = {
    fontSize: pt(b.size),
    fontWeight: b.bold ? 700 : 400,
    color: b.color,
    textAlign: b.align,
    paddingLeft: b.indent > 0 ? mm(b.indent) : undefined
  }
  const text = (className?: string, textAlign = b.align) => (
    <EditableText
      eid={`${b.id}:text`}
      multiline
      className={className}
      value={b.text}
      display={resolveTokens(b.text, doc)}
      onChange={(value) => mutate((x) => ({ ...x, text: value }))}
      placeholder="Type text"
      style={className ? style : { textAlign }}
    />
  )
  if (b.lead === '') return text('text-block')
  // The bold lead-in and the text run on as one paragraph, so both are laid out inline.
  return (
    <div className="text-block has-lead" style={style}>
      <EditableText
        eid={`${b.id}:lead`}
        className="text-lead"
        value={b.lead}
        onChange={(lead) => mutate((x) => ({ ...x, lead }))}
      />{' '}
      {text()}
    </div>
  )
}

// ------------------------------------------------------------------- fields

type Side = 'left' | 'right'

export function FieldsBlockView({ block: b }: { block: FieldsBlock }) {
  const { doc, editable, update, openMenu } = useDoc()
  const mutate = useMutate<FieldsBlock>(b.id)
  const words = DOC_WORDS[doc.docType]

  const setRows = (side: Side, fn: (rows: FieldRow[]) => FieldRow[]): void =>
    mutate((x) => (side === 'left' ? { ...x, left: fn(x.left) } : { ...x, right: fn(x.right) }))
  const setRow = (side: Side, id: string, patch: Partial<FieldRow>): void =>
    setRows(side, (rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const addRow = (side: Side): void => {
    const row: FieldRow = { id: uid(), label: '', value: '', bold: false, muted: false, bind: null }
    setRows(side, (rows) => [...rows, row])
    focusEid(`${row.id}:l`)
  }

  const rowMenu = (side: Side, index: number, r: FieldRow, total: number): MenuItem[] => {
    const bindItem = (label: string, bind: FieldBind): MenuItem => ({
      label,
      checked: r.bind === bind,
      onSelect: () => setRow(side, r.id, { bind })
    })
    return [
      { label: 'Bold label', checked: r.bold, onSelect: () => setRow(side, r.id, { bold: !r.bold }) },
      { label: 'Grey text', checked: r.muted, onSelect: () => setRow(side, r.id, { muted: !r.muted }) },
      { separator: true },
      { heading: true, label: 'Value shows' },
      bindItem('Typed text', null),
      bindItem(`${words.One} number`, 'number'),
      bindItem(`${words.One} date`, 'date'),
      bindItem(`Customer name (listed in ${words.Many})`, 'customer'),
      { separator: true },
      { label: 'Move up', disabled: index === 0, onSelect: () => setRows(side, (rows) => moveItem(rows, index, -1)) },
      {
        label: 'Move down',
        disabled: index === total - 1,
        onSelect: () => setRows(side, (rows) => moveItem(rows, index, 1))
      },
      {
        label: 'Remove field',
        danger: true,
        onSelect: () => setRows(side, (rows) => rows.filter((x) => x.id !== r.id))
      }
    ]
  }

  const column = (side: Side) => {
    const rows = b[side]
    const labelWidth = side === 'left' ? b.leftLabelWidth : b.rightLabelWidth
    return (
      <div className="fields-col">
        {rows.map((r, index) => {
          const value = r.bind === 'number' ? doc.number : r.bind === 'date' ? doc.date : r.value
          const setValue = (v: string): void => {
            if (r.bind === 'number') update((d) => ({ ...d, number: v }))
            else if (r.bind === 'date') update((d) => ({ ...d, date: v }))
            else setRow(side, r.id, { value: v })
          }
          const hint =
            r.bind === 'number'
              ? doc.kind === 'template'
                ? `${words.One} number`
                : 'Required'
              : r.bind === 'date'
                ? 'Date'
                : ''
          return (
            <div className="field-row" key={r.id} style={r.muted ? { color: MUTED_COLOR } : undefined}>
              <div className="field-label" style={{ width: mm(labelWidth), fontWeight: r.bold ? 700 : 400 }}>
                <EditableText
                  eid={`${r.id}:l`}
                  value={r.label}
                  onChange={(label) => setRow(side, r.id, { label })}
                  placeholder="Label"
                />
              </div>
              <div className="field-value">
                <EditableText eid={`${r.id}:v`} value={value} onChange={setValue} placeholder={hint} />
              </div>
              {editable && (
                <button
                  type="button"
                  className="chrome row-menu"
                  title="Field options"
                  onClick={(e) => openMenu(e.currentTarget, rowMenu(side, index, r, rows.length))}
                >
                  &#8943;
                </button>
              )}
            </div>
          )
        })}
        {editable && (
          <button type="button" className="chrome ghost-add fields-add" onClick={() => addRow(side)}>
            + Add field
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="fields" style={{ fontSize: pt(b.size), gridTemplateColumns: `${b.split}mm minmax(0, 1fr)` }}>
      {column('left')}
      {column('right')}
    </div>
  )
}

// -------------------------------------------------------------------- items

export function ItemsBlockView({ block: b, frag }: { block: ItemsBlock; frag: Fragment }) {
  const { doc, editable, openMenu } = useDoc()
  const mutate = useMutate<ItemsBlock>(b.id)
  const [start, end] = frag.rows ?? [0, b.rows.length]
  const widths = itemsWidths(b, PAGE_W - doc.page.marginLeft - doc.page.marginRight)
  /** How many columns lie left of the amount column. */
  const labelSpan = widths.length - 1
  const summary = frag.showTotal !== false ? itemsSummary(b) : []
  const isLast = frag.showTotal !== false

  const setRow = (id: string, patch: Partial<ItemRow>): void =>
    mutate((x) => ({ ...x, rows: x.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  const removeRow = (id: string): void => mutate((x) => ({ ...x, rows: x.rows.filter((r) => r.id !== id) }))

  const addRowAfter = (afterId: string | null): void => {
    const row: ItemRow = { id: uid(), description: '', qty: '1', price: '', hasQty: true }
    mutate((x) => {
      const index = afterId ? x.rows.findIndex((r) => r.id === afterId) : x.rows.length - 1
      const rows = [...x.rows]
      rows.splice(index + 1, 0, row)
      return { ...x, rows }
    })
    focusEid(`${row.id}:d`)
  }

  const addButton = (className: string) => (
    <button type="button" className={cx('chrome ghost-add', className)} onClick={() => addRowAfter(null)}>
      + Add row
    </button>
  )

  const SUMMARY: Record<SummaryRow['key'], { eid: string; placeholder: string; set: (x: ItemsBlock, v: string) => ItemsBlock }> = {
    total: { eid: 'tl', placeholder: 'Total', set: (x, totalLabel) => ({ ...x, totalLabel }) },
    paid: { eid: 'pl', placeholder: 'Amount paid', set: (x, paidLabel) => ({ ...x, paidLabel }) },
    balance: { eid: 'bl', placeholder: 'Balance', set: (x, balanceLabel) => ({ ...x, balanceLabel }) }
  }

  return (
    <>
      <table className={cx('items', b.hideRowAmounts && 'amounts-hidden')} style={{ fontSize: pt(b.size) }}>
        <colgroup>
          <col />
          {b.showQty && <col style={{ width: mm(widths[1]) }} />}
          <col style={{ width: mm(widths[labelSpan]) }} />
        </colgroup>
        <thead>
          <tr data-items-head={b.id}>
            <th>
              <EditableText
                eid={`${b.id}:hd:${start}`}
                value={b.descriptionLabel}
                onChange={(descriptionLabel) => mutate((x) => ({ ...x, descriptionLabel }))}
                placeholder="Description"
              />
            </th>
            {b.showQty && (
              <th className="num">
                <EditableText
                  eid={`${b.id}:hq:${start}`}
                  value={b.qtyLabel}
                  onChange={(qtyLabel) => mutate((x) => ({ ...x, qtyLabel }))}
                  placeholder="Qty"
                />
              </th>
            )}
            <th className="num">
              <EditableText
                eid={`${b.id}:ha:${start}`}
                value={b.amountLabel}
                onChange={(amountLabel) => mutate((x) => ({ ...x, amountLabel }))}
                placeholder="Amount"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {b.rows.slice(start, end).map((r) => {
            const hasQty = b.showQty && r.hasQty
            return (
              <tr key={r.id} data-items-row={r.id}>
                {/* Without a quantity cell the description takes over the quantity column. */}
                <td colSpan={hasQty ? 1 : labelSpan}>
                  <EditableText
                    eid={`${r.id}:d`}
                    value={r.description}
                    onChange={(description) => setRow(r.id, { description })}
                    onEnter={() => addRowAfter(r.id)}
                    placeholder="Description"
                  />
                </td>
                {hasQty && (
                  <td className="num">
                    <EditableText
                      eid={`${r.id}:q`}
                      value={r.qty}
                      onChange={(qty) => setRow(r.id, { qty })}
                      placeholder="1"
                    />
                  </td>
                )}
                <td className="num amount" title={editable && b.hideRowAmounts ? 'Hidden in PDF and Word' : undefined}>
                  <EditableText
                    eid={`${r.id}:p`}
                    value={r.price}
                    display={!editable && b.hideRowAmounts ? '' : fmtPrice(r.price, b.decimals)}
                    onChange={(price) => setRow(r.id, { price })}
                    placeholder={hasQty ? '0' : ''}
                  />
                  {editable && (
                    <>
                      <button
                        type="button"
                        className="chrome row-del"
                        title="Remove row"
                        onClick={() => removeRow(r.id)}
                      >
                        &times;
                      </button>
                      {/* The only row option is about the quantity cell, so it goes when the column does. */}
                      {b.showQty && (
                        <button
                          type="button"
                          className="chrome row-opt"
                          title="Row options"
                          onClick={(e) =>
                            openMenu(e.currentTarget, [
                              {
                                label: 'No quantity cell',
                                checked: !r.hasQty,
                                onSelect: () => setRow(r.id, { hasQty: !r.hasQty })
                              },
                              { separator: true },
                              { label: 'Remove row', danger: true, onSelect: () => removeRow(r.id) }
                            ])
                          }
                        >
                          &#8943;
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            )
          })}
          {summary.map((row, i) => (
            <tr key={row.key} data-items-total={b.id} data-summary={row.key}>
              <td colSpan={labelSpan} className={cx('total-label', b.boxTotals && 'is-boxed', i > 0 && 'is-below')}>
                {editable && i === 0 && addButton('items-add')}
                <EditableText
                  eid={`${b.id}:${SUMMARY[row.key].eid}`}
                  value={row.label}
                  onChange={(label) => mutate((x) => SUMMARY[row.key].set(x, label))}
                  placeholder={SUMMARY[row.key].placeholder}
                />
              </td>
              <td className="num total-value">
                {row.key === 'paid' ? (
                  <EditableText
                    eid={`${b.id}:pv`}
                    value={b.paid}
                    display={row.value}
                    onChange={(paid) => mutate((x) => ({ ...x, paid }))}
                    placeholder="0"
                  />
                ) : (
                  row.value
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && isLast && summary.length === 0 && addButton('items-add-below')}
    </>
  )
}

// --------------------------------------------------------------------- list

export function ListBlockView({ block: b }: { block: ListBlock }) {
  const mutate = useMutate<ListBlock>(b.id)

  const addAfter = (index: number): void => {
    const item = { id: uid(), text: '' }
    mutate((x) => {
      const items = [...x.items]
      items.splice(index + 1, 0, item)
      return { ...x, items }
    })
    focusEid(`${item.id}:t`)
  }

  const removeAt = (index: number): void => {
    if (b.items.length <= 1) return
    const previous = b.items[index - 1] ?? b.items[index + 1]
    mutate((x) => ({ ...x, items: x.items.filter((_, i) => i !== index) }))
    if (previous) focusEid(`${previous.id}:t`)
  }

  return (
    <div className="list" style={{ fontSize: pt(b.size), color: b.color }}>
      {b.items.map((item, index) => (
        <div className="li" key={item.id}>
          <span className="li-bullet" aria-hidden="true" />
          <EditableText
            eid={`${item.id}:t`}
            value={item.text}
            onChange={(text) =>
              mutate((x) => ({ ...x, items: x.items.map((i) => (i.id === item.id ? { ...i, text } : i)) }))
            }
            onEnter={() => addAfter(index)}
            onBackspaceEmpty={() => removeAt(index)}
            placeholder="List item"
          />
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------- images

export function ImagesBlockView({ block: b }: { block: ImagesBlock }) {
  const { editable, pickImage } = useDoc()
  const mutate = useMutate<ImagesBlock>(b.id)
  const justify = b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center'

  const add = async (): Promise<void> => {
    const picked = await pickImage()
    if (!picked) return
    const image = { id: uid(), asset: picked.asset, ratio: picked.width / picked.height }
    mutate((x) => ({ ...x, images: [...x.images, image] }))
  }

  const replace = async (id: string): Promise<void> => {
    const picked = await pickImage()
    if (!picked) return
    mutate((x) => ({
      ...x,
      images: x.images.map((i) => (i.id === id ? { ...i, asset: picked.asset, ratio: picked.width / picked.height } : i))
    }))
  }

  return (
    <>
      <div className="images" style={{ justifyContent: justify, gap: mm(b.gap) }}>
        {b.images.map((img) => (
          <div className="img-item" key={img.id} style={{ height: mm(b.height), width: mm(b.height * img.ratio) }}>
            <img src={assetUrl(img.asset)} alt="" draggable={false} />
            {editable && (
              <div className="chrome img-tools">
                <button type="button" onClick={() => void replace(img.id)}>
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => mutate((x) => ({ ...x, images: x.images.filter((i) => i.id !== img.id) }))}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
        {editable && b.images.length === 0 && (
          <button type="button" className="chrome img-empty" style={{ height: mm(b.height) }} onClick={() => void add()}>
            + Add image
          </button>
        )}
      </div>
      {editable && b.images.length > 0 && (
        <button type="button" className="chrome ghost-add images-add" onClick={() => void add()}>
          + Add image
        </button>
      )}
      {b.showCaption && (
        <EditableText
          eid={`${b.id}:cap`}
          className="caption"
          value={b.caption}
          onChange={(caption) => mutate((x) => ({ ...x, caption }))}
          placeholder="Caption"
          style={{ textAlign: b.align }}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------ account

export function AccountBlockView({ block: b }: { block: AccountBlock }) {
  const { account, editable } = useDoc()
  const mutate = useMutate<AccountBlock>(b.id)
  return (
    <div className="account" style={{ fontSize: pt(b.size) }}>
      <EditableText
        eid={`${b.id}:h`}
        className="account-heading"
        value={b.heading}
        onChange={(heading) => mutate((x) => ({ ...x, heading }))}
        placeholder="Heading"
      />
      {account ? (
        <div title={editable ? 'Bank details are set in Settings and chosen in the panel on the right' : undefined}>
          {accountRows(account).map(([label, value]) => (
            <div className="acc-row" key={label}>
              <span className="acc-label" style={{ width: mm((ACCOUNT_LABEL_W * b.size) / 9) }}>
                {label}
              </span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      ) : (
        editable && <div className="chrome acc-missing">No bank account selected. Choose one in the panel on the right.</div>
      )}
    </div>
  )
}
