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

const A = '000000000000000000000001'
const B = '000000000000000000000002'
const oid = (hex) => `ObjectId(${hex})`
const event = (name, key, doc) => ({ name: `full:${name}`, payload: { [key]: { kind: 'object', value: doc } } })
const updated = (doc) => event('updated', 'doc', doc)
const created = (doc) => event('created', 'doc', doc)
const deleted = (doc) => event('deleted', 'oldDoc', doc)
const entry = (id, version, patch) => ({ op: 'updateOne', collectionId: oid(id), version, patch })

// A scenario record: the store before and after as JSON, as mongoose reads it, and raw; what it recorded.
const record = ({ before = [], after = before, events = [], history = [], ...rest }) => ({
  omit: null,
  silent: false,
  historyExpected: true,
  before: before.map((doc) => ({ ...doc, _id: oid(doc._id) })),
  jsonBefore: before,
  jsonAfter: after,
  read: after.map((doc) => ({ ...doc, _id: oid(doc._id) })),
  state: after.map((doc) => ({ ...doc, _id: oid(doc._id) })),
  events,
  history,
  onError: [],
  ...rest,
})
const only = (oracle, scenarios) => storeViolations(scenarios).filter((violation) => violation.oracle === oracle)

describe('updated-doc', () => {
  it('accepts an event doc equal to the stored document, whatever the key order', () => {
    const scenarios = {
      'full/replaceOne/none': record({
        before: [{ _id: A, n: 1 }],
        after: [{ _id: A, n: 2, sku: 'a' }],
        events: [updated({ sku: 'a', n: 2, _id: oid(A) })],
        history: [
          entry(A, 0, [
            { op: 'replace', path: '/n', value: 2 },
            { op: 'add', path: '/sku', value: 'a' },
          ]),
        ],
      }),
    }
    assert.deepEqual(storeViolations(scenarios), [])
  })

  it('reports a field the event doc keeps and the store dropped, with its path', () => {
    const scenarios = { 'full/replaceOne/none': record({ after: [{ _id: A, n: 2 }], events: [updated({ _id: oid(A), n: 2, sku: 'a' })] }) }
    assert.deepEqual(only('updated-doc', scenarios), [{ oracle: 'updated-doc', id: 'full/replaceOne/none', doc: A, paths: ['$.sku: baseline <missing>, candidate "a"'] }])
  })

  it('judges each document by its last updated event only', () => {
    const scenarios = { 'full/updateOne/none': record({ after: [{ _id: A, n: 3 }], events: [updated({ _id: oid(A), n: 2 }), updated({ _id: oid(A), n: 3 })] }) }
    assert.deepEqual(only('updated-doc', scenarios), [])
  })

  it('skips rolled back transactions, whose store is unchanged', () => {
    const stale = record({ after: [{ _id: A, n: 1 }], events: [updated({ _id: oid(A), n: 2 })] })
    assert.deepEqual(only('updated-doc', { 'full/updateOne/aborted': stale, 'full/updateOne/als-aborted': stale }), [])
    assert.equal(only('updated-doc', { 'full/updateOne/committed': stale }).length, 1)
  })
})

describe('recorded', () => {
  it('reports a stored change that no event and no history entry names', () => {
    const scenarios = { 'full/updateOne/none': record({ before: [{ _id: A, extra: { a: 1 } }], after: [{ _id: A, extra: { a: 2 } }] }) }
    assert.deepEqual(only('recorded', scenarios), [{ oracle: 'recorded', id: 'full/updateOne/none', doc: A, paths: ['$.extra.a: before 1, after 2'] }])
  })

  it('accepts a change named by an event or by a history entry alone', () => {
    const base = { before: [{ _id: A, n: 1 }], after: [{ _id: A, n: 2 }] }
    assert.deepEqual(only('recorded', { 'disabled/updateOne/none': record({ ...base, historyExpected: false, events: [updated({ _id: oid(A), n: 2 })] }) }), [])
    assert.deepEqual(only('recorded', { 'no-events/updateOne/none': record({ ...base, history: [entry(A, 0, [{ op: 'replace', path: '/n', value: 2 }])] }) }), [])
  })

  it('reports a document inserted or deleted without a record', () => {
    assert.deepEqual(only('recorded', { 'full/insertMany/none': record({ before: [], after: [{ _id: B }] }) })[0].paths, ['$: before <missing>, after stored'])
    assert.deepEqual(only('recorded', { 'full/deleteOne/none': record({ before: [{ _id: A }], after: [] }) })[0].paths, ['$: before stored, after <missing>'])
  })

  it('does not judge a change only to paths the omit option may cover, nor a silent operation, nor a loss onError reported', () => {
    const change = { before: [{ _id: A, meta: { size: 1 } }], after: [{ _id: A, meta: { size: 2 } }] }
    assert.deepEqual(only('recorded', { 'full/updateOne/none': record({ ...change, omit: ['meta.size'] }) }), [])
    assert.deepEqual(only('recorded', { 'omit-string/updateOne/none': record({ ...change, omit: 'size' }) }), [])
    assert.deepEqual(only('recorded', { 'full/updateOne:ignoreHook/none': record({ ...change, silent: true }) }), [])
    assert.deepEqual(only('recorded', { 'badwrite/updateOne/none': record({ ...change, onError: [{ name: 'ValidationError' }] }) }), [])
    assert.equal(only('recorded', { 'omit-invalid/updateOne/none': record({ ...change, omit: { size: true } }) }).length, 1)
  })
})

