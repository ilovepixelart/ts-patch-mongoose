import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import model from '../../laws/generated/omit.mjs'
import { omitDeep } from '../../src/omit-deep'
import { type BendList, fromList, toList } from './bend'

// laws/omit.bend models omitDeep on trees with Nat keys, and proves that a dotted path whose head is
// unsafe changes nothing and that a key omitted at the top level is not in the result (LAWS.bend:
// omit_unsafe_path_ignored, omit_drops_top_key). Keys 1, 2 and 3 are constructor, prototype and
// __proto__; the rest are k4..k7. __proto__ appears in paths only: as an own key of a tree, omitDeep
// sets the result's prototype instead (pinned in omit-deep.test.ts). This test holds omitDeep to that
// model.

type Json = number | Json[] | { [key: string]: Json }
type Field = { $: 'F'; k: number; t: Tree }
type Tree = { $: 'Leaf'; v: number } | { $: 'Obj'; fs: BendList<Field> } | { $: 'Arr'; xs: BendList<Tree> }

const omit = model.omit as (fuel: number, t: Tree, keys: BendList<BendList<number>>) => Tree
// Fuel bounds the model's recursion; out of fuel it returns a node unchanged, so it must exceed any tree here.
const FUEL = 1_000_000

const NAMES: Record<number, string> = { 1: 'constructor', 2: 'prototype', 3: '__proto__' }
const name = (k: number) => NAMES[k] ?? `k${k}`

const treeKeyArb = fc.constantFrom(1, 2, 4, 5, 6, 7)
const keyArb = fc.integer({ min: 1, max: 7 })
const treeArb = fc.letrec<{ tree: [Json, Tree] }>((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.nat({ max: 9 }).map((v): [Json, Tree] => [v, { $: 'Leaf', v }]),
    fc.uniqueArray(fc.tuple(treeKeyArb, tie('tree')), { selector: ([k]) => k, maxLength: 4 }).map((fields): [Json, Tree] => [Object.fromEntries(fields.map(([k, [json]]) => [name(k), json])), { $: 'Obj', fs: toList(fields.map(([k, [, tree]]): Field => ({ $: 'F', k, t: tree }))) }]),
    fc.array(tie('tree'), { maxLength: 3 }).map((items): [Json, Tree] => [items.map(([json]) => json), { $: 'Arr', xs: toList(items.map(([, tree]) => tree)) }]),
  ),
})).tree
const pathArb = fc.array(keyArb, { minLength: 1, maxLength: 3 })

const toJson = (tree: Tree): Json => {
  if (tree.$ === 'Leaf') return tree.v
  if (tree.$ === 'Arr') return fromList(tree.xs).map(toJson)
  return Object.fromEntries(fromList(tree.fs).map(({ k, t }) => [name(k), toJson(t)]))
}

describe('omitDeep keeps the laws of laws/omit.bend', () => {
  it('omits what the model omits, at every depth, for every key list', () => {
    fc.assert(
      fc.property(treeArb, fc.array(pathArb, { maxLength: 4 }), ([json, tree], paths) => {
        const expected = toJson(omit(FUEL, tree, toList(paths.map(toList))))
        expect(
          omitDeep(
            json,
            paths.map((path) => path.map(name).join('.')),
          ),
        ).toEqual(expected)
      }),
      { numRuns: 3000 },
    )
  })
})
