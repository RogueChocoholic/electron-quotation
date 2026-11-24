import {
  AlignmentType,
  BorderStyle,
  CharacterSet,
  Document,
  Footer,
  Header,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  TextWrappingType,
  UnderlineType,
  VerticalAlignTable,
  VerticalAnchor,
  VerticalPositionRelativeFrom,
  WidthType,
  WpsShapeRun,
  type IBorderOptions,
  type IFloating,
  type ITableCellBorders
} from 'docx'
import fs from 'node:fs'
import {
  ACCOUNT_LABEL_W,
  CAPTION_PT,
  CELL_PAD,
  DOC_WORDS,
  FIELD_ROW_H,
  FOOTER_COLOR,
  FOOTER_PT,
  HEADER_ICON,
  HEADER_ICON_GAP,
  HEADER_LINE_H,
  HEADER_LINE_PT,
  HEADER_NAME_H,
  HEADER_NAME_PT,
  LIST_HANGING,
  LIST_INDENT,
  MUTED_COLOR,
  PAGE_H,
  PAGE_W,
  accountRows,
  docTotal,
  fmtAmount,
  fmtPrice,
  isLinkText,
  itemsSummary,
  itemsWidths,
  resolveTokens
} from '@shared/calc'
import type {
  Account,
  AccountBlock,
  AssetId,
  Block,
  FieldRow,
  FieldsBlock,
  ImagesBlock,
  ItemsBlock,
  ListBlock,
  QDoc,
  TextBlock
} from '@shared/types'
import outfitBold from '../renderer/src/assets/fonts/Outfit-Bold.ttf?asset'
import outfitRegular from '../renderer/src/assets/fonts/Outfit-Regular.ttf?asset'
import { readAsset } from './store'

/**
 * Builds an editable Word document that mirrors the on-screen page.
 * Word does its own text wrapping and pagination, so the result is close to the PDF
 * but not pixel-identical.
 */

const FONT = 'Outfit'
/** Outfit's natural line height as a multiple of the font size. */
const NATURAL_LINE = 1.26
/** 1.15 line spacing, which with Outfit equals the 1.45 line-height used on screen. */
const LINE = 276
const PT_MM = 25.4 / 72

const tw = (mm: number): number => Math.round(mm * 56.6929)
const emu = (mm: number): number => Math.round(mm * 36000)
const px = (mm: number): number => (mm * 96) / 25.4
const half = (pt: number): number => Math.round(pt * 2)
const hex = (color: string): string => color.replace('#', '').toUpperCase()

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const THIN: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const NO_BORDERS: ITableCellBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE }
const ALL_BORDERS: ITableCellBorders = { top: THIN, bottom: THIN, left: THIN, right: THIN }

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED
} as const

type Child = Paragraph | Table

function image(asset: AssetId, widthMm: number, heightMm: number, floating?: IFloating): ImageRun | null {
  const data = readAsset(asset)
  if (!data) return null
  return new ImageRun({
    type: asset.endsWith('.png') ? 'png' : 'jpg',
    data,
    transformation: { width: px(widthMm), height: px(heightMm) },
    floating
  })
}

/** Pins an image to an exact spot on the page, independent of the text around it. */
function pageFloat(xMm: number, yMm: number, behind = false): IFloating {
  return {
    horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(xMm) },
    verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(yMm) },
    wrap: { type: TextWrappingType.NONE },
    behindDocument: behind,
    allowOverlap: true
  }
}

/** An empty paragraph of an exact height, used for spacing where Word has no "space before". */
function gap(mm: number): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: Math.max(20, tw(mm)), lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: '', size: 2 })]
  })
}

