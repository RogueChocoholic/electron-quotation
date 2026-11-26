import { app, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_VERSION, NEWER_DATA_MESSAGE, collectAssets, docMeta, isNewerData, remapAssets, uid } from '@shared/calc'
import { ASSET_RE, ID_RE, sanitizeDoc, sanitizeSettings } from '@shared/sanitize'
import {
  BUILTIN_DESIGN,
  BUILTIN_INVOICE,
  BUILTIN_INVOICE_NAME,
  BUILTIN_TEMPLATE_NAME,
  ITEMS_DEFAULTS,
  buildDefaultTemplate,
  buildInvoiceTemplate,
  defaultSettings,
  type SeedAssets
} from '@shared/seed'
import type { AssetId, DocMeta, DocType, PickedImage, QDoc, Settings } from '@shared/types'
import seedBackground from '../../resources/seed/background.png?asset'
import seedIconLocation from '../../resources/seed/icon-1.png?asset'
import seedIconEmail from '../../resources/seed/icon-2.png?asset'
import seedIconPhone from '../../resources/seed/icon-3.png?asset'
import seedLogo from '../../resources/seed/logo.png?asset'
import seedPhotoInside from '../../resources/seed/photo-1.jpg?asset'
import seedPhotoOutside from '../../resources/seed/photo-2.jpg?asset'
import { DocxError } from './docxRead'
import { docxToTemplate } from './importDocx'

/**
 * All user data lives in the per-user app data folder, outside the install directory,
 * so installing an update never touches it:
 *
 *   settings.json        bank accounts and numbering
 *   docs/<id>.json       quotations, invoices and templates
 *   assets/<hash>.<ext>  images, stored once and referenced by id
 *   shipped.json         which templates that came with the app this PC has been given
 *   log.txt              which versions were started here, and anything that went wrong at start
 */

export const dataDir = (): string => app.getPath('userData')
const docsDir = (): string => path.join(dataDir(), 'docs')
const assetsDir = (): string => path.join(dataDir(), 'assets')
const settingsFile = (): string => path.join(dataDir(), 'settings.json')
const docFile = (id: string): string => path.join(docsDir(), `${id}.json`)
const shippedFile = (): string => path.join(dataDir(), 'shipped.json')
const logFile = (): string => path.join(dataDir(), 'log.txt')

const LOG_MAX_BYTES = 256 * 1024

/**
 * Adds a line to log.txt in the data folder. A packaged app has no console to look at, so
 * this is where a problem on someone else's PC can be read afterwards.
 */
