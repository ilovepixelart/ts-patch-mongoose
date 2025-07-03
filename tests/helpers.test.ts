import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ms from 'ms'
import { setPatchHistoryTTL } from '../src/helpers'
import { HistoryModel } from '../src/model'

vi.mock('../src/model', () => ({
  HistoryModel: {
    collection: {
      indexes: vi.fn(),
      dropIndex: vi.fn(),
      createIndex: vi.fn(),
    },
  },
}))

const name = 'createdAt_1_TTL'

describe('useTTL', () => {
  let dropIndexSpy: MockInstance
  let createIndexSpy: MockInstance
  const indexes = HistoryModel.collection.indexes as Mock

  beforeEach(() => {
    vi.clearAllMocks()
    dropIndexSpy = vi.spyOn(HistoryModel.collection, 'dropIndex')
    createIndexSpy = vi.spyOn(HistoryModel.collection, 'createIndex')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should drop the index if historyTTL is not set and index exists', async () => {
    indexes.mockResolvedValue([{ name }])

    // @ts-expect-error ttl can't be undefined in this case but we want to test it
    await setPatchHistoryTTL(undefined)
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
  })

  it('should drop the index if historyTTL is less than 1 second and index exists', async () => {
    indexes.mockResolvedValue([{ name }])

    await setPatchHistoryTTL('500ms')
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
  })

  it('should not recreate the index if it already exists with the correct TTL', async () => {
    const ttl = '1h'
    const expireAfterSeconds = ms(ttl) / 1000

    indexes.mockResolvedValue([{ name, expireAfterSeconds }])

    await setPatchHistoryTTL(ttl)
    expect(dropIndexSpy).not.toHaveBeenCalled()
    expect(createIndexSpy).not.toHaveBeenCalled()
  })

  it('should drop and recreate the index if TTL is different', async () => {
    const ttlBefore = '1h'
    const ttlAfter = '2h'

    const expireAfterSecondsBefore = ms(ttlBefore) / 1000
    const expireAfterSecondsAfter = ms(ttlAfter) / 1000

    indexes.mockResolvedValue([{ name, expireAfterSeconds: expireAfterSecondsBefore }])

    await setPatchHistoryTTL(ttlAfter)
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
    expect(createIndexSpy).toHaveBeenCalledWith({ createdAt: 1 }, { expireAfterSeconds: expireAfterSecondsAfter, name })
  })

  it('should create the index if it does not exist', async () => {
    const ttl = '1h'
    const expireAfterSeconds = ms(ttl) / 1000

    indexes.mockResolvedValue([])

    await setPatchHistoryTTL(ttl)
    expect(createIndexSpy).toHaveBeenCalledWith({ createdAt: 1 }, { expireAfterSeconds, name })
  })
})
