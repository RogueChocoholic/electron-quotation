import zlib from 'node:zlib'
import type { Align } from '@shared/types'

/**
 * Reads a Word file (.docx) into a plain description of what is on its pages: paragraphs,
 * tables, pictures and text boxes, with the sizes and spacing Word would use for them.
 *
 * A .docx is a zip archive of XML files. Both are read here directly, which keeps the app
 * free of another dependency for what is a small, well-defined subset of the two formats.
 * Nothing here knows about quotations or invoices; see importDocx.ts for that.
 */

/** An error whose message is meant to be shown to the user as it is. */
export class DocxError extends Error {}

const damaged = (): DocxError => new DocxError('The file is not a Word document (.docx), or it is damaged.')

// -------------------------------------------------------------------- zip

/** No single part of a sensible Word file comes near this; it stops a crafted file filling the memory. */
const MAX_PART_BYTES = 64 * 1024 * 1024

interface ZipEntry {
  method: number
  packed: number
  offset: number
}

interface Zip {
  read(name: string): Buffer | null
}

function openZip(buf: Buffer): Zip {
  // The archive's table of contents is at its end, behind a marker that is searched for backwards.
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw damaged()
  const count = buf.readUInt16LE(end + 10)
  const entries = new Map<string, ZipEntry>()
  let at = buf.readUInt32LE(end + 16)
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw damaged()
    const nameLength = buf.readUInt16LE(at + 28)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength)
    entries.set(name, {
      method: buf.readUInt16LE(at + 10),
      packed: buf.readUInt32LE(at + 20),
      offset: buf.readUInt32LE(at + 42)
    })
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return {
    read(name) {
      const e = entries.get(name)
      if (!e) return null
      if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw damaged()
      const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28)
      if (start + e.packed > buf.length) throw damaged()
      const data = buf.subarray(start, start + e.packed)
      if (e.method === 0) return data
      if (e.method !== 8) throw damaged()
      try {
        return zlib.inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES })
      } catch {
        throw damaged()
      }
    }
  }
}

// -------------------------------------------------------------------- xml

interface El {
  tag: string
  attrs: Record<string, string>
  kids: El[]
  /** The text directly inside the element. */
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, body: string) => {
    if (body[0] !== '#') return ENTITIES[body] ?? whole
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
}

const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13

/**
 * Reads name="value" pairs from the inside of a tag, after the tag name.
 * One pass from left to right, so a damaged file with a very long "tag" costs no more than its length.
 */
function readAttrs(body: string, from: number, into: Record<string, string>): void {
  const n = body.length
  let i = from
  while (i < n) {
    while (i < n && isSpace(body.charCodeAt(i))) i++
    const nameStart = i
    while (i < n && body[i] !== '=' && !isSpace(body.charCodeAt(i))) i++
    const name = body.slice(nameStart, i)
    while (i < n && isSpace(body.charCodeAt(i))) i++
    if (body[i] !== '=') continue
    i++
    while (i < n && isSpace(body.charCodeAt(i))) i++
    const quote = body[i]
    if (quote !== '"' && quote !== "'") continue
    const close = body.indexOf(quote, i + 1)
    if (close < 0) return
    if (name) into[name] = decode(body.slice(i + 1, close))
    i = close + 1
  }
}

/** Deeper than any real Word file goes; stops a damaged one from exhausting memory. */
const MAX_DEPTH = 200

function parseXml(src: string): El {
  const root: El = { tag: '#root', attrs: {}, kids: [], text: '' }
  const stack: El[] = [root]
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    const top = stack[stack.length - 1]
    if (lt < 0) break
    if (lt > i) top.text += decode(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt)
      if (close < 0) break
      i = close + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const close = src.indexOf(']]>', lt)
      if (close < 0) break
      top.text += src.slice(lt + 9, close)
      i = close + 3
      continue
    }
    const gt = src.indexOf('>', lt)
    if (gt < 0) break
    i = gt + 1
    const second = src[lt + 1]
    if (second === '?' || second === '!') continue
    if (second === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }
    const selfClosing = src[gt - 1] === '/'
    const body = src.slice(lt + 1, selfClosing ? gt - 1 : gt)
    let nameEnd = 0
    while (nameEnd < body.length && body[nameEnd] !== '/' && !isSpace(body.charCodeAt(nameEnd))) nameEnd++
    const el: El = { tag: body.slice(0, nameEnd), attrs: {}, kids: [], text: '' }
    readAttrs(body, nameEnd, el.attrs)
    top.kids.push(el)
    if (!selfClosing) {
      if (stack.length > MAX_DEPTH) throw new DocxError('The file is not a Word document (.docx), or it is damaged.')
      stack.push(el)
    }
  }
  flattenAlternates(root)
  return root
}