describe('replay', () => {
  it('accepts patches that turn the document as it was into the document as it is', () => {
    const history = [
      entry(A, 0, [
        { op: 'test', path: '/n', value: 1 },
        { op: 'replace', path: '/n', value: 2 },
      ]),
      entry(A, 1, [
        { op: 'add', path: '/tags/1', value: 'b' },
        { op: 'remove', path: '/sku' },
      ]),
    ]
    const scenarios = { 'full/updateOne:repeated/none': record({ before: [{ _id: A, n: 1, sku: 'a', tags: ['a'] }], after: [{ _id: A, n: 2, tags: ['a', 'b'] }], history }) }
    assert.deepEqual(only('replay', scenarios), [])
  })

  it('reports a change the patches miss', () => {
    const history = [entry(A, 0, [{ op: 'replace', path: '/n', value: 3 }])]
    const scenarios = { 'full/updateOne:mul/none': record({ before: [{ _id: A, n: 1, extra: { a: 1 } }], after: [{ _id: A, n: 3, extra: { a: 4 } }], history }) }
    assert.deepEqual(only('replay', scenarios), [{ oracle: 'replay', id: 'full/updateOne:mul/none', doc: A, paths: ['$.extra.a: replayed 1, stored 4'] }])
  })

  it('reports a test op that does not hold on the document as it was, and versions that do not count up from 0', () => {
    const before = [{ _id: A, n: 1 }]
    const failed = only('replay', {
      'full/updateOne/none': record({
        before,
        after: [{ _id: A, n: 2 }],
        history: [
          entry(A, 0, [
            { op: 'test', path: '/n', value: 9 },
            { op: 'replace', path: '/n', value: 2 },
          ]),
        ],
      }),
    })
    assert.deepEqual(failed[0].paths, ['$patch: test /n failed: 1'])
    const skipped = only('replay', { 'full/updateOne/none': record({ before, after: [{ _id: A, n: 2 }], history: [entry(A, 1, [{ op: 'replace', path: '/n', value: 2 }])] }) })
    assert.deepEqual(skipped[0].paths, ['$version: [1], expected 0 to 0'])
  })

  it('does not judge a profile without history, a document created in the scenario, or paths the omit option may cover', () => {
    const missed = { before: [{ _id: A, n: 1 }], after: [{ _id: A, n: 2 }], history: [entry(A, 0, [])] }
    assert.deepEqual(only('replay', { 'disabled/updateOne/none': record({ ...missed, historyExpected: false }) }), [])
    assert.deepEqual(only('replay', { 'full/updateOne/none': record({ ...missed, omit: ['n'] }) }), [])
    assert.deepEqual(only('replay', { 'full/upsert/none': record({ ...missed, history: [{ op: 'updateOne', collectionId: oid(A), version: 0, doc: {} }] }) }), [])
    assert.equal(only('replay', { 'full/updateOne/none': record(missed) }).length, 1)
  })
})

describe('omit', () => {
  it('does not judge an object the omit option emptied', () => {
    const scenarios = { 'omit/save:new/none': record({ after: [{ _id: B, extra: { obj: { k: 'v' } } }], events: [created({ _id: oid(B), extra: { obj: {} } })], omit: ['k'] }) }
    assert.deepEqual(only('created-doc', scenarios), [])
  })
})

describe('created-doc and deleted-doc', () => {
  it('takes a BigInt as stored (a number) and as an event holds it ("5n") for the same value', () => {
    const scenarios = { 'full/save:new/none': record({ after: [{ _id: B, bigs: [5, 6] }], events: [created({ _id: oid(B), bigs: ['5n', '6n'] })] }) }
    assert.deepEqual(only('created-doc', scenarios), [])
  })

  it('judges only scenario records, which hold the store before and after', () => {
    assert.deepEqual(storeViolations({ 'history/write-rejected': { state: [{ _id: oid(B), n: 2 }], events: [created({ _id: oid(B), n: 1 })], history: [], onError: [] } }), [])
  })

  it('judges a created doc by the document as stored, before mongoose fills in defaults on read', () => {
    const scenarios = { 'full/insertMany:lean/none': record({ after: [{ _id: B, n: 1 }], events: [created({ _id: oid(B), n: 1 })] }) }
    scenarios['full/insertMany:lean/none'].read = [{ _id: oid(B), n: 1, items: [] }]
    assert.deepEqual(only('created-doc', scenarios), [])
  })

  it('accepts a created doc that is stored and a deleted doc that is gone', () => {
    const scenarios = { 'full/insertMany/none': record({ before: [{ _id: A }], after: [{ _id: B, n: 1 }], events: [created({ _id: oid(B), n: 1 }), deleted({ _id: oid(A) })] }) }
    assert.deepEqual([...only('created-doc', scenarios), ...only('deleted-doc', scenarios)], [])
  })

  it('reports a created doc that differs from the stored one, and a deleted doc still stored', () => {
    const scenarios = { 'full/insertMany/none': record({ before: [{ _id: A }], after: [{ _id: A }, { _id: B, n: 2 }], events: [created({ _id: oid(B), n: 1 }), deleted({ _id: oid(A) })] }) }
    assert.deepEqual(only('created-doc', scenarios)[0].paths, ['$.n: stored 2, event 1'])
    assert.deepEqual(only('deleted-doc', scenarios)[0].paths, ['$: still stored'])
  })

  it('does not judge a created doc the scenario changed afterwards', () => {
    const scenarios = { 'full/save:repeated/none': record({ after: [{ _id: B, n: 2 }], events: [created({ _id: oid(B), n: 1 }), updated({ _id: oid(B), n: 2 })] }) }
    assert.deepEqual(only('created-doc', scenarios), [])
  })
})

