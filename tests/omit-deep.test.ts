import { describe, expect, it } from 'vitest'

import { omitDeep } from '../src/omit-deep'

describe('omitDeep', () => {
  it('should return empty object for undefined', () => {
    expect(omitDeep(undefined, 'a')).toEqual({})
  })

  it('should return primitives as-is', () => {
    expect(omitDeep(42 as unknown, 'a')).toBe(42)
    expect(omitDeep('hello' as unknown, 'a')).toBe('hello')
    expect(omitDeep(null as unknown, 'a')).toBe(null)
  })

  it('should omit top-level keys', () => {
    const obj = { a: 1, b: 2, c: 3 }
    expect(omitDeep(obj, ['b'])).toEqual({ a: 1, c: 3 })
  })

  it('should omit with a single string key', () => {
    const obj = { a: 1, b: 2 }
    expect(omitDeep(obj, 'b')).toEqual({ a: 1 })
  })

  it('should omit nested keys recursively', () => {
    const obj = { a: 1, nested: { a: 2, b: 3 } }
    expect(omitDeep(obj, ['a'])).toEqual({ nested: { b: 3 } })
  })

  it('should handle arrays of objects', () => {
    const arr = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]
    expect(omitDeep(arr, ['a'])).toEqual([{ b: 2 }, { b: 4 }])
  })

  it('should handle deeply nested structures', () => {
    const obj = { level1: { level2: { level3: { secret: 'hidden', keep: 'visible' } } } }
    expect(omitDeep(obj, ['secret'])).toEqual({ level1: { level2: { level3: { keep: 'visible' } } } })
  })

  it('should support dot-notation paths', () => {
    const obj = { address: { street: '123 Main', city: 'Springfield' }, name: 'John' }
    expect(omitDeep(obj, ['address.street'])).toEqual({ address: { city: 'Springfield' }, name: 'John' })
  })

  it('should handle dot-notation with nested arrays', () => {
    const obj = { config: { items: [{ secret: 1 }] }, meta: { secret: 2 } }
    expect(omitDeep(obj, ['secret'])).toEqual({ config: { items: [{}] }, meta: {} })
  })

  it('should block __proto__ in dot-notation paths', () => {
    const obj = { a: { b: 1 } }
    omitDeep(obj, ['__proto__.polluted'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('should block constructor in dot-notation paths', () => {
    const obj = { a: 1 }
    omitDeep(obj, ['constructor.something'])
    expect(obj).toEqual({ a: 1 })
  })

  it('should block prototype in dot-notation paths', () => {
    const obj = { a: 1 }
    omitDeep(obj, ['prototype.something'])
    expect(obj).toEqual({ a: 1 })
  })

  it('should return value if keys is not an array or string', () => {
    const obj = { a: 1 }
    expect(omitDeep(obj, 123 as unknown as string[])).toEqual({ a: 1 })
  })

  it('should handle non-plain objects', () => {
    const date = new Date()
    expect(omitDeep(date as unknown, 'a')).toBe(date)
  })

  it('should handle empty objects', () => {
    expect(omitDeep({}, ['a'])).toEqual({})
  })

  it('should handle empty arrays', () => {
    expect(omitDeep([], ['a'])).toEqual([])
  })

  it('should handle dot-notation where intermediate path is missing', () => {
    const obj = { a: 1 }
    expect(omitDeep(obj, ['x.y.z'])).toEqual({ a: 1 })
  })

  it('should handle dot-notation where intermediate is not an object', () => {
    const obj = { a: 'string' }
    expect(omitDeep(obj, ['a.b'])).toEqual({ a: 'string' })
  })

  it('should handle objects with null prototype', () => {
    const obj = Object.create(null) as Record<string, unknown>
    obj.a = 1
    obj.b = 2
    expect(omitDeep(obj, ['b'])).toEqual({ a: 1 })
  })

  it('should handle multiple keys at once', () => {
    const obj = { a: 1, b: 2, c: 3, d: 4 }
    expect(omitDeep(obj, ['a', 'c'])).toEqual({ b: 2, d: 4 })
  })

  it('should omit from dot-notation even when value is empty', () => {
    const obj = { a: { b: '' } }
    expect(omitDeep(obj, ['a.b'])).toEqual({ a: {} })
  })

  it('should omit dot-notation with nested value present', () => {
    const obj = { a: { b: { c: 1 } } }
    expect(omitDeep(obj, ['a.b.c'])).toEqual({ a: { b: {} } })
  })

  it('should handle object where nested values are all empty', () => {
    const obj = { a: { b: {}, c: '' } }
    expect(omitDeep(obj, ['x'])).toEqual({ a: { b: {}, c: '' } })
  })

  it('should handle object with RegExp values', () => {
    const obj = { pattern: /test/i, name: 'hello' }
    expect(omitDeep(obj, ['name'])).toEqual({ pattern: /test/i })
  })

  it('should handle object with Error values', () => {
    const err = new Error('test error')
    const obj = { error: err, name: 'hello' }
    const result = omitDeep(obj, ['name'])
    expect(result).toEqual({ error: err })
  })

  it('should handle object with Map values', () => {
    const map = new Map([['key', 'value']])
    const obj = { data: map, name: 'hello' } as Record<string, unknown>
    const result = omitDeep(obj, ['name'])
    expect(result.data).toBe(map)
  })

  it('should handle object with Set values', () => {
    const set = new Set([1, 2, 3])
    const obj = { data: set, name: 'hello' } as Record<string, unknown>
    const result = omitDeep(obj, ['name'])
    expect(result.data).toBe(set)
  })

  it('should handle object with boolean and number values at dot path', () => {
    const obj = { config: { enabled: true, count: 0 } }
    expect(omitDeep(obj, ['config.enabled'])).toEqual({ config: { count: 0 } })
  })

  it('should handle object with function values at dot path', () => {
    const fn = () => 42
    const obj = { handler: fn, name: 'test' } as Record<string, unknown>
    expect(omitDeep(obj, ['name'])).toEqual({ handler: fn })
  })

  it('should handle object with array values at dot path', () => {
    const obj = { tags: ['a', 'b'], name: 'test' }
    expect(omitDeep(obj, ['tags'])).toEqual({ name: 'test' })
  })

  it('should unset non-empty RegExp at dot path', () => {
    const obj = { config: { pattern: /test/i } }
    expect(omitDeep(obj, ['config.pattern'])).toEqual({ config: {} })
  })

  it('should unset Error with message at dot path', () => {
    const obj = { config: { err: new Error('oops') } }
    expect(omitDeep(obj, ['config.err'])).toEqual({ config: {} })
  })

  it('should unset non-empty Map at dot path', () => {
    const obj = { config: { data: new Map([['a', 1]]) } } as Record<string, unknown>
    expect(omitDeep(obj, ['config.data'])).toEqual({ config: {} })
  })

  it('should unset empty Map at dot path', () => {
    const obj = { config: { data: new Map() } } as Record<string, unknown>
    expect(omitDeep(obj, ['config.data'])).toEqual({ config: {} })
  })

  it('should unset non-empty Set at dot path', () => {
    const obj = { config: { data: new Set([1]) } } as Record<string, unknown>
    expect(omitDeep(obj, ['config.data'])).toEqual({ config: {} })
  })

  it('should unset empty Set at dot path', () => {
    const obj = { config: { data: new Set() } } as Record<string, unknown>
    expect(omitDeep(obj, ['config.data'])).toEqual({ config: {} })
  })

  it('should handle null value at dot-notation intermediate', () => {
    const obj = { a: null } as Record<string, unknown>
    expect(omitDeep(obj, ['a.b'])).toEqual({ a: null })
  })

  it('should handle mixed arrays with primitives and objects', () => {
    const arr = [1, 'two', { a: 1, b: 2 }, null]
    expect(omitDeep(arr, ['a'])).toEqual([1, 'two', { b: 2 }, null])
  })

  it('should unset non-empty array at dot path', () => {
    const obj = { config: { items: [1, 2] } }
    expect(omitDeep(obj, ['config.items'])).toEqual({ config: {} })
  })

  it('should unset empty array at dot path', () => {
    const obj = { config: { items: [] } }
    expect(omitDeep(obj, ['config.items'])).toEqual({ config: {} })
  })

  it('should not mutate the original object', () => {
    const obj = { a: 1, b: 2, nested: { c: 3, d: 4 } }
    const original = structuredClone(obj)
    omitDeep(obj, ['b', 'nested.c'])
    expect(obj).toEqual(original)
  })

  it('should not mutate the original array', () => {
    const arr = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]
    const original = structuredClone(arr)
    omitDeep(arr, ['b'])
    expect(arr).toEqual(original)
  })
})
