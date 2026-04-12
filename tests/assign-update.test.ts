import { describe, expect, it } from 'vitest'

import { applyUpdate } from '../src/assign-update'

describe('applyUpdate', () => {
  describe('plain field assignment with dot-notation numeric path', () => {
    it('creates an array when a path segment is numeric', () => {
      const result = applyUpdate({}, { 'items.0.sku': 'ABC-1' })
      expect(result).toEqual({ items: [{ sku: 'ABC-1' }] })
      expect(Array.isArray((result as { items: unknown }).items)).toBe(true)
    })
  })

  describe('$unset', () => {
    it('sets an array element to undefined without shrinking the array', () => {
      const result = applyUpdate({ items: ['a', 'b', 'c'] }, { $unset: { 'items.1': '' } })
      const items = (result as { items: unknown[] }).items
      expect(items).toHaveLength(3)
      expect(items[0]).toBe('a')
      expect(items[1]).toBeUndefined()
      expect(items[2]).toBe('c')
    })
  })

  describe('$min', () => {
    it('sets the field when it does not yet exist', () => {
      const result = applyUpdate({}, { $min: { score: 5 } })
      expect(result).toEqual({ score: 5 })
    })

    it('leaves the field unchanged when candidate is undefined', () => {
      const result = applyUpdate({ score: 10 }, { $min: { score: undefined } })
      expect(result).toEqual({ score: 10 })
    })

    it('replaces when candidate is smaller than the current value', () => {
      const result = applyUpdate({ score: 10 }, { $min: { score: 3 } })
      expect(result).toEqual({ score: 3 })
    })
  })

  describe('$max', () => {
    it('sets the field when it does not yet exist', () => {
      const result = applyUpdate({}, { $max: { score: 10 } })
      expect(result).toEqual({ score: 10 })
    })

    it('leaves the field unchanged when candidate is undefined', () => {
      const result = applyUpdate({ score: 10 }, { $max: { score: undefined } })
      expect(result).toEqual({ score: 10 })
    })

    it('replaces when candidate is greater than the current value', () => {
      const result = applyUpdate({ score: 5 }, { $max: { score: 10 } })
      expect(result).toEqual({ score: 10 })
    })

    it('keeps the current value when candidate is not greater', () => {
      const result = applyUpdate({ score: 10 }, { $max: { score: 5 } })
      expect(result).toEqual({ score: 10 })
    })
  })

  describe('$addToSet with non-JSON-stringifiable values', () => {
    it('falls back to reference equality when values cannot be JSON-stringified', () => {
      const bigA = BigInt(1)
      const bigB = BigInt(2)
      const result = applyUpdate({ values: [bigA] }, { $addToSet: { values: bigB } })
      expect((result as { values: unknown[] }).values).toEqual([bigA, bigB])
    })
  })

  describe('$inc', () => {
    it('treats a missing field as 0 when incrementing', () => {
      const result = applyUpdate({}, { $inc: { count: 5 } })
      expect(result).toEqual({ count: 5 })
    })

    it('treats a non-numeric value as 0 when incrementing', () => {
      const result = applyUpdate({ count: 'not-a-number' }, { $inc: { count: 3 } })
      expect(result).toEqual({ count: 3 })
    })
  })

  describe('$mul', () => {
    it('treats a missing field as 0 when multiplying', () => {
      const result = applyUpdate({}, { $mul: { count: 5 } })
      expect(result).toEqual({ count: 0 })
    })
  })

  describe('$push', () => {
    it('treats a non-array existing field as an empty array', () => {
      const result = applyUpdate({ tags: 'not-an-array' }, { $push: { tags: 'new' } })
      expect((result as { tags: unknown[] }).tags).toEqual(['new'])
    })

    it('creates an array when the field does not exist', () => {
      const result = applyUpdate({}, { $push: { tags: 'first' } })
      expect(result).toEqual({ tags: ['first'] })
    })

    it('appends multiple values with $each', () => {
      const result = applyUpdate({ tags: ['a'] }, { $push: { tags: { $each: ['b', 'c'] } } })
      expect(result).toEqual({ tags: ['a', 'b', 'c'] })
    })
  })

  describe('$rename', () => {
    it('ignores the operation when newPath is not a string', () => {
      const result = applyUpdate({ a: 1 }, { $rename: { a: 42 } })
      expect(result).toEqual({ a: 1 })
    })

    it('is a no-op when source field does not exist', () => {
      const result = applyUpdate({ a: 1 }, { $rename: { b: 'c' } })
      expect(result).toEqual({ a: 1 })
    })
  })

  describe('$currentDate', () => {
    it('sets a Date object by default', () => {
      const result = applyUpdate({}, { $currentDate: { stamp: true } })
      expect((result as { stamp: unknown }).stamp).toBeInstanceOf(Date)
    })

    it('sets a numeric timestamp when $type is "timestamp"', () => {
      const result = applyUpdate({}, { $currentDate: { stamp: { $type: 'timestamp' } } })
      expect(typeof (result as { stamp: unknown }).stamp).toBe('number')
    })
  })

  describe('$pop', () => {
    it('removes the last element when direction is 1', () => {
      const result = applyUpdate({ list: [1, 2, 3] }, { $pop: { list: 1 } })
      expect((result as { list: unknown[] }).list).toEqual([1, 2])
    })

    it('removes the first element when direction is -1', () => {
      const result = applyUpdate({ list: [1, 2, 3] }, { $pop: { list: -1 } })
      expect((result as { list: unknown[] }).list).toEqual([2, 3])
    })

    it('is a no-op when the list is empty or missing', () => {
      expect(applyUpdate({ list: [] }, { $pop: { list: 1 } })).toEqual({ list: [] })
      expect(applyUpdate({}, { $pop: { list: 1 } })).toEqual({})
    })
  })

  describe('$pull and $pullAll', () => {
    it('$pull is a no-op when the field is not an array', () => {
      const result = applyUpdate({ tags: 'string' }, { $pull: { tags: 'a' } })
      expect(result).toEqual({ tags: 'string' })
    })

    it('$pullAll is a no-op when values is not an array', () => {
      const result = applyUpdate({ tags: ['a', 'b'] }, { $pullAll: { tags: 'not-array' } })
      expect(result).toEqual({ tags: ['a', 'b'] })
    })
  })

  describe('operator dispatcher', () => {
    it('ignores unknown operators', () => {
      const result = applyUpdate({ a: 1 }, { $unknown: { a: 2 } })
      expect(result).toEqual({ a: 1 })
    })

    it('ignores operators with non-object argument payload', () => {
      const result = applyUpdate({ a: 1 }, { $set: null })
      expect(result).toEqual({ a: 1 })
    })
  })

  describe('nested path edge cases', () => {
    it('returns undefined from getAtPath when intermediate segment is missing', () => {
      // Exercised via $unset on a deep missing path — should not throw
      const result = applyUpdate({ a: 1 }, { $unset: { 'missing.child.leaf': '' } })
      expect(result).toEqual({ a: 1 })
    })
  })
})
