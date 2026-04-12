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
  return JSON.parse(JSON.stringify(value)) as T // NOSONAR: structuredClone cannot handle mongoose documents (they contain non-cloneable methods)
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

const normalizeTarget = (target: unknown): unknown => {
  if (!isContainer(target) || Array.isArray(target)) return target
  const withToJSON = target as { toJSON?: () => unknown }
  return typeof withToJSON.toJSON === 'function' ? withToJSON.toJSON() : target
}

const emitTest = (path: string, value: unknown, invertible: boolean, out: Operation[]): void => {
  if (invertible) out.push({ op: 'test', path, value: cloneValue(value) })
}

const emitReplace = (path: string, source: unknown, target: unknown, invertible: boolean, out: Operation[]): void => {
  emitTest(path, source, invertible, out)
  out.push({ op: 'replace', path, value: cloneValue(target) })
}

const emitRemove = (path: string, source: unknown, invertible: boolean, out: Operation[]): void => {
  emitTest(path, source, invertible, out)
  out.push({ op: 'remove', path })
}

const shouldTreatAsRemoval = (sourceChild: unknown, targetChild: unknown, sourceIsArray: boolean): boolean => {
  return targetChild === undefined && sourceChild !== undefined && !sourceIsArray
}

type DiffScope = {
  readonly source: JsonContainer
  readonly target: JsonContainer
  readonly targetKeySet: Set<string>
  readonly basePath: string
  readonly sourceIsArray: boolean
  readonly invertible: boolean
  readonly out: Operation[]
}

const diffSourceKey = (scope: DiffScope, key: string): void => {
  const { source, target, targetKeySet, basePath, sourceIsArray, invertible, out } = scope
  const childPath = joinPath(basePath, key)
  const sourceChild = source[key]

  if (!targetKeySet.has(key)) {
    emitRemove(childPath, sourceChild, invertible, out)
    return
  }

  const targetChild = target[key]
  if (shouldTreatAsRemoval(sourceChild, targetChild, sourceIsArray)) {
    emitRemove(childPath, sourceChild, invertible, out)
    return
  }

  diff(sourceChild, targetChild, childPath, invertible, out)
}

const diffAddedKeys = (target: JsonContainer, sourceKeys: string[], targetKeys: string[], basePath: string, out: Operation[]): void => {
  const sourceKeySet = new Set(sourceKeys)
  for (const key of targetKeys) {
    if (sourceKeySet.has(key)) continue
    const targetChild = target[key]
    if (targetChild === undefined) continue
    out.push({ op: 'add', path: joinPath(basePath, key), value: cloneValue(targetChild) })
  }
}

const diff = (source: unknown, target: unknown, basePath: string, invertible: boolean, out: Operation[]): void => {
  if (source === target) return

  const resolvedTarget = normalizeTarget(target)
  const sourceIsArray = Array.isArray(source)
  const targetIsArray = Array.isArray(resolvedTarget)

  if (!isContainer(source) || !isContainer(resolvedTarget) || sourceIsArray !== targetIsArray) {
    emitReplace(basePath, source, resolvedTarget, invertible, out)
    return
  }

  const sourceKeys = keysOf(source)
  const targetKeys = keysOf(resolvedTarget)
  const targetKeySet = new Set(targetKeys)

  const scope: DiffScope = { source, target: resolvedTarget, targetKeySet, basePath, sourceIsArray, invertible, out }
  for (const key of Array.from(sourceKeys).reverse()) {
    diffSourceKey(scope, key)
  }

  diffAddedKeys(resolvedTarget, sourceKeys, targetKeys, basePath, out)
}

export const compare = (source: object | unknown[], target: object | unknown[], invertible = false): Operation[] => {
  const out: Operation[] = []
  diff(source, target, '', invertible, out)
  return out
}
