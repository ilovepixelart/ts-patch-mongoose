const isPlainObject = (val: unknown): val is Record<string, unknown> => {
  if (Object.prototype.toString.call(val) !== '[object Object]') return false
  const prot = Object.getPrototypeOf(val) as object | null
  return prot === null || prot === Object.prototype
}

const isUnsafeKey = (key: string): boolean => {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

export const omitDeep = <T>(value: T, keys: string | string[]): T => {
  if (value === undefined) return {} as T

  if (Array.isArray(value)) {
    return value.map((item) => omitDeep(item, keys)) as T
  }

  if (!isPlainObject(value)) return value

  const omitKeys = typeof keys === 'string' ? [keys] : keys
  if (!Array.isArray(omitKeys)) return value

  const topLevel = new Set<string>()
  const nested = new Map<string, string[]>()

  for (const key of omitKeys) {
    const dotIdx = key.indexOf('.')
    if (dotIdx === -1) {
      topLevel.add(key)
    } else {
      const head = key.slice(0, dotIdx)
      const tail = key.slice(dotIdx + 1)
      if (!isUnsafeKey(head)) {
        const existing = nested.get(head) ?? []
        existing.push(tail)
        nested.set(head, existing)
      }
    }
  }

  const result = {} as Record<string, unknown>

  for (const key of Object.keys(value)) {
    if (topLevel.has(key)) continue

    let child = (value as Record<string, unknown>)[key]

    const nestedKeys = nested.get(key)
    if (nestedKeys) {
      child = omitDeep(child, nestedKeys)
    } else {
      child = omitDeep(child, omitKeys)
    }

    result[key] = child
  }

  return result as T
}
