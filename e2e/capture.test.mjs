import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const { aliasObjectIds, plain } = createRequire(import.meta.url)('./consumer/capture.cjs')

const now = Date.now()

describe('plain scrubs what differs between runs', () => {
  it('replaces a date of this run with <Date>, its ISO string with <DateString> and its epoch milliseconds with <Now>', () => {
    assert.deepEqual(plain({ date: new Date(now), string: new Date(now).toISOString(), ms: now }), { date: '<Date>', string: '<DateString>', ms: '<Now>' })
  })

  it('aliases runtime ObjectIds in order of first appearance and keeps the same alias for the same id', () => {
    const first = '6716b2a0f1e2d3c4b5a69788'
    const second = '6716b2a0f1e2d3c4b5a69799'
    assert.deepEqual(aliasObjectIds({ a: first, b: second, c: first }), { a: '#1', b: '#2', c: '#1' })
  })
})

describe('plain keeps what the fixtures fix', () => {
  it('keeps a fixed date and its ISO string verbatim, and keeps them apart', () => {
    const fixed = new Date(Date.UTC(2020, 0, 1))
    assert.deepEqual(plain({ date: fixed, string: fixed.toISOString() }), { date: 'Date(2020-01-01T00:00:00.000Z)', string: '2020-01-01T00:00:00.000Z' })
  })

  it('keeps numbers and strings that are not times of this run', () => {
    assert.deepEqual(plain({ n: 1, big: 9007199254740991, word: 'now', almost: '2020-01-01T00:00:00Z' }), { n: 1, big: 9007199254740991, word: 'now', almost: '2020-01-01T00:00:00Z' })
  })

  it('keeps ids whose timestamp is 0', () => {
    const fixed = '000000000000000000000001'
    assert.deepEqual(aliasObjectIds({ id: fixed }), { id: fixed })
  })

  it('prints a regular expression with its flags, and an invalid date or broken regular expression without throwing', () => {
    assert.deepEqual(plain({ re: /a+b/gi, bad: new Date(Number.NaN), broken: Object.create(RegExp.prototype) }), { re: 'RegExp(/a+b/gi)', bad: 'Date(invalid)', broken: 'RegExp(invalid)' })
  })
})
