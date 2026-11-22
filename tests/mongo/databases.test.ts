import { expect, it } from 'vitest'

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// Test files run in parallel on one replica set, each in a database of its own: one that drops its
// database at the end would drop another file's data mid-test if they shared a name.
it('every test file connects to a database of its own', () => {
  const root = join(import.meta.dirname, '..')
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.test.ts'))
  const owners = new Map<string, string[]>()
  for (const file of files) {
    for (const [, name = ''] of readFileSync(join(root, file), 'utf8').matchAll(/\bserver\('([^']+)'\)/g)) owners.set(name, [...(owners.get(name) ?? []), relative(root, join(root, file))])
  }
  expect(owners.size).toBeGreaterThan(0)
  expect([...owners].filter(([, users]) => users.length > 1)).toEqual([])
})
