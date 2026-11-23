import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  FOOTER_PT,
  HEADER_ICON,
  HEADER_ICON_GAP,
  HEADER_LINE_H,
  HEADER_LINE_PT,
  HEADER_NAME_H,
  HEADER_NAME_PT,
  PAGE_H,
  isLinkText
} from '@shared/calc'
import type { Block, Logo } from '@shared/types'
import {
  AccountBlockView,
  FieldsBlockView,
  ImagesBlockView,
  ItemsBlockView,
  ListBlockView,
  TextBlockView
} from './blocks'
import { captureFocus, restoreFocus, type FocusSnapshot } from './caret'
import { useDoc } from './context'
import { EditableText } from './EditableText'
import { addSectionItems, blockActionItems } from './menus'
import { patchHeader, patchPage } from './ops'
import { EMPTY_MEASURES, layoutSignature, measure, paginate, type Fragment, type Measures } from './paginate'
import { PX_PER_MM, assetUrl, cx, mm, pt, round1 } from './util'

/** Loads the page fonts up front so the first layout is measured with the right metrics. */
export function loadDocFonts(): Promise<unknown> {
  return Promise.all([document.fonts.load('400 12px Outfit'), document.fonts.load('700 12px Outfit')]).catch(
    () => undefined
  )
}

function LogoView({ logo }: { logo: Logo }) {
  const { editable, update, zoom } = useDoc()

  const startDrag = (e: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize'): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const scale = 1 / (PX_PER_MM * zoom)
    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - startX) * scale
      const dy = (ev.clientY - startY) * scale
      update((d) =>
        patchHeader(d, {
          logos: d.header.logos.map((l) => {
            if (l.id !== logo.id) return l
            return mode === 'move'
              ? { ...l, x: round1(logo.x + dx), y: round1(logo.y + dy) }
              : { ...l, width: Math.max(5, round1(logo.width + dx)) }
          })
        })
      )
    }
    const onEnd = (): void => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onEnd)
      el.removeEventListener('pointercancel', onEnd)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onEnd)
    el.addEventListener('pointercancel', onEnd)
  }

  return (
    <div
      className={cx('logo', editable && 'is-editable')}
      style={{ left: mm(logo.x), top: mm(logo.y), width: mm(logo.width), height: mm(logo.width * logo.ratio) }}
      title={editable ? 'Drag to move. Drag the corner to resize.' : undefined}
      onPointerDown={editable ? (e) => startDrag(e, 'move') : undefined}
    >
      <img src={assetUrl(logo.asset)} alt="" draggable={false} />
      {editable && <span className="logo-handle" onPointerDown={(e) => startDrag(e, 'resize')} />}
    </div>
  )
}

