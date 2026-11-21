import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import model from '../../laws/generated/chunk.mjs'
import { chunk } from '../../src/helpers'
import { type BendList, fromList, toList } from './bend'

// laws/chunk.bend models chunk and proves that the pieces concatenate to the input (LAWS.bend:
// chunk_concat). This test holds chunk to that model.

const modelChunk = model.chunk as (xs: BendList<number>, size: number) => BendList<BendList<number>>

describe('chunk keeps the laws of laws/chunk.bend', () => {
  it('gives the pieces the model gives, for every list and size', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 99 }), { maxLength: 30 }), fc.integer({ min: 1, max: 8 }), (xs, size) => {
        expect(chunk(xs, size)).toEqual(fromList(modelChunk(toList(xs), size)).map(fromList))
      }),
      { numRuns: 2000 },
    )
  })
})