export function logLine(message: string, err?: unknown): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    const file = logFile()
    // Once the file has grown, its older half is dropped.
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) {
      const text = fs.readFileSync(file, 'utf8')
      fs.writeFileSync(file, text.slice(text.indexOf('\n', Math.floor(text.length / 2)) + 1), 'utf8')
    }
    const detail = err === undefined ? '' : `: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    fs.appendFileSync(file, `${new Date().toISOString()}  v${app.getVersion()}  ${message}${detail}\n`, 'utf8')
  } catch {
    // Logging must never be what stops the app.
  }
}

function ensureDirs(): void {
  fs.mkdirSync(docsDir(), { recursive: true })
  fs.mkdirSync(assetsDir(), { recursive: true })
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Writes via a temporary file so a crash mid-write cannot leave a half-written document. */
function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

// ---------------------------------------------------------------- assets

export function assetPath(id: AssetId): string | null {
  return ASSET_RE.test(id) ? path.join(assetsDir(), id) : null
}

export function readAsset(id: AssetId): Buffer | null {
  const file = assetPath(id)
  if (!file) return null
  try {
    return fs.readFileSync(file)
  } catch {
    return null
  }
}

function imageExt(buf: Buffer): 'png' | 'jpg' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  return null
}

/** Stores a PNG or JPEG and returns its id and pixel size. Returns null for anything else. */
export function importAssetBuffer(buf: Buffer): PickedImage | null {
  const ext = imageExt(buf)
  if (!ext) return null
  const { width, height } = nativeImage.createFromBuffer(buf).getSize()
  if (!width || !height) return null
  ensureDirs()
  const asset = `${createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`
  const file = path.join(assetsDir(), asset)
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf)
  return { asset, width, height }
}

export function importAssetFile(file: string): PickedImage | null {
  try {
    return importAssetBuffer(fs.readFileSync(file))
  } catch {
    return null
  }
}

// -------------------------------------------------------------- settings

export function getSettings(): Settings {
  const raw = readJson(settingsFile())
  return raw ? sanitizeSettings(raw) : defaultSettings()
}

export function saveSettings(settings: unknown): Settings {
  ensureDirs()
  const clean = sanitizeSettings(settings)
  // Anything in the file this version does not know was put there by a newer one, and is kept.
  const existing = readJson(settingsFile())
  const kept = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  writeJson(settingsFile(), { ...kept, ...clean })
  return clean
}

// ------------------------------------------------------------- documents

export function getDoc(id: string): QDoc | null {
  if (!ID_RE.test(id)) return null
  const doc = sanitizeDoc(readJson(docFile(id)))
  // The file name is the source of truth for the id.
  return doc ? { ...doc, id } : null
}

export function listDocs(): DocMeta[] {
  ensureDirs()
  const out: DocMeta[] = []
  for (const name of fs.readdirSync(docsDir())) {
    if (!name.endsWith('.json')) continue
    const doc = getDoc(name.slice(0, -5))
    if (doc) out.push(docMeta(doc))
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** The data version of the file a document is stored in, read without cleaning it up first. */
function storedDataVersion(id: string): number {
  const raw = readJson(docFile(id)) as { dataVersion?: unknown } | null
  return raw && typeof raw === 'object' && typeof raw.dataVersion === 'number' ? raw.dataVersion : 0
}

export function saveDoc(input: unknown): QDoc {
  const clean = sanitizeDoc(input)
  if (!clean) throw new Error('This document could not be saved because its data is not valid.')
  ensureDirs()
  // Reading a newer document has already dropped what this version does not know. Writing it
  // back, over the original or as a copy, would make that loss permanent.
  if (isNewerData(clean) || storedDataVersion(clean.id) > DATA_VERSION) throw new Error(NEWER_DATA_MESSAGE)
  const doc: QDoc = { ...clean, updatedAt: new Date().toISOString(), dataVersion: DATA_VERSION }
  writeJson(docFile(doc.id), doc)
  return doc
}

export function deleteDoc(id: string): void {
  if (!ID_RE.test(id)) return
  fs.rmSync(docFile(id), { force: true })
}

// ------------------------------------------------------------------ seed

function seedAssets(): SeedAssets {
  const load = (file: string): PickedImage => {
    const picked = importAssetFile(file)
    if (!picked) throw new Error(`Built-in image is missing or unreadable: ${path.basename(file)}`)
    return picked
  }
  return {
    background: load(seedBackground),
    logo: load(seedLogo),
    iconLocation: load(seedIconLocation),
    iconEmail: load(seedIconEmail),
    iconPhone: load(seedIconPhone),
    photoOutside: load(seedPhotoOutside),
    photoInside: load(seedPhotoInside)
  }
}

/** Adds a fresh copy of the built-in quotation or invoice design to the template list. */
export function createDefaultTemplate(docType: DocType = 'quotation'): QDoc {
  const { defaultAccountId } = getSettings()
  const build = docType === 'invoice' ? buildInvoiceTemplate : buildDefaultTemplate
  return saveDoc(build(seedAssets(), defaultAccountId))
}

/** A document's design with everything that differs from copy to copy (ids, dates, account) left out. */
function designFingerprint(doc: QDoc): string {
  const clean = sanitizeDoc(doc)
  if (!clean) return ''
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    accountId: _account,
    dataVersion: _version,
    ...design
  } = clean
  return JSON.stringify(design, (key, value) => (key === 'id' ? undefined : value))
}

/**
 * Runs once after an update that ships a newer built-in design.
 *
 * Templates that are still an exact, unedited copy of the old built-in design are replaced
 * with the new one. If the user has changed theirs, it is left alone and the new design is
 * added beside it. Quotations and invoices are never touched.
 */
function upgradeBuiltinDesign(): void {
  const settings = getSettings()
  if (settings.builtinDesign >= BUILTIN_DESIGN) return
  const assets = seedAssets()
  const previous = designFingerprint(buildDefaultTemplate(assets, null, settings.builtinDesign))
  const templates = listDocs()
    .filter((m) => m.kind === 'template' && m.docType === 'quotation')
    .flatMap((m) => getDoc(m.id) ?? [])
    .filter((t) => !isNewerData(t))

  let replaced = 0
  for (const old of templates) {
    if (designFingerprint(old) !== previous) continue
    saveDoc({ ...buildDefaultTemplate(assets, old.accountId), id: old.id, createdAt: old.createdAt })
    replaced += 1
  }
  if (replaced === 0) {
    const taken = templates.some((t) => t.name === BUILTIN_TEMPLATE_NAME)
    saveDoc({
      ...buildDefaultTemplate(assets, settings.defaultAccountId),
      name: taken ? `${BUILTIN_TEMPLATE_NAME} (new design)` : BUILTIN_TEMPLATE_NAME
    })
  }
  saveSettings({ ...settings, builtinDesign: BUILTIN_DESIGN })
}

/**
 * Runs once after the update that brought invoices: gives a PC that was set up before then
 * the built-in invoice template. Nothing that is already there is changed.
 */
function addBuiltinInvoice(): void {
  const settings = getSettings()
  if (settings.builtinInvoice >= BUILTIN_INVOICE) return
  const taken = listDocs().some((m) => m.kind === 'template' && m.name === BUILTIN_INVOICE_NAME)
  saveDoc({
    ...buildInvoiceTemplate(seedAssets(), settings.defaultAccountId),
    name: taken ? `${BUILTIN_INVOICE_NAME} (built-in)` : BUILTIN_INVOICE_NAME
  })
  saveSettings({ ...settings, builtinInvoice: BUILTIN_INVOICE })
}

// ------------------------------------------- what this PC has been given

interface ShippedTemplate {
  /** Hash of the file that was added, to tell when a release brings a changed one. */
  hash: string
  /** The template it became on this PC. */
  docId: string
  /** That template's time of last change when it was added; still the same means untouched. */
  savedAt: string
}

/**
 * Kept in a file of its own rather than in settings.json: versions of the app that do not
 * know about it leave it alone, where they would drop an unknown setting when saving.
 */
interface Shipped {
  /** One-off repairs that have been made on this PC, by name. */
  repairs: Record<string, number>
  /** Template files that came with the app and were added on this PC, by file name. */
  templates: Record<string, ShippedTemplate>
}

function readShipped(): Shipped {
  const raw = readJson(shippedFile()) as Partial<Shipped> | null
  const out: Shipped = { repairs: {}, templates: {} }
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw.repairs ?? {})) {
    if (typeof value === 'number') out.repairs[key] = value
  }
  for (const [key, value] of Object.entries(raw.templates ?? {})) {
    if (!value || typeof value !== 'object') continue
    const { hash, docId, savedAt } = value as Partial<ShippedTemplate>
    if (typeof hash === 'string' && typeof docId === 'string' && typeof savedAt === 'string') {
      out.templates[key] = { hash, docId, savedAt }
    }
  }
  return out
}

/**
 * Runs once on every PC: if there is no invoice template at all, the built-in one is added.
 *
 * `addBuiltinInvoice` relies on a marker in settings.json, and that marker can say "done"
 * on a PC that has no invoice template: for example when a version from before invoices
 * re-saved the template, which made it a quotation template. Looking at what is actually
 * there does not depend on how the PC got into that state.
 */
function restoreInvoiceTemplate(): void {
  const shipped = readShipped()
  if (shipped.repairs.invoiceTemplate) return
  const present = listDocs().some((m) => m.kind === 'template' && m.docType === 'invoice')
  if (!present) {
    createDefaultTemplate('invoice')
    logLine('This PC had no invoice template; the built-in one was added.')
  }
  writeJson(shippedFile(), { ...readShipped(), repairs: { ...shipped.repairs, invoiceTemplate: 1 } })
}

/** Template files in this project folder are packed into the installer; see its README. */
const bundledDir = (): string => path.join(app.getAppPath(), 'resources', 'templates')

const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32)

/** The same for two templates that look the same, whatever they are called. */
const sameDesignKey = (doc: QDoc): string => sha(designFingerprint({ ...doc, name: '' }))

function freeName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${n})`
    if (!taken.includes(candidate)) return candidate
  }
}

