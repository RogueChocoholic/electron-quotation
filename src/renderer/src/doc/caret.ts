/** Caret helpers for the plain-text editable regions on the page. */

/** Character offset of the caret inside `el`, or null when the caret is elsewhere. */
export function getCaretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!el.contains(range.endContainer)) return null
  const before = document.createRange()
  before.selectNodeContents(el)
  before.setEnd(range.endContainer, range.endOffset)
  return before.toString().length
}

/** Places the caret `offset` characters into `el` (clamped to the end). */
export function setCaretOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  let placed = false
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(node, remaining)
      placed = true
      break
    }
    remaining -= length
    node = walker.nextNode()
  }
  if (!placed) {
    range.selectNodeContents(el)
    range.collapse(false)
  } else {
    range.collapse(true)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

export interface FocusSnapshot {
  eid: string
  offset: number | null
}

/** Remembers which editable region has focus, so it can be restored after a re-layout remounts it. */
export function captureFocus(root: HTMLElement): FocusSnapshot | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null
  const eid = active.dataset.eid
  return eid ? { eid, offset: getCaretOffset(active) } : null
}

export function restoreFocus(root: HTMLElement, snap: FocusSnapshot): void {
  const el = root.querySelector<HTMLElement>(`[data-eid="${CSS.escape(snap.eid)}"]`)
  if (!el || document.activeElement === el) return
  el.focus()
  if (snap.offset !== null) setCaretOffset(el, snap.offset)
}

/**
 * Focuses an editable region once it has been rendered, with the caret at the end.
 *
 * The first attempt runs as a microtask: React has committed the change by then, so the
 * new field has focus before the next keystroke arrives and nothing typed is lost.
 */
export function focusEid(eid: string): void {
  let tries = 0
  const attempt = (): void => {
    const el = document.querySelector<HTMLElement>(`[data-eid="${CSS.escape(eid)}"]`)
    if (el) {
      el.focus()
      setCaretOffset(el, Number.MAX_SAFE_INTEGER)
    } else if (tries++ < 10) {
      requestAnimationFrame(attempt)
    }
  }
  queueMicrotask(attempt)
}
