import type { Account, AssetId, Block, DocMeta, ItemRow, ItemsBlock, Numbering, QDoc } from './types'

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

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Reads the first number out of free text such as "1,500.50", "Rs. 5,000" or "10 units". */
export function parseNum(s: string): number {
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?|-?\.\d+/)
  return m ? Number(m[0]) : NaN
}

/** Quantity x unit price. A blank quantity counts as 1; a blank or unreadable price counts as 0. */
export function rowAmount(row: ItemRow): number {
  const price = parseNum(row.price)
  if (Number.isNaN(price)) return 0
  if (row.qty.trim() === '') return price
  const qty = parseNum(row.qty)
  return Number.isNaN(qty) ? 0 : qty * price
}

export function itemsTotal(block: ItemsBlock): number {
  const sum = block.rows.reduce((acc, r) => acc + rowAmount(r), 0)
  return Math.round(sum * 100) / 100
}

export function docTotal(doc: QDoc): number {
  const sum = doc.blocks.reduce((acc, b) => (b.type === 'items' ? acc + itemsTotal(b) : acc), 0)
  return Math.round(sum * 100) / 100
}

/** 'auto' drops the decimals for whole amounts (390,000); 'always' keeps two (390,000.00). */
export function fmtAmount(n: number, decimals: 'auto' | 'always' = 'auto'): string {
  const r = Math.round(n * 100) / 100
  const min = decimals === 'always' || !Number.isInteger(r) ? 2 : 0
  return r.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: 2 })
}

/** How a typed unit price is shown when the cell is not being edited. */
export function fmtPrice(price: string): string {
  if (price.trim() === '') return ''
  const n = parseNum(price)
  return Number.isNaN(n) ? price : fmtAmount(n)
}

export const TOKENS = ['{total}', '{number}', '{date}'] as const

/** Replaces {total}, {number} and {date} in text sections with the quotation's live values. */
export function resolveTokens(text: string, doc: QDoc): string {
  if (!text.includes('{')) return text
  return text
    .replace(/\{total\}/gi, fmtAmount(docTotal(doc), 'always'))
    .replace(/\{number\}/gi, doc.number)
    .replace(/\{date\}/gi, doc.date)
}

export function formatNumber(n: Numbering, year: number, seq: number): string {
  const yy = n.includeYear ? String(year % 100).padStart(2, '0') : ''
  const digits = Math.min(12, Math.max(1, Math.floor(n.digits) || 1))
  return `${n.prefix}${yy}${String(seq).padStart(digits, '0')}`
}

/** The number the next auto-numbered quotation would get. Does not reserve it. */
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
    name: doc.name,
    number: doc.number,
    date: doc.date,
    customer: customerOf(doc),
    total: docTotal(doc),
    accountId: doc.accountId,
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
  return safeFileName([doc.number, customer].filter(Boolean).join(' - '), 'Quotation')
}
