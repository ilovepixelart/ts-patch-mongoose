import { describe, expect, it } from 'vitest'

import { compare } from '../src/json-patch'

describe('json-patch compare', () => {
  // --- escapeToken / joinPath ---

  describe('path escaping (escapeToken)', () => {
    it('passes unchanged keys through without allocations', () => {
      const patch = compare({ simple: 1 }, { simple: 2 })
      expect(patch).toEqual([{ op: 'replace', path: '/simple', value: 2 }])
    })

    it('escapes `/` as `~1` per RFC 6901', () => {
      const patch = compare({ 'a/b': 1 }, { 'a/b': 10 })
      expect(patch.map((op) => op.path)).toEqual(['/a~1b'])
    })

    it('escapes `~` as `~0` per RFC 6901', () => {
      const patch = compare({ 'c~d': 2 }, { 'c~d': 20 })
      expect(patch.map((op) => op.path)).toEqual(['/c~0d'])
    })

    it('escapes `~` first so `~/` becomes `~0~1`, not `~01`', () => {
      const patch = compare({ 'x~/y': 1 }, { 'x~/y': 2 })
      expect(patch.map((op) => op.path)).toEqual(['/x~0~1y'])
    })
  })

  // --- cloneValue ---

  describe('cloneValue semantics', () => {
    it('coerces `undefined` replacement values to `null` to keep ops serializable', () => {
      const patch = compare({ a: 1 }, { a: undefined }, true)
      const replaceOp = patch.find((op) => op.op === 'replace')
      expect(replaceOp).toBeUndefined() // undefined prop is treated as removal, not replace
      const removeOp = patch.find((op) => op.op === 'remove')
      expect(removeOp).toBeDefined()
    })

    it('deep-clones nested object values in the emitted ops so later mutations do not leak', () => {
      const target = { nested: { inner: { count: 1 } } }
      const patch = compare({}, target)
      target.nested.inner.count = 999
      const addOp = patch.find((op) => op.op === 'add') as { value: { inner: { count: number } } } | undefined
      expect(addOp?.value.inner.count).toBe(1)
    })

    it('passes through primitive replacement values unchanged', () => {
      const patch = compare({ n: 1 }, { n: 2 })
      expect(patch).toEqual([{ op: 'replace', path: '/n', value: 2 }])
    })
  })

  // --- normalizeTarget ---

  describe('normalizeTarget (toJSON transform)', () => {
    it('calls toJSON() on non-array target objects before diffing', () => {
      const target = { nested: { toJSON: () => ({ transformed: true }) } }
      const patch = compare({ nested: { original: true } }, target)
      expect(patch).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: 'add', path: '/nested/transformed', value: true }),
          expect.objectContaining({ op: 'remove', path: '/nested/original' }),
        ]),
      )
    })

    it('does not invoke toJSON on array targets', () => {
      let called = 0
      const arr = [1, 2, 3] as unknown as { toJSON: () => unknown[] }
      arr.toJSON = () => {
        called++
        return [9, 9, 9]
      }
      const patch = compare({ list: [1, 2, 3] }, { list: arr as unknown as number[] })
      expect(patch).toEqual([])
      expect(called).toBe(0)
    })
  })

  // --- isContainer / type mismatch ---

  describe('container vs primitive handling', () => {
    it('emits a single replace when an object is replaced by a primitive', () => {
      const patch = compare({ node: { a: 1 } }, { node: 'leaf' })
      expect(patch).toEqual([{ op: 'replace', path: '/node', value: 'leaf' }])
    })

    it('emits a single replace when array is replaced by object at same path', () => {
      const patch = compare({ x: [1, 2] }, { x: { a: 1 } })
      expect(patch).toEqual([{ op: 'replace', path: '/x', value: { a: 1 } }])
    })
  })

  // --- diffSourceKey: remove vs recurse ---

  describe('source-side key iteration (diffSourceKey)', () => {
    it('emits remove when a key is missing in target', () => {
      const patch = compare({ keep: 1, drop: 2 }, { keep: 1 })
      expect(patch).toEqual([{ op: 'remove', path: '/drop' }])
    })

    it('treats object key with explicit undefined as removal and emits invertible test op', () => {
      const patch = compare({ a: 1, b: 2 }, { a: 1, b: undefined }, true)
      expect(patch).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: 'test', path: '/b', value: 2 }),
          expect.objectContaining({ op: 'remove', path: '/b' }),
        ]),
      )
    })

    it('recurses into nested object children and emits scoped replace paths', () => {
      const patch = compare({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })
      expect(patch).toEqual([{ op: 'replace', path: '/a/b/c', value: 2 }])
    })
  })

  // --- diffAddedKeys ---

  describe('target-side key iteration (diffAddedKeys)', () => {
    it('emits add for keys only present in target', () => {
      const patch = compare({ a: 1 }, { a: 1, b: 2 })
      expect(patch).toEqual([{ op: 'add', path: '/b', value: 2 }])
    })

    it('skips new keys whose value is explicitly undefined', () => {
      const patch = compare({ a: 1 }, { a: 1, b: undefined })
      expect(patch).toEqual([])
    })
  })

  // --- Array diffing ---

  describe('array diffing (keysOf numeric indices)', () => {
    it('emits a remove for the dropped tail when the array shrinks', () => {
      const patch = compare({ list: [1, 2, 3] }, { list: [1, 2] })
      expect(patch).toEqual([{ op: 'remove', path: '/list/2' }])
    })

    it('emits an add for the appended tail when the array grows', () => {
      const patch = compare({ list: [1, 2] }, { list: [1, 2, 3] })
      expect(patch).toEqual([{ op: 'add', path: '/list/2', value: 3 }])
    })

    it('emits a replace at the mutated index for in-place changes', () => {
      const patch = compare({ list: [1, 2, 3] }, { list: [1, 99, 3] })
      expect(patch).toEqual([{ op: 'replace', path: '/list/1', value: 99 }])
    })
  })

  // --- Invertible mode ---

  describe('invertible mode', () => {
    it('omits test ops by default (non-invertible)', () => {
      const patch = compare({ a: 1 }, { a: 2 })
      expect(patch.some((op) => op.op === 'test')).toBe(false)
    })

    it('emits a test op carrying the original value before every replace', () => {
      const patch = compare({ a: 'old' }, { a: 'new' }, true)
      expect(patch).toEqual([
        { op: 'test', path: '/a', value: 'old' },
        { op: 'replace', path: '/a', value: 'new' },
      ])
    })

    it('emits a test op carrying the original value before every remove', () => {
      const patch = compare({ a: 'bye' }, {}, true)
      expect(patch).toEqual([
        { op: 'test', path: '/a', value: 'bye' },
        { op: 'remove', path: '/a' },
      ])
    })
  })

  // --- Fast path ---

  describe('short-circuit on reference equality', () => {
    it('returns an empty patch when source === target', () => {
      const shared = { a: 1, b: [1, 2] }
      expect(compare(shared, shared)).toEqual([])
    })
  })
})