function buildHeader(doc: QDoc): Header {
  const h = doc.header
  const floats: (ImageRun | WpsShapeRun)[] = []
  const add = (run: ImageRun | null): void => {
    if (run) floats.push(run)
  }

  // The title goes in a borderless text box pinned to the page. Unlike a framed paragraph, a
  // text box with no wrapping leaves the header's own lines exactly where they are. Text
  // widths are not known here, so the box allows a full em per character: wide enough that
  // the title never wraps, without covering the contact lines more than it has to.
  if (h.title && h.title.text.trim() !== '') {
    const t = h.title
    const roomy = [...t.text].length * t.size * PT_MM + 2
    floats.push(
      new WpsShapeRun({
        type: 'wps',
        transformation: {
          width: px(Math.max(20, Math.min(roomy, PAGE_W - t.x))),
          height: px(t.size * NATURAL_LINE * PT_MM + 1)
        },
        floating: pageFloat(t.x, t.y),
        bodyProperties: { margins: { top: 0, bottom: 0, left: 0, right: 0 }, verticalAnchor: VerticalAnchor.TOP },
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
            run: { size: half(t.size) },
            children: [new TextRun({ text: t.text, bold: t.bold, size: half(t.size) })]
          })
        ]
      })
    )
  }

  if (h.background) add(image(h.background, PAGE_W, PAGE_H, pageFloat(0, 0, true)))
  for (const l of h.logos) add(image(l.asset, l.width, l.width * l.ratio, pageFloat(l.x, l.y)))
  const iconX = PAGE_W - h.detailsRight - HEADER_ICON
  h.lines.forEach((l, i) => {
    if (!l.icon) return
    const y = h.detailsTop + HEADER_NAME_H + i * HEADER_LINE_H + (HEADER_LINE_H - HEADER_ICON) / 2
    add(image(l.icon, HEADER_ICON, HEADER_ICON, pageFloat(iconX, y)))
  })

  // The text ends just left of the icon column, which sits outside the right page margin.
  const rightIndent = tw(h.detailsRight + HEADER_ICON + HEADER_ICON_GAP - doc.page.marginRight)
  // Each line is centred in its row. Word merges the space after one paragraph with the space
  // before the next, so all of the spacing is given as "space before".
  let carry = 0
  const row = (
    text: string,
    pt: number,
    rowMm: number,
    underline: boolean,
    extra: (ImageRun | WpsShapeRun)[] = []
  ): Paragraph => {
    const pad = Math.max(0, (rowMm - pt * NATURAL_LINE * PT_MM) / 2)
    const before = carry + pad
    carry = pad
    return new Paragraph({
      alignment: AlignmentType.RIGHT,
      indent: { right: rightIndent },
      spacing: { before: tw(before), after: 0, line: 240, lineRule: LineRuleType.AUTO },
      run: { size: half(pt) },
      children: [
        ...extra,
        new TextRun({ text, size: half(pt), underline: underline ? { type: UnderlineType.SINGLE } : undefined })
      ]
    })
  }

  return new Header({
    children: [
      row(h.companyName, HEADER_NAME_PT, HEADER_NAME_H, false, floats),
      ...h.lines.map((l) => row(l.text, HEADER_LINE_PT, HEADER_LINE_H, isLinkText(l.text)))
    ]
  })
}

function buildFooter(doc: QDoc): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [
          new TextRun({ text: doc.page.footerText, bold: true, size: half(FOOTER_PT), color: hex(FOOTER_COLOR) })
        ]
      })
    ]
  })
}

function buildText(b: TextBlock, doc: QDoc): Child[] {
  const lines = resolveTokens(b.text, doc).replace(/\n$/, '').split('\n')
  const run = (text: string, bold: boolean): TextRun =>
    new TextRun({ text, bold, size: half(b.size), color: hex(b.color) })
  return lines.map(
    (text, i) =>
      new Paragraph({
        alignment: ALIGN[b.align],
        indent: b.indent > 0 ? { left: tw(b.indent) } : undefined,
        spacing: { before: i === 0 ? tw(b.spaceBefore) : 0, after: 0, line: LINE },
        run: { size: half(b.size) },
        // The bold lead-in shares the first line with the start of the text.
        children: i === 0 && b.lead ? [run(b.lead, true), run(` ${text}`, b.bold)] : [run(text, b.bold)]
      })
  )
}

function fieldValue(row: FieldRow | undefined, doc: QDoc): string {
  if (!row) return ''
  if (row.bind === 'number') return doc.number
  if (row.bind === 'date') return doc.date
  return row.value
}

