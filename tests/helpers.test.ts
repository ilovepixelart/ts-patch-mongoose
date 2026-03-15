import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cloneDeep, setPatchHistoryTTL } from '../src/helpers'
import { HistoryModel } from '../src/model'
import { ms } from '../src/ms'

vi.mock('../src/model', () => ({
  HistoryModel: {
    collection: {
      indexes: vi.fn(),
      dropIndex: vi.fn(),
      createIndex: vi.fn(),
    },
  },
}))

const name = 'createdAt_1_TTL'

describe('useTTL', () => {
  let dropIndexSpy: MockInstance
  let createIndexSpy: MockInstance
  const indexes = HistoryModel.collection.indexes as Mock

  beforeEach(() => {
    vi.clearAllMocks()
    dropIndexSpy = vi.spyOn(HistoryModel.collection, 'dropIndex')
    createIndexSpy = vi.spyOn(HistoryModel.collection, 'createIndex')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should drop the index if historyTTL is not set and index exists', async () => {
    indexes.mockResolvedValue([{ name }])

    // @ts-expect-error ttl can't be undefined in this case but we want to test it
    await setPatchHistoryTTL(undefined)
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
  })

  it('should drop the index if historyTTL is less than 1 second and index exists', async () => {
    indexes.mockResolvedValue([{ name }])

    await setPatchHistoryTTL('500ms')
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
  })

  it('should not recreate the index if it already exists with the correct TTL', async () => {
    const ttl = '1h'
    const expireAfterSeconds = ms(ttl) / 1000

    indexes.mockResolvedValue([{ name, expireAfterSeconds }])

    await setPatchHistoryTTL(ttl)
    expect(dropIndexSpy).not.toHaveBeenCalled()
    expect(createIndexSpy).not.toHaveBeenCalled()
  })

  it('should drop and recreate the index if TTL is different', async () => {
    const ttlBefore = '1h'
    const ttlAfter = '2h'

    const expireAfterSecondsBefore = ms(ttlBefore) / 1000
    const expireAfterSecondsAfter = ms(ttlAfter) / 1000

    indexes.mockResolvedValue([{ name, expireAfterSeconds: expireAfterSecondsBefore }])

    await setPatchHistoryTTL(ttlAfter)
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
    expect(createIndexSpy).toHaveBeenCalledWith({ createdAt: 1 }, { expireAfterSeconds: expireAfterSecondsAfter, name })
  })

  it('should create the index if it does not exist', async () => {
    const ttl = '1h'
    const expireAfterSeconds = ms(ttl) / 1000

    indexes.mockResolvedValue([])

    await setPatchHistoryTTL(ttl)
    expect(createIndexSpy).toHaveBeenCalledWith({ createdAt: 1 }, { expireAfterSeconds, name })
  })
})

