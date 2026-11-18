import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setPatchHistoryTTL } from '../src/helpers'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

// The TTL index as MongoDB stores it, whichever driver call creates it.
describe('setPatchHistoryTTL against MongoDB', () => {
  const instance = server('patch-history-ttl')

  beforeAll(async () => {
    await instance.create()
    await HistoryModel.init()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  const ttlIndex = async () => (await HistoryModel.collection.indexes()).find((index) => index.name === 'createdAt_1_TTL')

  it('creates a TTL index on createdAt, changes its expiry, keeps it for the same TTL and drops it without a TTL', async () => {
    const errors: Error[] = []
    const onError = (error: Error) => errors.push(error)

    await setPatchHistoryTTL('1h', onError)
    expect(await ttlIndex()).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 3600 })

    await setPatchHistoryTTL('2h', onError)
    expect(await ttlIndex()).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 7200 })

    await setPatchHistoryTTL('2h', onError)
    expect(await ttlIndex()).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 7200 })

    await setPatchHistoryTTL(undefined as never, onError)
    expect(await ttlIndex()).toBeUndefined()
    expect(errors).toEqual([])
  })
})