function buildFields(b: FieldsBlock, doc: QDoc, contentW: number): Child[] {
  const count = Math.max(b.left.length, b.right.length)
  if (count === 0) return [gap(b.spaceBefore)]
  const widths = [
    b.leftLabelWidth,
    Math.max(5, b.split - b.leftLabelWidth),
    b.rightLabelWidth,
    Math.max(5, contentW - b.split - b.rightLabelWidth)
  ]
  const cell = (text: string, col: number, row: FieldRow | undefined, label: boolean): TableCell =>
    new TableCell({
      width: { size: tw(widths[col]), type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      margins: { left: tw(CELL_PAD), right: 0, top: 0, bottom: 0 },
      borders: NO_BORDERS,
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
          children: [
            new TextRun({
              text,
              bold: label && (row?.bold ?? false),
              size: half(b.size),
              color: row?.muted ? hex(MUTED_COLOR) : undefined
            })
          ]
        })
      ]
    })
  const rows = Array.from({ length: count }, (_, i) => {
    const l = b.left[i]
    const r = b.right[i]
    return new TableRow({
      height: { value: tw((FIELD_ROW_H * b.size) / 9), rule: HeightRule.ATLEAST },
      children: [
        cell(l?.label ?? '', 0, l, true),
        cell(fieldValue(l, doc), 1, l, false),
        cell(r?.label ?? '', 2, r, true),
        cell(fieldValue(r, doc), 3, r, false)
      ]
    })
  })
  return [
    gap(b.spaceBefore),
    new Table({
      width: { size: tw(widths.reduce((a, w) => a + w, 0)), type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: widths.map(tw),
      borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
      rows
    })
  ]
}

function buildItems(b: ItemsBlock, contentW: number): Child[] {
  const widths = itemsWidths(b, contentW)
  const amountCol = widths.length - 1
  /** Width of everything left of the amount column: the description, and the quantity if there is one. */
  const labelW = widths.slice(0, amountCol).reduce((a, w) => a + w, 0)
  type CellOpts = { bold?: boolean; right?: boolean; wide?: boolean; borders?: ITableCellBorders }
  const cell = (text: string, col: number, o: CellOpts = {}): TableCell =>
    new TableCell({
      width: { size: tw(o.wide ? labelW : widths[col]), type: WidthType.DXA },
      columnSpan: o.wide && amountCol > 1 ? amountCol : undefined,
      margins: { left: tw(CELL_PAD), right: tw(CELL_PAD), top: 0, bottom: 0 },
      borders: o.borders ?? ALL_BORDERS,
      children: [
        new Paragraph({
          alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { before: 0, after: 0, line: LINE },
          children: [new TextRun({ text, bold: o.bold, size: half(b.size) })]
        })
      ]
    })

  const rows = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        cell(b.descriptionLabel, 0, { bold: true }),
        ...(b.showQty ? [cell(b.qtyLabel, 1, { bold: true, right: true })] : []),
        cell(b.amountLabel, amountCol, { bold: true, right: true })
      ]
    }),
    ...b.rows.map(
      (r) =>
        new TableRow({
          cantSplit: true,
          children: [
            ...(b.showQty && r.hasQty
              ? [cell(r.description, 0), cell(r.qty, 1, { right: true })]
              : [cell(r.description, 0, { wide: true })]),
            cell(b.hideRowAmounts ? '' : fmtPrice(r.price, b.decimals), amountCol, { right: true })
          ]
        })
    ),
    ...itemsSummary(b).map(
      (row, i) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(row.label, 0, {
              bold: true,
              right: true,
              wide: true,
              // Unboxed, the label stands outside the grid: only the first keeps the line above it.
              borders: b.boxTotals
                ? ALL_BORDERS
                : { top: i === 0 ? THIN : NONE, left: NONE, bottom: NONE, right: THIN }
            }),
            cell(row.value, amountCol, { bold: true, right: true })
          ]
        })
    )
  ]

  return [
    gap(b.spaceBefore),
    new Table({
      width: { size: tw(widths.reduce((a, w) => a + w, 0)), type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: widths.map(tw),
      rows
    })
  ]
}

function buildList(b: ListBlock): Child[] {
  return b.items.map(
    (item, i) =>
      new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        spacing: { before: i === 0 ? tw(b.spaceBefore) : 0, after: 0, line: LINE },
        // Sizes the paragraph mark, and with it the bullet, so neither makes the line taller.
        run: { size: half(b.size), color: hex(b.color) },
        children: [new TextRun({ text: item.text, size: half(b.size), color: hex(b.color) })]
      })
  )
}

