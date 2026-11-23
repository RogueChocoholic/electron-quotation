import { uid } from './calc'
import { defaultPage, defaultSettings } from './seed'
import type {
  Account,
  Align,
  AssetId,
  Block,
  FieldBind,
  FieldRow,
  HeaderConfig,
  HeaderTitle,
  PageConfig,
  QDoc,
  Settings
} from './types'

/**
 * Everything read from disk or from an imported file passes through here, so the rest of
 * the app can rely on documents and settings having the shape the types promise.
 */

export const ASSET_RE = /^[a-f0-9]{16,64}\.(png|jpg)$/
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

type Rec = Record<string, unknown>

const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d)
const num = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
const id = (v: unknown): string => (typeof v === 'string' && ID_RE.test(v) ? v : uid())
const asset = (v: unknown): AssetId | null => (typeof v === 'string' && ASSET_RE.test(v) ? v : null)
const color = (v: unknown, d = '#000000'): string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d
const oneOf = <T extends string>(v: unknown, options: readonly T[], d: T): T =>
  options.includes(v as T) ? (v as T) : d

const ALIGNS: readonly Align[] = ['left', 'center', 'right', 'justify']
const BINDS = ['number', 'date', 'customer'] as const

function fieldRow(v: unknown): FieldRow {
  const r = rec(v)
  const bind = BINDS.includes(r.bind as (typeof BINDS)[number]) ? (r.bind as FieldBind) : null
  return { id: id(r.id), label: str(r.label), value: str(r.value), bold: bool(r.bold), muted: bool(r.muted), bind }
}

function block(v: unknown): Block | null {
  const b = rec(v)
  const base = { id: id(b.id), spaceBefore: num(b.spaceBefore, 0, 0, 200) }
  const size = (d: number) => num(b.size, d, 4, 72)
  switch (b.type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        text: str(b.text),
        size: size(9),
        bold: bool(b.bold),
        color: color(b.color),
        align: oneOf(b.align, ALIGNS, 'left')
      }
    case 'fields':
      return {
        ...base,
        type: 'fields',
        left: arr(b.left).map(fieldRow),
        right: arr(b.right).map(fieldRow),
        split: num(b.split, 88.65, 20, 180),
        leftLabelWidth: num(b.leftLabelWidth, 29.7, 5, 120),
        rightLabelWidth: num(b.rightLabelWidth, 16.1, 5, 120),
        size: size(9)
      }
    case 'items':
      return {
        ...base,
        type: 'items',
        descriptionLabel: str(b.descriptionLabel, 'Description'),
        qtyLabel: str(b.qtyLabel, 'Qty'),
        amountLabel: str(b.amountLabel, 'Amount'),
        totalLabel: str(b.totalLabel, 'Total'),
        rows: arr(b.rows).map((x) => {
          const r = rec(x)
          return {
            id: id(r.id),
            description: str(r.description),
            qty: str(r.qty),
            price: str(r.price),
            // Rows saved before this option existed all have a quantity cell.
            hasQty: bool(r.hasQty, true)
          }
        }),
        hideRowAmounts: bool(b.hideRowAmounts),
        size: size(9)
      }
    case 'list':
      return {
        ...base,
        type: 'list',
        items: arr(b.items).map((x) => {
          const r = rec(x)
          return { id: id(r.id), text: str(r.text) }
        }),
        size: size(8),
        color: color(b.color)
      }
    case 'images':
      return {
        ...base,
        type: 'images',
        images: arr(b.images).flatMap((x) => {
          const r = rec(x)
          const a = asset(r.asset)
          return a ? [{ id: id(r.id), asset: a, ratio: num(r.ratio, 1, 0.05, 20) }] : []
        }),
        height: num(b.height, 41.5, 5, 250),
        gap: num(b.gap, 1, 0, 50),
        align: oneOf(b.align, ['left', 'center', 'right'] as const, 'center'),
        showCaption: bool(b.showCaption),
        caption: str(b.caption)
      }
    case 'account':
      return { ...base, type: 'account', heading: str(b.heading, 'Account Details:'), size: size(9) }
    default:
      return null
  }
}

