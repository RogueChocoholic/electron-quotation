import type {
  Account,
  AmountDecimals,
  AssetId,
  Block,
  DocMeta,
  DocType,
  ItemRow,
  ItemsBlock,
  Numbering,
  QDoc,
  Settings
} from './types'

/**
 * The format of saved documents. Raise it by one in every release that adds something to
 * what a document stores: an older app would drop what it does not know when it saves, so
 * it refuses to open or overwrite a document with a higher number than its own.
 */
export const DATA_VERSION = 1

export const NEWER_DATA_MESSAGE =
  'This was last saved by a newer version of the app. Update the app on this PC to open or change it.'

/** True when the document was saved by a newer app than the one running. */
export const isNewerData = (doc: Pick<QDoc, 'dataVersion'>): boolean => doc.dataVersion > DATA_VERSION

/** Page geometry in mm (A4 portrait). */
export const PAGE_W = 210
export const PAGE_H = 297

/** Layout constants shared by the on-screen page, the PDF and the Word export. All in mm. */
export const HEADER_ICON = 4.9
export const HEADER_ICON_GAP = 0.9
export const HEADER_NAME_H = 10
export const HEADER_LINE_H = 6.78
export const HEADER_NAME_PT = 11
export const HEADER_LINE_PT = 8
export const FOOTER_PT = 9
export const LINE_HEIGHT = 1.45
export const CELL_PAD = 1.9
export const FIELD_ROW_H = 5.56
export const ITEM_QTY_W = 12.7
export const ITEM_AMOUNT_W = 28.95
export const LIST_INDENT = 12.7
export const LIST_HANGING = 6.35
export const ACCOUNT_LABEL_W = 25.4
export const CAPTION_PT = 9
/** Grey used for detail rows marked as secondary. */
export const MUTED_COLOR = '#767171'
export const FOOTER_COLOR = '#3b3838'

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Reads the first number out of free text such as "1,500.50", "Rs. 5,000" or "10 units". */
export function parseNum(s: string): number {
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?|-?\.\d+/)
  return m ? Number(m[0]) : NaN
}

const cents = (n: number): number => Math.round(n * 100) / 100

/**
 * Quantity x unit price. A blank quantity counts as 1; a blank or unreadable price counts as 0.
 * A row without a quantity cell adds its amount as typed, so it adds nothing when left empty.
 * The same goes for every row of a table that has no quantity column (`withQty` false).
 */
export function rowAmount(row: ItemRow, withQty = true): number {
  const price = parseNum(row.price)
  if (Number.isNaN(price)) return 0
  if (!withQty || !row.hasQty || row.qty.trim() === '') return price
  const qty = parseNum(row.qty)
  return Number.isNaN(qty) ? 0 : qty * price
}

export function itemsTotal(block: ItemsBlock): number {
  return cents(block.rows.reduce((acc, r) => acc + rowAmount(r, block.showQty), 0))
}

/** The amount already paid, when the table has its payment rows switched on. */
export function itemsPaid(block: ItemsBlock): number {
  if (!block.showPayment) return 0
  const paid = parseNum(block.paid)
  return Number.isNaN(paid) ? 0 : cents(paid)
}

export function itemsBalance(block: ItemsBlock): number {
  return cents(itemsTotal(block) - itemsPaid(block))
}

function sumItems(doc: QDoc, of: (block: ItemsBlock) => number): number {
  return cents(doc.blocks.reduce((acc, b) => (b.type === 'items' ? acc + of(b) : acc), 0))
}

export const docTotal = (doc: QDoc): number => sumItems(doc, itemsTotal)
export const docPaid = (doc: QDoc): number => sumItems(doc, itemsPaid)
export const docBalance = (doc: QDoc): number => sumItems(doc, itemsBalance)

/** 'auto' drops the decimals for whole amounts (390,000); 'always' keeps two (390,000.00). */
export function fmtAmount(n: number, decimals: AmountDecimals = 'auto'): string {
  const r = cents(n)
  const min = decimals === 'always' || !Number.isInteger(r) ? 2 : 0
  return r.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: 2 })
}

/** How a typed amount is shown when the cell is not being edited. */
export function fmtPrice(price: string, decimals: AmountDecimals = 'auto'): string {
  if (price.trim() === '') return ''
  const n = parseNum(price)
  return Number.isNaN(n) ? price : fmtAmount(n, decimals)
}

export const TOKENS = ['{total}', '{number}', '{date}', '{paid}', '{balance}'] as const

/** Replaces {total}, {number}, {date}, {paid} and {balance} in text with the document's live values. */
export function resolveTokens(text: string, doc: QDoc): string {
  if (!text.includes('{')) return text
  return text
    .replace(/\{total\}/gi, fmtAmount(docTotal(doc), 'always'))
    .replace(/\{paid\}/gi, fmtAmount(docPaid(doc), 'always'))
    .replace(/\{balance\}/gi, fmtAmount(docBalance(doc), 'always'))
    .replace(/\{number\}/gi, doc.number)
    .replace(/\{date\}/gi, doc.date)
}

export interface SummaryRow {
  key: 'total' | 'paid' | 'balance'
  label: string
  /** The amount as printed. The amount paid is typed by the user; the others are worked out. */
  value: string
}

/** The rows under the items of a table: the total, then the amount paid and the balance left. */
export function itemsSummary(b: ItemsBlock): SummaryRow[] {
  const rows: SummaryRow[] = []
  if (b.showTotal) rows.push({ key: 'total', label: b.totalLabel, value: fmtAmount(itemsTotal(b), b.decimals) })
  if (b.showPayment) {
    rows.push({ key: 'paid', label: b.paidLabel, value: fmtPrice(b.paid, b.decimals) })
    rows.push({ key: 'balance', label: b.balanceLabel, value: fmtAmount(itemsBalance(b), b.decimals) })
  }
  return rows
}