/**
 * Adds one template file that came with the app, unless this PC already has this very file.
 *
 * - A design that is already among the templates (as on the PC it was made on) is not added twice.
 * - When a release brings a changed file, the template added from the earlier file is replaced
 *   if nobody has touched it; otherwise it is left alone and the new one is added beside it.
 * - A template that was deleted stays deleted until the file changes.
 */
function deliverBundledTemplate(name: string): void {
  const text = fs.readFileSync(path.join(bundledDir(), name), 'utf8')
  const hash = sha(text)
  const before = readShipped().templates[name]
  if (before?.hash === hash) return

  const incoming = readTemplateBundle(text)
  const templates = listDocs()
    .filter((m) => m.kind === 'template')
    .flatMap((m) => getDoc(m.id) ?? [])
    .filter((t) => !isNewerData(t))
  const key = sameDesignKey(incoming)
  const same = templates.find((t) => sameDesignKey(t) === key)
  const earlier = before ? templates.find((t) => t.id === before.docId) : undefined

  let result: QDoc
  let what: string
  if (same) {
    result = same
    what = 'was already among the templates'
  } else if (earlier && before && earlier.updatedAt === before.savedAt) {
    result = saveDoc({ ...incoming, id: earlier.id, createdAt: earlier.createdAt, accountId: earlier.accountId })
    what = 'replaced the earlier one'
  } else {
    const taken = templates.filter((t) => t.docType === incoming.docType).map((t) => t.name)
    result = saveDoc({ ...incoming, name: freeName(incoming.name, taken) })
    what = `was added as "${result.name}"`
  }
  const shipped = readShipped()
  writeJson(shippedFile(), {
    ...shipped,
    templates: { ...shipped.templates, [name]: { hash, docId: result.id, savedAt: result.updatedAt } }
  })
  logLine(`The template file ${name} that came with the app ${what}.`)
}

