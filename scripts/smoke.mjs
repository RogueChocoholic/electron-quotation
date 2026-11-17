// End-to-end check of the built app: starts it with a throwaway data folder, creates a
// quotation from the default template, and exports it to PDF and Word.
// Run with: npm run smoke   (output goes to .smoke/)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const work = path.join(root, '.smoke')
const dataDir = path.join(work, 'data')
const outDir = path.join(work, 'out')
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const failures = []
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

const app = await electron.launch({ args: [root, `--user-data-dir=${dataDir}`], cwd: root })
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) })

  await page.getByRole('heading', { name: 'Quotations', exact: true }).waitFor()
  const info = await page.evaluate(() => window.api.app.info())
  check(path.resolve(info.dataPath).startsWith(dataDir), `data folder is isolated (${info.dataPath})`)
  await shot('01-quotations-empty')

  await page.getByRole('button', { name: 'Templates' }).click()
  await page.getByText('Mobile Washroom Quotation').waitFor()
  await shot('02-templates')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  await shot('03-settings')

  await page.getByRole('button', { name: 'Quotations' }).click()
  await page.getByRole('button', { name: 'New quotation' }).first().click()
  await page.getByRole('dialog').waitFor()
  await shot('04-new-quotation')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.locator('.page').first().waitFor()
  await page.waitForTimeout(800)
  await shot('05-editor')
  check((await page.locator('.page').count()) === 1, 'default quotation fits on one page')

  // Type prices so the total is exercised: 8 rows, qty 1 except the first which is 2.
  const prices = page.locator('.items td.amount .et')
  const count = await prices.count()
  for (let i = 0; i < count; i++) {
    await prices.nth(i).click()
    await page.keyboard.type(String((i + 1) * 1000))
  }
  await page.locator('.items tbody tr').first().locator('td.num .et').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('2')
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(300)
  const total = (await page.locator('.items .total-value').innerText()).trim()
  const expected = count * (count + 1) * 500 + 1000
  check(Number(total.replace(/[^0-9.]/g, '')) === expected, `total is ${expected} (shown: ${total})`)
  await page.waitForTimeout(900)
  await shot('06-editor-filled')

  for (const ext of ['pdf', 'docx']) {
    const target = path.join(outDir, `quotation.${ext}`)
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, target)
    await page.getByRole('button', { name: ext === 'pdf' ? 'PDF' : 'Word', exact: true }).click()
    await page.getByText(ext === 'pdf' ? 'PDF saved.' : 'Word document saved.').waitFor({ timeout: 40000 })
    check(fs.existsSync(target) && fs.statSync(target).size > 10000, `${ext} exported (${fs.statSync(target).size} bytes)`)
  }

  const stubSave = (filePath) =>
    app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f })
    }, filePath)
  const waitForFile = async (file) => {
    for (let i = 0; i < 200 && !fs.existsSync(file); i++) await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'PDF', exact: true }).isEnabled()
    await page.waitForTimeout(300)
  }
  const menuItem = (label) => page.locator('.menu-item', { hasText: label }).first()

  // Sections can be added, removed, and the removal undone.
  const blocks = page.locator('.blk')
  const before = await blocks.count()
  await blocks.nth(3).hover()
  await blocks.nth(3).locator('.blk-gutter button').first().click()
  await menuItem('Text').click()
  await page.keyboard.type('An extra paragraph added by the smoke test.')
  check((await blocks.count()) === before + 1, 'a text section can be added')
  await shot('07-section-added')
  await blocks.nth(4).hover()
  await blocks.nth(4).locator('.blk-gutter button').nth(1).click()
  await menuItem('Delete section').click()
  check((await blocks.count()) === before, 'a section can be deleted')
  await page.getByRole('button', { name: 'Undo' }).click()
  check((await blocks.count()) === before + 1, 'deleting a section can be undone')

  // Long content flows onto a second page, with the header repeated.
  for (let i = 0; i < 22; i++) {
    await page.locator('.items-add').last().click({ force: true })
    await page.keyboard.type(`Extra item ${i + 1}`)
  }
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(900)
  const pageCount = await page.locator('.page').count()
  check(pageCount === 2, `long content flows to a second page (pages: ${pageCount})`)
  check((await page.locator('.page .hdr').count()) === pageCount, 'header repeats on every page')
  check((await page.locator('.items thead').count()) >= 1, 'items table is still present')
  await page.locator('.canvas').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shot('08-two-pages')
  const twoPages = path.join(outDir, 'two-pages.pdf')
  await stubSave(twoPages)
  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  await waitForFile(twoPages)
  check(fs.existsSync(twoPages), 'two-page PDF exported')
  const twoPagesDocx = path.join(outDir, 'two-pages.docx')
  await stubSave(twoPagesDocx)
  await page.getByRole('button', { name: 'Word', exact: true }).click()
  await waitForFile(twoPagesDocx)
  check(fs.existsSync(twoPagesDocx), 'two-page Word document exported')

  // The quotation is listed and reopens with its content.
  await page.getByRole('button', { name: 'Quotations' }).click()
  const listRow = page.locator('.list-table tbody tr').first()
  await listRow.waitFor()
  await shot('09-quotations')
  check((await listRow.innerText()).includes('MT-'), 'quotation is listed with its number')
  await listRow.click()
  await page.locator('.page').first().waitFor()
  await page.waitForTimeout(600)
  const reopened = await page.locator('.items tbody tr[data-items-row]').count()
  check(reopened === count + 22, `reopened quotation kept its rows (${reopened} of ${count + 22})`)
  await page.getByRole('button', { name: 'Quotations' }).click()

  // With number generation off, a number has to be typed.
  await page.getByRole('button', { name: 'New quotation' }).first().click()
  const dialogEl = page.getByRole('dialog')
  await dialogEl.waitFor()
  const nextNumber = await dialogEl.locator('input.input').last().inputValue()
  check(/^MT-\d{2}0019$/.test(nextNumber), `next suggested number is 0019 (${nextNumber})`)
  await dialogEl.locator('.toggle-track').click()
  check(await dialogEl.getByRole('button', { name: 'Create' }).isDisabled(), 'manual numbering requires a typed number')
  await dialogEl.locator('input.input').last().fill('CUSTOM-7')
  check(await dialogEl.getByRole('button', { name: 'Create' }).isEnabled(), 'a typed number is accepted')
  await shot('10-manual-number')
  await dialogEl.getByRole('button', { name: 'Cancel' }).click()

  // A template survives an export / import round trip.
  await page.getByRole('button', { name: 'Templates' }).click()
  await page.locator('.card').first().waitFor()
  const bundle = path.join(outDir, 'template.qtpl')
  await stubSave(bundle)
  await page.locator('.card').first().getByRole('button', { name: 'More actions' }).click()
  await menuItem('Export to file').click()
  await page.getByText('Template exported.').waitFor()
  check(fs.existsSync(bundle) && fs.statSync(bundle).size > 100000, 'template exported with its images')
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, bundle)
  await page.getByRole('button', { name: 'Import' }).click()
  await page.getByText('Template imported.').waitFor()
  check((await page.locator('.card').count()) === 2, 'template imported')
  await shot('11-templates-imported')
  await page.locator('.card').nth(1).locator('.card-main').click()
  await page.locator('.page').first().waitFor()
  await page.waitForTimeout(600)
  const broken = await page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length)
  check(broken === 0, 'imported template shows all of its images')
  await page.locator('.blk').nth(2).click({ position: { x: 4, y: 4 } })
  await shot('12-template-editor')

  // An edit made just before the window is closed is still saved.
  await page.locator('.page-footer .et').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Footer typed right before closing')
  await app.close()
  const again = await electron.launch({ args: [root, `--user-data-dir=${dataDir}`], cwd: root })
  try {
    const p2 = await again.firstWindow()
    await p2.getByRole('heading', { name: 'Quotations', exact: true }).waitFor()
    const footers = await p2.evaluate(async () => {
      const metas = await window.api.docs.list()
      const docs = await Promise.all(metas.filter((m) => m.kind === 'template').map((m) => window.api.docs.get(m.id)))
      return docs.map((d) => d?.page.footerText)
    })
    check(footers.includes('Footer typed right before closing'), 'last edit survives closing the app')
    await p2.locator('.list-table tbody tr').first().waitFor({ timeout: 5000 }).catch(() => undefined)
    check((await p2.locator('.list-table tbody tr').count()) === 1, 'quotations are still there after a restart')
  } finally {
    await again.close()
  }

  check(errors.length === 0, `no page errors${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`)
} finally {
  await app.close().catch(() => undefined)
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
