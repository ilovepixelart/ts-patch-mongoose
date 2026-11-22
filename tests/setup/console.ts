import { afterAll, afterEach, beforeEach } from 'vitest'

// The plugin reports a failed history write or getter to onError, which defaults to console.error,
// so a test that does not expect one would pass while history is lost. console.error is a plain
// function here, not a mock, so vi.resetAllMocks() and vi.restoreAllMocks() leave it in place. A test
// that expects a call spies on console.error with a mock implementation of its own. A call outside a
// test (beforeAll, afterAll, or after a test ended) fails the file.
let unexpected: unknown[][] = []

console.error = (...args: unknown[]) => {
  unexpected.push(args)
}

const report = (where: string) => {
  const calls = unexpected
  unexpected = []
  if (calls.length > 0) throw new Error(`console.error was called ${calls.length} time(s) ${where}, first with: ${String(calls[0]?.[0])}`)
}

beforeEach(() => report('before this test, in beforeAll or after an earlier test ended'))

afterEach(() => report('in this test'))

afterAll(() => report('outside a test'))
