import { newBlock, type TextPreset } from '@shared/seed'
import type { BlockType } from '@shared/types'
import { focusEid } from './caret'
import type { DocContextValue, MenuItem } from './context'
import { cloneBlock, insertBlockAfter, moveBlock } from './ops'

const SECTIONS: { label: string; type: BlockType; preset?: TextPreset }[] = [
  { label: 'Text', type: 'text', preset: 'body' },
  { label: 'Heading', type: 'text', preset: 'heading' },
  { label: 'Note (grey text)', type: 'text', preset: 'note' },
  { label: 'Bullet list', type: 'list' },
  { label: 'Images', type: 'images' },
  { label: 'Items table', type: 'items' },
  { label: 'Details grid', type: 'fields' },
  { label: 'Bank account', type: 'account' }
]

/** Menu entries that add a new section below `afterId` (or at the top when null). */
export function addSectionItems(ctx: DocContextValue, afterId: string | null): MenuItem[] {
  return [
    { heading: true, label: 'Add section below' },
    ...SECTIONS.map(
      (s): MenuItem => ({
        label: s.label,
        onSelect: () => {
          const block = newBlock(s.type, s.preset)
          ctx.update((d) => insertBlockAfter(d, afterId, block))
          ctx.select(block.id)
          if (block.type === 'text') focusEid(`${block.id}:text`)
          if (block.type === 'list') focusEid(`${block.items[0].id}:t`)
        }
      })
    )
  ]
}

export function blockActionItems(ctx: DocContextValue, id: string): MenuItem[] {
  const index = ctx.doc.blocks.findIndex((b) => b.id === id)
  return [
    { label: 'Move up', disabled: index <= 0, onSelect: () => ctx.update((d) => moveBlock(d, id, -1)) },
    {
      label: 'Move down',
      disabled: index < 0 || index >= ctx.doc.blocks.length - 1,
      onSelect: () => ctx.update((d) => moveBlock(d, id, 1))
    },
    {
      label: 'Duplicate',
      onSelect: () => {
        const source = ctx.doc.blocks.find((b) => b.id === id)
        if (!source) return
        const copy = cloneBlock(source)
        ctx.update((d) => insertBlockAfter(d, id, copy))
        ctx.select(copy.id)
      }
    },
    { separator: true },
    { label: 'Delete section', danger: true, onSelect: () => ctx.removeBlock(id) }
  ]
}