function buildImages(b: ImagesBlock): Child[] {
  const out: Child[] = []
  const runs: (ImageRun | TextRun)[] = []
  b.images.forEach((img, i) => {
    const run = image(img.asset, b.height * img.ratio, b.height)
    if (!run) return
    // A space sized so that its width is roughly the configured gap between images.
    if (runs.length && i > 0) runs.push(new TextRun({ text: ' ', size: Math.max(2, Math.round(b.gap * 22.6)) }))
    runs.push(run)
  })
  if (runs.length) {
    out.push(gap(b.spaceBefore))
    out.push(
      new Paragraph({
        alignment: ALIGN[b.align],
        spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: runs
      })
    )
  }
  if (b.showCaption) {
    out.push(
      new Paragraph({
        alignment: ALIGN[b.align],
        spacing: { before: runs.length ? 0 : tw(b.spaceBefore), after: 0, line: 240, lineRule: LineRuleType.AUTO },
        run: { size: half(CAPTION_PT) },
        children: [new TextRun({ text: b.caption, size: half(CAPTION_PT) })]
      })
    )
  }
  return out
}

function buildAccount(b: AccountBlock, account: Account | null): Child[] {
  if (!account) return []
  const labelW = (ACCOUNT_LABEL_W * b.size) / 9
  return [
    new Paragraph({
      spacing: { before: tw(b.spaceBefore), after: 0, line: LINE },
      run: { size: half(b.size) },
      children: [new TextRun({ text: b.heading, bold: true, size: half(b.size) })]
    }),
    ...accountRows(account).map(
      ([label, value]) =>
        new Paragraph({
          tabStops: [{ type: TabStopType.LEFT, position: tw(labelW) }],
          spacing: { before: 0, after: 0, line: LINE },
          run: { size: half(b.size) },
          children: [
            new TextRun({ text: label, size: half(b.size) }),
            new TextRun({ children: [new Tab(), value], size: half(b.size) })
          ]
        })
    )
  ]
}

function buildBlock(b: Block, doc: QDoc, account: Account | null, contentW: number): Child[] {
  switch (b.type) {
    case 'text':
      return buildText(b, doc)
    case 'fields':
      return buildFields(b, doc, contentW)
    case 'items':
      return buildItems(b, contentW)
    case 'list':
      return buildList(b)
    case 'images':
      return buildImages(b)
    case 'account':
      return buildAccount(b, account)
  }
}

export async function renderDocx(doc: QDoc, account: Account | null): Promise<Buffer> {
  const p = doc.page
  const contentW = PAGE_W - p.marginLeft - p.marginRight
  const children: Child[] = doc.blocks.flatMap((b) => buildBlock(b, doc, account, contentW))
  // Word requires the body to end with a paragraph, not a table.
  if (children.length === 0 || children[children.length - 1] instanceof Table) children.push(gap(0))

  const document = new Document({
    creator: 'Quotation Maker',
    title: doc.kind === 'template' ? doc.name : doc.number || DOC_WORDS[doc.docType].One,
    description: doc.kind === 'document' ? `Total ${fmtAmount(docTotal(doc), 'always')}` : undefined,
    // Embedded so the file looks the same on PCs that do not have Outfit installed.
    fonts: [
      {
        name: FONT,
        data: fs.readFileSync(outfitRegular),
        bold: fs.readFileSync(outfitBold),
        characterSet: CharacterSet.ANSI
      }
    ],
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 18 },
          paragraph: { spacing: { before: 0, after: 0, line: LINE } }
        }
      }
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: tw(LIST_INDENT), hanging: tw(LIST_HANGING) } } }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: tw(PAGE_W), height: tw(PAGE_H) },
            margin: {
              top: tw(p.marginTop),
              bottom: tw(p.marginBottom),
              left: tw(p.marginLeft),
              right: tw(p.marginRight),
              header: tw(doc.header.detailsTop),
              footer: tw(p.footerBottom)
            }
          }
        },
        headers: { default: buildHeader(doc) },
        footers: { default: buildFooter(doc) },
        children
      }
    ]
  })
  return Packer.toBuffer(document)
}
