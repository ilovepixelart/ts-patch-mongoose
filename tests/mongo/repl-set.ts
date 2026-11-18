import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'

// Transactions need a replica set; a single member is enough.
const replSet = () => {
  let mongo: MongoMemoryReplSet

  const create = async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
    await mongoose.connect(mongo.getUri())
  }

  const destroy = async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.connection.close()
    await mongo.stop({ doCleanup: true, force: true })
  }

  return { create, destroy }
}

export default replSet
