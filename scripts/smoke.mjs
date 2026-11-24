// End-to-end check of the built app: starts it with a throwaway data folder, creates a
// quotation and an invoice from the built-in templates, and exports them to PDF and Word.
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
  /** A sidebar entry, and one side of the quotations / invoices switch above them. */
  const nav = (label) => page.locator('.nav-item', { hasText: label })
  const mode = (label) => page.locator('.mode-switch button', { hasText: label })

  await page.getByRole('heading', { name: 'Quotations', exact: true }).waitFor()
  const info = await page.evaluate(() => window.api.app.info())
  check(path.resolve(info.dataPath).startsWith(dataDir), `data folder is isolated (${info.dataPath})`)
  await shot('01-quotations-empty')

  await nav('Templates').click()
  await page.getByText('Mobile Washroom Quotation').waitFor()
  check((await page.locator('.card').count()) === 1, 'quotation templates list only quotation templates')
  await shot('02-templates')

  await nav('Settings').click()
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  await shot('03-settings')

  await nav('Quotations').click()
  await page.getByRole('button', { name: 'New quotation' }).first().click()
  await page.getByRole('dialog').waitFor()
  await shot('04-new-quotation')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.locator('.page').first().waitFor()
  await page.waitForTimeout(800)
  await shot('05-editor')
  check((await page.locator('.page').count()) === 1, 'default quotation fits on one page')
  check((await page.locator('.hdr-title').innerText()).trim() === 'QUOTATION', 'title is shown in the header')
  const greyRows = await page
    .locator('.field-row')
    .evaluateAll((rows) => rows.filter((r) => getComputedStyle(r).color === 'rgb(118, 113, 113)').length)
  check(greyRows === 3, `event details are grey (${greyRows} rows)`)

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
  // A row can do without its quantity cell, and its amount can then stay empty.
  const itemRows = page.locator('.items tbody tr[data-items-row]')
  const shownTotal = async () => Number((await page.locator('.items .total-value').innerText()).replace(/[^0-9.]/g, ''))
  const toggleQtyCell = async (index) => {
    await itemRows.nth(index).hover()
    await itemRows.nth(index).locator('.row-opt').click()
    await page.locator('.menu-item', { hasText: 'No quantity cell' }).click()
    await page.waitForTimeout(150)
  }
  await toggleQtyCell(1)
  check((await itemRows.nth(1).locator('td').count()) === 2, 'a row can have its quantity cell removed')
  check((await itemRows.nth(2).locator('td').count()) === 3, 'other rows keep their quantity cell')
  await itemRows.nth(1).locator('td.amount .et').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } })
  check((await shownTotal()) === expected - 2000, `a row with no quantity and no amount adds nothing (total ${await shownTotal()})`)
  await toggleQtyCell(0)
  check((await shownTotal()) === expected - 3000, `an amount typed in a row with no quantity counts once (total ${await shownTotal()})`)
  await toggleQtyCell(0)
  check((await shownTotal()) === expected - 2000, 'putting the quantity cell back restores the quantity')
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
  check((await page.locator('.page .hdr-title').count()) === pageCount, 'header title repeats on every page')
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
  await page.getByRole('button', { name: 'Quotations', exact: true }).click()
  const listRow = page.locator('.list-table tbody tr').first()
  await listRow.waitFor()
  await shot('09-quotations')
  check((await listRow.innerText()).includes('MT-'), 'quotation is listed with its number')
  await listRow.click()
  await page.locator('.page').first().waitFor()
  await page.waitForTimeout(600)
  const reopened = await page.locator('.items tbody tr[data-items-row]').count()
  check(reopened === count + 22, `reopened quotation kept its rows (${reopened} of ${count + 22})`)
  await page.getByRole('button', { name: 'Quotations', exact: true }).click()

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

  // ------------------------------------------------------------------ invoices
  // The switch in the sidebar turns the whole app over to invoices.
  await mode('Invoices').click()
  await page.getByRole('heading', { name: 'Invoices', exact: true }).waitFor()
  check((await page.locator('.list-table tbody tr').count()) === 0, 'the invoice list does not show quotations')
  await shot('13-invoices-empty')
  await nav('Templates').click()
  await page.getByText('Mobile Washroom Invoice').waitFor()
  check((await page.locator('.card').count()) === 1, 'invoice templates list only invoice templates')
  await shot('14-invoice-templates')

  await nav('Invoices').click()
  await page.getByRole('button', { name: 'New invoice' }).first().click()
  await dialogEl.waitFor()
  const invoiceNumber = await dialogEl.locator('input.input').last().inputValue()
  check(/^INV-\d{2}0001$/.test(invoiceNumber), `invoices are numbered in their own series (${invoiceNumber})`)
  check((await dialogEl.getByText('Bank account').count()) === 0, 'no bank account is asked for a design without one')
  await shot('15-new-invoice')
  await dialogEl.getByRole('button', { name: 'Create' }).click()
  await page.locator('.page').first().waitFor()
  await page.waitForTimeout(800)
  check((await page.locator('.hdr-title').innerText()).trim() === 'INVOICE', 'invoice title is shown in the header')
  check((await page.locator('.items thead th').count()) === 2, 'the invoice table has no quantity column')
  check((await page.locator('.items .row-opt').count()) === 0, 'rows offer no quantity option without the column')

  // Filled in with the content of the reference invoice.
  const typeInto = async (locator, text) => {
    await locator.click()
    await page.keyboard.press('Control+End')
    const lines = text.split('\n')
    for (const [i, line] of lines.entries()) {
      if (i > 0) await page.keyboard.press('Enter')
      await page.keyboard.type(line)
    }
  }
  await typeInto(page.locator('.field-row').first().locator('.field-value .et'), 'Mr. W M S Lakshitha-Engineer')
  await typeInto(page.locator('.blk').nth(1).locator('.et'), '\n126C/1/1,\nHigh Level Road,\nNugegoda,\nSri Lanka.')
  await typeInto(
    page.locator('.text-block.has-lead .et').nth(1),
    "Advane payment for Six fully equipped mobile toilet unit's rental basis at the Ingiriya Location from 01 December 2026."
  )
  const invoiceRow = page.locator('.items tbody tr[data-items-row]').first()
  await typeInto(invoiceRow.locator('td .et').first(), 'Total quotation for Two fully equipped mobile toilet units')
  await typeInto(invoiceRow.locator('td.amount .et'), '185000')
  await typeInto(page.locator('.items tr[data-summary="paid"] .total-value .et'), '92500')
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(400)
  const cellText = async (selector) => (await page.locator(selector).innerText()).trim()
  check((await cellText('.items td.amount .et')) === '185,000.00', 'invoice amounts always show cents')
  check((await cellText('.items tr[data-summary="paid"] .total-value')) === '92,500.00', 'the amount paid is shown')
  check(
    (await cellText('.items tr[data-summary="balance"] .total-value')) === '92,500.00',
    'balance = total - amount paid'
  )
  check((await page.locator('.items tr[data-summary="total"]').count()) === 0, 'the invoice has no separate total row')
  check(
    (await page.getByText('Advance payment received (92,500.00)').count()) === 1,
    'text shows the amount paid through {paid}'
  )
  check((await page.locator('.page').count()) === 1, 'the invoice fits on one page')
  await page.waitForTimeout(900)
  await shot('16-invoice-editor')
  for (const ext of ['pdf', 'docx']) {
    const target = path.join(outDir, `invoice.${ext}`)
    await stubSave(target)
    await page.getByRole('button', { name: ext === 'pdf' ? 'PDF' : 'Word', exact: true }).click()
    await waitForFile(target)
    check(fs.existsSync(target) && fs.statSync(target).size > 10000, `invoice ${ext} exported`)
  }

  await page.getByRole('button', { name: 'Invoices', exact: true }).click()
  await page.locator('.list-table tbody tr').first().waitFor()
  const invoiceRows = await page.locator('.list-table tbody tr').allInnerTexts()
  check(invoiceRows.length === 1 && invoiceRows[0].includes('INV-'), 'the invoice is listed under Invoices')
  check(invoiceRows[0].includes('Lakshitha') && invoiceRows[0].includes('185,000.00'), 'with its customer and total')
  await shot('17-invoices')
  await mode('Quotations').click()
  await page.getByRole('heading', { name: 'Quotations', exact: true }).waitFor()
  await page.locator('.list-table tbody tr').first().waitFor()
  const quotationRows = await page.locator('.list-table tbody tr').allInnerTexts()
  check(quotationRows.length === 1 && quotationRows[0].includes('MT-'), 'quotations are not mixed with invoices')
  const counters = await page.evaluate(async () => {
    const s = await window.api.settings.get()
    return [s.numbering.nextSeq, s.invoiceNumbering.nextSeq]
  })
  check(counters[0] === 19 && counters[1] === 2, `each series kept its own counter (${counters.join(', ')})`)

  // A template survives an export / import round trip.
  await nav('Templates').click()
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
    check(
      (await p2.evaluate(async () => (await window.api.docs.list()).filter((m) => m.kind === 'document').length)) === 2,
      'the quotation and the invoice are both still stored'
    )
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
