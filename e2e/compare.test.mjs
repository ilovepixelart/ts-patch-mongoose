import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { compareBuilds, loadAllowlist, pathToRegExp, versionMismatches } from './compare.mjs'

const dir = mkdtempSync(join(tmpdir(), 'e2e-compare-'))
after(() => rmSync(dir, { recursive: true, force: true }))

let files = 0
const allowlist = (entries) => {
  const file = join(dir, `allowlist-${files++}.json`)
  writeFileSync(file, JSON.stringify({ description: 'test', entries }))
  return loadAllowlist(file)
}

const record = ({ order = ['a', 'b'], op = 'replace' } = {}) => ({
  history: [{ op: 'updateOne', patch: [{ op, path: '/n', value: 2 }] }],
  events: [{ name: 'updated', payload: { doc: { value: Object.fromEntries(order.map((key) => [key, 1])) } } }],
})

const eventDoc = { scenario: 'full/updateOne/*', paths: ['$.events[*].payload.doc.**'], reason: 'doc is read back' }

describe('pathToRegExp', () => {
  it('matches one key or index with * and any rest of the path with **', () => {
    assert.equal(pathToRegExp('$.events[*].payload.doc.**').test('$.events[0].payload.doc.value.__v'), true)
    assert.equal(pathToRegExp('$.history[*].patch').test('$.history[3].patch'), true)
  })

  it('does not let * cross a key or an index', () => {
    assert.equal(pathToRegExp('$.history[*].patch').test('$.history[0].patch[1].op'), false)
    assert.equal(pathToRegExp('$.events[*].payload.doc.**').test('$.events[0].payload.oldDoc.value'), false)
    assert.equal(pathToRegExp('$.*').test('$.history[0]'), false)
  })
})

describe('compareBuilds', () => {
  it('allows a scenario whose every differing path an entry lists', () => {
    const result = compareBuilds({ 'full/updateOne/none': record() }, { 'full/updateOne/none': record({ order: ['b', 'a'] }) }, allowlist([eventDoc]), '9.4.1')
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.unused, [])
    assert.deepEqual(
      result.allowed.map(({ id, reason }) => [id, reason]),
      [['full/updateOne/none', 'doc is read back']],
    )
  })

  it('fails a listed scenario at a path no entry allows, naming only that path', () => {
    const result = compareBuilds({ 'full/updateOne/none': record() }, { 'full/updateOne/none': record({ order: ['b', 'a'], op: 'add' }) }, allowlist([eventDoc]), '9.4.1')
    assert.deepEqual(result.allowed, [])
    assert.deepEqual(result.failures, [{ id: 'full/updateOne/none', paths: ['$.history[0].patch[0].op: baseline "replace", candidate "add"'] }])
  })

  it('allows the union of the paths of every entry that names the scenario', () => {
    const history = { scenario: '*/updateOne/none', paths: ['$.history[*].patch[*].op'], reason: 'patch op' }
    const result = compareBuilds({ 'full/updateOne/none': record() }, { 'full/updateOne/none': record({ order: ['b', 'a'], op: 'add' }) }, allowlist([eventDoc, history]), '9.4.1')
    assert.deepEqual(result.failures, [])
    assert.equal(result.allowed[0]?.reason, 'patch op; doc is read back')
  })

  it('reports an entry that allows no difference as stale, also when its scenario differs elsewhere', () => {
    const stale = { scenario: 'full/deleteOne/*', paths: ['$.history'], reason: 'stale' }
    const elsewhere = { scenario: 'full/updateOne/*', paths: ['$.getterCalls'], reason: 'elsewhere' }
    const result = compareBuilds({ 'full/updateOne/none': record() }, { 'full/updateOne/none': record({ order: ['b', 'a'] }) }, allowlist([eventDoc, stale, elsewhere]), '9.4.1')
    assert.deepEqual(result.unused, [
      { scenario: 'full/deleteOne/*', reason: 'stale' },
      { scenario: 'full/updateOne/*', reason: 'elsewhere' },
    ])
  })

  it('applies an entry only to its mongoose major', () => {
    const result = compareBuilds({ 'full/updateOne/none': record() }, { 'full/updateOne/none': record({ order: ['b', 'a'] }) }, allowlist([{ ...eventDoc, mongoose: 8 }]), '9.4.1')
    assert.equal(result.failures.length, 1)
    assert.deepEqual(result.unused, [])
  })
})

describe('loadAllowlist', () => {
  for (const [name, paths] of [
    ['missing', undefined],
    ['empty', []],
    ['not a string', [1]],
    ['not starting with $', ['events[*]']],
  ]) {
    it(`rejects an entry whose paths are ${name}`, () => {
      assert.throws(() => allowlist([{ scenario: 'full/updateOne/*', paths, reason: 'r' }]), /"paths" must list the difference paths/)
    })
  }

  it('rejects an unknown key', () => {
    assert.throws(() => allowlist([{ ...eventDoc, path: '$' }]), /unknown keys path/)
  })
})

describe('versionMismatches', () => {
  const found = (candidate, baseline) => [
    { name: 'candidate', version: candidate },
    { name: 'baseline', version: baseline },
  ]

  it('accepts versions that are exactly the one requested', () => {
    assert.deepEqual(versionMismatches('mongoose', '8.24.10', found('8.24.10', '8.24.10')), [])
  })

  it('names each one that has another version', () => {
    assert.deepEqual(versionMismatches('mongodb', '8.2.6', found('8.2.6', '8.0.4')), ['baseline has mongodb 8.0.4, not the requested 8.2.6'])
  })

  it('does not compare when the request is a range or tag', () => {
    assert.deepEqual(versionMismatches('mongoose', '8', found('8.24.10', '8.23.0')), [])
    assert.deepEqual(versionMismatches('mongoose', 'latest', found('9.12.2', '9.0.0')), [])
  })
})
