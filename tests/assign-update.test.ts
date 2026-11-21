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
      expect(Object.hasOwn(items, 1)).toBe(true)
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

    it('sets the field when it holds undefined', () => {
      const result = applyUpdate({ score: undefined }, { $min: { score: 5 } })
      expect(result).toEqual({ score: 5 })
    })

    it('keeps the current value when the candidate is equal', () => {
      const current = new Date(1000)
      const result = applyUpdate({ at: current }, { $min: { at: new Date(1000) } })
      expect(result.at).toBe(current)
    })

    it('creates the parent when a nested path is missing', () => {
      const result = applyUpdate({}, { $min: { 'o.x': 5 } })
      expect(result).toEqual({ o: { x: 5 } })
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

    it('sets the field when it holds undefined', () => {
      const result = applyUpdate({ score: undefined }, { $max: { score: 5 } })
      expect(result).toEqual({ score: 5 })
    })

    it('keeps the current value when the candidate is equal', () => {
      const current = new Date(1000)
      const result = applyUpdate({ at: current }, { $max: { at: new Date(1000) } })
      expect(result.at).toBe(current)
    })

    it('creates the parent when a nested path is missing', () => {
      const result = applyUpdate({}, { $max: { 'o.x': 5 } })
      expect(result).toEqual({ o: { x: 5 } })
    })
  })

  describe('$addToSet with non-JSON-stringifiable values', () => {
    it('falls back to reference equality when values cannot be JSON-stringified', () => {
      const bigA = BigInt(1)
      const bigB = BigInt(2)
      const result = applyUpdate({ values: [bigA] }, { $addToSet: { values: bigB } })
      expect((result as { values: unknown[] }).values).toEqual([bigA, bigB])
    })

    it('does not add a value that cannot be JSON-stringified when the same value is present', () => {
      const big = BigInt(1)
      const result = applyUpdate({ values: [big] }, { $addToSet: { values: big } })
      expect((result as { values: unknown[] }).values).toEqual([big])
    })

    it('treats a non-array existing field as an empty array', () => {
      const result = applyUpdate({ values: 'not-an-array' }, { $addToSet: { values: 'a' } })
      expect(result).toEqual({ values: ['a'] })
    })

    it('adds null as a single value', () => {
      const result = applyUpdate({ values: [1] }, { $addToSet: { values: null } })
      expect((result as { values: unknown[] }).values).toEqual([1, null])
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

    it('replaces a null parent with an object holding the incremented field', () => {
      const result = applyUpdate({ o: null }, { $inc: { 'o.x': 1 } })
      expect(result).toEqual({ o: { x: 1 } })
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

    it('appends null as a single value', () => {
      const result = applyUpdate({ tags: ['a'] }, { $push: { tags: null } })
      expect(result).toEqual({ tags: ['a', null] })
    })

    it('appends an object whose $each is not an array as a single value', () => {
      const result = applyUpdate({ tags: ['a'] }, { $push: { tags: { $each: 'bc' } } })
      expect(result).toEqual({ tags: ['a', { $each: 'bc' }] })
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

    it('sets a Date object when $type is "date"', () => {
      const result = applyUpdate({}, { $currentDate: { stamp: { $type: 'date' } } })
      expect((result as { stamp: unknown }).stamp).toBeInstanceOf(Date)
    })

    it('sets a Date object when the spec is null', () => {
      const result = applyUpdate({}, { $currentDate: { stamp: null } })
      expect((result as { stamp: unknown }).stamp).toBeInstanceOf(Date)
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

    it('keeps the same empty list rather than writing a new one', () => {
      const list: unknown[] = []
      expect(applyUpdate({ list }, { $pop: { list: 1 } }).list).toBe(list)
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

    it('ignores a string argument payload rather than reading its characters as fields', () => {
      const result = applyUpdate({ a: 1 }, { $set: 'ab' })
      expect(result).toEqual({ a: 1 })
    })
  })

  describe('nested path edge cases', () => {
    it('returns undefined from getAtPath when intermediate segment is missing', () => {
      // Exercised via $unset on a deep missing path — should not throw
      const result = applyUpdate({ a: 1 }, { $unset: { 'missing.child.leaf': '' } })
      expect(result).toEqual({ a: 1 })
    })

    it('handles a path whose parent is missing for every array and rename operator', () => {
      expect(applyUpdate({}, { $mul: { 'm.x': 2 } })).toEqual({ m: { x: 0 } })
      expect(applyUpdate({}, { $rename: { 'm.x': 'y' } })).toEqual({})
      expect(applyUpdate({}, { $push: { 'm.x': 1 } })).toEqual({ m: { x: [1] } })
      expect(applyUpdate({}, { $addToSet: { 'm.x': 1 } })).toEqual({ m: { x: [1] } })
      expect(applyUpdate({}, { $pull: { 'm.x': 1 } })).toEqual({})
      expect(applyUpdate({}, { $pullAll: { 'm.x': [1] } })).toEqual({})
      expect(applyUpdate({}, { $pop: { 'm.x': 1 } })).toEqual({})
    })

    it('replaces a null parent with an object when setting a nested path', () => {
      const result = applyUpdate({ o: null }, { 'o.x': 1 })
      expect(result).toEqual({ o: { x: 1 } })
    })

    // Characterization: only the top level is copied. The plugin always passes a fresh toObject() copy.
    it('characterization: writes a nested change through to the input, which shares nested objects with the result', () => {
      const input = { top: 1, o: { x: 1 } }
      const result = applyUpdate(input, { $inc: { 'o.x': 1 }, $set: { top: 2 } })
      expect(result).toEqual({ top: 2, o: { x: 2 } })
      expect(input).toEqual({ top: 1, o: { x: 2 } })
      expect(result.o).toBe(input.o)
    })
  })
})
