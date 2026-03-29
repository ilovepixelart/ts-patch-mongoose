import { HistoryModel } from './model'
import { type Duration, ms } from './ms'

import type { QueryOptions, ToObjectOptions } from 'mongoose'

export const isArray = Array.isArray

export const isEmpty = (value: unknown): boolean => {
  if (value == null) return true
  if (Array.isArray(value) || typeof value === 'string') return value.length === 0
  if (value instanceof Map || value instanceof Set) return value.size === 0
  if (typeof value === 'object') {
    for (const key in value) {
      if (Object.hasOwn(value, key)) return false
    }
    return true
  }
  return true
}

export const isFunction = (value: unknown): value is (...args: unknown[]) => unknown => {
  return typeof value === 'function'
}

export const isObjectLike = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const cloneArrayBuffer = (arrayBuffer: ArrayBuffer): ArrayBuffer => {
  const result = new ArrayBuffer(arrayBuffer.byteLength)
  new Uint8Array(result).set(new Uint8Array(arrayBuffer))
  return result
}

const cloneImmutable = <T>(value: T): T | undefined => {
  const tag = Object.prototype.toString.call(value)

  switch (tag) {
    case '[object Date]':
      return new Date(+(value as unknown as Date)) as T
    case '[object RegExp]': {
      const re = value as unknown as RegExp
      const cloned = new RegExp(re.source, re.flags)
      cloned.lastIndex = re.lastIndex
      return cloned as T
    }
    case '[object Error]': {
      const err = value as unknown as Error
      const cloned = new (err.constructor as ErrorConstructor)(err.message)
      if (err.stack) cloned.stack = err.stack
      return cloned as T
    }
    case '[object ArrayBuffer]':
      return cloneArrayBuffer(value as unknown as ArrayBuffer) as T
    case '[object DataView]': {
      const dv = value as unknown as DataView
      const buffer = cloneArrayBuffer(dv.buffer as ArrayBuffer)
      return new DataView(buffer, dv.byteOffset, dv.byteLength) as T
    }
  }

  if (ArrayBuffer.isView(value)) {
    const ta = value as unknown as { buffer: ArrayBuffer; byteOffset: number; length: number }
    const buffer = cloneArrayBuffer(ta.buffer)
    return new (value.constructor as new (buffer: ArrayBuffer, byteOffset: number, length: number) => T)(buffer, ta.byteOffset, ta.length)
  }

  return undefined
}

const cloneCollection = <T extends object>(value: T, seen: WeakMap<object, unknown>): T => {
  if (value instanceof Map) {
    const map = new Map()
    seen.set(value, map)
    for (const [k, v] of value) map.set(k, cloneDeep(v, seen))
    return map as T
  }

  if (value instanceof Set) {
    const set = new Set()
    seen.set(value, set)
    for (const v of value) set.add(cloneDeep(v, seen))
    return set as T
  }

  if (Array.isArray(value)) {
    const arr = new Array(value.length) as unknown[]
    seen.set(value, arr)
    for (let i = 0; i < value.length; i++) {
      arr[i] = cloneDeep(value[i], seen)
    }
    return arr as T
  }

  const result = typeof value.constructor === 'function' ? (Object.create(Object.getPrototypeOf(value) as object) as T) : ({} as T)
  seen.set(value, result)
  for (const key of Object.keys(value)) {
    ;(result as Record<string, unknown>)[key] = cloneDeep((value as Record<string, unknown>)[key], seen)
  }
  return result
}

export const cloneDeep = <T>(value: T, seen = new WeakMap<object, unknown>()): T => {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value) as T

  const immutable = cloneImmutable(value)
  if (immutable !== undefined) return immutable

  const record = value as Record<string, unknown>

  if (typeof record._bsontype === 'string' && typeof record.toHexString === 'function') {
    return new (value.constructor as new (hex: string) => T)((record.toHexString as () => string)())
  }

  if (typeof record.toJSON === 'function') {
    // NOSONAR — structuredClone cannot handle objects with non-cloneable methods (e.g. mongoose documents)
    return JSON.parse(JSON.stringify(value)) as T
  }

  return cloneCollection(value, seen)
}

export const chunk = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

export const isHookIgnored = <T>(options: QueryOptions<T>): boolean => {
  return options.ignoreHook === true || (options.ignoreEvent === true && options.ignorePatchHistory === true)
}

export const toObjectOptions: ToObjectOptions = {
  depopulate: true,
  virtuals: false,
}

export const setPatchHistoryTTL = async (ttl: Duration, onError?: (error: Error) => void): Promise<void> => {
  const name = 'createdAt_1_TTL'
  try {
    const indexes = await HistoryModel.collection.indexes()
    const existingIndex = indexes?.find((index) => index.name === name)

    if (!ttl && existingIndex) {
      await HistoryModel.collection.dropIndex(name)
      return
    }

    const milliseconds = ms(ttl)

    if (milliseconds < 1000 && existingIndex) {
      await HistoryModel.collection.dropIndex(name)
      return
    }

    const expireAfterSeconds = milliseconds / 1000

    if (existingIndex && existingIndex.expireAfterSeconds === expireAfterSeconds) {
      return
    }

    if (existingIndex) {
      await HistoryModel.collection.dropIndex(name)
    }

    await HistoryModel.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds, name })
  } catch (err) {
    const handler = onError ?? console.error
    handler(err as Error)
  }
}
