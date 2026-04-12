import { describe, expect, it } from 'vitest'

import { splitUpdateAndCommands } from '../src/hooks/update-hooks'

describe('splitUpdateAndCommands', () => {
  it('returns empty update and no commands for null input', () => {
    expect(splitUpdateAndCommands(null)).toEqual({ update: {}, commands: [] })
  })

  it('returns empty update and no commands for empty object', () => {
    expect(splitUpdateAndCommands({})).toEqual({ update: {}, commands: [] })
  })

  it('returns empty update and no commands for aggregation pipeline array', () => {
    expect(splitUpdateAndCommands([{ $set: { name: 'x' } }])).toEqual({ update: {}, commands: [] })
  })

  it('separates plain field updates from dollar-prefixed commands', () => {
    const result = splitUpdateAndCommands({ name: 'x', $set: { age: 1 }, $inc: { count: 2 } })
    expect(result.update).toEqual({ name: 'x' })
    expect(result.commands).toEqual([{ $set: { age: 1 } }, { $inc: { count: 2 } }])
  })

  it('returns only update when there are no commands', () => {
    expect(splitUpdateAndCommands({ name: 'x', age: 1 })).toEqual({ update: { name: 'x', age: 1 }, commands: [] })
  })

  it('returns only commands when there are no plain fields', () => {
    const result = splitUpdateAndCommands({ $set: { name: 'x' } })
    expect(result.update).toEqual({})
    expect(result.commands).toEqual([{ $set: { name: 'x' } }])
  })
})
