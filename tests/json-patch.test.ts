import { describe, expect, it } from 'vitest'

import { compare } from '../src/json-patch'

describe('json-patch compare', () => {
  it('escapes / and ~ in path components per RFC 6901', () => {
    const patch = compare({ 'a/b': 1, 'c~d': 2 }, { 'a/b': 10, 'c~d': 20 })
    const paths = patch.map((op) => op.path)
    expect(paths).toContain('/a~1b')
    expect(paths).toContain('/c~0d')
  })

  it('calls toJSON() on non-array target objects before diffing', () => {
    const target = {
      nested: {
        toJSON: () => ({ transformed: true }),
      },
    }
    const patch = compare({ nested: { original: true } }, target)
    expect(patch).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'add', path: '/nested/transformed', value: true })]))
    expect(patch).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'remove', path: '/nested/original' })]))
  })

  it('treats object key with explicit undefined value as removal and emits invertible test op', () => {
    const patch = compare({ a: 1, b: 2 }, { a: 1, b: undefined }, true)
    const hasTest = patch.some((op) => op.op === 'test' && op.path === '/b')
    const hasRemove = patch.some((op) => op.op === 'remove' && op.path === '/b')
    expect(hasTest).toBe(true)
    expect(hasRemove).toBe(true)
  })
})
