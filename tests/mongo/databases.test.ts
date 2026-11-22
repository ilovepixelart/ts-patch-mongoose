import { expect, it } from 'vitest'

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

// Test files run in parallel on one replica set, each in a database of its own: one that drops its
// database at the end would drop another file's data mid-test if they shared a name. A name a helper
// passes to server() belongs to every test file that imports the helper.
const SERVER = /\bserver\(\s*(['"`])([^'"`]+)\1\s*\)/g
const IMPORT = /from\s+'(\.[^']+)'/g

it('every test file connects to a database of its own', () => {
  const root = join(import.meta.dirname, '..')
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts') && file !== join('mongo', 'server.ts'))
  const names = new Map(files.map((file) => [file.replace(/\.ts$/, ''), [...readFileSync(join(root, file), 'utf8').matchAll(SERVER)].map(([, , name = '']) => name)]))
  const owners = new Map<string, string[]>()
  for (const file of files.filter((file) => file.endsWith('.test.ts'))) {
    const helpers = [...readFileSync(join(root, file), 'utf8').matchAll(IMPORT)].map(([, specifier = '']) => relative(root, join(root, dirname(file), specifier)))
    for (const name of new Set([...(names.get(file.replace(/\.ts$/, '')) ?? []), ...helpers.flatMap((helper) => names.get(helper) ?? [])])) owners.set(name, [...(owners.get(name) ?? []), file])
  }
  expect(owners.get('repl-set')).toBeDefined()
  expect([...owners].filter(([, users]) => users.length > 1)).toEqual([])
})
