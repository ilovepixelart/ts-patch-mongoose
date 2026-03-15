import { describe, expect, it } from 'vitest'

import { ms, UNITS } from '../src/ms'

const { s, m, h, d, w, mo, y } = UNITS

describe('ms', () => {
  it('should parse milliseconds', () => {
    expect(ms('100ms')).toBe(100)
    expect(ms('500msecs')).toBe(500)
    expect(ms('1millisecond')).toBe(1)
    expect(ms('5milliseconds')).toBe(5)
  })

  it('should parse seconds', () => {
    expect(ms('1s')).toBe(s)
    expect(ms('5sec')).toBe(5 * s)
    expect(ms('10secs')).toBe(10 * s)
    expect(ms('1second')).toBe(s)
    expect(ms('2seconds')).toBe(2 * s)
  })

  it('should parse minutes', () => {
    expect(ms('1m')).toBe(m)
    expect(ms('5min')).toBe(5 * m)
    expect(ms('10mins')).toBe(10 * m)
    expect(ms('1minute')).toBe(m)
    expect(ms('2minutes')).toBe(2 * m)
  })

  it('should parse hours', () => {
    expect(ms('1h')).toBe(h)
    expect(ms('2hr')).toBe(2 * h)
    expect(ms('3hrs')).toBe(3 * h)
    expect(ms('1hour')).toBe(h)
    expect(ms('2hours')).toBe(2 * h)
  })

  it('should parse days', () => {
    expect(ms('1d')).toBe(d)
    expect(ms('1day')).toBe(d)
    expect(ms('2days')).toBe(2 * d)
  })

  it('should parse weeks', () => {
    expect(ms('1w')).toBe(w)
    expect(ms('1week')).toBe(w)
    expect(ms('2weeks')).toBe(2 * w)
  })

  it('should parse months', () => {
    expect(ms('1mo')).toBe(mo)
    expect(ms('1month')).toBe(mo)
    expect(ms('2months')).toBe(2 * mo)
    expect(ms('6mo')).toBe(6 * mo)
    expect(ms('0.5mo')).toBe(0.5 * mo)
  })

  it('should parse years', () => {
    expect(ms('1y')).toBe(y)
    expect(ms('1yr')).toBe(y)
    expect(ms('1year')).toBe(y)
    expect(ms('2years')).toBe(2 * y)
  })

  it('should default to milliseconds when no unit', () => {
    expect(ms('500')).toBe(500)
  })

  it('should handle decimal values', () => {
    expect(ms('1.5h')).toBe(1.5 * h)
    expect(ms('0.5d')).toBe(0.5 * d)
  })

  it('should handle negative values', () => {
    expect(ms('-1s')).toBe(-s)
    expect(ms('-500ms')).toBe(-500)
  })

  it('should handle spaces between number and unit', () => {
    expect(ms('1 hour')).toBe(h)
    expect(ms('2  days')).toBe(2 * d)
    expect(ms('500 ms')).toBe(500)
    expect(ms('30 seconds')).toBe(30 * s)
    expect(ms('5 min')).toBe(5 * m)
    expect(ms('1 mo')).toBe(mo)
    expect(ms('1 week')).toBe(w)
    expect(ms('1 year')).toBe(y)
  })

  it('should be case insensitive', () => {
    expect(ms('1H')).toBe(h)
    expect(ms('1D')).toBe(d)
    expect(ms('1MS')).toBe(1)
  })

  it('should return NaN for strings over 100 chars', () => {
    // @ts-expect-error testing invalid input
    expect(ms('a'.repeat(101))).toBeNaN()
  })

  it('should return NaN for invalid strings', () => {
    // @ts-expect-error testing invalid input
    expect(ms('abc')).toBeNaN()
    // @ts-expect-error testing invalid input
    expect(ms('')).toBeNaN()
    // @ts-expect-error testing invalid input
    expect(ms('hello world')).toBeNaN()
  })
})
