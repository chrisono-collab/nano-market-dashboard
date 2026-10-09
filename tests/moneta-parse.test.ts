// Moneta parser tests. Fixtures come from a real discovery capture with
// customer names/emails and transaction ids replaced. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MonetaShapeError,
  centralToUtc,
  decodeEntities,
  parseMonetaDate,
  parseReportData,
  portalDate,
  splitExportProducts,
  toLines,
} from '@/lib/moneta/parse'
import { parseExportFile } from '@/lib/moneta/upload'

const dir = path.join(__dirname, 'fixtures/moneta')
const reportBody = fs.readFileSync(path.join(dir, 'report-data.json'), 'utf8')
const machineIds = new Map([
  ['The Maris', '1b8c0cf4-eb1d-465b-9074-4821f67db332'],
  ['Gables At The Terrace', 'd9bdd0da-7edd-431a-889f-96a2b2f0ddf0'],
])

test('parses GetReportData carts', () => {
  const carts = parseReportData(reportBody, machineIds)
  assert.equal(carts.length, 9)
  const first = carts[0]
  assert.equal(first.machineName, 'The Maris')
  assert.equal(first.machineId, '1b8c0cf4-eb1d-465b-9074-4821f67db332')
  assert.equal(first.transactionId, '00000000-0000-0000-0000-000000000001')
  assert.deepEqual(first.items, [{ name: 'Bloom Energy', quantity: 1 }])
  assert.equal(first.total, 4.87)
  assert.equal(first.profit, 4.5)
  assert.equal(first.paymentMethod, 'Online Credit Card')
  // 2:48:31 PM Central (CDT, UTC-5) on Oct 9
  assert.equal(first.soldAt, '2026-10-09T19:48:31.000Z')
  assert.equal(first.saleDay, '2026-10-09')
})

test('splits products on <br>, counts repeats, decodes entities', () => {
  const carts = parseReportData(reportBody)
  const chips = carts.find((c) => c.total === 24.36)!
  assert.deepEqual(chips.items.map((i) => i.name), ['California Pizza Kitchen BBQ Chicken', "Trader Joe's Rolled Corn Tortilla Chips"])
  const sprite = carts.find((c) => c.total === 7.04)!
  assert.deepEqual(sprite.items, [{ name: 'Sprite', quantity: 2 }])
  const three = carts.find((c) => c.total === 12.72)!
  assert.equal(three.items.length, 3)
})

test('drops customer information from raw payloads', () => {
  for (const c of parseReportData(reportBody)) {
    assert.ok(!('UserInformation' in c.raw))
    assert.ok(!JSON.stringify(c.raw).includes('@'))
  }
})

test('handles empty, "No Data" and double-encoded bodies', () => {
  assert.deepEqual(parseReportData(''), [])
  assert.deepEqual(parseReportData('No Data Found'), [])
  assert.equal(parseReportData(JSON.stringify(reportBody)).length, 9)
})

test('rejects unexpected shapes with a clear error', () => {
  assert.throws(() => parseReportData('<!DOCTYPE html><html>'), MonetaShapeError)
  assert.throws(() => parseReportData('{"a":1}'), /non-array/)
  assert.throws(() => parseReportData('[{"Machine":"x"}]'), /missing Products, TotalAmount, RegistrationDateTime/)
  assert.throws(() => parseMonetaDate('2026-10-09'), /Unrecognized Moneta date/)
})

test('converts Central wall-clock across DST', () => {
  assert.equal(centralToUtc(2026, 1, 15, 12).toISOString(), '2026-01-15T18:00:00.000Z') // CST
  assert.equal(centralToUtc(2026, 7, 15, 12).toISOString(), '2026-07-15T17:00:00.000Z') // CDT
  assert.equal(parseMonetaDate('1/1/2026 12:05:00 AM').toISOString(), '2026-01-01T06:05:00.000Z')
  assert.equal(parseMonetaDate('1/1/2026 12:05:00 PM').toISOString(), '2026-01-01T18:05:00.000Z')
  assert.equal(portalDate('2026-06-01', false), '06-01-2026 12:00 AM')
  assert.equal(portalDate('2026-10-09', true), '10-09-2026 11:59 PM')
})

test('lines sum to cart totals and split by reference prices', () => {
  const carts = parseReportData(reportBody)
  const lines = toLines(carts, new Map([['Lunchables', 4], ['Celsius Wild Berry', 3], ['Takis', 3]]))
  for (const c of carts) {
    const sum = lines.filter((l) => l.cart_key === c.cartKey).reduce((s, l) => s + l.line_amount, 0)
    assert.equal(Math.round(sum * 100) / 100, c.total)
  }
  const gables = lines.filter((l) => l.machine_name === 'Gables At The Terrace')
  assert.deepEqual(gables.map((l) => l.line_amount), [5.52, 4.14, 4.14])
  assert.ok(gables.every((l) => l.amount_allocated))
  // Single-product carts (even with qty 2) are exact, not allocated.
  const sprite = lines.find((l) => l.product_name === 'Sprite')!
  assert.equal(sprite.quantity, 2)
  assert.equal(sprite.line_amount, 7.04)
  assert.equal(sprite.amount_allocated, false)
})

test('falls back to an even split without reference prices', () => {
  const [cart] = parseReportData(JSON.stringify(JSON.parse(reportBody).filter((r: any) => r.Machine === 'Gables At The Terrace')))
  assert.deepEqual(toLines([cart]).map((l) => l.line_amount), [4.6, 4.6, 4.6])
})

test('export rows match API rows by cart key', async () => {
  const api = parseReportData(reportBody)
  const known = api.flatMap((c) => c.items.map((i) => i.name))
  for (const file of ['shopping-cart-export.xlsx', 'shopping-cart-export.csv']) {
    const bytes = fs.readFileSync(path.join(dir, file))
    const carts = await parseExportFile(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), known)
    assert.equal(carts.length, api.length, file)
    carts.forEach((c, i) => {
      assert.equal(c.cartKey, api[i].cartKey, `${file} row ${i}`)
      assert.deepEqual(c.items, api[i].items, `${file} row ${i}`)
      assert.equal(c.transactionId, null)
      assert.ok(!('UserInformation' in c.raw))
    })
  }
})

test('export product splitting keeps unknown names together', () => {
  assert.deepEqual(splitExportProducts('Coke Zero Mystery Snack Bar Takis', ['Coke Zero', 'Takis']), ['Coke Zero', 'Mystery Snack Bar', 'Takis'])
  assert.deepEqual(splitExportProducts('A<br> B', []), ['A', ' B'])
  assert.equal(decodeEntities('Ben &amp; Jerry&#39;s'), "Ben & Jerry's")
})
