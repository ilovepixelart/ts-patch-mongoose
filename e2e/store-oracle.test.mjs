import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { checkStore, loadKnownDefects, storeViolations } from './store-oracle.mjs'

const dir = mkdtempSync(join(tmpdir(), 'e2e-store-'))
after(() => rmSync(dir, { recursive: true, force: true }))

let files = 0
const known = (entries) => {
  const file = join(dir, `known-${files++}.json`)
  writeFileSync(file, JSON.stringify({ description: 'test', entries }))
  return loadKnownDefects(file)
}

const updated = (doc) => ({ name: 'full:updated', payload: { doc: { kind: 'object', value: doc } } })
const record = (read, events) => ({ state: read, read, events })
const A = 'ObjectId(000000000000000000000001)'

describe('storeViolations', () => {
  it('accepts an event doc equal to the stored document, whatever the key order', () => {
    const scenarios = { 'full/replaceOne/none': record([{ _id: A, n: 2, sku: 'a' }], [updated({ sku: 'a', n: 2, _id: A })]) }
    assert.deepEqual(storeViolations(scenarios), [])
  })

  it('reports a field the event doc keeps and the store dropped, with its path', () => {
    const scenarios = { 'full/replaceOne/none': record([{ _id: A, n: 2 }], [updated({ _id: A, n: 2, sku: 'a' })]) }
    assert.deepEqual(storeViolations(scenarios), [{ id: 'full/replaceOne/none', doc: A, paths: ['$.sku: baseline <missing>, candidate "a"'] }])
  })

  it('judges each document by its last updated event only', () => {
    const scenarios = { 'full/updateOne:repeated/none': record([{ _id: A, n: 3 }], [updated({ _id: A, n: 2 }), updated({ _id: A, n: 3 })]) }
    assert.deepEqual(storeViolations(scenarios), [])
  })

  it('skips rolled back transactions, whose store is unchanged', () => {
    const stale = record([{ _id: A, n: 1 }], [updated({ _id: A, n: 2 })])
    assert.deepEqual(storeViolations({ 'full/updateOne/aborted': stale, 'full/updateOne/als-aborted': stale }), [])
    assert.equal(storeViolations({ 'full/updateOne/committed': stale }).length, 1)
  })

  it('skips a document no longer stored', () => {
    assert.deepEqual(storeViolations({ 'full/x/none': record([], [updated({ _id: A, n: 2 })]) }), [])
  })

  it('judges updated events only', () => {
    const created = { name: 'full:created', payload: { doc: { kind: 'object', value: { _id: A, n: 0 } } } }
    assert.deepEqual(storeViolations({ 'full/x/none': record([{ _id: A, n: 1 }], [created]) }), [])
  })
})

describe('checkStore', () => {
  const scenarios = { 'full/replaceOne/none': record([{ _id: A }], [updated({ _id: A, sku: 'a' })]) }

  it('fails a violation no known defect names', () => {
    const { failures, unused } = checkStore(scenarios, known([]), '9.12.2')
    assert.equal(failures.length, 1)
    assert.deepEqual(unused, [])
  })

  it('accepts a violation a known defect names, for its mongoose major only', () => {
    assert.deepEqual(checkStore(scenarios, known([{ scenario: '*/replaceOne/*', reason: 'r' }]), '9.12.2'), { failures: [], unused: [] })
    assert.equal(checkStore(scenarios, known([{ scenario: '*/replaceOne/*', mongoose: 6, reason: 'r' }]), '9.12.2').failures.length, 1)
  })

  it('fails a known defect that names no violation', () => {
    const { unused } = checkStore(
      scenarios,
      known([
        { scenario: '*/replaceOne/*', reason: 'r' },
        { scenario: '*/updateOne/*', reason: 'fixed' },
      ]),
      '9.12.2',
    )
    assert.deepEqual(unused, [{ scenario: '*/updateOne/*', reason: 'fixed' }])
  })

  it('rejects an entry without a reason or with an unknown key', () => {
    assert.throws(() => known([{ scenario: '*/x/*' }]), /"reason" must name the defect/)
    assert.throws(() => known([{ scenario: '*/x/*', reason: 'r', paths: [] }]), /unknown keys paths/)
  })
})