/** Column widths in mm of an items table: description, quantity (when it has one), amount. */
export function itemsWidths(b: ItemsBlock, contentW: number): number[] {
  const amount = Math.min(b.amountWidth, Math.max(10, contentW - 20 - (b.showQty ? ITEM_QTY_W : 0)))
  const rest = contentW - amount - (b.showQty ? ITEM_QTY_W : 0)
  return b.showQty ? [rest, ITEM_QTY_W, amount] : [rest, amount]
}

/** How each type of document is named in the app's own wording. */
export const DOC_WORDS: Record<DocType, { one: string; many: string; One: string; Many: string }> = {
  quotation: { one: 'quotation', many: 'quotations', One: 'Quotation', Many: 'Quotations' },
  invoice: { one: 'invoice', many: 'invoices', One: 'Invoice', Many: 'Invoices' }
}

/** The number series and remembered template for one type of document. */
export function numberingOf(settings: Settings, type: DocType): Numbering {
  return type === 'invoice' ? settings.invoiceNumbering : settings.numbering
}

export function lastTemplateOf(settings: Settings, type: DocType): string | null {
  return type === 'invoice' ? settings.lastInvoiceTemplateId : settings.lastTemplateId
}

export function withNumbering(
  settings: Settings,
  type: DocType,
  numbering: Numbering,
  lastTemplateId = lastTemplateOf(settings, type)
): Settings {
  return type === 'invoice'
    ? { ...settings, invoiceNumbering: numbering, lastInvoiceTemplateId: lastTemplateId }
    : { ...settings, numbering, lastTemplateId }
}

export function formatNumber(n: Numbering, year: number, seq: number): string {
  const yy = n.includeYear ? String(year % 100).padStart(2, '0') : ''
  const digits = Math.min(12, Math.max(1, Math.floor(n.digits) || 1))
  return `${n.prefix}${yy}${String(seq).padStart(digits, '0')}`
}

/** The number the next auto-numbered document would get. Does not reserve it. */
export function peekNumber(n: Numbering, now = new Date()): { year: number; seq: number; number: string } {
  const year = now.getFullYear()
  const restart = n.includeYear && n.yearlyReset && n.seqYear !== year
  const seq = restart ? 1 : Math.max(1, Math.floor(n.nextSeq) || 1)
  return { year, seq, number: formatNumber(n, year, seq) }
}

/** Marks a peeked number as used. */
export function consumeNumber(n: Numbering, year: number, seq: number): Numbering {
  return { ...n, nextSeq: seq + 1, seqYear: year }
}

export function todayStr(now = new Date()): string {
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${now.getFullYear()}`
}

export function customerOf(doc: QDoc): string {
  for (const b of doc.blocks) {
    if (b.type !== 'fields') continue
    const row = [...b.left, ...b.right].find((r) => r.bind === 'customer')
    if (row) return row.value.trim()
  }
  return ''
}

export function docMeta(doc: QDoc): DocMeta {
  return {
    id: doc.id,
    kind: doc.kind,
    docType: doc.docType,
    name: doc.name,
    number: doc.number,
    date: doc.date,
    customer: customerOf(doc),
    total: docTotal(doc),
    accountId: doc.accountId,
    usesAccount: doc.blocks.some((b) => b.type === 'account'),
    updatedAt: doc.updatedAt
  }
}

/** Every asset a document refers to, without duplicates. */
export function collectAssets(doc: QDoc): AssetId[] {
  const out = new Set<AssetId>()
  if (doc.header.background) out.add(doc.header.background)
  for (const l of doc.header.logos) out.add(l.asset)
  for (const l of doc.header.lines) if (l.icon) out.add(l.icon)
  for (const b of doc.blocks) if (b.type === 'images') for (const i of b.images) out.add(i.asset)
  return [...out]
}

/** Returns a copy of the document with every asset id passed through `map`. */
export function remapAssets(doc: QDoc, map: (id: AssetId) => AssetId): QDoc {
  return {
    ...doc,
    header: {
      ...doc.header,
      background: doc.header.background ? map(doc.header.background) : null,
      logos: doc.header.logos.map((l) => ({ ...l, asset: map(l.asset) })),
      lines: doc.header.lines.map((l) => ({ ...l, icon: l.icon ? map(l.icon) : null }))
    },
    blocks: doc.blocks.map(
      (b): Block =>
        b.type === 'images' ? { ...b, images: b.images.map((i) => ({ ...i, asset: map(i.asset) })) } : b
    )
  }
}

/** The bank detail lines printed for an account. Lines without a value are left out. */
export function accountRows(account: Account): [string, string][] {
  const rows: [string, string][] = [
    ['Account Holder:', account.holder],
    ['Account No:', account.number],
    ['Bank:', account.bank],
    ['Branch:', account.branch]
  ]
  return rows.filter(([, value]) => value.trim() !== '')
}

export function isLinkText(text: string): boolean {
  return /\S+@\S+\.\S+|^(https?:\/\/|www\.)/i.test(text.trim())
}

/** A file-system-safe name for exports. */
export function safeFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return cleaned || fallback
}

export function exportBaseName(doc: QDoc): string {
  if (doc.kind === 'template') return safeFileName(doc.name, 'Template')
  const customer = customerOf(doc)
  return safeFileName([doc.number, customer].filter(Boolean).join(' - '), DOC_WORDS[doc.docType].One)
}
