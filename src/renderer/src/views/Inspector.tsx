import type { ReactNode } from 'react'
import { DOC_WORDS, consumeNumber, numberingOf, peekNumber, todayStr, uid, withNumbering } from '@shared/calc'
import { TEXT_PRESETS, type TextPreset } from '@shared/seed'
import type {
  AccountBlock,
  Align,
  AssetId,
  Block,
  FieldsBlock,
  HeaderTitle,
  ImagesBlock,
  ItemsBlock,
  ListBlock,
  Logo,
  TextBlock
} from '@shared/types'
import { useApp } from '../app/context'
import { useDoc } from '../doc/context'
import { cloneBlock, insertBlockAfter, moveBlock, moveItem, patchHeader, patchPage, updateBlock } from '../doc/ops'
import { assetUrl, cx } from '../doc/util'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconImage,
  IconLock,
  IconMore,
  IconPlus,
  IconTrash
} from '../ui/icons'
import { Button, Field, IconButton, NumberInput, Segmented, Select, TextInput, Toggle } from '../ui/ui'

const NONE = '__none__'

const BLOCK_NAMES: Record<Block['type'], string> = {
  text: 'Text',
  fields: 'Details grid',
  items: 'Items table',
  list: 'Bullet list',
  images: 'Images',
  account: 'Bank account'
}

function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="insp-group">
      <div className="insp-group-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Thumb({ asset }: { asset: AssetId | null }) {
  return <span className="thumb">{asset ? <img src={assetUrl(asset)} alt="" /> : <IconImage />}</span>
}

const SWATCHES = ['#000000', '#404040', '#808080', '#a6a6a6']

