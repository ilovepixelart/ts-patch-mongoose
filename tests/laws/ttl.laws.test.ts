import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import fc from 'fast-check'
import { type Duration, setPatchHistoryTTL } from '../../src/index'
import { HistoryModel } from '../../src/model'
import server from '../mongo/server'

// laws/ttl.bend models what setPatchHistoryTTL leaves of the history TTL index, as MongoDB answers it
// (LAWS.bend: ttl_whole_seconds_set, ttl_whole_seconds_idempotent, ttl_below_second_drops). These tests
// run random sequences of TTL inputs on the plugin and the model alike: the index and whether onError
// was called must be the model's after every call.

type Index = { $: 'NoIndex' } | { $: 'Ttl'; secs: number }
type Input = { $: 'Empty' } | { $: 'Invalid' } | { $: 'TooLong' } | { $: 'Millis'; neg: boolean; secs: number; frac: boolean }
type Outcome = { index: Index; error: boolean }

import model from '../../laws/generated/ttl.mjs'

const ttl = model.ttl as (index: Index, input: Input) => Outcome

// The documented units, in milliseconds (a month is a twelfth of a 365.25-day year).
const SECOND = 1000
const DAY = 24 * 60 * 60 * SECOND
const YEAR = 365.25 * DAY
const UNITS: Record<string, number> = {
  ms: 1,
  msec: 1,
  msecs: 1,
  millisecond: 1,
  milliseconds: 1,
  s: SECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
  m: 60 * SECOND,
  min: 60 * SECOND,
  mins: 60 * SECOND,
  minute: 60 * SECOND,
  minutes: 60 * SECOND,
  h: 3600 * SECOND,
  hr: 3600 * SECOND,
  hrs: 3600 * SECOND,
  hour: 3600 * SECOND,
  hours: 3600 * SECOND,
  d: DAY,
  day: DAY,
  days: DAY,
  w: 7 * DAY,
  week: 7 * DAY,
  weeks: 7 * DAY,
  mo: YEAR / 12,
  month: YEAR / 12,
  months: YEAR / 12,
  y: YEAR,
  yr: YEAR,
  yrs: YEAR,
  year: YEAR,
  years: YEAR,
}
// MongoDB's largest expireAfterSeconds.
const MAX_SECONDS = 2147483647

type Case = { ttl: Duration | string; input: Input }
const millis = (ttl: Duration | string, value: number): Case => {
  const whole = Math.trunc(Math.abs(value) / SECOND)
  if (whole > MAX_SECONDS) return { ttl, input: { $: 'TooLong' } }
  return { ttl, input: { $: 'Millis', neg: value < 0, secs: whole, frac: Math.abs(value) % SECOND !== 0 } }
}
const AMOUNTS = ['0', '1', '2', '1.5', '.5', '-1', '-.5', '-0', '90', '68', '69']
const caseArb: fc.Arbitrary<Case> = fc.oneof(
  fc.tuple(fc.constantFrom(...AMOUNTS), fc.constantFrom('', ' '), fc.constantFrom(...Object.keys(UNITS)), fc.boolean()).map(([amount, space, unit, upper]) => millis(`${amount}${space}${upper ? unit.toUpperCase() : unit}`, Number(amount) * UNITS[unit])),
  fc.constantFrom(...AMOUNTS).map((amount) => millis(amount, Number(amount))),
  fc.constantFrom(0, 1, 999, 1000, 1500, 2000, 60_000, -1, -1000, -1500).map((n) => millis(n, n)),
  fc.constant<Case>({ ttl: '', input: { $: 'Empty' } }),
  fc.constantFrom('abc', 'NaN', '1e3', ' 1s', '1s ', '1 s s', '1x', `${'1'.repeat(99)}s`).map((ttl): Case => ({ ttl, input: { $: 'Invalid' } })),
)
// Repeat gives the previous input again: two equal whole-second inputs in a row, which leave the index
// as it is (LAWS.bend: ttl_whole_seconds_idempotent), are otherwise a rare draw.
const sequenceArb = fc.array(fc.oneof({ weight: 4, arbitrary: caseArb }, { weight: 1, arbitrary: fc.constant('repeat' as const) }), { minLength: 1, maxLength: 6 }).map((drawn) =>
  drawn.reduce<Case[]>((cases, item) => {
    const previous = cases.at(-1)
    if (item !== 'repeat') cases.push(item)
    else if (previous) cases.push(previous)
    return cases
  }, []),
)
const sameTtl = (before: Index, after: Index) => before.$ === 'Ttl' && after.$ === 'Ttl' && before.secs === after.secs

describe('setPatchHistoryTTL keeps the laws of laws/ttl.bend', () => {
  const instance = server('laws-ttl')

  const indexNow = async (): Promise<Index> => {
    const found = (await HistoryModel.collection.indexes()).find((index) => index.name === 'createdAt_1_TTL')
    return found ? { $: 'Ttl', secs: found.expireAfterSeconds as number } : { $: 'NoIndex' }
  }

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  it('leaves the index the model leaves, and reports to onError when the model errs, after every call', async () => {
    let sequences = 0
    let kept = 0
    await fc.assert(
      fc.asyncProperty(sequenceArb, async (cases) => {
        sequences++
        if ((await indexNow()).$ === 'Ttl') await HistoryModel.collection.dropIndex('createdAt_1_TTL')
        let index: Index = { $: 'NoIndex' }
        for (const { ttl: input, input: modelInput } of cases) {
          const errors: Error[] = []
          await setPatchHistoryTTL(input as Duration, (error) => errors.push(error))
          const { index: expectedIndex, error } = ttl(index, modelInput)
          expect({ index: await indexNow(), error: errors.length > 0 }).toEqual({ index: expectedIndex, error })
          expect(errors.length).toBeLessThanOrEqual(1)
          if (modelInput.$ === 'Millis' && sameTtl(index, expectedIndex)) kept++
          index = expectedIndex
        }
      }),
      { numRuns: 300 },
    )
    expect(sequences).toBe(300)
    expect(kept).toBeGreaterThan(0)
  }, 120_000)

  // Characterization: 0 drops an existing index, but with none it creates one of 0 seconds, under which
  // MongoDB deletes every history entry at its next TTL pass. '0s' and '500ms' do the same.
  it('characterization: a TTL of 0 with no index creates an index that expires history immediately', async () => {
    if ((await indexNow()).$ === 'Ttl') await HistoryModel.collection.dropIndex('createdAt_1_TTL')
    await setPatchHistoryTTL(0)
    expect(await indexNow()).toEqual({ $: 'Ttl', secs: 0 })
  })

  // Characterization: an input ms cannot parse, or one beyond MongoDB's limit, drops the existing index
  // before the create fails, so the history keeps no TTL at all.
  it('characterization: an unparseable or too long TTL loses the existing index', async () => {
    for (const input of ['one day', '69y'] as Duration[]) {
      await setPatchHistoryTTL('1d')
      const errors: Error[] = []
      await setPatchHistoryTTL(input, (error) => errors.push(error))
      expect([input, await indexNow(), errors.length]).toEqual([input, { $: 'NoIndex' }, 1])
    }
  })
})
