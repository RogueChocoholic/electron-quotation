import {
  CELL_PAD,
  DATA_VERSION,
  HEADER_ICON,
  HEADER_ICON_GAP,
  HEADER_NAME_H,
  HEADER_NAME_PT,
  LINE_HEIGHT,
  PAGE_H,
  PAGE_W,
  parseNum,
  uid
} from '@shared/calc'
import { ITEMS_DEFAULTS, defaultPage } from '@shared/seed'
import type {
  AccountBlock,
  Align,
  Block,
  DocType,
  FieldRow,
  FieldsBlock,
  HeaderConfig,
  HeaderTitle,
  ImageItem,
  ImagesBlock,
  ItemRow,
  ItemsBlock,
  ListBlock,
  PageConfig,
  PickedImage,
  QDoc,
  TextBlock
} from '@shared/types'
import {
  DocxError,
  PT,
  readDocx,
  type WordCell,
  type WordDoc,
  type WordDrawing,
  type WordFlow,
  type WordPara,
  type WordRow,
  type WordRun,
  type WordTable
} from './docxRead'

/**
 * Turns a Word file into a template.
 *
 * The app does not lay a page out the way Word does: a template is a letterhead and a list
 * of sections (details grid, items table, text, bullet list, pictures, bank account). So
 * this is a translation, made with rules of thumb:
 *
 *   header and footer   the letterhead: background, logos, title, company details, footer text
 *   table without lines the details grid; a row that is one piece of running text becomes text
 *   table with lines    the items table, with its total and payment rows
 *   bulleted paragraphs a list
 *   pictures            a row of pictures, with the text box below them as its caption
 *   "Account Details"   the bank account section, which shows the account chosen in Settings
 *   everything else     text, with the gaps between sections worked out from Word's spacing
 *
 * What belongs to one customer is left empty: the values in the details grid and all amounts.
 * The result is a first draft that is meant to be looked over, and `notes` says what to look at.
 */

export interface DocxImportOptions {
  /** Name for the template, normally the file's name. */
  name: string
  /** What the template is for when the file itself does not say. */
  fallbackType: DocType
  accountId: string | null
  /** Stores a picture and returns its id and pixel size, or null for a format the app cannot show. */
  storeImage(data: Buffer): PickedImage | null
}

/** Height of a line of text as a multiple of its font size: the font's own, as Word uses it. */
const FONT_LINE = 1.26
/** The caption under a row of pictures, as the app draws it. */
const CAPTION_H = 4.1
const TITLE_RE = /^(tax\s+)?(invoice|quotation|quote|estimate|receipt|pro-?\s?forma(\s+invoice)?)$/i

const round = (n: number): number => Math.round(n * 100) / 100
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

/** Tabs become spaces, and space at either end goes. Line breaks stay. */
const clean = (s: string): string =>
  s
    .replace(/\t+/g, ' ')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/[ \u00a0]{2,}/g, ' ')
    .trim()

const isPara = (f: WordFlow | undefined): f is WordPara => f?.type === 'p'