function headerTitle(v: unknown): HeaderTitle | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const t = rec(v)
  return {
    text: str(t.text),
    x: num(t.x, 46, -100, 300),
    y: num(t.y, 12.7, -100, 400),
    size: num(t.size, 20, 4, 72),
    bold: bool(t.bold, true)
  }
}

function header(v: unknown): HeaderConfig {
  const h = rec(v)
  return {
    background: asset(h.background),
    title: headerTitle(h.title),
    logos: arr(h.logos).flatMap((x) => {
      const l = rec(x)
      const a = asset(l.asset)
      if (!a) return []
      return [
        {
          id: id(l.id),
          asset: a,
          x: num(l.x, 10, -100, 300),
          y: num(l.y, 10, -100, 400),
          width: num(l.width, 30, 2, 210),
          ratio: num(l.ratio, 1, 0.05, 20)
        }
      ]
    }),
    companyName: str(h.companyName),
    lines: arr(h.lines).map((x) => {
      const l = rec(x)
      return { id: id(l.id), icon: asset(l.icon), text: str(l.text) }
    }),
    detailsTop: num(h.detailsTop, 5.2, 0, 150),
    detailsRight: num(h.detailsRight, 5.35, 0, 150)
  }
}

function page(v: unknown): PageConfig {
  const p = rec(v)
  const d = defaultPage()
  return {
    marginTop: num(p.marginTop, d.marginTop, 0, 150),
    marginBottom: num(p.marginBottom, d.marginBottom, 0, 120),
    marginLeft: num(p.marginLeft, d.marginLeft, 0, 80),
    marginRight: num(p.marginRight, d.marginRight, 0, 80),
    footerText: str(p.footerText),
    footerBottom: num(p.footerBottom, d.footerBottom, 0, 100)
  }
}

/** Returns a well-formed document, or null when the input is not a document at all. */
export function sanitizeDoc(v: unknown): QDoc | null {
  const d = rec(v)
  if (!Array.isArray(d.blocks) || typeof d.header !== 'object' || d.header === null) return null
  const now = new Date().toISOString()
  return {
    schema: 1,
    id: id(d.id),
    kind: d.kind === 'template' ? 'template' : 'quotation',
    name: str(d.name),
    number: str(d.number),
    date: str(d.date),
    accountId: typeof d.accountId === 'string' && ID_RE.test(d.accountId) ? d.accountId : null,
    header: header(d.header),
    page: page(d.page),
    blocks: d.blocks.flatMap((b) => {
      const clean = block(b)
      return clean ? [clean] : []
    }),
    createdAt: str(d.createdAt, now),
    updatedAt: str(d.updatedAt, now)
  }
}

export function sanitizeSettings(v: unknown): Settings {
  const s = rec(v)
  const d = defaultSettings()
  const n = rec(s.numbering)
  const accounts: Account[] = arr(s.accounts).map((x) => {
    const a = rec(x)
    return {
      id: id(a.id),
      name: str(a.name),
      holder: str(a.holder),
      number: str(a.number),
      bank: str(a.bank),
      branch: str(a.branch)
    }
  })
  const has = (x: unknown): x is string => typeof x === 'string' && accounts.some((a) => a.id === x)
  return {
    schema: 1,
    accounts,
    defaultAccountId: has(s.defaultAccountId) ? s.defaultAccountId : (accounts[0]?.id ?? null),
    numbering: {
      auto: bool(n.auto, d.numbering.auto),
      prefix: str(n.prefix, d.numbering.prefix).slice(0, 24),
      includeYear: bool(n.includeYear, d.numbering.includeYear),
      yearlyReset: bool(n.yearlyReset, d.numbering.yearlyReset),
      digits: Math.round(num(n.digits, d.numbering.digits, 1, 12)),
      nextSeq: Math.round(num(n.nextSeq, 1, 1, 999999999)),
      seqYear: Math.round(num(n.seqYear, d.numbering.seqYear, 2000, 9999))
    },
    lastTemplateId: typeof s.lastTemplateId === 'string' && ID_RE.test(s.lastTemplateId) ? s.lastTemplateId : null,
    // Settings written before this field existed belong to the first built-in design.
    builtinDesign: Math.round(num(s.builtinDesign, 1, 1, 9999))
  }
}
