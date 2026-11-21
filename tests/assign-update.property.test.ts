import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import { applyUpdate } from '../src/assign-update'

// ---------- Arbitraries ----------

// Simple top-level keys (no dots so we stay in single-field territory for
// most properties — dot-path semantics are exercised separately).
const keyArb = fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !s.includes('.') && !s.startsWith('$'))

const intArb = fc.integer({ min: -1_000_000, max: 1_000_000 })
const finiteNumberArb = fc.double({ noNaN: true, min: -1e9, max: 1e9 })

const leafArb = fc.oneof(intArb, fc.string(), fc.boolean(), fc.constant(null))

const docArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(keyArb, leafArb, { maxKeys: 5 })

const intArrayArb = fc.array(intArb, { maxLength: 8 })

// An array and a value that is in it about half the time: an independent integer almost never is.
const arrayAndValueArb = intArrayArb.chain((arr) => fc.tuple(fc.constant(arr), arr.length > 0 ? fc.oneof(fc.constantFrom(...arr), intArb) : intArb))

// An array and targets taken partly from it, partly not.
const arrayAndTargetsArb = intArrayArb.chain((arr) =>
  fc.tuple(
    fc.constant(arr),
    fc.tuple(fc.subarray(arr), fc.array(intArb, { maxLength: 3 })).map(([taken, other]) => [...taken, ...other]),
  ),
)

// ---------- $set / $unset ----------

describe('applyUpdate — $set / $unset properties', () => {
  it('$set on a top-level key makes that key readable with the new value', () => {
    fc.assert(
      fc.property(docArb, keyArb, leafArb, (doc, key, value) => {
        const result = applyUpdate(doc, { $set: { [key]: value } })
        expect(result[key]).toStrictEqual(value)
      }),
    )
  })

  it('$set does not mutate the input doc', () => {
    fc.assert(
      fc.property(docArb, keyArb, leafArb, (doc, key, value) => {
        const before = JSON.stringify(doc)
        applyUpdate(doc, { $set: { [key]: value } })
        expect(JSON.stringify(doc)).toBe(before)
      }),
    )
  })

  it('$unset followed by absence: after $unset the key is not an own-prop of the result', () => {
    fc.assert(
      fc.property(docArb, keyArb, leafArb, (doc, key, seedValue) => {
        const seeded = applyUpdate(doc, { $set: { [key]: seedValue } })
        const result = applyUpdate(seeded, { $unset: { [key]: '' } })
        expect(Object.hasOwn(result, key)).toBe(false)
      }),
    )
  })

  it('$set then $set (same key) is equivalent to a single $set with the final value', () => {
    fc.assert(
      fc.property(docArb, keyArb, leafArb, leafArb, (doc, key, v1, v2) => {
        const stepwise = applyUpdate(applyUpdate(doc, { $set: { [key]: v1 } }), { $set: { [key]: v2 } })
        const oneShot = applyUpdate(doc, { $set: { [key]: v2 } })
        expect(JSON.stringify(stepwise)).toBe(JSON.stringify(oneShot))
      }),
    )
  })
})

// ---------- $inc / $mul ----------

describe('applyUpdate — $inc / $mul properties', () => {
  it('$inc is additive: inc(n) ∘ inc(m) === inc(n + m)', () => {
    fc.assert(
      fc.property(keyArb, finiteNumberArb, intArb, intArb, (key, seed, n, m) => {
        const base = { [key]: seed }
        const stepwise = applyUpdate(applyUpdate(base, { $inc: { [key]: n } }), { $inc: { [key]: m } })
        const oneShot = applyUpdate(base, { $inc: { [key]: n + m } })
        expect(stepwise[key]).toBeCloseTo(oneShot[key] as number, 5)
      }),
    )
  })

  it('$inc on a missing field treats the original as 0', () => {
    fc.assert(
      fc.property(keyArb, intArb, (key, delta) => {
        const result = applyUpdate({}, { $inc: { [key]: delta } })
        expect(result[key]).toBe(delta)
      }),
    )
  })

  it('$mul with factor 1 is identity on numeric fields', () => {
    fc.assert(
      fc.property(keyArb, finiteNumberArb, (key, seed) => {
        const base = { [key]: seed }
        const result = applyUpdate(base, { $mul: { [key]: 1 } })
        expect(result[key]).toBeCloseTo(seed, 5)
      }),
    )
  })
})

// ---------- $push / $addToSet / $pull / $pullAll / $pop ----------

