import { inject } from 'vitest'

import mongoose from 'mongoose'

// Connects to the run's replica set (tests/mongo/global-setup.ts) with a database of its own, and
// drops only that database when done.
const server = (dbName: string) => {
  const create = async () => {
    await mongoose.connect(inject('mongoUri'), { dbName })
    // Connecting starts building every registered model's collection and indexes without waiting for
    // it; on the shared server, with every file doing the same, that takes seconds. Finishing it
    // here keeps it out of the first test's time limit.
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
  }

  const destroy = async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.connection.close()
  }

  return { create, destroy }
}

export default server
