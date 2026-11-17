import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { useDoc } from './context'
import { cx } from './util'

interface Props {
  /** Unique id used to restore focus when the element is re-created by a page re-layout. */
  eid: string
  value: string
  onChange(value: string): void
  /** What to show while the text is not being edited (e.g. with {total} filled in). */
  display?: string
  multiline?: boolean
  placeholder?: string
  className?: string
  style?: CSSProperties
  /** Called instead of inserting a line break when Enter is pressed in a single-line field. */
  onEnter?(): void
  /** Called when Backspace is pressed in an already-empty field. */
  onBackspaceEmpty?(): void
}

/**
 * A plain-text region edited directly on the page.
 *
 * The DOM text is managed by hand rather than by React: while the element has focus its
 * content is left alone (so the caret and native undo keep working) and only written to
 * when the value changes from outside.
 */
export function EditableText(props: Props) {
  const { editable } = useDoc()
  const { eid, value, onChange, display, multiline, placeholder, className, style, onEnter, onBackspaceEmpty } = props
  const ref = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const shown = display ?? value
  const classes = cx('et', style?.textAlign === 'justify' && 'is-justify', className)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const want = focused.current ? value : shown
    if (el.textContent !== want) el.textContent = want
  })

  if (!editable) {
    return (
      <div className={classes} style={style}>
        {shown}
      </div>
    )
  }

  const read = (el: HTMLDivElement): string => {
    let text = el.textContent ?? ''
    if (!multiline && /[\r\n]/.test(text)) {
      text = text.replace(/[\r\n]+/g, ' ')
      el.textContent = text
    }
    // Browsers can leave a stray <br> behind in an emptied region, which would hide the placeholder.
    if (text === '' && el.childNodes.length > 0) el.textContent = ''
    return text
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      if (onEnter) onEnter()
      else e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.currentTarget.blur()
    } else if (e.key === 'Backspace' && onBackspaceEmpty && (e.currentTarget.textContent ?? '') === '') {
      e.preventDefault()
      onBackspaceEmpty()
    }
  }

  return (
    <div
      ref={ref}
      className={classes}
      style={style}
      data-eid={eid}
      data-placeholder={placeholder || undefined}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onFocus={(e) => {
        focused.current = true
        if (e.currentTarget.textContent !== value) e.currentTarget.textContent = value
      }}
      onBlur={(e) => {
        focused.current = false
        if (e.currentTarget.textContent !== shown) e.currentTarget.textContent = shown
      }}
      onInput={(e) => onChange(read(e.currentTarget))}
      onKeyDown={onKeyDown}
    />
  )
}
