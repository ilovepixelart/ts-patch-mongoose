import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import { compare, type Operation } from '../src/json-patch'

// ---------- Arbitraries ----------

// Primitive values allowed as leaf nodes. Dates/BigInts/Regex are excluded
// because our patch layer serializes through JSON.stringify so they wouldn't
// round-trip anyway.
const leafArb = (): fc.Arbitrary<unknown> => fc.oneof(fc.integer(), fc.float({ noNaN: true, noDefaultInfinity: true }), fc.string(), fc.boolean(), fc.constant(null))

// Keys, with the empty key and the characters JSON pointers escape (~ and /) made likely.
const keyArb = fc.oneof(fc.string({ maxLength: 6 }), fc.constantFrom('', '~', '/', '~0', '~1', 'a/b', 'a~b'))

// Recursive JSON-ish values: primitives, arrays, and objects of arbitrary shape.
const jsonArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  leaf: leafArb(),
  value: fc.oneof({ withCrossShrink: true, depthSize: 'small' }, tie('leaf'), tie('array'), tie('object')),
  array: fc.array(tie('value'), { maxLength: 5 }),
  object: fc.dictionary(keyArb, tie('value'), { maxKeys: 5 }),
})).value

// Force the top level to be a plain object so compare() preconditions hold
// (compare expects object | unknown[] at the root).
const jsonObjectArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(keyArb, jsonArb, { maxKeys: 5 })

// A variant of a value: kept, replaced, or (for containers) with some entries changed, removed or
// added. Two independently generated objects share no key almost every time, which leaves nested
// diffs untested; a pair made this way shares most of its structure.
const DELETED = Symbol('deleted')

const variantOf = (value: unknown): fc.Arbitrary<unknown> => {
  if (value === null || typeof value !== 'object') return fc.oneof({ weight: 3, arbitrary: fc.constant(value) }, { weight: 1, arbitrary: jsonArb })
  if (Array.isArray(value)) {
    const edited = fc.tuple(fc.tuple(...value.map(variantOf)), fc.nat({ max: value.length }), fc.array(jsonArb, { maxLength: 2 })).map(([kept, length, added]) => [...kept.slice(0, length), ...added])
    return fc.oneof({ weight: 4, arbitrary: edited }, { weight: 1, arbitrary: jsonArb })
  }
  const entries = Object.entries(value).map(([key, child]) => fc.option(variantOf(child), { freq: 4, nil: DELETED }).map((next) => [key, next] as const))
  const edited = fc.tuple(fc.tuple(...entries), fc.dictionary(keyArb, jsonArb, { maxKeys: 2 })).map(([kept, added]) => ({ ...Object.fromEntries(kept.filter(([, next]) => next !== DELETED)), ...added }))
  return fc.oneof({ weight: 4, arbitrary: edited }, { weight: 1, arbitrary: jsonArb })
}

