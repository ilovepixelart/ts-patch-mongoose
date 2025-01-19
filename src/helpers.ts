import ms from 'ms'

import { HistoryModel } from './models/History'

import type { QueryOptions, ToObjectOptions } from 'mongoose'

export const isHookIgnored = <T>(options: QueryOptions<T>): boolean => {
  return options.ignoreHook === true || (options.ignoreEvent === true && options.ignorePatchHistory === true)
}

export const toObjectOptions: ToObjectOptions = {
  depopulate: true,
  virtuals: false,
}

export const setPatchHistoryTTL = async (ttl: number | ms.StringValue): Promise<void> => {
  const name = 'createdAt_1_TTL' // To avoid collision with user defined index / manually created index
  try {
    const indexes = await HistoryModel.collection.indexes()
    const existingIndex = indexes?.find((index) => index.name === name)

    // Drop the index if historyTTL is not set and index exists
    if (!ttl && existingIndex) {
      await HistoryModel.collection.dropIndex(name)
      return
    }

    const milliseconds = typeof ttl === 'string' ? ms(ttl) : ttl

    // Drop the index if historyTTL is less than 1 second and index exists
    if (milliseconds < 1000 && existingIndex) {
      await HistoryModel.collection.dropIndex(name)
      return
    }

    const expireAfterSeconds = milliseconds / 1000

    if (existingIndex && existingIndex.expireAfterSeconds === expireAfterSeconds) {
      // Index already exists with the correct TTL, no need to recreate
      return
    }

    if (existingIndex) {
      // Drop the existing index if it exists and TTL is different
      await HistoryModel.collection.dropIndex(name)
    }

    // Create a new index with the correct TTL if it doesn't exist or if the TTL is different
    await HistoryModel.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds, name })
  } catch (err) {
    console.error("Couldn't create or update index for history collection", err)
  }
}
