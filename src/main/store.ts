import { app, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { collectAssets, docMeta, remapAssets, uid } from '@shared/calc'
import { ASSET_RE, ID_RE, sanitizeDoc, sanitizeSettings } from '@shared/sanitize'
import {
  BUILTIN_DESIGN,
  BUILTIN_TEMPLATE_NAME,
  buildDefaultTemplate,
  defaultSettings,
  type SeedAssets
} from '@shared/seed'
import type { AssetId, DocMeta, PickedImage, QDoc, Settings } from '@shared/types'
import seedBackground from '../../resources/seed/background.png?asset'
import seedIconLocation from '../../resources/seed/icon-1.png?asset'
import seedIconEmail from '../../resources/seed/icon-2.png?asset'
import seedIconPhone from '../../resources/seed/icon-3.png?asset'
import seedLogo from '../../resources/seed/logo.png?asset'
import seedPhotoInside from '../../resources/seed/photo-1.jpg?asset'
import seedPhotoOutside from '../../resources/seed/photo-2.jpg?asset'

/**
 * All user data lives in the per-user app data folder, outside the install directory,
 * so installing an update never touches it:
 *
 *   settings.json        bank accounts and numbering
 *   docs/<id>.json       quotations and templates
 *   assets/<hash>.<ext>  images, stored once and referenced by id
 */

export const dataDir = (): string => app.getPath('userData')
const docsDir = (): string => path.join(dataDir(), 'docs')
const assetsDir = (): string => path.join(dataDir(), 'assets')
const settingsFile = (): string => path.join(dataDir(), 'settings.json')
const docFile = (id: string): string => path.join(docsDir(), `${id}.json`)

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
  writeJson(settingsFile(), clean)
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

export function saveDoc(input: unknown): QDoc {
  const clean = sanitizeDoc(input)
  if (!clean) throw new Error('This document could not be saved because its data is not valid.')
  ensureDirs()
  const doc: QDoc = { ...clean, updatedAt: new Date().toISOString() }
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

/** Adds a fresh copy of the built-in design to the template list. */
export function createDefaultTemplate(): QDoc {
  const settings = getSettings()
  return saveDoc(buildDefaultTemplate(seedAssets(), settings.defaultAccountId))
}

/** A document's design with everything that differs from copy to copy (ids, dates, account) left out. */
function designFingerprint(doc: QDoc): string {
  const clean = sanitizeDoc(doc)
  if (!clean) return ''
  const { id: _id, createdAt: _created, updatedAt: _updated, accountId: _account, ...design } = clean
  return JSON.stringify(design, (key, value) => (key === 'id' ? undefined : value))
}

/**
 * Runs once after an update that ships a newer built-in design.
 *
 * Templates that are still an exact, unedited copy of the old built-in design are replaced
 * with the new one. If the user has changed theirs, it is left alone and the new design is
 * added beside it. Quotations are never touched.
 */
function upgradeBuiltinDesign(): void {
  const settings = getSettings()
  if (settings.builtinDesign >= BUILTIN_DESIGN) return
  const assets = seedAssets()
  const previous = designFingerprint(buildDefaultTemplate(assets, null, settings.builtinDesign))
  const templates = listDocs()
    .filter((m) => m.kind === 'template')
    .flatMap((m) => getDoc(m.id) ?? [])

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
 * On the very first launch, writes the default settings and the built-in template.
 * On later launches, brings the built-in template up to date if an update changed it.
 */
export function ensureSeed(): void {
  ensureDirs()
  if (!fs.existsSync(settingsFile())) {
    saveSettings(defaultSettings())
    createDefaultTemplate()
    return
  }
  try {
    upgradeBuiltinDesign()
  } catch (err) {
    // Not worth stopping the app for; it is tried again on the next start.
    console.error('Could not update the built-in template:', err)
  }
}

// ------------------------------------------------- template import/export

const TEMPLATE_FORMAT = 'quotation-maker-template'

/**
 * Version 2 added the header title and grey detail rows; version 3 added table rows without
 * a quantity cell. A file is marked with the version it needs, so that an app too old to show
 * something says "update the app" instead of quietly dropping it.
 */
const TEMPLATE_VERSION = 3

function templateVersionNeeded(doc: QDoc): number {
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

/** Imports a bundle as a new template. Throws with a readable message when the file is not usable. */
export function importTemplateBundle(text: string): QDoc {
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
  return saveDoc({
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
    updatedAt: now
  })
}