describe('rolled-back', () => {
  it('accepts an async local storage rollback that leaves the store and history as they were', () => {
    assert.deepEqual(only('rolled-back', { 'full/updateOne/als-aborted': record({ before: [{ _id: A, n: 1 }] }) }), [])
  })

  it('reports a store change or history after an async local storage rollback, and does not judge a manual one', () => {
    const leaked = record({ before: [{ _id: A, n: 1 }], history: [entry(A, 0, [])] })
    leaked.state = [{ _id: oid(A), n: 2 }]
    assert.deepEqual(only('rolled-back', { 'full/updateOne/als-aborted': leaked })[0].paths, ['$state[0].n: baseline 1, candidate 2', '$history: 1 entries'])
    assert.deepEqual(only('rolled-back', { 'full/updateOne/aborted': leaked }), [])
  })
})

describe('checkStore', () => {
  const scenarios = { 'full/replaceOne/none': record({ after: [{ _id: A }], events: [updated({ _id: oid(A), sku: 'a' })] }) }
  const entryFor = (overrides) => ({ oracle: 'updated-doc', scenario: '*/replaceOne/*', paths: ['$.sku'], reason: 'r', ...overrides })

  it('fails a violation no known defect names', () => {
    const { failures, unused } = checkStore(scenarios, known([]), '9.12.2')
    assert.deepEqual(
      failures.map((failure) => failure.oracle),
      ['updated-doc'],
    )
    assert.deepEqual(unused, [])
  })

  it('accepts a violation a known defect names by oracle, paths and mongoose major', () => {
    assert.deepEqual(checkStore(scenarios, known([entryFor({})]), '9.12.2'), { failures: [], unused: [] })
    assert.equal(checkStore(scenarios, known([entryFor({ mongoose: 6 })]), '9.12.2').failures.length, 1)
    assert.equal(checkStore(scenarios, known([entryFor({ oracle: 'recorded' })]), '9.12.2').failures.length, 2 - 1)
  })

  it('applies an entry to a minor version given as a version prefix', () => {
    assert.deepEqual(checkStore(scenarios, known([entryFor({ mongoose: '6.13' })]), '6.13.13').failures, [])
    assert.equal(checkStore(scenarios, known([entryFor({ mongoose: '6.13' })]), '6.12.0').failures.length, 1)
    assert.equal(checkStore(scenarios, known([entryFor({ mongoose: '6.1' })]), '6.13.13').failures.length, 1)
    assert.throws(() => known([entryFor({ mongoose: 'six' })]), /"mongoose" must be a major version number or a version prefix/)
  })

  it('fails a violation at a path the known defect does not name', () => {
    assert.equal(checkStore(scenarios, known([entryFor({ paths: ['$.n'] })]), '9.12.2').failures.length, 1)
  })

  it('fails a known defect that names no violation', () => {
    const { unused } = checkStore(scenarios, known([entryFor({}), entryFor({ scenario: '*/updateOne/*', reason: 'fixed' })]), '9.12.2')
    assert.deepEqual(unused, [{ oracle: 'updated-doc', scenario: '*/updateOne/*', reason: 'fixed' }])
  })

  it('rejects an entry without an oracle, paths or reason, or with an unknown key', () => {
    assert.throws(() => known([{ scenario: '*/x/*', paths: ['$'], reason: 'r' }]), /"oracle" must be one of/)
    assert.throws(() => known([{ oracle: 'recorded', scenario: '*/x/*', reason: 'r' }]), /"paths" must list/)
    assert.throws(() => known([{ oracle: 'recorded', scenario: '*/x/*', paths: ['$'] }]), /"reason" must name the defect/)
    assert.throws(() => known([{ oracle: 'recorded', scenario: '*/x/*', paths: ['$'], reason: 'r', doc: 'x' }]), /unknown keys doc/)
  })
})