function deliverBundledTemplates(): void {
  let names: string[]
  try {
    names = fs
      .readdirSync(bundledDir())
      .filter((n) => n.toLowerCase().endsWith('.qtpl'))
      .sort()
  } catch {
    // No folder, no templates to add.
    return
  }
  for (const name of names) {
    try {
      deliverBundledTemplate(name)
    } catch (err) {
      logLine(`The template file ${name} that came with the app could not be added`, err)
    }
  }
}

/**
 * On the very first launch, writes the default settings and the built-in templates.
 * On every launch, brings the templates up to date with what this version of the app brings.
 */
export function ensureSeed(): void {
  ensureDirs()
  logLine('Started.')
  if (!fs.existsSync(settingsFile())) {
    saveSettings(defaultSettings())
    createDefaultTemplate('quotation')
    createDefaultTemplate('invoice')
  }
  // Each step stands on its own, so one failing does not hold the others back. None is worth
  // stopping the app for: a step that failed is tried again on the next start.
  const steps: [string, () => void][] = [
    ['bring the built-in quotation design up to date', upgradeBuiltinDesign],
    ['add the built-in invoice template', addBuiltinInvoice],
    ['check that there is an invoice template', restoreInvoiceTemplate],
    ['add the templates that came with the app', deliverBundledTemplates]
  ]
  for (const [what, step] of steps) {
    try {
      step()
    } catch (err) {
      logLine(`Could not ${what}`, err)
    }
  }
}

// ------------------------------------------------- template import/export

const TEMPLATE_FORMAT = 'quotation-maker-template'

/**
 * Version 2 added the header title and grey detail rows; version 3 added table rows without
 * a quantity cell; version 4 added invoices, with the table and text options they brought.
 * A file is marked with the version it needs, so that an app too old to show something says
 * "update the app" instead of quietly dropping it.
 */
const TEMPLATE_VERSION = 4

function templateVersionNeeded(doc: QDoc): number {
  const sinceInvoices =
    doc.docType === 'invoice' ||
    doc.blocks.some((b) => {
      if (b.type === 'text') return b.lead !== '' || b.indent !== 0
      if (b.type !== 'items') return false
      return (Object.keys(ITEMS_DEFAULTS) as (keyof typeof ITEMS_DEFAULTS)[]).some(
        // The labels and the amount paid only show when the payment rows are switched on.
        (key) => !['paidLabel', 'paid', 'balanceLabel'].includes(key) && b[key] !== ITEMS_DEFAULTS[key]
      )
    })
  if (sinceInvoices) return 4
  const rowsWithoutQty = doc.blocks.some((b) => b.type === 'items' && b.rows.some((r) => !r.hasQty))
  return rowsWithoutQty ? 3 : 2
}

