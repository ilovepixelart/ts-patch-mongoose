export interface AddOperation<T> {
  op: 'add'
  path: string
  value: T
}

export interface RemoveOperation {
  op: 'remove'
  path: string
}

export interface ReplaceOperation<T> {
  op: 'replace'
  path: string
  value: T
}

export interface TestOperation<T> {
  op: 'test'
  path: string
  value: T
}

export type Operation = AddOperation<unknown> | RemoveOperation | ReplaceOperation<unknown> | TestOperation<unknown>

type JsonContainer = { [key: string]: unknown }

const escapeToken = (key: string): string => {
  if (!key.includes('/') && !key.includes('~')) return key
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

const joinPath = (base: string, key: string): string => `${base}/${escapeToken(key)}`

const cloneValue = <T>(value: T): T => {
  if (value === undefined) return null as unknown as T
  if (value === null || typeof value !== 'object') return value
  // NOSONAR — structuredClone cannot handle mongoose documents (they contain non-cloneable methods)
  return JSON.parse(JSON.stringify(value)) as T
}

const isContainer = (value: unknown): value is JsonContainer => {
  return typeof value === 'object' && value !== null
}

const keysOf = (value: JsonContainer): string[] => {
  if (Array.isArray(value)) {
    const indices: string[] = []
    for (let i = 0; i < value.length; i++) indices.push(String(i))
    return indices
  }
  return Object.keys(value)
}

const diff = (source: unknown, target: unknown, basePath: string, invertible: boolean, out: Operation[]): void => {
  if (source === target) return

  let resolvedTarget: unknown = target
  if (isContainer(resolvedTarget) && !Array.isArray(resolvedTarget)) {
    const withToJSON = resolvedTarget as { toJSON?: () => unknown }
    if (typeof withToJSON.toJSON === 'function') {
      resolvedTarget = withToJSON.toJSON()
    }
  }

  const sourceIsArray = Array.isArray(source)
  const targetIsArray = Array.isArray(resolvedTarget)

  if (!isContainer(source) || !isContainer(resolvedTarget) || sourceIsArray !== targetIsArray) {
    if (invertible) {
      out.push({ op: 'test', path: basePath, value: cloneValue(source) })
    }
    out.push({ op: 'replace', path: basePath, value: cloneValue(resolvedTarget) })
    return
  }

  const sourceKeys = keysOf(source)
  const targetKeys = keysOf(resolvedTarget)
  const targetKeySet = new Set(targetKeys)

  for (const key of Array.from(sourceKeys).reverse()) {
    const childPath = joinPath(basePath, key)
    const sourceChild = source[key]

    if (targetKeySet.has(key)) {
      const targetChild = resolvedTarget[key]
      const skipUndefinedProp = targetChild === undefined && sourceChild !== undefined && !sourceIsArray
      if (skipUndefinedProp) {
        if (invertible) {
          out.push({ op: 'test', path: childPath, value: cloneValue(sourceChild) })
        }
        out.push({ op: 'remove', path: childPath })
        continue
      }
      diff(sourceChild, targetChild, childPath, invertible, out)
    } else {
      if (invertible) {
        out.push({ op: 'test', path: childPath, value: cloneValue(sourceChild) })
      }
      out.push({ op: 'remove', path: childPath })
    }
  }

  const sourceKeySet = new Set(sourceKeys)
  for (const key of targetKeys) {
    if (sourceKeySet.has(key)) continue
    const targetChild = resolvedTarget[key]
    if (targetChild === undefined) continue
    out.push({ op: 'add', path: joinPath(basePath, key), value: cloneValue(targetChild) })
  }
}

export const compare = (source: object | unknown[], target: object | unknown[], invertible = false): Operation[] => {
  const out: Operation[] = []
  diff(source, target, '', invertible, out)
  return out
}