/**
 * Word stores a shape twice: in the current format and, as a fallback, in the old one.
 * Only the first is kept, in place of the wrapper around the two.
 */
function flattenAlternates(el: El): void {
  const out: El[] = []
  for (const kid of el.kids) {
    if (kid.tag === 'mc:AlternateContent') {
      const pick = kid.kids.find((k) => k.tag === 'mc:Choice') ?? kid.kids.find((k) => k.tag === 'mc:Fallback')
      if (pick) out.push(...pick.kids)
    } else {
      out.push(kid)
    }
  }
  el.kids = out
  for (const kid of el.kids) flattenAlternates(kid)
}

const kid = (el: El | undefined, tag: string): El | undefined => el?.kids.find((k) => k.tag === tag)
const kids = (el: El | undefined, tag: string): El[] => el?.kids.filter((k) => k.tag === tag) ?? []

function find(el: El | undefined, tag: string): El | undefined {
  if (!el) return undefined
  for (const k of el.kids) {
    if (k.tag === tag) return k
    const deep = find(k, tag)
    if (deep) return deep
  }
  return undefined
}

const val = (el: El | undefined): string | undefined => el?.attrs['w:val']

function numAttr(el: El | undefined, name: string): number | undefined {
  const raw = el?.attrs[name]
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

// ------------------------------------------------------------------ model

/** Word measures in twentieths of a point, and drawings in EMU. Everything here is in mm. */
const TWIP = 25.4 / 1440
const EMU = 1 / 36000
export const PT = 25.4 / 72

export interface WordRun {
  text: string
  /** Font size in pt. */
  size: number
  bold: boolean
  /** "#rrggbb", or null for the automatic colour. */
  color: string | null
}

export interface WordPicture {
  /** The picture's file inside the archive. */
  file: string
  /** Position and size inside its drawing, in mm. */
  x: number
  y: number
  w: number
  h: number
}

export interface WordDrawing {
  /** False for a picture that sits in the line of text like a letter. */
  anchored: boolean
  behindText: boolean
  /** How text gets out of its way: "Square", "Tight", "Through", "TopAndBottom", "None" or "" when inline. */
  wrap: string
  w: number
  h: number
  /** What the position is measured from, e.g. "page", "margin", "column", "paragraph". */
  hFrom: string
  hOffset: number
  hAlign: string | null
  vFrom: string
  vOffset: number
  vAlign: string | null
  distLeft: number
  distRight: number
  pictures: WordPicture[]
  /** The content of a text box. */
  flow: WordFlow[]
  insets: { left: number; top: number; right: number; bottom: number }
}

export interface WordPara {
  type: 'p'
  runs: WordRun[]
  drawings: WordDrawing[]
  /** The text of all runs. Tabs and line breaks are "\t" and "\n". */
  text: string
  /** Space above and below, in mm. */
  before: number
  after: number
  /** Line height as a multiple of the font's own, or a fixed height in mm when `lineExact` is set. */
  line: number
  lineExact: number | null
  align: Align
  /** Left indent in mm. */
  indent: number
  list: { numId: string; level: number } | null
  /** Font size of the paragraph mark, which gives an empty paragraph its height. */
  markSize: number
  style: string
  /** Word leaves out the space between two paragraphs of the same style that both have this set. */
  contextual: boolean
}

export interface WordCell {
  /** First grid column the cell covers, and how many. */
  col: number
  span: number
  flow: WordFlow[]
  /** Borders set on the cell itself: true for drawn, false for switched off. */
  borders: Partial<Record<'top' | 'left' | 'bottom' | 'right', boolean>>
}

export interface WordRow {
  /** The height the row has at least, in mm. 0 when none is set. */
  height: number
  cells: WordCell[]
}

export interface WordTable {
  type: 't'
  /** Column widths in mm. */
  grid: number[]
  bordered: boolean
  rows: WordRow[]
}

export type WordFlow = WordPara | WordTable

export interface WordPage {
  w: number
  h: number
  top: number
  right: number
  bottom: number
  left: number
  /** Distance of the header from the top edge, and of the footer from the bottom edge. */
  header: number
  footer: number
}

export interface WordDoc {
  page: WordPage
  body: WordFlow[]
  header: WordFlow[]
  footer: WordFlow[]
  /** The contents of a picture file. */
  image(file: string): Buffer | null
  /**
   * How the space below one paragraph and the space above the next add up. Word 2013 and
   * later take the larger of the two; documents kept in an older layout mode add them.
   */
  spacingShared: boolean
  /** True when the list a paragraph belongs to is numbered rather than bulleted. */
  numbered(list: { numId: string; level: number }): boolean
  /** Charts, diagrams and old-style drawings that were skipped. */
  skipped: number
}

interface Style {
  basedOn?: string
  ppr?: El
  rpr?: El
  tblPr?: El
}

/** Whether an on/off property is switched on; undefined when it is not set at all. */
const isOn = (el: El | undefined): boolean | undefined => {
  if (!el) return undefined
  const v = val(el)
  return !(v === '0' || v === 'false' || v === 'off')
}

const ALIGN: Record<string, Align> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify'
}

