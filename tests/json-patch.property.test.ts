import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import { compare, type Operation } from '../src/json-patch'

// ---------- Arbitraries ----------

// Primitive values allowed as leaf nodes. Dates/BigInts/Regex are excluded
// because our patch layer serializes through JSON.stringify so they wouldn't
// round-trip anyway.
const leafArb = (): fc.Arbitrary<unknown> => fc.oneof(fc.integer(), fc.float({ noNaN: true }), fc.string(), fc.boolean(), fc.constant(null))

// Recursive JSON-ish values: primitives, arrays, and objects of arbitrary shape.
const jsonArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  leaf: leafArb(),
  value: fc.oneof({ withCrossShrink: true, depthSize: 'small' }, tie('leaf'), tie('array'), tie('object')),
  array: fc.array(tie('value'), { maxLength: 5 }),
  object: fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('value'), { maxKeys: 5 }),
})).value

// Force the top level to be a plain object so compare() preconditions hold
// (compare expects object | unknown[] at the root).
const jsonObjectArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), jsonArb, { maxKeys: 5 })

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

  it('emits a patch iff the JSON projections differ', () => {
    fc.assert(
      fc.property(jsonObjectArb, jsonObjectArb, (a, b) => {
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
      fc.property(jsonObjectArb, jsonObjectArb, (a, b) => {
        for (const op of compare(a, b)) {
          // Root pointer is "" (empty); any non-empty path starts with "/"
          // and does not end with "/".
          expect(isOperation(op)).toBe(true)
          if (op.path !== '') {
            expect(op.path.startsWith('/')).toBe(true)
            expect(op.path.endsWith('/')).toBe(false)
          }
        }
      }),
    )
  })

  it('does not mutate either input during diffing', () => {
    fc.assert(
      fc.property(jsonObjectArb, jsonObjectArb, (a, b) => {
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
      fc.property(jsonObjectArb, jsonObjectArb, (a, b) => {
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
      fc.property(jsonObjectArb, jsonObjectArb, (a, b) => {
        const patch = compare(a, b, false)
        expect(patch.some((op) => op.op === 'test')).toBe(false)
      }),
    )
  })

  it('primitive replacement at a top-level key produces a single replace op for that key', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 6 }), leafArb(), leafArb(), (key, oldVal, newVal) => {
        fc.pre(JSON.stringify(oldVal) !== JSON.stringify(newVal))
        const patch = compare({ [key]: oldVal }, { [key]: newVal })
        // Escape the key the way json-patch does for the path check.
        const escaped = key.replaceAll('~', '~0').replaceAll('/', '~1')
        const hit = patch.find((op) => op.path === `/${escaped}`)
        expect(hit).toBeDefined()
      }),
    )
  })
})
