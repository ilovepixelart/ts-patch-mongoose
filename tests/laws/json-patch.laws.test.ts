import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import model from '../../laws/generated/patch.mjs'
import { compare, type Operation } from '../../src/json-patch'
import { type BendList, type BendMaybe, fromList, fromMaybe, toList } from './bend'

// laws/patch.bend models compare on flat documents (Nat keys and values) and proves the laws of a
// patch operation and the diff round trip (LAWS.bend). These tests hold compare to that model, and
// check the round trip laws on the compiled model too.

type Entry = { $: 'E'; k: number; v: number }
type ModelOp = { $: 'Put'; k: number; v: number } | { $: 'Del'; k: number }

const diff = model.diff as (a: BendList<Entry>, b: BendList<Entry>) => BendList<ModelOp>
const apply = model.apply as (ops: BendList<ModelOp>, d: BendList<Entry>) => BendList<Entry>
const lookup = model.lookup as (d: BendList<Entry>, k: number) => BendMaybe<number>

const toEntries = (doc: Record<string, number>) => toList(Object.entries(doc).map(([k, v]): Entry => ({ $: 'E', k: Number(k), v })))

// A patch as the set of what it does: Del k, or Put k v (an add and a replace are both a Put).
const fromModel = (ops: BendList<ModelOp>) =>
  fromList(ops)
    .map((op) => (op.$ === 'Del' ? `Del ${op.k}` : `Put ${op.k} ${op.v}`))
    .sort()
const fromCompare = (patch: Operation[]) => patch.map((op) => (op.op === 'remove' ? `Del ${op.path.slice(1)}` : `Put ${op.path.slice(1)} ${(op as { value: number }).value}`)).sort()

// A dictionary's keys are distinct, as the laws require of a document.
const docArb = fc.dictionary(fc.integer({ min: 0, max: 6 }).map(String), fc.integer({ min: 0, max: 3 }), { maxKeys: 6 })
const keyArb = fc.integer({ min: 0, max: 6 })

describe('compare keeps the laws of laws/patch.bend', () => {
  it('emits the operations the model emits, for every pair of flat documents', () => {
    fc.assert(
      fc.property(docArb, docArb, (a, b) => {
        expect(fromCompare(compare(a, b))).toEqual(fromModel(diff(toEntries(a), toEntries(b))))
      }),
      { numRuns: 2000 },
    )
  })

  it('law apply_diff_roundtrip: applying the diff of a and b to a agrees with b on every key', () => {
    fc.assert(
      fc.property(docArb, docArb, keyArb, (a, b, j) => {
        const roundtrip = apply(diff(toEntries(a), toEntries(b)), toEntries(a))
        expect(fromMaybe(lookup(roundtrip, j))).toBe(fromMaybe(lookup(toEntries(b), j)))
      }),
      { numRuns: 2000 },
    )
  })

  it('law diff_self_empty: a document diffed against itself gives no operations', () => {
    fc.assert(
      fc.property(docArb, (a) => {
        expect(fromList(diff(toEntries(a), toEntries(a)))).toEqual([])
      }),
    )
  })
})