interface TemplateBundle {
  format: typeof TEMPLATE_FORMAT
  version: number
  template: QDoc
  /** Asset id to base64 file contents. */
  assets: Record<string, string>
}

/** A self-contained file: the template plus every image it uses. */
export function buildTemplateBundle(doc: QDoc): string {
  const assets: Record<string, string> = {}
  for (const id of collectAssets(doc)) {
    const buf = readAsset(id)
    if (buf) assets[id] = buf.toString('base64')
  }
  const bundle: TemplateBundle = {
    format: TEMPLATE_FORMAT,
    version: templateVersionNeeded(doc),
    template: { ...doc, kind: 'template' },
    assets
  }
  return JSON.stringify(bundle)
}

/**
 * Reads a bundle into a new template that is ready to be saved, and stores its images.
 * Throws with a readable message when the file is not usable.
 */
function readTemplateBundle(text: string): QDoc {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The file is not a valid template file.')
  }
  const bundle = parsed as Partial<TemplateBundle> | null
  if (!bundle || typeof bundle !== 'object' || bundle.format !== TEMPLATE_FORMAT) {
    throw new Error('The file is not a Quotation Maker template.')
  }
  if (typeof bundle.version !== 'number' || bundle.version < 1 || bundle.version > TEMPLATE_VERSION) {
    throw new Error('This template was made with a newer version of the app. Update the app and try again.')
  }
  const template = sanitizeDoc(bundle.template)
  if (!template) throw new Error('The template inside the file is damaged.')
  // The template itself also says which version saved it; see DATA_VERSION.
  if (isNewerData(template)) {
    throw new Error('This template was made with a newer version of the app. Update the app and try again.')
  }

  // Re-store every image; ids are content hashes, so they are recomputed rather than trusted.
  const idMap = new Map<AssetId, AssetId>()
  const assets = bundle.assets && typeof bundle.assets === 'object' ? bundle.assets : {}
  for (const [oldId, b64] of Object.entries(assets)) {
    if (typeof b64 !== 'string') continue
    const stored = importAssetBuffer(Buffer.from(b64, 'base64'))
    if (stored) idMap.set(oldId, stored.asset)
  }
  const missing = collectAssets(template).filter((a) => !idMap.has(a))
  if (missing.length) throw new Error('The template file is missing some of its images.')

  const settings = getSettings()
  const now = new Date().toISOString()
  const remapped = remapAssets(template, (a) => idMap.get(a) ?? a)
  return {
    ...remapped,
    id: uid(),
    kind: 'template',
    name: remapped.name || 'Imported template',
    number: '',
    date: '',
    // Bank accounts are per-PC settings and are not part of a template file.
    accountId: settings.accounts.some((a) => a.id === remapped.accountId)
      ? remapped.accountId
      : settings.defaultAccountId,
    createdAt: now,
    updatedAt: now,
    dataVersion: DATA_VERSION
  }
}

/** Imports a bundle as a new template. */
export function importTemplateBundle(text: string): QDoc {
  return saveDoc(readTemplateBundle(text))
}

const WORD_FILE_MAX_BYTES = 100 * 1024 * 1024

/**
 * Makes a new template from a Word file. `fallbackType` is what it becomes when the file
 * itself does not say whether it is a quotation or an invoice.
 */
export function importWordFile(file: string, fallbackType: DocType): { doc: QDoc; notes: string[] } {
  if (fs.statSync(file).size > WORD_FILE_MAX_BYTES) {
    throw new DocxError('This Word file is too large to make a template from (over 100 MB).')
  }
  const settings = getSettings()
  const { doc, notes } = docxToTemplate(fs.readFileSync(file), {
    name: path.basename(file).replace(/\.[^.]+$/, ''),
    fallbackType,
    accountId: settings.defaultAccountId,
    storeImage: importAssetBuffer
  })
  const taken = listDocs()
    .filter((m) => m.kind === 'template' && m.docType === doc.docType)
    .map((m) => m.name)
  return { doc: saveDoc({ ...doc, name: freeName(doc.name, taken) }), notes }
}
