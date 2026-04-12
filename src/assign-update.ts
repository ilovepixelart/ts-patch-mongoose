type Doc = Record<string, unknown>
type Container = Record<string | number, unknown>
type PathKey = string | number

type Crumb = { readonly key: PathKey; readonly nextNumeric: boolean }
type ParsedPath = { readonly leaf: PathKey; readonly crumbs: readonly Crumb[] }

const hasOwn = Object.prototype.hasOwnProperty

const parseSegment = (segment: string): PathKey => {
  const asNumber = Number(segment)
  return Number.isInteger(asNumber) && String(asNumber) === segment ? asNumber : segment
}

const parsePath = (path: string): ParsedPath => {
  const [first, ...rest] = path.split('.').map(parseSegment)
  let leaf: PathKey = first ?? path
  const crumbs: Crumb[] = []
  for (const key of rest) {
    crumbs.push({ key: leaf, nextNumeric: typeof key === 'number' })
    leaf = key
  }
  return { leaf, crumbs }
}

const deepEqualJson = (a: unknown, b: unknown): boolean => {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}

const ensureContainer = (parent: Container, key: PathKey, hintNumeric: boolean): Container => {
  const existing = parent[key]
  if (existing !== null && typeof existing === 'object') {
    return existing as Container
  }
  const created = hintNumeric ? [] : {}
  parent[key] = created
  return created as Container
}

const setAtPath = (doc: Doc, path: string, value: unknown): void => {
  const { leaf, crumbs } = parsePath(path)
  let cursor: Container = doc as Container
  for (const crumb of crumbs) {
    cursor = ensureContainer(cursor, crumb.key, crumb.nextNumeric)
  }
  cursor[leaf] = value
}

type Located = { container: Container; leaf: PathKey; exists: boolean }

const getAtPath = (doc: Doc, path: string): Located | undefined => {
  const { leaf, crumbs } = parsePath(path)
  let cursor: Container = doc as Container
  for (const crumb of crumbs) {
    const next = cursor[crumb.key]
    if (next === null || typeof next !== 'object') return undefined
    cursor = next as Container
  }
  return { container: cursor, leaf, exists: hasOwn.call(cursor, leaf) }
}

const unsetAtPath = (doc: Doc, path: string): void => {
  const located = getAtPath(doc, path)
  if (!located) return
  if (Array.isArray(located.container)) {
    ;(located.container as unknown[])[located.leaf as number] = undefined
  } else {
    delete (located.container as Record<string, unknown>)[located.leaf]
  }
}

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0)

const toArray = (value: unknown): unknown[] | undefined => (Array.isArray(value) ? value : undefined)

const shouldReplaceForMin = (current: unknown, candidate: unknown): boolean => {
  if (candidate === undefined) return false
  if (current === undefined) return true
  return (candidate as number) < (current as number)
}

const shouldReplaceForMax = (current: unknown, candidate: unknown): boolean => {
  if (candidate === undefined) return false
  if (current === undefined) return true
  return (candidate as number) > (current as number)
}

type OperatorFn = (doc: Doc, path: string, argument: unknown) => void

const operators: Record<string, OperatorFn> = {
  $set: (doc, path, value) => setAtPath(doc, path, value),
  $unset: (doc, path) => unsetAtPath(doc, path),
  $inc: (doc, path, delta) => {
    const located = getAtPath(doc, path)
    const current = located?.exists ? asNumber(located.container[located.leaf]) : 0
    setAtPath(doc, path, current + asNumber(delta))
  },
  $mul: (doc, path, factor) => {
    const located = getAtPath(doc, path)
    const current = located?.exists ? asNumber(located.container[located.leaf]) : 0
    setAtPath(doc, path, current * asNumber(factor))
  },
  $min: (doc, path, candidate) => {
    const located = getAtPath(doc, path)
    if (!located?.exists) {
      setAtPath(doc, path, candidate)
      return
    }
    if (shouldReplaceForMin(located.container[located.leaf], candidate)) {
      setAtPath(doc, path, candidate)
    }
  },
  $max: (doc, path, candidate) => {
    const located = getAtPath(doc, path)
    if (!located?.exists) {
      setAtPath(doc, path, candidate)
      return
    }
    if (shouldReplaceForMax(located.container[located.leaf], candidate)) {
      setAtPath(doc, path, candidate)
    }
  },
  $rename: (doc, path, newPath) => {
    if (typeof newPath !== 'string') return
    const located = getAtPath(doc, path)
    if (!located?.exists) return
    const value = located.container[located.leaf]
    unsetAtPath(doc, path)
    setAtPath(doc, newPath, value)
  },
  $currentDate: (doc, path, spec) => {
    const wantTimestamp = typeof spec === 'object' && spec !== null && (spec as { $type?: string }).$type === 'timestamp'
    setAtPath(doc, path, wantTimestamp ? Date.now() : new Date())
  },
  $push: (doc, path, pushSpec) => {
    const located = getAtPath(doc, path)
    const existing = located?.exists ? (toArray(located.container[located.leaf]) ?? []) : []
    const next = [...existing]
    if (typeof pushSpec === 'object' && pushSpec !== null && '$each' in pushSpec && Array.isArray(pushSpec.$each)) {
      next.push(...pushSpec.$each)
    } else {
      next.push(pushSpec)
    }
    setAtPath(doc, path, next)
  },
  $addToSet: (doc, path, item) => {
    const located = getAtPath(doc, path)
    const existing = located?.exists ? (toArray(located.container[located.leaf]) ?? []) : []
    const next = [...existing]
    const rawItems = typeof item === 'object' && item !== null && '$each' in item ? item.$each : item
    const toAdd = Array.isArray(rawItems) ? rawItems : [rawItems]
    for (const candidate of toAdd) {
      if (!next.some((existingEntry) => deepEqualJson(existingEntry, candidate))) {
        next.push(candidate)
      }
    }
    setAtPath(doc, path, next)
  },
  $pull: (doc, path, matcher) => {
    const located = getAtPath(doc, path)
    const existing = located?.exists ? toArray(located.container[located.leaf]) : undefined
    if (!existing) return
    const filtered = existing.filter((entry) => !deepEqualJson(entry, matcher))
    setAtPath(doc, path, filtered)
  },
  $pullAll: (doc, path, values) => {
    const located = getAtPath(doc, path)
    const existing = located?.exists ? toArray(located.container[located.leaf]) : undefined
    if (!existing || !Array.isArray(values)) return
    const filtered = existing.filter((entry) => !values.some((target) => deepEqualJson(entry, target)))
    setAtPath(doc, path, filtered)
  },
  $pop: (doc, path, direction) => {
    const located = getAtPath(doc, path)
    const existing = located?.exists ? toArray(located.container[located.leaf]) : undefined
    if (!existing || existing.length === 0) return
    const next = direction === -1 ? existing.slice(1) : existing.slice(0, -1)
    setAtPath(doc, path, next)
  },
}

const applyOperator = (doc: Doc, operator: string, fields: unknown): void => {
  const fn = operators[operator]
  if (!fn || fields === null || typeof fields !== 'object') return
  for (const [path, argument] of Object.entries(fields as Record<string, unknown>)) {
    fn(doc, path, argument)
  }
}

export const applyUpdate = (doc: Doc, update: Record<string, unknown>): Doc => {
  const result: Doc = { ...doc }
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) {
      applyOperator(result, key, value)
    } else {
      setAtPath(result, key, value)
    }
  }
  return result
}