function ColorPicker({ value, onChange }: { value: string; onChange(color: string): void }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          className={cx('swatch', value.toLowerCase() === c && 'is-active')}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
      <input type="color" title="Other colour" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function AccountSelect() {
  const { settings, navigate } = useApp()
  const { doc, update } = useDoc()
  const known = settings.accounts.some((a) => a.id === doc.accountId)
  return (
    <Field
      label="Bank account shown"
      hint={
        <>
          Details come from Settings and cannot be edited on the page.{' '}
          <button type="button" className="link" onClick={() => navigate({ name: 'settings' })}>
            Manage accounts
          </button>
        </>
      }
    >
      <Select
        value={known && doc.accountId ? doc.accountId : NONE}
        onChange={(v) => update((d) => ({ ...d, accountId: v === NONE ? null : v }))}
        options={[
          ...settings.accounts.map((a) => ({ value: a.id, label: a.name || a.bank || 'Unnamed account' })),
          { value: NONE, label: 'None' }
        ]}
      />
    </Field>
  )
}

// ---------------------------------------------------------- document panel

function NumberAndDate({ otherNumbers }: { otherNumbers: string[] }) {
  const { settings, saveSettings } = useApp()
  const { doc, update } = useDoc()
  const words = DOC_WORDS[doc.docType]
  const number = doc.number.trim()
  // Quotations and invoices each continue their own series of numbers.
  const numbering = numberingOf(settings, doc.docType)
  const next = peekNumber(numbering)
  const duplicate = number !== '' && otherNumbers.includes(number)

  const useNext = (): void => {
    update((d) => ({ ...d, number: next.number }))
    saveSettings(withNumbering(settings, doc.docType, consumeNumber(numbering, next.year, next.seq)))
  }

  return (
    <Group title={words.One}>
      <Field
        label={`${words.One} number`}
        hint={
          number === '' ? (
            <span className="text-danger">Required before the {words.one} can be exported.</span>
          ) : duplicate ? (
            <span className="text-warn">Another {words.one} already uses this number.</span>
          ) : undefined
        }
      >
        <TextInput
          id="insp-number"
          value={doc.number}
          invalid={number === ''}
          onChange={(v) => update((d) => ({ ...d, number: v }))}
        />
      </Field>
      {number === '' && numbering.auto && (
        <Button small onClick={useNext}>
          Use next number ({next.number})
        </Button>
      )}
      <Field label="Date">
        <div className="inline">
          <TextInput value={doc.date} onChange={(v) => update((d) => ({ ...d, date: v }))} />
          <Button small onClick={() => update((d) => ({ ...d, date: todayStr() }))}>
            Today
          </Button>
        </div>
      </Field>
    </Group>
  )
}

function LogoEditor({ logo }: { logo: Logo }) {
  const { update, pickImage } = useDoc()
  const set = (patch: Partial<Logo>): void =>
    update((d) => patchHeader(d, { logos: d.header.logos.map((l) => (l.id === logo.id ? { ...l, ...patch } : l)) }))

  const replace = async (): Promise<void> => {
    const picked = await pickImage()
    if (picked) set({ asset: picked.asset, ratio: picked.height / picked.width })
  }

  return (
    <div className="insp-item">
      <div className="inline">
        <Thumb asset={logo.asset} />
        <Button small onClick={() => void replace()}>
          Replace
        </Button>
        <span className="spacer" />
        <IconButton
          label="Remove logo"
          onClick={() => update((d) => patchHeader(d, { logos: d.header.logos.filter((l) => l.id !== logo.id) }))}
        >
          <IconTrash />
        </IconButton>
      </div>
      <div className="grid-3">
        <Field label="Width">
          <NumberInput value={logo.width} min={2} max={210} step={0.5} suffix="mm" onChange={(width) => set({ width })} />
        </Field>
        <Field label="From left">
          <NumberInput value={logo.x} min={-100} max={300} step={0.5} suffix="mm" onChange={(x) => set({ x })} />
        </Field>
        <Field label="From top">
          <NumberInput value={logo.y} min={-100} max={400} step={0.5} suffix="mm" onChange={(y) => set({ y })} />
        </Field>
      </div>
    </div>
  )
}

function HeaderPanel() {
  const { doc, update, pickImage, openMenu } = useDoc()
  const h = doc.header

  const setBackground = async (): Promise<void> => {
    const picked = await pickImage()
    if (picked) update((d) => patchHeader(d, { background: picked.asset }))
  }

  const addLogo = async (): Promise<void> => {
    const picked = await pickImage()
    if (!picked) return
    const logo: Logo = { id: uid(), asset: picked.asset, x: 15, y: 10, width: 30, ratio: picked.height / picked.width }
    update((d) => patchHeader(d, { logos: [...d.header.logos, logo] }))
  }

  const setTitle = (patch: Partial<HeaderTitle>): void =>
    update((d) => (d.header.title ? patchHeader(d, { title: { ...d.header.title, ...patch } }) : d))

  const setLine = (id: string, patch: { text?: string; icon?: AssetId | null }): void =>
    update((d) => patchHeader(d, { lines: d.header.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))

  const pickIcon = async (id: string): Promise<void> => {
    const picked = await pickImage()
    if (picked) setLine(id, { icon: picked.asset })
  }

  return (
    <>
      <Group title="Page background">
        <div className="inline">
          <Thumb asset={h.background} />
          <Button small onClick={() => void setBackground()}>
            {h.background ? 'Replace' : 'Add image'}
          </Button>
          {h.background && (
            <Button small variant="ghost" onClick={() => update((d) => patchHeader(d, { background: null }))}>
              Remove
            </Button>
          )}
        </div>
        <p className="insp-hint">A full-page image drawn behind the content of every page.</p>
      </Group>

      <Group
        title="Logos"
        action={
          <IconButton label="Add logo" onClick={() => void addLogo()}>
            <IconPlus />
          </IconButton>
        }
      >
        {h.logos.length === 0 && <p className="insp-hint">No logo. Use + to add one.</p>}
        {h.logos.map((l) => (
          <LogoEditor key={l.id} logo={l} />
        ))}
        {h.logos.length > 0 && <p className="insp-hint">Logos can also be dragged and resized on the page.</p>}
      </Group>

      <Group
        title="Header title"
        action={
          h.title ? (
            <IconButton label="Remove title" onClick={() => update((d) => patchHeader(d, { title: null }))}>
              <IconTrash />
            </IconButton>
          ) : (
            <IconButton
              label="Add title"
              onClick={() =>
                update((d) =>
                  patchHeader(d, { title: { text: 'QUOTATION', x: 46.1, y: 12.9, size: 20, bold: true } })
                )
              }
            >
              <IconPlus />
            </IconButton>
          )
        }
      >
        {h.title ? (
          <>
            <Field label="Text">
              <TextInput value={h.title.text} onChange={(text) => setTitle({ text })} />
            </Field>
            <div className="grid-3">
              <Field label="Size">
                <NumberInput
                  value={h.title.size}
                  min={4}
                  max={72}
                  step={0.5}
                  suffix="pt"
                  onChange={(size) => setTitle({ size })}
                />
              </Field>
              <Field label="From left">
                <NumberInput
                  value={h.title.x}
                  min={-100}
                  max={300}
                  step={0.5}
                  suffix="mm"
                  onChange={(x) => setTitle({ x })}
                />
              </Field>
              <Field label="From top">
                <NumberInput
                  value={h.title.y}
                  min={-100}
                  max={400}
                  step={0.5}
                  suffix="mm"
                  onChange={(y) => setTitle({ y })}
                />
              </Field>
            </div>
            <Toggle checked={h.title.bold} onChange={(bold) => setTitle({ bold })} label="Bold" />
          </>
        ) : (
          <p className="insp-hint">No title. Use + to add text beside the logo, shown on every page.</p>
        )}
      </Group>

      <Group
        title="Header details"
        action={
          <IconButton
            label="Add line"
            onClick={() =>
              update((d) => patchHeader(d, { lines: [...d.header.lines, { id: uid(), icon: null, text: '' }] }))
            }
          >
            <IconPlus />
          </IconButton>
        }
      >
        <Field label="Company name">
          <TextInput value={h.companyName} onChange={(companyName) => update((d) => patchHeader(d, { companyName }))} />
        </Field>
        {h.lines.map((line, index) => (
          <div className="insp-line" key={line.id}>
            <button type="button" className="thumb-btn" title="Change icon" onClick={() => void pickIcon(line.id)}>
              <Thumb asset={line.icon} />
            </button>
            <TextInput
              value={line.text}
              placeholder="Address, email, phone..."
              onChange={(text) => setLine(line.id, { text })}
            />
            <IconButton
              label="Line options"
              onClick={(e) =>
                openMenu(e.currentTarget, [
                  { label: 'Remove icon', disabled: !line.icon, onSelect: () => setLine(line.id, { icon: null }) },
                  {
                    label: 'Move up',
                    disabled: index === 0,
                    onSelect: () => update((d) => patchHeader(d, { lines: moveItem(d.header.lines, index, -1) }))
                  },
                  {
                    label: 'Move down',
                    disabled: index === h.lines.length - 1,
                    onSelect: () => update((d) => patchHeader(d, { lines: moveItem(d.header.lines, index, 1) }))
                  },
                  { separator: true },
                  {
                    label: 'Delete line',
                    danger: true,
                    onSelect: () =>
                      update((d) => patchHeader(d, { lines: d.header.lines.filter((l) => l.id !== line.id) }))
                  }
                ])
              }
            >
              <IconMore />
            </IconButton>
          </div>
        ))}
        <div className="grid-2">
          <Field label="From top">
            <NumberInput
              value={h.detailsTop}
              min={0}
              max={150}
              step={0.5}
              suffix="mm"
              onChange={(detailsTop) => update((d) => patchHeader(d, { detailsTop }))}
            />
          </Field>
          <Field label="From right">
            <NumberInput
              value={h.detailsRight}
              min={0}
              max={150}
              step={0.5}
              suffix="mm"
              onChange={(detailsRight) => update((d) => patchHeader(d, { detailsRight }))}
            />
          </Field>
        </div>
      </Group>
    </>
  )
}

function PagePanel() {
  const { doc, update } = useDoc()
  const p = doc.page
  const margin = (label: string, key: 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight', max: number) => (
    <Field label={label}>
      <NumberInput
        value={p[key]}
        min={0}
        max={max}
        step={0.5}
        suffix="mm"
        onChange={(v) => update((d) => patchPage(d, { ...d.page, [key]: v }))}
      />
    </Field>
  )
  return (
    <Group title="Page margins">
      <div className="grid-2">
        {margin('Top', 'marginTop', 150)}
        {margin('Bottom', 'marginBottom', 120)}
        {margin('Left', 'marginLeft', 80)}
        {margin('Right', 'marginRight', 80)}
      </div>
      <Field label="Footer text from bottom">
        <NumberInput
          value={p.footerBottom}
          min={0}
          max={100}
          step={0.5}
          suffix="mm"
          onChange={(footerBottom) => update((d) => patchPage(d, { footerBottom }))}
        />
      </Field>
      <p className="insp-hint">The footer text itself is edited on the page.</p>
    </Group>
  )
}

function DocumentPanel({ otherNumbers }: { otherNumbers: string[] }) {
  const { doc, update } = useDoc()
  return (
    <>
      {doc.kind === 'document' ? (
        <NumberAndDate otherNumbers={otherNumbers} />
      ) : (
        <Group title="Template">
          <Field label="Template name">
            <TextInput value={doc.name} onChange={(name) => update((d) => ({ ...d, name }))} />
          </Field>
        </Group>
      )}
      <Group title="Bank account">
        <AccountSelect />
        {!doc.blocks.some((b) => b.type === 'account') && (
          <p className="insp-hint">This page has no bank account section. Add one with the + button beside a section.</p>
        )}
      </Group>
      <HeaderPanel />
      <PagePanel />
    </>
  )
}

// ------------------------------------------------------------ section panel

function SizeField({ value, onChange }: { value: number; onChange(size: number): void }) {
  return (
    <Field label="Text size">
      <NumberInput value={value} min={4} max={72} step={0.5} suffix="pt" onChange={onChange} />
    </Field>
  )
}

function TextPanel({ block: b, set }: { block: TextBlock; set(patch: Partial<TextBlock>): void }) {
  const { doc } = useDoc()
  const one = DOC_WORDS[doc.docType].one
  const presets: { key: TextPreset; label: string }[] = [
    { key: 'title', label: 'Title' },
    { key: 'heading', label: 'Heading' },
    { key: 'body', label: 'Body' },
    { key: 'note', label: 'Note' }
  ]
  return (
    <>
      <Field label="Style">
        <div className="chips">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              className="chip"
              onClick={() => {
                const { size, bold, color } = TEXT_PRESETS[p.key]
                set({ size, bold, color })
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <SizeField value={b.size} onChange={(size) => set({ size })} />
        <Field label="Alignment">
          <Segmented<Align>
            value={b.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: <IconAlignLeft />, title: 'Left' },
              { value: 'center', label: <IconAlignCenter />, title: 'Centre' },
              { value: 'right', label: <IconAlignRight />, title: 'Right' },
              { value: 'justify', label: <IconAlignJustify />, title: 'Justify' }
            ]}
          />
        </Field>
      </div>
      <Toggle checked={b.bold} onChange={(bold) => set({ bold })} label="Bold" />
      <Field label="Colour">
        <ColorPicker value={b.color} onChange={(color) => set({ color })} />
      </Field>
      <Field label="Bold words in front" hint='Start the text with a bold label, such as "Specification:".'>
        <TextInput value={b.lead} onChange={(lead) => set({ lead })} />
      </Field>
      <Field label="Set in from the left">
        <NumberInput value={b.indent} min={0} max={150} step={0.5} suffix="mm" onChange={(indent) => set({ indent })} />
      </Field>
      <p className="insp-hint">
        Type <code>{'{total}'}</code> to show the {one} total, <code>{'{number}'}</code> for its number and{' '}
        <code>{'{date}'}</code> for its date. Where the table has payment rows, <code>{'{paid}'}</code> is the amount
        paid and <code>{'{balance}'}</code> what is left. They are filled in when you click away.
      </p>
    </>
  )
}

function FieldsPanel({ block: b, set }: { block: FieldsBlock; set(patch: Partial<FieldsBlock>): void }) {
  const { doc } = useDoc()
  return (
    <>
      <SizeField value={b.size} onChange={(size) => set({ size })} />
      <Field label="Left column width">
        <NumberInput value={b.split} min={20} max={180} step={1} suffix="mm" onChange={(split) => set({ split })} />
      </Field>
      <div className="grid-2">
        <Field label="Left labels">
          <NumberInput
            value={b.leftLabelWidth}
            min={5}
            max={120}
            step={1}
            suffix="mm"
            onChange={(leftLabelWidth) => set({ leftLabelWidth })}
          />
        </Field>
        <Field label="Right labels">
          <NumberInput
            value={b.rightLabelWidth}
            min={5}
            max={120}
            step={1}
            suffix="mm"
            onChange={(rightLabelWidth) => set({ rightLabelWidth })}
          />
        </Field>
      </div>
      <p className="insp-hint">
        Point at a row and use its &#8943; button to make the label bold, print the row in grey, link the value to
        the {DOC_WORDS[doc.docType].one} number or date, reorder it, or remove it.
      </p>
    </>
  )
}

function ItemsPanel({ block: b, set }: { block: ItemsBlock; set(patch: Partial<ItemsBlock>): void }) {
  return (
    <>
      <div className="grid-2">
        <SizeField value={b.size} onChange={(size) => set({ size })} />
        <Field label="Amount column">
          <NumberInput
            value={b.amountWidth}
            min={15}
            max={90}
            step={1}
            suffix="mm"
            onChange={(amountWidth) => set({ amountWidth })}
          />
        </Field>
      </div>
      <Toggle
        checked={b.showQty}
        onChange={(showQty) => set({ showQty })}
        label="Quantity column"
        hint={b.showQty ? undefined : 'Off: every amount counts as it is typed.'}
      />
      <Toggle
        checked={b.decimals === 'always'}
        onChange={(on) => set({ decimals: on ? 'always' : 'auto' })}
        label="Always show cents"
        hint={b.decimals === 'always' ? '185,000.00' : '185,000 - cents show only when there are any.'}
      />
      <Toggle
        checked={b.hideRowAmounts}
        onChange={(hideRowAmounts) => set({ hideRowAmounts })}
        label="Hide row amounts in PDF and Word"
        hint="Amounts stay editable here and still count towards the total."
      />
      <Toggle checked={b.showTotal} onChange={(showTotal) => set({ showTotal })} label="Total row" />
      <Toggle
        checked={b.showPayment}
        onChange={(showPayment) => set({ showPayment })}
        label="Amount paid and balance rows"
        hint={b.showPayment ? 'Type the amount paid in the table. Balance = total - amount paid.' : undefined}
      />
      {(b.showTotal || b.showPayment) && (
        <Toggle
          checked={b.boxTotals}
          onChange={(boxTotals) => set({ boxTotals })}
          label="Borders around their labels"
          hint="Draws the rows under the items as part of the table."
        />
      )}
      {b.showQty ? (
        <>
          <p className="insp-hint">
            Total = the sum of Qty &times; Amount for every row. A row with no Qty counts as 1. Press Enter in a
            description to add a row below it.
          </p>
          <p className="insp-hint">
            For a row that needs no quantity, point at it and use its &#8943; button to remove the quantity cell. Its
            amount can stay empty; if one is typed, it is added to the total as it is.
          </p>
        </>
      ) : (
        <p className="insp-hint">
          Total = the sum of the amounts. An amount can stay empty. Press Enter in a description to add a row below
          it.
        </p>
      )}
    </>
  )
}

function ListPanel({ block: b, set }: { block: ListBlock; set(patch: Partial<ListBlock>): void }) {
  return (
    <>
      <SizeField value={b.size} onChange={(size) => set({ size })} />
      <Field label="Colour">
        <ColorPicker value={b.color} onChange={(color) => set({ color })} />
      </Field>
      <p className="insp-hint">Enter adds a bullet. Backspace in an empty bullet removes it.</p>
    </>
  )
}

function ImagesPanel({ block: b, set }: { block: ImagesBlock; set(patch: Partial<ImagesBlock>): void }) {
  const { pickImage } = useDoc()

  const add = async (): Promise<void> => {
    const picked = await pickImage()
    if (picked) set({ images: [...b.images, { id: uid(), asset: picked.asset, ratio: picked.width / picked.height }] })
  }
  const replace = async (id: string): Promise<void> => {
    const picked = await pickImage()
    if (!picked) return
    set({
      images: b.images.map((i) => (i.id === id ? { ...i, asset: picked.asset, ratio: picked.width / picked.height } : i))
    })
  }

  return (
    <>
      <div className="grid-2">
        <Field label="Image height">
          <NumberInput value={b.height} min={5} max={250} step={1} suffix="mm" onChange={(height) => set({ height })} />
        </Field>
        <Field label="Gap">
          <NumberInput value={b.gap} min={0} max={50} step={0.5} suffix="mm" onChange={(gap) => set({ gap })} />
        </Field>
      </div>
      <Field label="Alignment">
        <Segmented<ImagesBlock['align']>
          value={b.align}
          onChange={(align) => set({ align })}
          options={[
            { value: 'left', label: <IconAlignLeft />, title: 'Left' },
            { value: 'center', label: <IconAlignCenter />, title: 'Centre' },
            { value: 'right', label: <IconAlignRight />, title: 'Right' }
          ]}
        />
      </Field>
      <Toggle checked={b.showCaption} onChange={(showCaption) => set({ showCaption })} label="Show a caption below" />
      <div className="insp-list">
        {b.images.map((img, index) => (
          <div className="inline" key={img.id}>
            <Thumb asset={img.asset} />
            <Button small onClick={() => void replace(img.id)}>
              Replace
            </Button>
            <span className="spacer" />
            <IconButton
              label="Move earlier"
              disabled={index === 0}
              onClick={() => set({ images: moveItem(b.images, index, -1) })}
            >
              <IconArrowUp />
            </IconButton>
            <IconButton
              label="Move later"
              disabled={index === b.images.length - 1}
              onClick={() => set({ images: moveItem(b.images, index, 1) })}
            >
              <IconArrowDown />
            </IconButton>
            <IconButton label="Remove image" onClick={() => set({ images: b.images.filter((i) => i.id !== img.id) })}>
              <IconTrash />
            </IconButton>
          </div>
        ))}
      </div>
      <Button small icon={<IconPlus />} onClick={() => void add()}>
        Add image
      </Button>
    </>
  )
}

function AccountPanel({ block: b, set }: { block: AccountBlock; set(patch: Partial<AccountBlock>): void }) {
  return (
    <>
      <SizeField value={b.size} onChange={(size) => set({ size })} />
      <AccountSelect />
      <p className="insp-hint with-icon">
        <IconLock />
        <span>Only the heading is editable on the page.</span>
      </p>
    </>
  )
}

function SectionPanel({ block }: { block: Block }) {
  const { doc, update, removeBlock, select } = useDoc()
  const index = doc.blocks.findIndex((b) => b.id === block.id)
  const set = <T extends Block>(patch: Partial<T>): void =>
    update((d) => updateBlock<T>(d, block.id, (b) => ({ ...b, ...patch })))
  const duplicate = (): void => {
    const copy = cloneBlock(block)
    update((d) => insertBlockAfter(d, block.id, copy))
    select(copy.id)
  }

  let body: ReactNode
  switch (block.type) {
    case 'text':
      body = <TextPanel block={block} set={set} />
      break
    case 'fields':
      body = <FieldsPanel block={block} set={set} />
      break
    case 'items':
      body = <ItemsPanel block={block} set={set} />
      break
    case 'list':
      body = <ListPanel block={block} set={set} />
      break
    case 'images':
      body = <ImagesPanel block={block} set={set} />
      break
    case 'account':
      body = <AccountPanel block={block} set={set} />
      break
  }

  return (
    <Group
      title={BLOCK_NAMES[block.type]}
      action={
        <div className="inline tight">
          <IconButton label="Move up" disabled={index <= 0} onClick={() => update((d) => moveBlock(d, block.id, -1))}>
            <IconArrowUp />
          </IconButton>
          <IconButton
            label="Move down"
            disabled={index >= doc.blocks.length - 1}
            onClick={() => update((d) => moveBlock(d, block.id, 1))}
          >
            <IconArrowDown />
          </IconButton>
          <IconButton label="Duplicate" onClick={duplicate}>
            <IconCopy />
          </IconButton>
          <IconButton
            label="Delete section"
            onClick={() => {
              select(null)
              removeBlock(block.id)
            }}
          >
            <IconTrash />
          </IconButton>
        </div>
      }
    >
      <Field label="Space above">
        <NumberInput
          value={block.spaceBefore}
          min={0}
          max={200}
          step={0.5}
          suffix="mm"
          onChange={(spaceBefore) => set({ spaceBefore })}
        />
      </Field>
      {body}
    </Group>
  )
}

// ---------------------------------------------------------------- inspector

export type InspectorTab = 'document' | 'section'

export function Inspector({
  tab,
  onTab,
  otherNumbers
}: {
  tab: InspectorTab
  onTab(tab: InspectorTab): void
  otherNumbers: string[]
}) {
  const { doc, selectedId } = useDoc()
  const block = doc.blocks.find((b) => b.id === selectedId) ?? null
  return (
    <aside className="inspector">
      <div className="insp-tabs" role="tablist">
        <button type="button" className={cx(tab === 'document' && 'is-active')} onClick={() => onTab('document')}>
          {doc.kind === 'template' ? 'Template' : DOC_WORDS[doc.docType].One}
        </button>
        <button type="button" className={cx(tab === 'section' && 'is-active')} onClick={() => onTab('section')}>
          Section
        </button>
      </div>
      <div className="insp-body">
        {tab === 'document' ? (
          <DocumentPanel otherNumbers={otherNumbers} />
        ) : block ? (
          <SectionPanel key={block.id} block={block} />
        ) : (
          <div className="insp-empty">Click a section on the page to change its settings.</div>
        )}
      </div>
    </aside>
  )
}
