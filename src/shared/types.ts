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

/** A line of text placed in the header band, e.g. the word "QUOTATION" beside the logo. */
export interface HeaderTitle {
  text: string
  /** Position of the text's top-left corner from the page's top-left corner, in mm. */
  x: number
  y: number
  /** Font size in pt. */
  size: number
  bold: boolean
}

export interface HeaderConfig {
  /** Full-page image drawn behind everything on every page. */
  background: AssetId | null
  logos: Logo[]
  /** Shown on every page, like the rest of the header. Null when the design has none. */
  title: HeaderTitle | null
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
  /** Bold words printed in front of the text on its first line, e.g. "Specification:". */
  lead: string
  text: string
  /** Distance in mm the text is set in from the left margin, e.g. to line up with a table's text. */
  indent: number
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
  /** Label and value are printed in grey, for secondary details. */
  muted: boolean
  /**
   * 'number' and 'date' rows show the document's own number and date.
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
  /**
   * False for a row without a quantity cell: the description runs across the quantity
   * column, and the amount, if one is typed, counts as it stands. `qty` is kept so that
   * it comes back when the cell is switched on again.
   */
  hasQty: boolean
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
  /** False leaves the quantity column out of the whole table; every amount then counts as typed. */
  showQty: boolean
  /** Width of the amount column in mm. */
  amountWidth: number
  /** 'always' prints every amount with cents (185,000.00); 'auto' only when there are any. */
  decimals: AmountDecimals
  showTotal: boolean
  /** Draws the label cells of the rows under the items with borders, like the rows above them. */
  boxTotals: boolean
  /** Adds a row for an amount already paid, typed in the table, and a row for what is left. */
  showPayment: boolean
  paidLabel: string
  /** The amount paid, as typed. */
  paid: string
  balanceLabel: string
}

export type AmountDecimals = 'auto' | 'always'

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

/** A template, or a document made from one. */
export type DocKind = 'document' | 'template'

/**
 * What a document or template is for. Both types are built from the same sections; they
 * differ in their built-in template, their number series and where they are listed.
 */
export type DocType = 'quotation' | 'invoice'

export interface QDoc {
  schema: 1
  id: string
  kind: DocKind
  docType: DocType
  /** Template name. Unused for documents. */
  name: string
  number: string
  date: string
  accountId: string | null
  header: HeaderConfig
  page: PageConfig
  blocks: Block[]
  createdAt: string
  updatedAt: string
  /**
   * The data format of the app version that last saved this document (see DATA_VERSION).
   * 0 for documents saved before the field existed. A document with a higher number than
   * the running app knows was saved by a newer version, and is not opened or overwritten.
   */
  dataVersion: number
}

export interface DocMeta {
  id: string
  kind: DocKind
  docType: DocType
  name: string
  number: string
  date: string
  customer: string
  total: number
  accountId: string | null
  /** Whether the page has a bank account section. */
  usesAccount: boolean
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
  /** Quotation numbers. */
  numbering: Numbering
  /** Invoice numbers: a series of their own. */
  invoiceNumbering: Numbering
  /** The template last used for a quotation, and for an invoice. */
  lastTemplateId: string | null
  lastInvoiceTemplateId: string | null
  /** Which type of document the app is currently showing. */
  mode: DocType
  /** Version of the built-in quotation design this PC's templates were last brought up to. */
  builtinDesign: number
  /** Version of the built-in invoice design this PC has been given; 0 when it has none yet. */
  builtinInvoice: number
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
  /** Things to check in a template that was made from a Word file. */
  notes?: string[]
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
    /** Adds a copy of the built-in design for this type of document to the templates. */
    createDefaultTemplate(docType: DocType): Promise<QDoc>
  }
  assets: {
    pick(): Promise<PickedImage | null>
  }
  templates: {
    exportFile(id: string): Promise<ExportResult>
    /**
     * Imports template files (.qtpl) and turns Word files (.docx) into templates.
     * `docType` is what a Word file becomes when it does not say what it is.
     */
    importFile(docType: DocType): Promise<ImportResult>
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
