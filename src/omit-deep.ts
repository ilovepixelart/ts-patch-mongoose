const isPlainObject = (val: unknown): val is Record<string, unknown> => {
  if (Object.prototype.toString.call(val) !== '[object Object]') return false
  const prot = Object.getPrototypeOf(val) as object | null
  return prot === null || prot === Object.prototype
}

const isUnsafeKey = (key: string): boolean => {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

const getValue = (obj: Record<string, unknown>, path: string): unknown => {
  const segs = path.split('.')
  let current: unknown = obj
  for (const seg of segs) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[seg]
  }
  return current
}

const hasValue = (val: unknown): boolean => {
  if (val == null) return false
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'function') return true
  if (typeof val === 'string') return val.length !== 0
  if (Array.isArray(val)) return val.length !== 0
  if (val instanceof RegExp) return val.source !== '(?:)' && val.source !== ''
  if (val instanceof Error) return val.message !== ''
  if (val instanceof Map || val instanceof Set) return val.size !== 0
  if (typeof val === 'object') {
    for (const key of Object.keys(val)) {
      if (hasValue((val as Record<string, unknown>)[key])) return true
    }
    return false
  }
  return true
}

const has = (obj: unknown, path: string): boolean => {
  if (obj != null && typeof obj === 'object' && typeof path === 'string') {
    return hasValue(getValue(obj as Record<string, unknown>, path))
  }
  return false
}

const unset = (obj: Record<string, unknown>, prop: string): boolean => {
  if (typeof obj !== 'object' || obj === null) return false

  if (Object.hasOwn(obj, prop)) {
    delete obj[prop]
    return true
  }

  if (has(obj, prop)) {
    const segs = prop.split('.')
    let last = segs.pop()
    while (segs.length && segs.at(-1)?.slice(-1) === '\\') {
      last = `${(segs.pop() as string).slice(0, -1)}.${last}`
    }
    let target: unknown = obj
    while (segs.length) {
      const seg = segs.shift() as string
      if (isUnsafeKey(seg)) return false
      target = (target as Record<string, unknown>)[seg]
    }
    return delete (target as Record<string, unknown>)[last ?? '']
  }

  return true
}

export const omitDeep = <T>(value: T, keys: string | string[]): T => {
  if (value === undefined) return {} as T

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = omitDeep(value[i], keys)
    }
    return value
  }

  if (!isPlainObject(value)) return value

  const omitKeys = typeof keys === 'string' ? [keys] : keys
  if (!Array.isArray(omitKeys)) return value

  for (const key of omitKeys) {
    unset(value, key)
  }

  for (const key of Object.keys(value)) {
    ;(value as Record<string, unknown>)[key] = omitDeep((value as Record<string, unknown>)[key], omitKeys)
  }

  return value
}