/** The size, weight and colour most of a paragraph's text has. */
function mostly(runs: WordRun[]): { size: number; bold: boolean; color: string | null } | null {
  const visible = runs.filter((r) => r.text.trim() !== '')
  if (visible.length === 0) return null
  const tally = <T>(of: (r: WordRun) => T): T => {
    const counts = new Map<T, number>()
    for (const r of visible) counts.set(of(r), (counts.get(of(r)) ?? 0) + r.text.length)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
  return { size: tally((r) => r.size), bold: tally((r) => r.bold), color: tally((r) => r.color) }
}

/** Font size of a paragraph: that of its text, or of the paragraph mark when it is empty. */
const sizeOf = (p: WordPara): number => mostly(p.runs)?.size ?? p.markSize

/** Height in mm of one line of a paragraph in Word. */
const lineHeight = (p: WordPara): number => p.lineExact ?? sizeOf(p) * PT * FONT_LINE * p.line

/** Height in mm a paragraph takes up in Word, not counting text that wraps to more lines. */
function flowHeight(p: WordPara): number {
  const inline = Math.max(0, ...p.drawings.filter((d) => !d.anchored).map((d) => d.h))
  const lines = p.text.split('\n').length
  return p.before + Math.max(lines * lineHeight(p), inline) + p.after
}

const isGrey = (color: string | null): boolean => {
  if (!color) return false
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
  return Math.max(r, g, b) - Math.min(r, g, b) < 24 && r >= 0x50 && r <= 0xc8
}

/** Advance widths of Outfit for the characters from space to "~", in thousandths of the font size. */
const OUTFIT_REGULAR = [
  208, 261, 400, 640, 588, 660, 659, 237, 303, 302, 490, 542, 275, 461, 290, 390, 656, 347, 541, 538, 598, 541, 564,
  525, 550, 564, 271, 269, 542, 542, 542, 505, 750, 696, 623, 688, 740, 590, 566, 773, 706, 258, 495, 666, 552, 839,
  710, 794, 606, 817, 630, 555, 625, 683, 688, 981, 691, 665, 583, 338, 390, 338, 453, 505, 281, 582, 582, 489, 582,
  536, 399, 579, 548, 224, 230, 498, 222, 855, 548, 566, 582, 583, 419, 427, 368, 516, 511, 750, 504, 514, 447, 323,
  278, 323, 542
]
const OUTFIT_BOLD = [
  190, 286, 456, 662, 603, 685, 691, 250, 310, 310, 490, 563, 283, 462, 300, 384, 666, 378, 564, 559, 609, 560, 573,
  527, 562, 573, 290, 280, 563, 563, 563, 499, 756, 729, 641, 689, 754, 615, 590, 785, 730, 293, 532, 705, 561, 858,
  738, 806, 628, 819, 652, 583, 639, 702, 713, 1002, 715, 687, 608, 349, 384, 349, 466, 505, 323, 595, 595, 496, 595,
  548, 436, 584, 572, 261, 273, 546, 261, 873, 572, 576, 595, 595, 444, 458, 399, 539, 537, 785, 536, 534, 481, 342,
  300, 342, 563
]

/** Width in mm of a line of text in the app's font. */
function textWidth(text: string, size: number, bold: boolean): number {
  const table = bold ? OUTFIT_BOLD : OUTFIT_REGULAR
  let units = 0
  for (const ch of text) units += table[ch.charCodeAt(0) - 32] ?? 560
  return (units / 1000) * size * PT
}

// ------------------------------------------------------------------ notes

class Notes {
  private readonly list: string[] = []
  add(note: string): void {
    if (!this.list.includes(note)) this.list.push(note)
  }
  all(): string[] {
    return [...this.list]
  }
}

/** Loads pictures from the Word file into the app's store, each one once. */
class Pictures {
  private readonly cache = new Map<string, PickedImage | null>()
  unusable = 0
  constructor(
    private readonly word: WordDoc,
    private readonly store: (data: Buffer) => PickedImage | null
  ) {}
  get(file: string): PickedImage | null {
    if (!this.cache.has(file)) {
      const data = this.word.image(file)
      const stored = data ? this.store(data) : null
      if (!stored) this.unusable += 1
      this.cache.set(file, stored)
    }
    return this.cache.get(file) ?? null
  }
}

// ----------------------------------------------------------------- header

interface Placed {
  x: number
  y: number
  w: number
  h: number
}

interface HeaderText {
  text: string
  size: number
  bold: boolean
  align: Align
  /** Top of the line, from the top of the page. */
  top: number
  /** The left and right edges the line is set between. */
  left: number
  right: number
  /** The text box the line is in, if any. */
  box: number
}

function convertHeader(
  word: WordDoc,
  pictures: Pictures,
  notes: Notes
): { header: HeaderConfig; bottom: number; title: string } {
  const pg = word.page
  const images: (Placed & { file: string; behind: boolean })[] = []
  /** Floating things that the header's own text makes room for. */
  const obstacles: (Placed & { left: number; right: number })[] = []
  const lines: HeaderText[] = []
  let boxes = 0

  const place = (d: WordDrawing, paraTop: number, align: Align): Placed => {
    if (!d.anchored) {
      const room = pg.w - pg.left - pg.right - d.w
      return { x: pg.left + (align === 'center' ? room / 2 : align === 'right' ? room : 0), y: paraTop, w: d.w, h: d.h }
    }
    const across = (): [number, number] => {
      if (d.hFrom === 'page') return [0, pg.w]
      if (d.hFrom === 'leftMargin' || d.hFrom === 'insideMargin') return [0, pg.left]
      if (d.hFrom === 'rightMargin' || d.hFrom === 'outsideMargin') return [pg.w - pg.right, pg.right]
      return [pg.left, pg.w - pg.left - pg.right]
    }
    const down = (): [number, number] | null => {
      if (d.vFrom === 'page') return [0, pg.h]
      if (d.vFrom === 'margin') return [pg.top, pg.h - pg.top - pg.bottom]
      if (d.vFrom === 'topMargin' || d.vFrom === 'insideMargin') return [0, pg.top]
      if (d.vFrom === 'bottomMargin' || d.vFrom === 'outsideMargin') return [pg.h - pg.bottom, pg.bottom]
      return null
    }
    const [ax, aw] = across()
    const area = down()
    const x =
      d.hAlign === 'center' ? ax + (aw - d.w) / 2 : d.hAlign === 'right' || d.hAlign === 'outside' ? ax + aw - d.w : d.hAlign ? ax : ax + d.hOffset
    let y = (area ? area[0] : paraTop) + d.vOffset
    if (area && d.vAlign) {
      y = d.vAlign === 'center' ? area[0] + (area[1] - d.h) / 2 : d.vAlign === 'bottom' ? area[0] + area[1] - d.h : area[0]
    }
    return { x, y, w: d.w, h: d.h }
  }

  /** Walks paragraphs downwards from `top`, noting where each line of text and each picture is. */
  const walk = (flow: WordFlow[], top: number, left: number, right: number, box: number): number => {
    let y = top
    for (const el of flow) {
      if (!isPara(el)) {
        for (const row of el.rows) for (const cell of row.cells) y = Math.max(y, walk(cell.flow, y, left, right, box))
        continue
      }
      const lineTop = y + el.before
      for (const d of el.drawings) {
        const at = place(d, lineTop, el.align)
        for (const p of d.pictures) {
          images.push({ file: p.file, x: at.x + p.x, y: at.y + p.y, w: p.w, h: p.h, behind: d.behindText })
        }
        if (d.flow.length > 0) {
          boxes += 1
          walk(d.flow, at.y + d.insets.top, at.x + d.insets.left, at.x + at.w - d.insets.right, boxes)
        }
        if (d.anchored && (d.wrap === 'Square' || d.wrap === 'Tight')) {
          obstacles.push({ ...at, left: d.distLeft, right: d.distRight })
        }
      }
      const text = clean(el.text).replace(/\n/g, ' ')
      const look = mostly(el.runs)
      if (text && look) {
        lines.push({ text, size: look.size, bold: look.bold, align: el.align, top: lineTop, left, right, box })
      }
      y += flowHeight(el)
    }
    return y
  }
  const bottom = walk(word.header, pg.header, pg.left, pg.w - pg.right, 0)

  // Pictures: one that covers the page is the background, small ones are the icons beside
  // the contact details, and the rest are logos.
  const covers = (i: (typeof images)[number]): boolean =>
    (i.w >= pg.w * 0.8 && i.h >= pg.h * 0.8) || (i.behind && i.w >= pg.w * 0.7 && i.h >= pg.h * 0.5)
  const backgroundAt = images.findIndex(covers)
  const background = backgroundAt >= 0 ? pictures.get(images[backgroundAt].file) : null
  const others = images.filter((i) => !covers(i))
  const icons = others.filter((i) => i.w <= 9 && i.h <= 9).sort((a, b) => a.y - b.y)
  const logos = others
    .filter((i) => !(i.w <= 9 && i.h <= 9))
    .flatMap((i) => {
      const stored = pictures.get(i.file)
      return stored ? [{ id: uid(), asset: stored.asset, x: round(i.x), y: round(i.y), width: round(i.w), ratio: i.h / i.w }] : []
    })

  // The title is a line that says what the document is, or stands out as large and bold.
  const titleAt = lines.findIndex((l) => TITLE_RE.test(l.text) || (l.size >= 16 && l.bold && l.text.length <= 32))
  let title: HeaderTitle | null = null
  if (titleAt >= 0) {
    const [t] = lines.splice(titleAt, 1)
    let { left, right } = t
    if (t.box === 0) {
      // Text in the header itself is set in the room that floating boxes beside it leave.
      const middle = (left + right) / 2
      const lineBottom = t.top + t.size * PT * FONT_LINE
      for (const o of obstacles) {
        if (o.y >= lineBottom || o.y + o.h <= t.top) continue
        if (o.x + o.w / 2 > middle) right = Math.min(right, o.x - o.left)
        else left = Math.max(left, o.x + o.w + o.right)
      }
    }
    const width = textWidth(t.text, t.size, t.bold)
    const x = t.align === 'center' ? (left + right - width) / 2 : t.align === 'right' ? right - width : left
    title = { text: t.text, x: round(x), y: round(t.top + 0.2), size: t.size, bold: t.bold }
  }

  // The company details are the lines of the text box that has the most, or else the header's own.
  const perBox = new Map<number, HeaderText[]>()
  for (const l of lines) perBox.set(l.box, [...(perBox.get(l.box) ?? []), l])
  const fullest = [...perBox.entries()].filter(([box]) => box !== 0).sort((a, b) => b[1].length - a[1].length)[0]
  const details = (fullest?.[1] ?? perBox.get(0) ?? []).slice(0, 9)
  if (lines.length > details.length) notes.add('Some text in the header of the Word file has no place in the letterhead and was left out.')
  if (details.some((l) => l.align !== 'right')) {
    notes.add('The company details are set against the right edge of the page, as in every template of this app.')
  }
  const lineIcons = icons.map((i) => pictures.get(i.file)?.asset ?? null)
  const iconEdges = icons.map((i) => i.x + i.w).sort((a, b) => a - b)
  const textRight = details.length > 0 ? Math.max(...details.map((l) => l.right)) : pg.w - pg.right
  // In the app the icon stands to the right of its line. Where the Word file has its icons
  // there too, they keep their place; otherwise the text keeps its right edge.
  const iconsRight = iconEdges.length > 0 && iconEdges[Math.floor(iconEdges.length / 2)] > textRight
  const detailsRight = iconsRight
    ? pg.w - iconEdges[Math.floor(iconEdges.length / 2)]
    : pg.w - textRight - (HEADER_ICON + HEADER_ICON_GAP)
  const nameLine = HEADER_NAME_PT * PT * FONT_LINE
  const detailsTop = details.length > 0 ? details[0].top - (HEADER_NAME_H - nameLine) / 2 : 8

  return {
    header: {
      background: background?.asset ?? null,
      logos,
      title,
      companyName: details[0]?.text ?? '',
      lines: details.slice(1).map((l, i) => ({ id: uid(), icon: lineIcons[i] ?? null, text: l.text })),
      detailsTop: round(clamp(detailsTop, 0, 150)),
      detailsRight: round(clamp(detailsRight, 0, 150))
    },
    bottom,
    title: title?.text ?? ''
  }
}

function footerText(flow: WordFlow[]): string {
  for (const el of flow) {
    if (isPara(el)) {
      const text = clean(el.text).replace(/\n/g, ' ')
      // A page number would be the same on every page here, so a line that is only that is skipped.
      if (text && !/^(page)?[\s\d]*((of|\/)[\s\d]*)?$/i.test(text)) return text
      for (const d of el.drawings) {
        const inBox = footerText(d.flow)
        if (inBox) return inBox
      }
    } else {
      for (const row of el.rows) {
        for (const cell of row.cells) {
          const inCell = footerText(cell.flow)
          if (inCell) return inCell
        }
      }
    }
  }
  return ''
}

// ------------------------------------------------------------------- body

const ACCOUNT_HEAD = /^((bank\s+)?(account|a\/c)|bank|payment)\s+details?\s*:?$/i
const ACCOUNT_LINE = /^(account|a\/c|acc\.?|bank|branch|swift|holder|beneficiary|name)\b[^:\t]{0,30}[:\t]/i
const BULLET_CHAR = /^[\u2022\u25cf\u25aa\u25a0\u25e6\u25cb\u2023\u00b7]\s*/
const QTY_RE = /^(qty|quantity|nos?|units?|pcs|pieces)\.?$/i
const ITEMS_HEAD = /\b(description|item|particulars|service|amount|price|rate|total|cost|qty|quantity)\b|\b(lkr|rs|usd)\b/i
const SUMMARY_RE = /\b(total|balance|advance|paid|deposit|due|received|outstanding|discount|tax|vat)\b/i
const AMOUNT_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{2}(?!\d)/g

/** What the Word file had where the template gets live values, kept to put tokens in the text. */
interface Seen {
  number: string
  date: string
  total: number
  paid: number
  balance: number
}

/**
 * Collects sections while walking down the page.
 *
 * `gap` is the empty space in mm between the bottom of the last section and the point
 * reached so far: paragraph spacing and empty paragraphs add to it, and it becomes the next
 * section's space above. It goes below zero after a floating picture, which reaches further
 * down than the paragraph it hangs from; the empty paragraphs that make room for it in Word
 * then bring it back up.
 */
class Body {
  readonly blocks: Block[] = []
  readonly seen: Seen = { number: '', date: '', total: NaN, paid: NaN, balance: NaN }
  /** Labels of the number rows found, which say what kind of document this is. */
  numberLabel = ''
  private gap = 0
  private lastText: { block: TextBlock; key: string } | null = null
  private lastImages: ImagesBlock | null = null
  private prev: WordPara | null = null
  private readonly bound = { number: false, date: false, customer: false }

  constructor(
    private readonly word: WordDoc,
    private readonly pictures: Pictures,
    private readonly notes: Notes,
    private readonly contentW: number
  ) {}

  private push(block: Block): void {
    this.blocks.push(block)
    this.lastText = null
    this.lastImages = block.type === 'images' ? block : null
  }

  private space(extra = 0): number {
    return round(Math.max(0, this.gap + extra))
  }

  run(flow: WordFlow[], indentBase = 0): void {
    for (let i = 0; i < flow.length; i += 1) {
      const el = flow[i]
      if (isPara(el)) {
        i = this.para(flow, i, indentBase)
      } else {
        this.prev = null
        if (this.isItems(el)) this.items(el)
        else this.fields(el)
        this.prev = null
      }
    }
  }

  // ---- paragraphs

  /** Handles the paragraph at `i` and returns the index of the last paragraph it used up. */
  private para(flow: WordFlow[], i: number, indentBase: number): number {
    const p = flow[i] as WordPara
    let before = p.before
    if (this.prev && p.contextual && this.prev.contextual && this.prev.style === p.style) {
      this.gap -= this.prev.after
      before = 0
    } else if (this.prev && this.word.spacingShared) {
      // The space below the paragraph before is already in the gap; only what this one
      // asks for beyond that is added.
      before = Math.max(0, before - this.prev.after)
    }
    this.prev = p

    // Text boxes, and pictures that float beside the text.
    for (const d of p.drawings.filter((x) => x.anchored || x.pictures.length === 0)) this.floating(d, before)

    const inline = p.drawings.filter((d) => !d.anchored && d.pictures.length > 0)
    const raw = p.text.trim()
    const text = clean(p.text)
    if (inline.length > 0) {
      const made = this.images(
        inline.flatMap((d) => d.pictures.map((pic) => ({ ...pic, x: 0, y: 0 }))),
        this.space(before),
        p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left',
        1
      )
      if (made) {
        this.gap = text ? 0 : p.after
        before = 0
        if (!text) return i
      }
    }
    if (!text) {
      this.gap += before + lineHeight(p) + p.after
      return i
    }

    // A short centred line right under a row of pictures is their caption.
    const shown = this.lastImages
    if (shown && !shown.showCaption && shown.align === 'center' && p.align === 'center' && this.gap + before <= 1.5) {
      if (text.length <= 90 && !text.includes('\n')) {
        shown.showCaption = true
        shown.caption = text
        this.gap += before + lineHeight(p) + p.after - CAPTION_H
        return i
      }
    }

    // "Account Details:" followed by the lines of a bank account.
    if (ACCOUNT_HEAD.test(text)) {
      let j = i
      while (j - i < 8 && isPara(flow[j + 1]) && ACCOUNT_LINE.test((flow[j + 1] as WordPara).text.trim())) j += 1
      if (j - i >= 2) {
        const block: AccountBlock = {
          id: uid(),
          type: 'account',
          spaceBefore: this.space(before),
          heading: text,
          size: sizeOf(p)
        }
        this.push(block)
        this.gap = (flow[j] as WordPara).after
        this.prev = flow[j] as WordPara
        this.notes.add(
          'The bank account section shows the account chosen in Settings. The account typed in the Word file was not taken over.'
        )
        return j
      }
    }

    if (p.list || BULLET_CHAR.test(raw)) return this.list(flow, i, before)

    this.text(p, before, indentBase)
    return i
  }

  private text(p: WordPara, before: number, indentBase: number): void {
    const runs = p.runs.filter((r) => r.text !== '')
    const look = mostly(runs) ?? { size: p.markSize, bold: false, color: null }

    // Bold words at the start, followed by text that is not bold: "Specification: ...".
    let lead = ''
    let rest = runs
    const firstPlain = runs.findIndex((r) => !r.bold && r.text.trim() !== '')
    if (firstPlain > 0) {
      const front = clean(runs.slice(0, firstPlain).map((r) => r.text).join(''))
      const after = clean(runs.slice(firstPlain).map((r) => r.text).join(''))
      if (front && front.length <= 60 && !front.includes('\n') && (front.endsWith(':') || after.length >= 3)) {
        lead = front
        rest = runs.slice(firstPlain)
      }
    }
    const body = clean(rest.map((r) => r.text).join(''))
    const restLook = mostly(rest) ?? look
    const align = p.align
    const indent = align === 'left' || align === 'justify' ? round(clamp(p.indent + indentBase, 0, 150)) : 0
    const color = restLook.color ?? '#000000'
    const key = [restLook.size, restLook.bold, color, align, indent].join('|')
    const gap = this.gap + before

    // A paragraph that looks the same as the one before it, a whole number of lines further
    // down, is the same piece of text going on.
    if (this.lastText && this.lastText.key === key && !lead) {
      const line = restLook.size * PT * LINE_HEIGHT
      const blank = Math.round(gap / line)
      if (blank >= 0 && blank <= 2 && Math.abs(gap - blank * line) <= 0.7) {
        this.lastText.block.text += '\n'.repeat(blank + 1) + body
        this.gap = p.after
        return
      }
    }
    const block: TextBlock = {
      id: uid(),
      type: 'text',
      spaceBefore: round(Math.max(0, gap)),
      lead,
      text: body,
      indent,
      size: restLook.size,
      bold: lead ? false : restLook.bold,
      color,
      align
    }
    this.push(block)
    this.lastText = { block, key }
    this.gap = p.after
  }

  private list(flow: WordFlow[], i: number, before: number): number {
    const first = flow[i] as WordPara
    const texts: string[] = []
    let j = i
    for (;;) {
      const p = flow[j] as WordPara
      texts.push(clean(p.text).replace(BULLET_CHAR, '').replace(/\n/g, ' '))
      const next = flow[j + 1]
      const goesOn =
        isPara(next) && next.drawings.length === 0 && clean(next.text) !== '' && (next.list !== null || BULLET_CHAR.test(next.text.trim()))
      if (!goesOn) break
      j += 1
    }
    const look = mostly(first.runs)
    const block: ListBlock = {
      id: uid(),
      type: 'list',
      spaceBefore: this.space(before),
      items: texts.map((text) => ({ id: uid(), text })),
      size: look?.size ?? first.markSize,
      color: look?.color ?? '#000000'
    }
    this.push(block)
    const last = flow[j] as WordPara
    this.gap = last.after
    this.prev = last
    if (first.list && this.word.numbered(first.list)) {
      this.notes.add('A numbered list became a bulleted list; the app has no numbered lists.')
    }
    return j
  }

  // ---- pictures and text boxes

  /** Adds a row of pictures. Returns the section, or null when none of the pictures can be used. */
  private images(
    pics: { file: string; x: number; y: number; w: number; h: number }[],
    spaceBefore: number,
    align: ImagesBlock['align'],
    gapBetween: number
  ): ImagesBlock | null {
    const sorted = [...pics].sort((a, b) => a.x - b.x)
    const items: ImageItem[] = []
    for (const pic of sorted) {
      const stored = this.pictures.get(pic.file)
      if (stored) items.push({ id: uid(), asset: stored.asset, ratio: stored.width / stored.height })
    }
    if (items.length === 0) return null
    const block: ImagesBlock = {
      id: uid(),
      type: 'images',
      spaceBefore,
      images: items,
      height: round(clamp(Math.max(...sorted.map((p) => p.y + p.h)) - Math.min(...sorted.map((p) => p.y)), 5, 250)),
      gap: round(clamp(gapBetween, 0, 50)),
      align,
      showCaption: false,
      caption: ''
    }
    this.push(block)
    return block
  }

  /** A picture or text box that floats beside the text, hung from the paragraph being handled. */
  private floating(d: WordDrawing, before: number): void {
    const fromPara = d.vFrom === 'paragraph' || d.vFrom === 'line' || d.vFrom === ''

    if (d.pictures.length > 0) {
      // The pictures can start a little below the top of the drawing they are grouped in.
      const top = Math.max(0, (fromPara ? d.vOffset : 0) + Math.min(...d.pictures.map((p) => p.y)))
      const sorted = [...d.pictures].sort((a, b) => a.x - b.x)
      const gaps = sorted.slice(1).map((p, k) => p.x - (sorted[k].x + sorted[k].w))
      const between = gaps.length > 0 ? Math.max(0, gaps.reduce((a, b) => a + b, 0) / gaps.length) : 1
      // Where the drawing's middle is, measured from the left margin.
      const middle = d.hOffset + d.w / 2 - (d.hFrom === 'page' ? this.word.page.left : 0)
      const align: ImagesBlock['align'] =
        d.hAlign === 'center' || d.hAlign === 'left' || d.hAlign === 'right'
          ? d.hAlign
          : Math.abs(middle - this.contentW / 2) < 6
            ? 'center'
            : middle < this.contentW / 2
              ? 'left'
              : 'right'
      const made = this.images(sorted, this.space(before + top), align, between)
      // From here on the gap is measured from the bottom of the pictures, which is below
      // the paragraph they hang from.
      if (made) this.gap = -(before + top + made.height)
      if (d.behindText) this.notes.add('A picture that lies behind the text in the Word file became a section of its own.')
      return
    }

    const paras = d.flow.filter(isPara).filter((p) => clean(p.text) !== '')
    if (paras.length === 0) return
    const caption = clean(paras[0].text).replace(/\n/g, ' ')
    if (this.lastImages && !this.lastImages.showCaption && paras.length === 1 && caption.length <= 90) {
      this.lastImages.showCaption = true
      this.lastImages.caption = caption
      this.gap -= CAPTION_H
      return
    }
    // Any other text box: its text is set where the box is hung.
    this.notes.add('Text in a text box was turned into ordinary text; check where it ended up.')
    const prev = this.prev
    this.prev = null
    this.run(d.flow)
    this.prev = prev
  }

  // ---- details grid

  private isItems(t: WordTable): boolean {
    if (!t.bordered || t.grid.length < 2 || t.rows.length === 0) return false
    const head = t.rows[0].cells.map((c) => cellText(c, ' ')).join(' ')
    if (ITEMS_HEAD.test(head)) return true
    // No recognisable heading: a table whose last column holds numbers is one all the same.
    const last = t.rows.map((r) => cellText(r.cells[r.cells.length - 1], ' ')).filter(Boolean)
    return last.length > 0 && last.every((s) => !Number.isNaN(parseNum(s)) && s.length <= 18)
  }

  private fields(t: WordTable): void {
    const n = t.grid.length
    const offsets = [0]
    for (const w of t.grid) offsets.push(offsets[offsets.length - 1] + w)

    /** The cell of a row that is running text rather than a label or a value, if it has one. */
    const freeCell = (row: WordRow): WordCell | null => {
      const filled = row.cells.filter((c) => cellText(c, ' ') !== '' || c.flow.some((f) => isPara(f) && f.drawings.length > 0))
      if (filled.length !== 1) return null
      const c = filled[0]
      const paragraphs = c.flow.filter((f) => isPara(f) && clean(f.text) !== '').length
      const hasOther = c.flow.some((f) => !isPara(f) || f.drawings.length > 0)
      return (n > 1 && c.span >= n) || paragraphs > 1 || hasOther || c.span > 1 || cellText(c, ' ').length > 40 || n === 1 ? c : null
    }
    const free = t.rows.map(freeCell)

    // Which columns hold labels and values: a narrow column that is always empty divides the
    // grid into its left and right half; without one, four columns are two pairs.
    const used = Array.from({ length: n }, () => false)
    t.rows.forEach((row, r) => {
      if (free[r]) return
      for (const c of row.cells) if (cellText(c, ' ') !== '') used[c.col] = true
    })
    let divider = -1
    for (let c = 1; c < n - 1; c += 1) {
      if (!used[c] && t.grid[c] < 12 && used.slice(0, c).some(Boolean) && used.slice(c + 1).some(Boolean)) {
        divider = c
        break
      }
    }
    const leftEnd = divider >= 0 ? divider : n >= 4 ? 2 : n
    const rightStart = divider >= 0 ? divider + 1 : leftEnd
    const hasRight = rightStart < n && used.slice(rightStart).some(Boolean)

    const sideOf = (row: WordRow, from: number, to: number): FieldRow & { raw: string } => {
      const cells = row.cells.filter((c) => c.col >= from && c.col < to)
      const labelCell = cells.find((c) => c.col === from)
      const label = labelCell ? cellText(labelCell, ' ') : ''
      const value = cells
        .filter((c) => c !== labelCell)
        .map((c) => cellText(c, ' '))
        .filter(Boolean)
        .join(' ')
      const look = mostly(cells.flatMap((c) => c.flow.filter(isPara).flatMap((p) => p.runs)))
      const labelLook = labelCell ? mostly(labelCell.flow.filter(isPara).flatMap((p) => p.runs)) : null
      return {
        id: uid(),
        label,
        value: '',
        raw: value,
        bold: (labelLook ?? look)?.bold ?? false,
        muted: isGrey((labelLook ?? look)?.color ?? null),
        bind: null
      }
    }

    const sizes = t.rows.flatMap((row) => row.cells.flatMap((c) => c.flow.filter(isPara).flatMap((p) => p.runs)))
    const size = mostly(sizes)?.size ?? 9
    const appRow = 1.752 * size * PT

    let left: (FieldRow & { raw: string })[] = []
    let right: (FieldRow & { raw: string })[] = []
    let wordHeight = 0
    const flush = (): void => {
      const trim = (rows: (FieldRow & { raw: string })[]): (FieldRow & { raw: string })[] => {
        const out = [...rows]
        while (out.length > 0 && out[out.length - 1].label === '' && out[out.length - 1].raw === '') out.pop()
        return out
      }
      const l = trim(left)
      const r = trim(right)
      if (l.length > 0 || r.length > 0) {
        for (const row of [...l, ...r]) this.bind(row)
        const strip = ({ raw: _raw, ...row }: FieldRow & { raw: string }): FieldRow => row
        const block: FieldsBlock = {
          id: uid(),
          type: 'fields',
          spaceBefore: this.space(),
          left: l.map(strip),
          right: r.map(strip),
          split: round(clamp(hasRight ? offsets[rightStart] : this.contentW, 20, Math.min(180, this.contentW))),
          leftLabelWidth: round(clamp(t.grid[0] ?? 29.7, 5, 120)),
          rightLabelWidth: round(clamp(hasRight ? t.grid[rightStart] : 16.1, 5, 120)),
          size
        }
        this.push(block)
        // Rows that are taller in Word than in the app leave the difference as a gap below.
        // Shorter ones take nothing away: the space Word shows under the grid is kept.
        this.gap = Math.max(0, wordHeight - Math.max(l.length, r.length) * appRow)
      } else {
        this.gap += wordHeight
      }
      left = []
      right = []
      wordHeight = 0
    }

    t.rows.forEach((row, r) => {
      const cell = free[r]
      if (!cell) {
        left.push(sideOf(row, 0, leftEnd))
        if (hasRight) right.push(sideOf(row, rightStart, n))
        wordHeight += rowHeight(row)
        return
      }
      flush()
      const content = cell.flow.reduce((sum, f) => sum + (isPara(f) ? flowHeight(f) : 0), 0)
      this.prev = null
      this.run(cell.flow, offsets[cell.col] + CELL_PAD)
      this.prev = null
      if (row.height > content) this.gap += row.height - content
    })
    flush()
  }

  /** Ties a row of the details grid to the document's number, date or customer, by its label. */
  private bind(row: FieldRow & { raw: string }): void {
    const label = row.label.replace(/[:.\s]+$/, '').trim()
    if (!label) return
    const other = /account|a\/c|contact|phone|tel|mobile|fax|vat|tin|reg|order|\bpo\b/i.test(label)
    if (!this.bound.number && !other && /(^|\s)(no|number|num|#|ref|reference)$/i.test(label)) {
      row.bind = 'number'
      this.bound.number = true
      this.seen.number = row.raw
      this.numberLabel = label
    } else if (!this.bound.date && !row.muted && /date/i.test(label) && !/due|event|delivery|valid|expiry/i.test(label)) {
      row.bind = 'date'
      this.bound.date = true
      this.seen.date = row.raw
    } else if (
      !this.bound.customer &&
      /^(name|customer|client|billed\s+to|bill\s+to|invoice\s+to|invoiced\s+to|to|attn|attention|m\/s)(\s+name)?$/i.test(label)
    ) {
      row.bind = 'customer'
      this.bound.customer = true
    }
  }

  // ---- items table

  private items(t: WordTable): void {
    const n = t.grid.length
    const at = (row: WordRow, col: number): WordCell | undefined => row.cells.find((c) => c.col === col)
    const lastOf = (row: WordRow): WordCell | undefined => row.cells.find((c) => c.col + c.span >= n)
    const allRuns = (cells: WordCell[]): WordRun[] => cells.flatMap((c) => c.flow.filter(isPara).flatMap((p) => p.runs))

    const first = t.rows[0]
    const headText = first.cells.map((c) => cellText(c, ' ')).join(' ')
    const headLook = mostly(allRuns(first.cells))
    const hasHead = ITEMS_HEAD.test(headText) || (headLook?.bold ?? false)

    let qtyCol = -1
    if (n >= 3) {
      qtyCol = hasHead ? first.cells.find((c) => c.col > 0 && c.col + c.span < n && QTY_RE.test(cellText(c, ' ')))?.col ?? -1 : -1
      if (qtyCol < 0 && n === 3 && t.grid[1] < 30) qtyCol = 1
    }
    if (n - 2 - (qtyCol >= 0 ? 1 : 0) > 0) {
      this.notes.add('The table in the Word file has more columns than the items table of the app; only the description, quantity and amount were taken over.')
    }

    const rows = t.rows.slice(hasHead ? 1 : 0)
    interface Summary {
      kind: 'total' | 'paid' | 'balance' | 'other'
      label: string
      value: string
      boxed: boolean
    }
    const summaryOf = (row: WordRow): Summary | null => {
      const amount = lastOf(row)
      const labelCell = row.cells.find((c) => c !== amount && cellText(c, ' ') !== '')
      if (!labelCell) return null
      const label = cellText(labelCell, ' ')
      const para = labelCell.flow.filter(isPara).find((p) => clean(p.text) !== '')
      const look = mostly(allRuns([labelCell]))
      const standsOut = labelCell.span > 1 || (para !== undefined && (para.align === 'right' || para.align === 'center')) || (look?.bold ?? false)
      if (!SUMMARY_RE.test(label) || label.length > 48 || !standsOut) return null
      const kind = /balance|due|outstanding|remaining/i.test(label)
        ? 'balance'
        : /advance|paid|deposit|received/i.test(label)
          ? 'paid'
          : /total/i.test(label)
            ? 'total'
            : 'other'
      return { kind, label, value: amount ? cellText(amount, ' ') : '', boxed: labelCell.borders.left !== false }
    }
    // The rows under the items are read from the bottom up, so that an item which happens
    // to mention a total is not taken for one.
    const summary: Summary[] = []
    let end = rows.length
    while (end > 0) {
      const row = rows[end - 1]
      const empty = row.cells.every((c) => cellText(c, ' ') === '')
      const s = summaryOf(row)
      if (!s && !(empty && summary.length === 0)) break
      if (s) summary.unshift(s)
      end -= 1
    }

    const amounts: string[] = []
    const itemRows: ItemRow[] = rows.slice(0, end).map((row) => {
      const qtyCell = qtyCol >= 0 ? at(row, qtyCol) : undefined
      const amount = lastOf(row)
      if (amount && amount.col > 0) amounts.push(cellText(amount, ' '))
      return {
        id: uid(),
        description: at(row, 0) ? cellText(at(row, 0) as WordCell, '\n') : '',
        qty: qtyCell ? cellText(qtyCell, ' ') : '1',
        price: '',
        hasQty: qtyCol < 0 || qtyCell !== undefined
      }
    })
    if (itemRows.length === 0) itemRows.push({ id: uid(), description: '', qty: '1', price: '', hasQty: true })

    const total = summary.filter((s) => s.kind === 'total').pop()
    const paid = summary.find((s) => s.kind === 'paid')
    const balance = summary.find((s) => s.kind === 'balance')
    const dropped = summary.filter((s) => s !== total && s !== paid && s !== balance)
    if (dropped.length > 0) {
      this.notes.add(
        `The table rows ${dropped.map((s) => `"${s.label}"`).join(', ')} have no counterpart in the app and were left out.`
      )
    }
    const sum = amounts.reduce((acc, a) => acc + (Number.isNaN(parseNum(a)) ? 0 : parseNum(a)), 0)
    const typedTotal = total ? parseNum(total.value) : NaN
    this.seen.total = Number.isNaN(typedTotal) ? (sum > 0 ? sum : this.seen.total) : typedTotal
    if (paid && !Number.isNaN(parseNum(paid.value))) this.seen.paid = parseNum(paid.value)
    if (balance && !Number.isNaN(parseNum(balance.value))) this.seen.balance = parseNum(balance.value)

    const head = (col: number, fallback: string): string => (hasHead && at(first, col) ? cellText(at(first, col) as WordCell, ' ') || fallback : fallback)
    const amountHead = hasHead ? lastOf(first) : undefined
    // Word keeps the other columns as wide as they are set and lets the last one fill the page.
    const others = t.grid.slice(0, n - 1).reduce((a, b) => a + b, 0)
    const amountWidth = Math.min(t.grid[n - 1], this.contentW - others)
    const everyAmount = [...amounts, ...summary.map((s) => s.value)].filter((a) => a !== '')

    const block: ItemsBlock = {
      id: uid(),
      type: 'items',
      spaceBefore: this.space(),
      descriptionLabel: head(0, 'Description'),
      qtyLabel: qtyCol >= 0 ? head(qtyCol, 'Qty') : 'Qty',
      amountLabel: (amountHead && cellText(amountHead, ' ')) || 'Amount',
      totalLabel: total?.label ?? 'Total',
      rows: itemRows,
      hideRowAmounts: false,
      size: mostly(allRuns(t.rows.flatMap((r) => r.cells)))?.size ?? 9,
      showQty: qtyCol >= 0,
      amountWidth: round(clamp(amountWidth > 0 ? amountWidth : ITEMS_DEFAULTS.amountWidth, 15, 90)),
      decimals: everyAmount.some((a) => /\.\d{2}$/.test(a)) ? 'always' : 'auto',
      showTotal: total !== undefined,
      boxTotals: summary.length > 0 && summary.every((s) => s.boxed),
      showPayment: paid !== undefined || balance !== undefined,
      paidLabel: paid?.label ?? ITEMS_DEFAULTS.paidLabel,
      paid: '',
      balanceLabel: balance?.label ?? ITEMS_DEFAULTS.balanceLabel
    }
    this.push(block)
    this.gap = 0
  }

  // ---- after the walk

  /** Puts {total}, {paid}, {balance}, {number} and {date} where the text repeats those values. */
  tokens(): void {
    const { number, date, total, paid, balance } = this.seen
    for (const b of this.blocks) {
      if (b.type !== 'text') continue
      let text = b.text.replace(AMOUNT_RE, (found) => {
        const n = parseNum(found)
        if (n === total) return '{total}'
        if (n === paid) return '{paid}'
        if (n === balance) return '{balance}'
        return found
      })
      if (number.length >= 3) text = text.split(number).join('{number}')
      if (date.length >= 6) text = text.split(date).join('{date}')
      b.text = text
    }
  }
}

/** The text of a table cell, its paragraphs joined by `joiner`. */
function cellText(cell: WordCell, joiner: string): string {
  const parts: string[] = []
  const walk = (flow: WordFlow[]): void => {
    for (const f of flow) {
      if (isPara(f)) {
        const text = clean(f.text)
        if (text) parts.push(joiner === '\n' ? text : text.replace(/\n/g, ' '))
      } else {
        for (const row of f.rows) for (const c of row.cells) walk(c.flow)
      }
    }
  }
  walk(cell.flow)
  return parts.join(joiner)
}

/** Height in mm of a table row in Word: its tallest cell, but at least the height set for it. */
function rowHeight(row: WordRow): number {
  const tallest = Math.max(
    0,
    ...row.cells.map((c) => c.flow.reduce((sum, f) => sum + (isPara(f) ? flowHeight(f) : 0), 0))
  )
  return Math.max(row.height, tallest)
}

// ------------------------------------------------------------------- main

export function docxToTemplate(data: Buffer, opts: DocxImportOptions): { doc: QDoc; notes: string[] } {
  const word = readDocx(data)
  const notes = new Notes()
  const pictures = new Pictures(word, opts.storeImage)
  const pg = word.page

  const { header, bottom: headerBottom, title } = convertHeader(word, pictures, notes)
  const body = new Body(word, pictures, notes, pg.w - pg.left - pg.right)
  body.run(word.body)
  body.tokens()
  const blocks = body.blocks

  const nothingInHeader = !header.background && header.logos.length === 0 && !header.companyName && !header.title
  if (blocks.length === 0 && nothingInHeader) {
    throw new DocxError('Nothing that could go into a template was found in the Word file.')
  }

  // What the document is: its title says so, or the label of its number, or the file's name.
  const says = (s: string): DocType | null => (/invoice|receipt/i.test(s) ? 'invoice' : /quot|estimate/i.test(s) ? 'quotation' : null)
  const firstText = blocks.find((b): b is TextBlock => b.type === 'text' && TITLE_RE.test(b.text.trim()))
  const docType = says(title) ?? says(firstText?.text ?? '') ?? says(body.numberLabel) ?? says(opts.name) ?? opts.fallbackType

  // Word starts the text at the top margin, or below the header when that is taller. The
  // app's first line sits a little lower in its row than Word's, which the margin makes up for.
  const top = Math.max(pg.top, Math.min(headerBottom, 120))
  const first = blocks[0]
  const lower = first?.type === 'fields' ? 0.9 : first?.type === 'text' ? ((LINE_HEIGHT - FONT_LINE) / 2) * first.size * PT : 0
  const defaults = defaultPage()
  const footer = footerText(word.footer)
  const footerBottom = footer ? round(Math.max(0, pg.footer - 0.3)) : defaults.footerBottom
  const page: PageConfig = {
    marginTop: round(clamp(top - lower, 0, 150)),
    marginBottom: round(clamp(pg.bottom, footer ? footerBottom + 6 : 5, 120)),
    marginLeft: round(clamp(pg.left, 0, 80)),
    marginRight: round(clamp(pg.right, 0, 80)),
    footerText: footer,
    footerBottom
  }
  if (Math.abs(pg.w - PAGE_W) > 2 || Math.abs(pg.h - PAGE_H) > 2) {
    notes.add('The Word file is not set up for upright A4 paper, which the app always uses. Positions may be off.')
  }
  if (pictures.unusable > 0) {
    notes.add(
      pictures.unusable === 1
        ? 'One picture is in a format the app cannot show (only PNG and JPEG work) and was left out.'
        : `${pictures.unusable} pictures are in a format the app cannot show (only PNG and JPEG work) and were left out.`
    )
  }
  if (word.skipped > 0) notes.add('Shapes, charts or drawings in the Word file were left out.')
  if (nothingInHeader) notes.add('The Word file has no header, so the template has no letterhead yet.')
  if (blocks.some((b) => b.type === 'items') && blocks.filter((b) => b.type === 'items').length > 1) {
    notes.add('The Word file has more than one table with lines; each became an items table, and their totals are added up.')
  }
  if (!blocks.some((b) => b.type === 'fields' && [...b.left, ...b.right].some((r) => r.bind === 'number'))) {
    notes.add(`No row for the ${docType} number was recognised. Mark one in the details grid so the number is filled in.`)
  }

  const now = new Date().toISOString()
  const doc: QDoc = {
    schema: 1,
    id: uid(),
    kind: 'template',
    docType,
    name: opts.name.replace(/[.\s]+$/, '').trim() || 'Template from Word',
    number: '',
    date: '',
    accountId: opts.accountId,
    header,
    page,
    blocks,
    createdAt: now,
    updatedAt: now,
    dataVersion: DATA_VERSION
  }
  return {
    doc,
    notes: [
      `Values in the details grid and all amounts were left empty. Other text was kept as it is in the Word file: remove what should not be on every ${docType}.`,
      ...notes.all()
    ]
  }
}