describe('applyUpdate — array operator properties', () => {
  it('$push grows the array by exactly 1 (single value)', () => {
    fc.assert(
      fc.property(keyArb, intArrayArb, intArb, (key, arr, value) => {
        const result = applyUpdate({ [key]: arr }, { $push: { [key]: value } })
        const after = result[key] as unknown[]
        expect(after).toHaveLength(arr.length + 1)
        expect(after[after.length - 1]).toBe(value)
      }),
    )
  })

  it('$push with $each grows by exactly the length of $each', () => {
    fc.assert(
      fc.property(keyArb, intArrayArb, intArrayArb, (key, arr, extras) => {
        const result = applyUpdate({ [key]: arr }, { $push: { [key]: { $each: extras } } })
        expect((result[key] as unknown[]).length).toBe(arr.length + extras.length)
      }),
    )
  })

  it('$addToSet appends a value only when it is absent, and is idempotent', () => {
    fc.assert(
      fc.property(keyArb, arrayAndValueArb, (key, [arr, value]) => {
        const once = applyUpdate({ [key]: arr }, { $addToSet: { [key]: value } })
        expect(once[key]).toEqual(arr.includes(value) ? arr : [...arr, value])
        expect(applyUpdate(once, { $addToSet: { [key]: value } })[key]).toEqual(once[key])
      }),
    )
  })

  it('$pull keeps exactly the elements that differ from the matcher, in order', () => {
    fc.assert(
      fc.property(keyArb, arrayAndValueArb, (key, [arr, value]) => {
        const result = applyUpdate({ [key]: arr }, { $pull: { [key]: value } })
        expect(result[key]).toEqual(arr.filter((v) => v !== value))
      }),
    )
  })

  it('$pullAll keeps exactly the elements that are not targets, in order', () => {
    fc.assert(
      fc.property(keyArb, arrayAndTargetsArb, (key, [arr, targets]) => {
        const result = applyUpdate({ [key]: arr }, { $pullAll: { [key]: targets } })
        expect(result[key]).toEqual(arr.filter((v) => !targets.includes(v)))
      }),
    )
  })

  it('$pop with direction 1 shrinks by 1 (non-empty) and preserves every non-last element', () => {
    fc.assert(
      fc.property(
        keyArb,
        intArrayArb.filter((a) => a.length > 0),
        (key, arr) => {
          const result = applyUpdate({ [key]: arr }, { $pop: { [key]: 1 } })
          const after = result[key] as unknown[]
          expect(after).toHaveLength(arr.length - 1)
          for (let i = 0; i < after.length; i++) expect(after[i]).toBe(arr[i])
        },
      ),
    )
  })

  it('$pop with direction -1 shrinks by 1 (non-empty) and preserves every non-first element', () => {
    fc.assert(
      fc.property(
        keyArb,
        intArrayArb.filter((a) => a.length > 0),
        (key, arr) => {
          const result = applyUpdate({ [key]: arr }, { $pop: { [key]: -1 } })
          const after = result[key] as unknown[]
          expect(after).toHaveLength(arr.length - 1)
          for (let i = 0; i < after.length; i++) expect(after[i]).toBe(arr[i + 1])
        },
      ),
    )
  })
})

// ---------- $min / $max ----------

describe('applyUpdate — $min / $max properties', () => {
  // MongoDB: $min "updates the value of the field to a specified value if the specified value is less
  // than the current value" ($max: greater). Strictly, so an equal candidate (0 against -0) keeps it.
  it('$min stores the candidate only when it is less than the stored value', () => {
    fc.assert(
      fc.property(keyArb, finiteNumberArb, finiteNumberArb, (key, seed, candidate) => {
        const result = applyUpdate({ [key]: seed }, { $min: { [key]: candidate } })
        // biome-ignore lint/complexity/useMathMinMax: Math.min(0, -0) is -0, while $min keeps an equal stored value
        expect(result[key]).toBe(candidate < seed ? candidate : seed)
      }),
    )
  })

  it('$max stores the candidate only when it is greater than the stored value', () => {
    fc.assert(
      fc.property(keyArb, finiteNumberArb, finiteNumberArb, (key, seed, candidate) => {
        const result = applyUpdate({ [key]: seed }, { $max: { [key]: candidate } })
        // biome-ignore lint/complexity/useMathMinMax: Math.max(0, -0) is -0, while $max keeps an equal stored value
        expect(result[key]).toBe(candidate > seed ? candidate : seed)
      }),
    )
  })
})

// ---------- Unknown operators ----------

describe('applyUpdate — unknown operator is a no-op', () => {
  it('unknown $ prefixed operators do not mutate the doc structurally', () => {
    fc.assert(
      fc.property(docArb, keyArb, leafArb, (doc, key, value) => {
        const result = applyUpdate(doc, { $bogus: { [key]: value } })
        expect(JSON.stringify(result)).toBe(JSON.stringify(doc))
      }),
    )
  })
})
