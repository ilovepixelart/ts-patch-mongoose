import { MongoMemoryReplSet } from 'mongodb-memory-server'

import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string
  }
}

// One single-member replica set for the whole run, so every test file can use transactions; each
// file connects to its own database on it (tests/mongo/server.ts).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  project.provide('mongoUri', replSet.getUri())
  return async () => {
    await replSet.stop({ doCleanup: true, force: true })
  }
}