const pairArb = jsonObjectArb.chain((a) => fc.record({ a: fc.constant(a), b: variantOf(a).filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object' && !Array.isArray(b)) }))

// Values as JSON, the form the plugin diffs (getJsonOmit): there a -0 is 0.
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

// A minimal RFC 6902 applier for the ops compare emits: the inverse operation, written from the RFC
// (pointer tokens unescape ~1 to / and ~0 to ~), so it checks compare without reusing its code.
const unescapeToken = (token: string): string => token.replaceAll('~1', '/').replaceAll('~0', '~')

const applyPatch = (document: unknown, patch: Operation[]): unknown => {
  let root = JSON.parse(JSON.stringify(document)) as unknown
  for (const op of patch) {
    const tokens = op.path === '' ? [] : op.path.slice(1).split('/').map(unescapeToken)
    if (tokens.length === 0) {
      if (op.op === 'test') expect(json(root)).toEqual(json(op.value))
      else root = op.op === 'remove' ? undefined : op.value
      continue
    }
    const last = tokens.pop() as string
    let parent = root as Record<string, unknown>
    for (const token of tokens) parent = parent[token] as Record<string, unknown>
    const list = Array.isArray(parent) ? (parent as unknown[]) : undefined
    if (op.op === 'test') expect(json(parent[last])).toEqual(json(op.value))
    else if (op.op === 'remove') list ? list.splice(Number(last), 1) : delete parent[last]
    else if (op.op === 'add' && list) list.splice(last === '-' ? list.length : Number(last), 0, op.value)
    else parent[last] = op.value
  }
  return root
}

const isOperation = (op: unknown): op is Operation => typeof op === 'object' && op !== null && 'op' in op && 'path' in op

// ---------- Properties ----------

describe('json-patch compare — properties', () => {
  it('is reflexive: compare(x, x) is empty', () => {
    fc.assert(
      fc.property(jsonObjectArb, (x) => {
        expect(compare(x, x)).toEqual([])
      }),
    )
  })

  it('is reflexive under structural clone: compare(x, structuredClone(x)) is empty', () => {
    fc.assert(
      fc.property(jsonObjectArb, (x) => {
        const clone = JSON.parse(JSON.stringify(x)) as Record<string, unknown>
        expect(compare(x, clone)).toEqual([])
      }),
    )
  })

  it('applying the patch to the source gives the target, and every test op holds where it is applied', () => {
    fc.assert(
      fc.property(pairArb, fc.boolean(), ({ a, b }, invertible) => {
        // Compared as JSON, the form the plugin diffs (getJsonOmit): a -0 in the target stays -0 in the patch, and is 0 there.
        expect(json(applyPatch(a, compare(a, b, invertible)))).toEqual(json(b))
      }),
    )
  })

  it('emits a patch iff the JSON projections differ', () => {
    fc.assert(
      fc.property(pairArb, ({ a, b }) => {
        const patch = compare(a, b)
        const sameJson = JSON.stringify(a) === JSON.stringify(b)
        if (sameJson) {
          // Equal JSON projections must produce an empty patch.
          expect(patch).toEqual([])
        } else {
          // Different JSON projections must produce at least one op.
          expect(patch.length).toBeGreaterThan(0)
        }
      }),
    )
  })

  it('every emitted op has a well-formed RFC 6901 path', () => {
    fc.assert(
      fc.property(pairArb, ({ a, b }) => {
        // RFC 6901 section 3: a pointer is "" or a sequence of "/" + token, where a token holds no
        // unescaped "/" and uses "~" only as "~0" or "~1". "/" alone points at the key "".
        const pointer = /^(\/([^~/]|~[01])*)*$/
        for (const op of compare(a, b)) {
          expect(isOperation(op)).toBe(true)
          expect(op.path).toMatch(pointer)
        }
      }),
    )
  })

  it('does not mutate either input during diffing', () => {
    fc.assert(
      fc.property(pairArb, ({ a, b }) => {
        const beforeA = JSON.stringify(a)
        const beforeB = JSON.stringify(b)
        compare(a, b)
        expect(JSON.stringify(a)).toBe(beforeA)
        expect(JSON.stringify(b)).toBe(beforeB)
      }),
    )
  })

  it('invertible mode pairs every replace/remove with a preceding test at the same path', () => {
    fc.assert(
      fc.property(pairArb, ({ a, b }) => {
        const patch = compare(a, b, true)
        for (let i = 0; i < patch.length; i++) {
          const op = patch[i]
          if (op.op === 'replace' || op.op === 'remove') {
            // Every replace/remove in invertible mode must be preceded by a
            // test op at the same path.
            const prev = patch[i - 1]
            expect(prev?.op).toBe('test')
            expect(prev?.path).toBe(op.path)
          }
        }
      }),
    )
  })

  it('non-invertible mode never emits test ops', () => {
    fc.assert(
      fc.property(pairArb, ({ a, b }) => {
        const patch = compare(a, b, false)
        expect(patch.some((op) => op.op === 'test')).toBe(false)
      }),
    )
  })

  it('primitive replacement at a top-level key is exactly one replace op, with the key escaped per RFC 6901', () => {
    // Pointers written out by hand from RFC 6901, section 3: ~ becomes ~0 and / becomes ~1.
    const pointers = { a: '/a', '': '/', '~': '/~0', '/': '/~1', 'a/b': '/a~1b', '~1': '/~01' }
    fc.assert(
      fc.property(fc.constantFrom(...Object.entries(pointers)), leafArb(), leafArb(), ([key, path], oldVal, newVal) => {
        fc.pre(JSON.stringify(oldVal) !== JSON.stringify(newVal))
        expect(json(compare({ [key]: oldVal }, { [key]: newVal }))).toEqual([{ op: 'replace', path, value: json(newVal) }])
      }),
    )
  })
})
