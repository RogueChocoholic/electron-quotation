import { uid } from '@shared/calc'
import type { Block, HeaderConfig, PageConfig, QDoc } from '@shared/types'

/** Pure helpers that return an updated copy of a document. */

export function updateBlock<T extends Block>(doc: QDoc, id: string, fn: (block: T) => T): QDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === id ? fn(b as T) : b)) }
}

export function patchHeader(doc: QDoc, patch: Partial<HeaderConfig>): QDoc {
  return { ...doc, header: { ...doc.header, ...patch } }
}

export function patchPage(doc: QDoc, patch: Partial<PageConfig>): QDoc {
  return { ...doc, page: { ...doc.page, ...patch } }
}

/** Inserts after the block with id `afterId`, or at the top when `afterId` is null. */
export function insertBlockAfter(doc: QDoc, afterId: string | null, block: Block): QDoc {
  const index = afterId ? doc.blocks.findIndex((b) => b.id === afterId) : -1
  const blocks = [...doc.blocks]
  blocks.splice(index + 1, 0, block)
  return { ...doc, blocks }
}

export function insertBlockAt(doc: QDoc, index: number, block: Block): QDoc {
  const blocks = [...doc.blocks]
  blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block)
  return { ...doc, blocks }
}

export function removeBlock(doc: QDoc, id: string): QDoc {
  return { ...doc, blocks: doc.blocks.filter((b) => b.id !== id) }
}

export function moveBlock(doc: QDoc, id: string, dir: -1 | 1): QDoc {
  const from = doc.blocks.findIndex((b) => b.id === id)
  const to = from + dir
  if (from < 0 || to < 0 || to >= doc.blocks.length) return doc
  const blocks = [...doc.blocks]
  const [moved] = blocks.splice(from, 1)
  blocks.splice(to, 0, moved)
  return { ...doc, blocks }
}

/** Gives a copied block (and everything inside it) fresh ids. */
export function cloneBlock(block: Block): Block {
  const copy = structuredClone(block)
  copy.id = uid()
  switch (copy.type) {
    case 'fields':
      for (const r of [...copy.left, ...copy.right]) r.id = uid()
      break
    case 'items':
      for (const r of copy.rows) r.id = uid()
      break
    case 'list':
      for (const i of copy.items) i.id = uid()
      break
    case 'images':
      for (const i of copy.images) i.id = uid()
      break
  }
  return copy
}

export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir
  if (index < 0 || to < 0 || to >= list.length) return list
  const out = [...list]
  const [moved] = out.splice(index, 1)
  out.splice(to, 0, moved)
  return out
}
