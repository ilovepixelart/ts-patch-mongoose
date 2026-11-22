import { afterEach, beforeEach, vi } from 'vitest'

// The plugin reports a failed history write or getter to onError, which defaults to console.error,
// so a test that does not expect one would pass while history is lost. A test that expects it spies
// on console.error itself.
let unexpected: unknown[][] = []

beforeEach(() => {
  unexpected = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    unexpected.push(args)
  })
})

afterEach(() => {
  if (unexpected.length > 0) throw new Error(`console.error was called ${unexpected.length} time(s), first with: ${String(unexpected[0]?.[0])}`)
})