function partDir(part: string): string {
  const slash = part.lastIndexOf('/')
  return slash < 0 ? '' : part.slice(0, slash + 1)
}

/** "word/header1.xml" + "media/image1.png" gives "word/media/image1.png". */
function resolvePart(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const out: string[] = []
  for (const piece of (partDir(from) + target).split('/')) {
    if (piece === '..') out.pop()
    else if (piece !== '.' && piece !== '') out.push(piece)
  }
  return out.join('/')
}

export function readDocx(buf: Buffer): WordDoc {
  if (buf.length > 4 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    throw new DocxError('This is an old Word file (.doc). Open it in Word, save it as .docx and import that.')
  }
  const zip = openZip(buf)
  const xml = (name: string): El | undefined => {
    const data = zip.read(name)
    return data ? parseXml(data.toString('utf8')) : undefined
  }

  /** The other files a part points to, by the id it uses for them. */
  const relsOf = (part: string): Map<string, { target: string; type: string }> => {
    const slash = part.lastIndexOf('/')
    const file = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`
    const out = new Map<string, { target: string; type: string }>()
    for (const r of kids(kid(xml(file), 'Relationships'), 'Relationship')) {
      if (r.attrs.TargetMode === 'External' || !r.attrs.Id || !r.attrs.Target) continue
      out.set(r.attrs.Id, { target: resolvePart(part, r.attrs.Target), type: r.attrs.Type ?? '' })
    }
    return out
  }

  const rootRels = [...relsOf('').values()]
  const mainPart = rootRels.find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'word/document.xml'
  const main = xml(mainPart)
  const body = kid(kid(main, 'w:document'), 'w:body')
  if (!body) throw damaged()
  const mainRels = relsOf(mainPart)
  const partOfType = (type: string, fallback: string): string =>
    [...mainRels.values()].find((r) => r.type.endsWith(type))?.target ?? fallback

  // ---- styles

  const stylesRoot = kid(xml(partOfType('/styles', 'word/styles.xml')), 'w:styles')
  const defaults = kid(stylesRoot, 'w:docDefaults')
  const defaultRpr = kid(kid(defaults, 'w:rPrDefault'), 'w:rPr')
  const defaultPpr = kid(kid(defaults, 'w:pPrDefault'), 'w:pPr')
  const styles = new Map<string, Style>()
  let defaultParaStyle: string | undefined
  let defaultTableStyle: string | undefined
  for (const s of kids(stylesRoot, 'w:style')) {
    const id = s.attrs['w:styleId']
    if (!id) continue
    styles.set(id, {
      basedOn: val(kid(s, 'w:basedOn')),
      ppr: kid(s, 'w:pPr'),
      rpr: kid(s, 'w:rPr'),
      tblPr: kid(s, 'w:tblPr')
    })
    if (s.attrs['w:default'] === '1' && s.attrs['w:type'] === 'paragraph') defaultParaStyle = id
    if (s.attrs['w:default'] === '1' && s.attrs['w:type'] === 'table') defaultTableStyle = id
  }

  /** A style and the styles it is based on, nearest first. */
  const chain = (id: string | undefined): Style[] => {
    const out: Style[] = []
    for (let cur = id; cur && out.length < 20; ) {
      const s = styles.get(cur)
      if (!s) break
      out.push(s)
      cur = s.basedOn
    }
    return out
  }

  // ---- lists

  const numbering = kid(xml(partOfType('/numbering', 'word/numbering.xml')), 'w:numbering')
  const abstractOf = new Map<string, string>()
  for (const n of kids(numbering, 'w:num')) {
    const abstract = val(kid(n, 'w:abstractNumId'))
    if (n.attrs['w:numId'] && abstract) abstractOf.set(n.attrs['w:numId'], abstract)
  }
  const numbered = (list: { numId: string; level: number }): boolean => {
    const abstract = kids(numbering, 'w:abstractNum').find(
      (a) => a.attrs['w:abstractNumId'] === abstractOf.get(list.numId)
    )
    const level = kids(abstract, 'w:lvl').find((l) => l.attrs['w:ilvl'] === String(list.level))
    const format = val(kid(level, 'w:numFmt'))
    return format !== undefined && format !== 'bullet' && format !== 'none'
  }

  const compat = find(kid(xml(partOfType('/settings', 'word/settings.xml')), 'w:settings'), 'w:compat')
  const layoutMode = kids(compat, 'w:compatSetting').find((c) => c.attrs['w:name'] === 'compatibilityMode')
  const spacingShared = Number(val(layoutMode) ?? 12) >= 15

  // ---- content

  let skipped = 0

  /** Where the properties of a paragraph or run are looked up, nearest first. */
  interface Scope {
    part: string
    rels: Map<string, { target: string; type: string }>
    tableStyle?: string
  }

  const parseDrawing = (el: El, scope: Scope): WordDrawing | null => {
    const box = kid(el, 'wp:inline') ?? kid(el, 'wp:anchor')
    if (!box) return null
    const extent = kid(box, 'wp:extent')
    const position = (tag: string): { from: string; offset: number; align: string | null } => {
      const p = kid(box, tag)
      const offset = Number(kid(p, 'wp:posOffset')?.text)
      return {
        from: p?.attrs.relativeFrom ?? '',
        offset: Number.isFinite(offset) ? offset * EMU : 0,
        align: kid(p, 'wp:align')?.text.trim() || null
      }
    }
    const h = position('wp:positionH')
    const v = position('wp:positionV')
    const d: WordDrawing = {
      anchored: box.tag === 'wp:anchor',
      behindText: box.attrs.behindDoc === '1',
      wrap: box.kids.find((k) => k.tag.startsWith('wp:wrap'))?.tag.slice(7) ?? '',
      w: (numAttr(extent, 'cx') ?? 0) * EMU,
      h: (numAttr(extent, 'cy') ?? 0) * EMU,
      hFrom: h.from,
      hOffset: h.offset,
      hAlign: h.align,
      vFrom: v.from,
      vOffset: v.offset,
      vAlign: v.align,
      distLeft: (numAttr(box, 'distL') ?? 0) * EMU,
      distRight: (numAttr(box, 'distR') ?? 0) * EMU,
      pictures: [],
      flow: [],
      insets: { left: 2.54, top: 1.27, right: 2.54, bottom: 1.27 }
    }

    const addPicture = (pic: El, x: number, y: number, w: number, h: number): void => {
      const id = find(pic, 'a:blip')?.attrs['r:embed']
      const file = id ? scope.rels.get(id)?.target : undefined
      if (file) d.pictures.push({ file, x, y, w, h })
    }
    const addTextBox = (shape: El): void => {
      const content = find(kid(shape, 'wps:txbx'), 'w:txbxContent')
      if (!content) return
      d.flow.push(...parseFlow(content, { ...scope, tableStyle: undefined }))
      const bodyPr = kid(shape, 'wps:bodyPr')
      const inset = (name: string, fallback: number): number => {
        const n = numAttr(bodyPr, name)
        return n === undefined ? fallback : n * EMU
      }
      d.insets = {
        left: inset('lIns', 2.54),
        top: inset('tIns', 1.27),
        right: inset('rIns', 2.54),
        bottom: inset('bIns', 1.27)
      }
    }
    /** Maps a position inside a group of shapes to a position in the drawing, in EMU. */
    interface Mapping {
      ox: number
      oy: number
      sx: number
      sy: number
    }
    const xfrm = (shapeProps: El | undefined): { x: number; y: number; cx: number; cy: number; inner: Mapping } => {
      const t = kid(shapeProps, 'a:xfrm')
      const off = kid(t, 'a:off')
      const ext = kid(t, 'a:ext')
      const chOff = kid(t, 'a:chOff')
      const chExt = kid(t, 'a:chExt')
      const x = numAttr(off, 'x') ?? 0
      const y = numAttr(off, 'y') ?? 0
      const cx = numAttr(ext, 'cx') ?? 0
      const cy = numAttr(ext, 'cy') ?? 0
      const sx = cx / (numAttr(chExt, 'cx') || cx || 1)
      const sy = cy / (numAttr(chExt, 'cy') || cy || 1)
      return {
        x,
        y,
        cx,
        cy,
        inner: { ox: x - (numAttr(chOff, 'x') ?? 0) * sx, oy: y - (numAttr(chOff, 'y') ?? 0) * sy, sx, sy }
      }
    }
    const walkGroup = (group: El, outer: Mapping, depth: number): void => {
      const own = xfrm(kid(group, 'wpg:grpSpPr')).inner
      // A position in this group, to a position in the group around it, to one in the drawing.
      const map: Mapping = {
        ox: outer.ox + own.ox * outer.sx,
        oy: outer.oy + own.oy * outer.sy,
        sx: own.sx * outer.sx,
        sy: own.sy * outer.sy
      }
      for (const k of group.kids) {
        if (k.tag === 'pic:pic') {
          const t = xfrm(kid(k, 'pic:spPr'))
          addPicture(k, (map.ox + t.x * map.sx) * EMU, (map.oy + t.y * map.sy) * EMU, t.cx * map.sx * EMU, t.cy * map.sy * EMU)
        } else if (k.tag === 'wps:wsp') {
          addTextBox(k)
        } else if (k.tag === 'wpg:grpSp' && depth < 8) {
          walkGroup(k, map, depth + 1)
        }
      }
    }

    const data = find(box, 'a:graphicData')
    const first = data?.kids[0]
    if (first?.tag === 'pic:pic') addPicture(first, 0, 0, d.w, d.h)
    else if (first?.tag === 'wpg:wgp') walkGroup(first, { ox: 0, oy: 0, sx: 1, sy: 1 }, 0)
    else if (first?.tag === 'wps:wsp') addTextBox(first)
    else skipped += 1
    return d
  }

  const parsePara = (el: El, scope: Scope): WordPara => {
    const ppr = kid(el, 'w:pPr')
    const style = val(kid(ppr, 'w:pStyle')) ?? defaultParaStyle ?? ''
    const paraStyles = chain(style)
    const tableStyles = chain(scope.tableStyle)
    const paraLevels = [ppr, ...paraStyles.map((s) => s.ppr), ...tableStyles.map((s) => s.ppr), defaultPpr]
    const pProp = (tag: string): El | undefined => {
      for (const level of paraLevels) {
        const found = kid(level, tag)
        if (found) return found
      }
      return undefined
    }
    /** An attribute is inherited on its own: `line` set here does not hide `after` set by a style. */
    const pAttr = (tag: string, ...names: string[]): number | undefined => {
      for (const level of paraLevels) {
        const found = kid(level, tag)
        for (const name of names) {
          const n = numAttr(found, name)
          if (n !== undefined) return n
        }
      }
      return undefined
    }
    const runLevels = (rpr: El | undefined): (El | undefined)[] => [
      rpr,
      ...chain(val(kid(rpr, 'w:rStyle'))).map((s) => s.rpr),
      ...paraStyles.map((s) => s.rpr),
      ...tableStyles.map((s) => s.rpr),
      defaultRpr
    ]
    const rProp = (levels: (El | undefined)[], tag: string): El | undefined => {
      for (const level of levels) {
        const found = kid(level, tag)
        if (found) return found
      }
      return undefined
    }
    const sizeOf = (levels: (El | undefined)[]): number => (numAttr(rProp(levels, 'w:sz'), 'w:val') ?? 20) / 2

    const lineRule = pProp('w:spacing')?.attrs['w:lineRule']
    const lineRaw = pAttr('w:spacing', 'w:line')
    const exact = lineRaw !== undefined && (lineRule === 'exact' || lineRule === 'atLeast')
    const numPr = pProp('w:numPr')
    const numId = val(kid(numPr, 'w:numId'))
    const para: WordPara = {
      type: 'p',
      runs: [],
      drawings: [],
      text: '',
      before: (pAttr('w:spacing', 'w:before') ?? 0) * TWIP,
      after: (pAttr('w:spacing', 'w:after') ?? 0) * TWIP,
      line: exact || lineRaw === undefined ? 1 : lineRaw / 240,
      lineExact: exact && lineRaw !== undefined ? lineRaw * TWIP : null,
      align: ALIGN[val(pProp('w:jc')) ?? 'left'] ?? 'left',
      indent: (pAttr('w:ind', 'w:left', 'w:start') ?? 0) * TWIP,
      list: numId && numId !== '0' ? { numId, level: Number(val(kid(numPr, 'w:ilvl')) ?? 0) || 0 } : null,
      markSize: sizeOf(runLevels(kid(ppr, 'w:rPr'))),
      style,
      contextual: isOn(pProp('w:contextualSpacing')) ?? false
    }

    const addRun = (r: El): void => {
      const rpr = kid(r, 'w:rPr')
      const levels = runLevels(rpr)
      if (isOn(rProp(levels, 'w:vanish'))) return
      const rawColor = val(rProp(levels, 'w:color'))
      let text = ''
      for (const k of r.kids) {
        if (k.tag === 'w:t') text += k.text
        else if (k.tag === 'w:tab') text += '\t'
        else if (k.tag === 'w:br' && k.attrs['w:type'] !== 'page' && k.attrs['w:type'] !== 'column') text += '\n'
        else if (k.tag === 'w:cr') text += '\n'
        else if (k.tag === 'w:noBreakHyphen') text += '-'
        else if (k.tag === 'w:drawing') {
          const d = parseDrawing(k, scope)
          if (d) para.drawings.push(d)
        } else if (k.tag === 'w:pict' || k.tag === 'w:object') {
          skipped += 1
        }
      }
      if (text === '') return
      para.runs.push({
        text,
        size: sizeOf(levels),
        bold: isOn(rProp(levels, 'w:b')) ?? false,
        color: rawColor && /^[0-9a-fA-F]{6}$/.test(rawColor) ? `#${rawColor.toLowerCase()}` : null
      })
      para.text += text
    }
    /** Runs can sit inside links, fields and other wrappers; deleted text is left out. */
    const WRAPPERS = ['w:hyperlink', 'w:smartTag', 'w:ins', 'w:fldSimple', 'w:sdt', 'w:sdtContent', 'w:customXml', 'w:dir', 'w:bdo']
    const walk = (parent: El, depth: number): void => {
      for (const k of parent.kids) {
        if (k.tag === 'w:r') addRun(k)
        else if (WRAPPERS.includes(k.tag) && depth < 12) walk(k, depth + 1)
      }
    }
    walk(el, 0)
    return para
  }

  const borderDrawn = (side: El | undefined): boolean | undefined => {
    if (!side) return undefined
    const v = val(side)
    return !(v === 'nil' || v === 'none')
  }
  const anyBorder = (borders: El | undefined): boolean | undefined =>
    borders ? borders.kids.some((side) => borderDrawn(side) === true) : undefined

  const parseTable = (el: El, scope: Scope): WordTable => {
    const tblPr = kid(el, 'w:tblPr')
    const tableStyle = val(kid(tblPr, 'w:tblStyle')) ?? defaultTableStyle
    const inner: Scope = { ...scope, tableStyle }
    let grid = kids(kid(el, 'w:tblGrid'), 'w:gridCol').map((c) => (numAttr(c, 'w:w') ?? 0) * TWIP)
    const rows: WordRow[] = []
    let cellCount = 0
    let cellsWithBorders = 0
    for (const tr of kids(el, 'w:tr')) {
      const trPr = kid(tr, 'w:trPr')
      const row: WordRow = { height: (numAttr(kid(trPr, 'w:trHeight'), 'w:val') ?? 0) * TWIP, cells: [] }
      let col = numAttr(kid(trPr, 'w:gridBefore'), 'w:val') ?? 0
      for (const tc of kids(tr, 'w:tc')) {
        const tcPr = kid(tc, 'w:tcPr')
        const span = Math.max(1, numAttr(kid(tcPr, 'w:gridSpan'), 'w:val') ?? 1)
        const borders: WordCell['borders'] = {}
        for (const side of ['top', 'left', 'bottom', 'right'] as const) {
          const drawn = borderDrawn(kid(kid(tcPr, 'w:tcBorders'), `w:${side}`))
          if (drawn !== undefined) borders[side] = drawn
        }
        cellCount += 1
        if (Object.values(borders).some(Boolean)) cellsWithBorders += 1
        row.cells.push({ col, span, flow: parseFlow(tc, inner), borders })
        col += span
      }
      rows.push(row)
    }
    if (grid.length === 0) {
      // No grid given: take the widths the cells of the first row ask for.
      const first = kids(el, 'w:tr')[0]
      grid = kids(first, 'w:tc').map((tc) => (numAttr(kid(kid(tc, 'w:tcPr'), 'w:tcW'), 'w:w') ?? 0) * TWIP)
    }
    const fromTable =
      anyBorder(kid(tblPr, 'w:tblBorders')) ??
      chain(tableStyle)
        .map((s) => anyBorder(kid(s.tblPr, 'w:tblBorders')))
        .find((b) => b !== undefined)
    return {
      type: 't',
      grid,
      bordered: fromTable === true || (cellCount > 0 && cellsWithBorders * 2 >= cellCount),
      rows
    }
  }

  function parseFlow(container: El, scope: Scope): WordFlow[] {
    const out: WordFlow[] = []
    for (const k of container.kids) {
      if (k.tag === 'w:p') out.push(parsePara(k, scope))
      else if (k.tag === 'w:tbl') out.push(parseTable(k, scope))
      else if (k.tag === 'w:sdt') out.push(...parseFlow(kid(k, 'w:sdtContent') ?? k, scope))
    }
    return out
  }

  // ---- page, header and footer

  const section = kids(body, 'w:sectPr').pop()
  const size = kid(section, 'w:pgSz')
  const margins = kid(section, 'w:pgMar')
  const mm = (el: El | undefined, name: string, fallback: number): number => {
    const n = numAttr(el, name)
    return n === undefined ? fallback : Math.abs(n) * TWIP
  }
  const page: WordPage = {
    w: mm(size, 'w:w', 210),
    h: mm(size, 'w:h', 297),
    top: mm(margins, 'w:top', 25.4),
    right: mm(margins, 'w:right', 25.4),
    bottom: mm(margins, 'w:bottom', 25.4),
    left: mm(margins, 'w:left', 25.4),
    header: mm(margins, 'w:header', 12.7),
    footer: mm(margins, 'w:footer', 12.7)
  }

  /** The header or footer of the first page: its own when the file has one, else the usual one. */
  const edgePart = (tag: 'w:headerReference' | 'w:footerReference', root: 'w:hdr' | 'w:ftr'): WordFlow[] => {
    const refs = kids(section, tag)
    const pick =
      (kid(section, 'w:titlePg') && refs.find((r) => r.attrs['w:type'] === 'first')) ||
      refs.find((r) => r.attrs['w:type'] === 'default') ||
      refs[0]
    const part = pick?.attrs['r:id'] ? mainRels.get(pick.attrs['r:id'])?.target : undefined
    const content = part ? kid(xml(part), root) : undefined
    return part && content ? parseFlow(content, { part, rels: relsOf(part) }) : []
  }

  return {
    page,
    body: parseFlow(body, { part: mainPart, rels: mainRels }),
    header: edgePart('w:headerReference', 'w:hdr'),
    footer: edgePart('w:footerReference', 'w:ftr'),
    image: (file) => zip.read(file),
    spacingShared,
    numbered,
    get skipped() {
      return skipped
    }
  }
}
