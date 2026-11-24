import type { Block, QDoc } from '@shared/types'
import { PX_PER_MM } from './util'

/**
 * Splits the document's blocks across pages.
 *
 * Blocks are kept whole, except the items table, which may break between rows (its
 * header row is repeated on the next page). Heights are measured from the rendered page,
 * so what is computed here is exactly what the editor and the PDF both show.
 */

export interface Fragment {
  /** Unique within the layout; used as the React key. */
  key: string
  blockId: string
  /** True for the first (or only) piece of a block; it carries the block's top spacing. */
  first: boolean
  /** Items tables only: the half-open row range shown in this piece. */
  rows?: [number, number]
  /** Items tables only: whether the rows under the items (total, paid, balance) are shown in this piece. */
  showTotal?: boolean
}

export type Layout = Fragment[][]

export interface ItemsMeasure {
  pad: number
  head: number
  rows: number[]
  total: number
}

export interface Measures {
  blocks: Map<string, number>
  items: Map<string, ItemsMeasure>
}

export const EMPTY_MEASURES: Measures = { blocks: new Map(), items: new Map() }

/** Reads rendered heights (in unzoomed CSS px) for every block of the document. */
export function measure(root: HTMLElement, zoom: number, doc: QDoc): Measures {
  const height = (el: Element | null): number => (el ? el.getBoundingClientRect().height / zoom : 0)
  const blocks = new Map<string, number>()
  const items = new Map<string, ItemsMeasure>()
  for (const b of doc.blocks) {
    if (b.type === 'items') {
      items.set(b.id, {
        pad: b.spaceBefore * PX_PER_MM,
        head: height(root.querySelector(`[data-items-head="${b.id}"]`)),
        rows: b.rows.map((r) => height(root.querySelector(`[data-items-row="${r.id}"]`))),
        // The total, amount paid and balance rows stay together under the last item.
        total: [...root.querySelectorAll(`[data-items-total="${b.id}"]`)].reduce((sum, el) => sum + height(el), 0)
      })
    } else {
      blocks.set(b.id, height(root.querySelector(`[data-block-id="${b.id}"]`)))
    }
  }
  return { blocks, items }
}

export function paginate(blocks: Block[], m: Measures, avail: number): Layout {
  const pages: Layout = [[]]
  let used = 0
  const page = (): Fragment[] => pages[pages.length - 1]
  const newPage = (): void => {
    pages.push([])
    used = 0
  }

  /** The least height a block needs on a page: all of it, or for a table its header and first row. */
  const minHeight = (b: Block | undefined): number => {
    if (!b) return 0
    if (b.type !== 'items') return m.blocks.get(b.id) ?? 0
    const im = m.items.get(b.id)
    return im ? im.pad + im.head + (im.rows[0] ?? im.total) : 0
  }

  for (const [index, b] of blocks.entries()) {
    if (b.type !== 'items') {
      const h = m.blocks.get(b.id) ?? 0
      // A bold line of text is a heading: it stays on the same page as what it introduces.
      const isHeading = b.type === 'text' && b.bold && !b.text.includes('\n')
      const needed = h + (isHeading ? minHeight(blocks[index + 1]) : 0)
      if (used > 0 && used + (needed <= avail ? needed : h) > avail) newPage()
      page().push({ key: b.id, blockId: b.id, first: true })
      used += h
      continue
    }

    const im = m.items.get(b.id)
    const count = b.rows.length
    const rowH = (i: number): number => im?.rows[i] ?? 0
    const whole = im ? im.pad + im.head + im.rows.reduce((a, r) => a + r, 0) + im.total : 0
    if (!im || used + whole <= avail) {
      // Fits on the current page (or has not been measured yet).
      page().push({ key: `${b.id}:0`, blockId: b.id, first: true, rows: [0, count], showTotal: true })
      used += whole
      continue
    }

    let start = 0
    let first = true
    while (true) {
      const base = (first ? im.pad : 0) + im.head
      const minimum = base + (start < count ? rowH(start) : im.total)
      if (used > 0 && used + minimum > avail) {
        newPage()
        continue
      }
      let end = start
      let h = base
      while (end < count && used + h + rowH(end) <= avail) h += rowH(end++)
      // Always make progress, even when a single row is taller than the page.
      if (end === start && start < count) h += rowH(end++)
      let last = end === count
      if (last && used + h + im.total > avail && end - start > 1) {
        // Keep the total with at least one row instead of stranding it alone on the next page.
        h -= rowH(--end)
        last = false
      }
      page().push({ key: `${b.id}:${start}`, blockId: b.id, first, rows: [start, end], showTotal: last })
      used += h + (last ? im.total : 0)
      if (last) break
      start = end
      first = false
      newPage()
    }
  }
  return pages
}

export function layoutSignature(layout: Layout): string {
  return layout
    .map((p) => p.map((f) => `${f.key}[${f.rows ? `${f.rows[0]}-${f.rows[1]}` : ''}${f.showTotal ? 'T' : ''}]`).join(','))
    .join('|')
}
