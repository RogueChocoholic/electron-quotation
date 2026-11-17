export type Align = 'left' | 'center' | 'right' | 'justify'

/** Asset ids look like "<sha256 prefix>.<ext>" and resolve to files in the app's asset store. */
export type AssetId = string

export interface HeaderLine {
  id: string
  icon: AssetId | null
  text: string
}

export interface Logo {
  id: string
  asset: AssetId
  /** Position of the top-left corner from the page's top-left corner, in mm. */
  x: number
  y: number
  /** Width in mm. Height follows from `ratio`. */
  width: number
  /** Natural height divided by natural width. */
  ratio: number
}

export interface HeaderConfig {
  /** Full-page image drawn behind everything on every page. */
  background: AssetId | null
  logos: Logo[]
  companyName: string
  lines: HeaderLine[]
  /** Offset of the contact details block from the top and right page edges, in mm. */
  detailsTop: number
  detailsRight: number
}

export interface PageConfig {
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  footerText: string
  /** Distance from the bottom page edge to the bottom of the footer text, in mm. */
  footerBottom: number
}

interface BlockBase {
  id: string
  /** Empty space above the block, in mm. */
  spaceBefore: number
}

export interface TextBlock extends BlockBase {
  type: 'text'
  text: string
  /** Font size in pt. */
  size: number
  bold: boolean
  color: string
  align: Align
}

export type FieldBind = 'number' | 'date' | 'customer' | null

export interface FieldRow {
  id: string
  label: string
  value: string
  bold: boolean
  /**
   * 'number' and 'date' rows show the quotation's own number and date.
   * 'customer' marks the row whose value is listed as the customer name.
   */
  bind: FieldBind
}

export interface FieldsBlock extends BlockBase {
  type: 'fields'
  left: FieldRow[]
  right: FieldRow[]
  /** Width of the left column in mm; the right column takes the rest. */
  split: number
  leftLabelWidth: number
  rightLabelWidth: number
  size: number
}

export interface ItemRow {
  id: string
  description: string
  qty: string
  /** Price per unit, as typed. */
  price: string
}

export interface ItemsBlock extends BlockBase {
  type: 'items'
  descriptionLabel: string
  qtyLabel: string
  amountLabel: string
  totalLabel: string
  rows: ItemRow[]
  /** When true the per-row amounts stay editable on screen but are left blank in exports. */
  hideRowAmounts: boolean
  size: number
}

export interface ListItem {
  id: string
  text: string
}

export interface ListBlock extends BlockBase {
  type: 'list'
  items: ListItem[]
  size: number
  color: string
}

export interface ImageItem {
  id: string
  asset: AssetId
  /** Natural width divided by natural height. */
  ratio: number
}

export interface ImagesBlock extends BlockBase {
  type: 'images'
  images: ImageItem[]
  /** Height of every image in the row, in mm. */
  height: number
  gap: number
  align: 'left' | 'center' | 'right'
  showCaption: boolean
  caption: string
}

export interface AccountBlock extends BlockBase {
  type: 'account'
  heading: string
  size: number
}

export type Block = TextBlock | FieldsBlock | ItemsBlock | ListBlock | ImagesBlock | AccountBlock
export type BlockType = Block['type']

export type DocKind = 'quotation' | 'template'

export interface QDoc {
  schema: 1
  id: string
  kind: DocKind
  /** Template name. Unused for quotations. */
  name: string
  number: string
  date: string
  accountId: string | null
  header: HeaderConfig
  page: PageConfig
  blocks: Block[]
  createdAt: string
  updatedAt: string
}

export interface DocMeta {
  id: string
  kind: DocKind
  name: string
  number: string
  date: string
  customer: string
  total: number
  accountId: string | null
  updatedAt: string
}

export interface Account {
  id: string
  /** Short name shown in pickers, e.g. "Sampath - Tangalle". */
  name: string
  holder: string
  number: string
  bank: string
  branch: string
}

export interface Numbering {
  auto: boolean
  prefix: string
  /** Insert the 2-digit year after the prefix. */
  includeYear: boolean
  /** Restart the counter at 1 when the year changes. */
  yearlyReset: boolean
  digits: number
  nextSeq: number
  /** The year `nextSeq` belongs to. */
  seqYear: number
}

export interface Settings {
  schema: 1
  accounts: Account[]
  defaultAccountId: string | null
  numbering: Numbering
  lastTemplateId: string | null
}

export interface PickedImage {
  asset: AssetId
  width: number
  height: number
}

export type UpdateState = 'dev' | 'idle' | 'checking' | 'downloading' | 'ready' | 'none' | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** Version being downloaded or ready to install. */
  version?: string
  percent?: number
  message?: string
  checkedAt?: string
}

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export interface ImportResult {
  ok: boolean
  canceled?: boolean
  ids?: string[]
  error?: string
}

export interface AppInfo {
  version: string
  dataPath: string
  packaged: boolean
}

/** The API exposed to the renderer by the preload script. */
export interface Api {
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    openPath(path: string): Promise<void>
    showInFolder(path: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    save(settings: Settings): Promise<Settings>
  }
  docs: {
    list(): Promise<DocMeta[]>
    get(id: string): Promise<QDoc | null>
    save(doc: QDoc): Promise<QDoc>
    /** Blocks until the document is on disk. Used only while the window is closing. */
    saveSync(doc: QDoc): boolean
    remove(id: string): Promise<void>
    createDefaultTemplate(): Promise<QDoc>
  }
  assets: {
    pick(): Promise<PickedImage | null>
  }
  templates: {
    exportFile(id: string): Promise<ExportResult>
    importFile(): Promise<ImportResult>
  }
  exporter: {
    pdf(doc: QDoc): Promise<ExportResult>
    docx(doc: QDoc): Promise<ExportResult>
  }
  update: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    install(): Promise<void>
    onStatus(cb: (status: UpdateStatus) => void): () => void
  }
  print: {
    payload(): Promise<{ doc: QDoc; account: Account | null } | null>
    ready(): void
  }
}