function HeaderView({ pageIndex }: { pageIndex: number }) {
  const { doc, update } = useDoc()
  const h = doc.header
  return (
    <>
      {h.background && <img className="page-bg" src={assetUrl(h.background)} alt="" draggable={false} />}
      {h.logos.map((l) => (
        <LogoView key={l.id} logo={l} />
      ))}
      {h.title && (
        <div
          className="hdr-title"
          style={{
            left: mm(h.title.x),
            top: mm(h.title.y),
            fontSize: pt(h.title.size),
            fontWeight: h.title.bold ? 700 : 400
          }}
        >
          <EditableText
            eid={`hdr:title:${pageIndex}`}
            value={h.title.text}
            onChange={(text) => update((d) => (d.header.title ? patchHeader(d, { title: { ...d.header.title, text } }) : d))}
            placeholder="Title"
          />
        </div>
      )}
      <div className="hdr" style={{ top: mm(h.detailsTop), right: mm(h.detailsRight) }}>
        <div
          className="hdr-name"
          style={{
            height: mm(HEADER_NAME_H),
            paddingRight: mm(HEADER_ICON + HEADER_ICON_GAP),
            fontSize: pt(HEADER_NAME_PT)
          }}
        >
          <EditableText
            eid={`hdr:name:${pageIndex}`}
            value={h.companyName}
            onChange={(companyName) => update((d) => patchHeader(d, { companyName }))}
            placeholder="Company name"
          />
        </div>
        {h.lines.map((line) => (
          <div className="hdr-line" key={line.id} style={{ height: mm(HEADER_LINE_H), fontSize: pt(HEADER_LINE_PT) }}>
            <EditableText
              eid={`hdr:${line.id}:${pageIndex}`}
              className={isLinkText(line.text) ? 'u' : undefined}
              value={line.text}
              onChange={(text) =>
                update((d) =>
                  patchHeader(d, { lines: d.header.lines.map((l) => (l.id === line.id ? { ...l, text } : l)) })
                )
              }
              placeholder="Contact detail"
            />
            <span
              className="hdr-icon"
              style={{ width: mm(HEADER_ICON), height: mm(HEADER_ICON), marginLeft: mm(HEADER_ICON_GAP) }}
            >
              {line.icon && <img src={assetUrl(line.icon)} alt="" draggable={false} />}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function FooterView({ pageIndex }: { pageIndex: number }) {
  const { doc, editable, update } = useDoc()
  if (!editable && doc.page.footerText.trim() === '') return null
  return (
    <div className="page-footer" style={{ bottom: mm(doc.page.footerBottom), fontSize: pt(FOOTER_PT) }}>
      <EditableText
        eid={`ftr:${pageIndex}`}
        value={doc.page.footerText}
        onChange={(footerText) => update((d) => patchPage(d, { footerText }))}
        placeholder="Footer text"
      />
    </div>
  )
}

function BlockView({ block, frag }: { block: Block; frag: Fragment }) {
  const ctx = useDoc()
  const { editable, selectedId, select, account, openMenu } = ctx
  // With no bank account chosen there is nothing to print for the account section.
  if (block.type === 'account' && !account && !editable) return null

  let content
  switch (block.type) {
    case 'text':
      content = <TextBlockView block={block} />
      break
    case 'fields':
      content = <FieldsBlockView block={block} />
      break
    case 'items':
      content = <ItemsBlockView block={block} frag={frag} />
      break
    case 'list':
      content = <ListBlockView block={block} />
      break
    case 'images':
      content = <ImagesBlockView block={block} />
      break
    case 'account':
      content = <AccountBlockView block={block} />
      break
  }

  const spaceBefore = frag.first ? block.spaceBefore : 0
  return (
    <div
      className={cx('blk', `blk-${block.type}`, selectedId === block.id && 'is-selected')}
      data-block-id={frag.first ? block.id : undefined}
      style={{ paddingTop: mm(spaceBefore) }}
      onMouseDown={editable ? () => select(block.id) : undefined}
    >
      {editable && frag.first && (
        <div className="chrome blk-gutter" style={{ top: mm(spaceBefore) }}>
          <button
            type="button"
            title="Add a section below"
            onClick={(e) => openMenu(e.currentTarget, addSectionItems(ctx, block.id))}
          >
            +
          </button>
          <button
            type="button"
            title="Move, duplicate or delete this section"
            onClick={(e) => openMenu(e.currentTarget, blockActionItems(ctx, block.id))}
          >
            &#8942;
          </button>
        </div>
      )}
      <div className="blk-body">{content}</div>
    </div>
  )
}

interface Props {
  /** Reports whether the page layout has settled, and how many pages there are. */
  onLayout?(stable: boolean, pages: number): void
}

/** Renders the document as A4 pages. The same component is used for editing and for PDF export. */
export function DocumentView({ onLayout }: Props) {
  const ctx = useDoc()
  const { doc, zoom, editable, openMenu } = ctx
  const rootRef = useRef<HTMLDivElement>(null)
  const measures = useRef<Measures>(EMPTY_MEASURES)
  const pendingFocus = useRef<FocusSnapshot | null>(null)
  const retries = useRef(0)
  const [, setTick] = useState(0)

  const available = (PAGE_H - doc.page.marginTop - doc.page.marginBottom) * PX_PER_MM - 1
  const pages = paginate(doc.blocks, measures.current, available)
  const signature = layoutSignature(pages)
  const blocksById = new Map(doc.blocks.map((b) => [b.id, b]))

  // Text metrics change once the page fonts arrive, so measure again then.
  useEffect(() => {
    let alive = true
    void loadDocFonts().then(() => alive && setTick((t) => t + 1))
    return () => {
      alive = false
    }
  }, [])

  // After every render: measure the real heights and re-flow if blocks now belong on other pages.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const next = measure(root, zoom, doc)
    const wanted = layoutSignature(paginate(doc.blocks, next, available))
    measures.current = next
    if (wanted !== signature && retries.current < 8) {
      retries.current += 1
      pendingFocus.current = captureFocus(root)
      onLayout?.(false, pages.length)
      setTick((t) => t + 1)
      return
    }
    retries.current = 0
    onLayout?.(true, pages.length)
  })

  // Blocks that moved to another page were re-created; give focus back to the one being typed in.
  useLayoutEffect(() => {
    const root = rootRef.current
    const snap = pendingFocus.current
    pendingFocus.current = null
    if (root && snap) restoreFocus(root, snap)
  }, [signature])

  return (
    <div ref={rootRef} className={cx('doc-root', editable && 'editable')} style={{ zoom }}>
      {pages.map((fragments, pageIndex) => (
        <div className="page" key={pageIndex}>
          <HeaderView pageIndex={pageIndex} />
          <div
            className="page-body"
            style={{
              top: mm(doc.page.marginTop),
              left: mm(doc.page.marginLeft),
              right: mm(doc.page.marginRight),
              height: mm(PAGE_H - doc.page.marginTop - doc.page.marginBottom)
            }}
          >
            {fragments.map((frag) => {
              const block = blocksById.get(frag.blockId)
              return block ? <BlockView key={frag.key} block={block} frag={frag} /> : null
            })}
            {editable && doc.blocks.length === 0 && (
              <button
                type="button"
                className="chrome page-empty"
                onClick={(e) => openMenu(e.currentTarget, addSectionItems(ctx, null))}
              >
                + Add a section
              </button>
            )}
          </div>
          <FooterView pageIndex={pageIndex} />
        </div>
      ))}
    </div>
  )
}