describe('cloneDeep', () => {
  it('should clone primitives', () => {
    expect(cloneDeep(42)).toBe(42)
    expect(cloneDeep('hello')).toBe('hello')
    expect(cloneDeep(null)).toBe(null)
    expect(cloneDeep(undefined)).toBe(undefined)
    expect(cloneDeep(true)).toBe(true)
  })

  it('should deep clone plain objects', () => {
    const original = { a: 1, b: { c: 2 } }
    const cloned = cloneDeep(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned.b).not.toBe(original.b)
  })

  it('should deep clone arrays', () => {
    const original = [1, [2, 3], { a: 4 }]
    const cloned = cloneDeep(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned[1]).not.toBe(original[1])
    expect(cloned[2]).not.toBe(original[2])
  })

  it('should clone Date instances', () => {
    const original = new Date('2026-01-01')
    const cloned = cloneDeep(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned.getTime()).toBe(original.getTime())
  })

  it('should clone RegExp instances', () => {
    const original = /test/gi
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.source).toBe(original.source)
    expect(cloned.flags).toBe(original.flags)
  })

  it('should clone Map instances', () => {
    const original = new Map([['a', { nested: 1 }]])
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.get('a')).toEqual({ nested: 1 })
    expect(cloned.get('a')).not.toBe(original.get('a'))
  })

  it('should clone Set instances', () => {
    const obj = { a: 1 }
    const original = new Set([obj])
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.size).toBe(1)
    const [clonedItem] = cloned
    expect(clonedItem).toEqual(obj)
    expect(clonedItem).not.toBe(obj)
  })

  it('should handle circular references in objects', () => {
    const original: Record<string, unknown> = { a: 1 }
    original.self = original
    const cloned = cloneDeep(original)
    expect(cloned.a).toBe(1)
    expect(cloned.self).toBe(cloned)
    expect(cloned).not.toBe(original)
  })

  it('should handle circular references in arrays', () => {
    const original: unknown[] = [1, 2]
    original.push(original)
    const cloned = cloneDeep(original)
    expect(cloned[0]).toBe(1)
    expect(cloned[1]).toBe(2)
    expect(cloned[2]).toBe(cloned)
    expect(cloned).not.toBe(original)
  })

  it('should handle circular references in nested objects', () => {
    const child: Record<string, unknown> = { value: 'child' }
    const parent: Record<string, unknown> = { child }
    child.parent = parent
    const cloned = cloneDeep(parent)
    expect(cloned).not.toBe(parent)
    expect(cloned.child).not.toBe(child)
    expect((cloned.child as Record<string, unknown>).value).toBe('child')
    expect((cloned.child as Record<string, unknown>).parent).toBe(cloned)
  })

  it('should handle circular references in Maps', () => {
    const original = new Map<string, unknown>()
    original.set('self', original)
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.get('self')).toBe(cloned)
  })

  it('should handle circular references in Sets', () => {
    const original = new Set<unknown>()
    original.add(original)
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.has(cloned)).toBe(true)
    expect(cloned.size).toBe(1)
  })

  it('should clone objects with toJSON method via JSON round-trip', () => {
    const original = { value: 42, toJSON: () => ({ value: 42 }) }
    const cloned = cloneDeep(original)
    expect(cloned).toEqual({ value: 42 })
    expect(cloned).not.toBe(original)
  })

  it('should clone ArrayBuffer', () => {
    const original = new ArrayBuffer(8)
    new Uint8Array(original).set([1, 2, 3, 4, 5, 6, 7, 8])
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.byteLength).toBe(8)
    expect(new Uint8Array(cloned)).toEqual(new Uint8Array(original))
  })

  it('should clone DataView', () => {
    const buffer = new ArrayBuffer(16)
    const original = new DataView(buffer, 4, 8)
    original.setInt32(0, 42)
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.buffer).not.toBe(original.buffer)
    expect(cloned.byteOffset).toBe(4)
    expect(cloned.byteLength).toBe(8)
    expect(cloned.getInt32(0)).toBe(42)
  })

  it('should clone TypedArrays with offset and length', () => {
    const buffer = new ArrayBuffer(16)
    const original = new Uint8Array(buffer, 4, 8)
    original.set([10, 20, 30, 40, 50, 60, 70, 80])
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.buffer).not.toBe(original.buffer)
    expect(cloned.byteOffset).toBe(4)
    expect(cloned.length).toBe(8)
    expect(Array.from(cloned)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
  })

  it('should clone Float64Array', () => {
    const original = new Float64Array([1.1, 2.2, 3.3])
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.buffer).not.toBe(original.buffer)
    expect(Array.from(cloned)).toEqual([1.1, 2.2, 3.3])
  })

  it('should clone RegExp with lastIndex', () => {
    const original = /foo/g
    original.exec('foobar')
    expect(original.lastIndex).toBe(3)
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.lastIndex).toBe(3)
    expect(cloned.source).toBe('foo')
    expect(cloned.flags).toBe('g')
  })

  it('should clone object without constructor', () => {
    const original = Object.create(null) as Record<string, unknown>
    original.a = 1
    original.b = { c: 2 }
    const cloned = cloneDeep(original)
    expect(cloned).not.toBe(original)
    expect(cloned.a).toBe(1)
    expect(cloned.b).toEqual({ c: 2 })
    expect(cloned.b).not.toBe(original.b)
  })
})
