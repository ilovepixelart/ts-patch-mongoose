import ms from 'ms'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import History from '../src/models/History'

import { useTTL } from '../src/helpers'

import type { Mock, MockInstance } from 'vitest'

vi.mock('../src/models/History', () => ({
  default: {
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
  const indexes = History.collection.indexes as Mock

  beforeEach(() => {
    vi.clearAllMocks()
    dropIndexSpy = vi.spyOn(History.collection, 'dropIndex')
    createIndexSpy = vi.spyOn(History.collection, 'createIndex')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should drop the index if historyTTL is not set and index exists', async () => {
    indexes.mockResolvedValue([{ name }])
    const opts = { historyTTL: undefined }

    await useTTL(opts)
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
  })

  it('should drop the index if historyTTL is less than 1 second and index exists', async () => {
    indexes.mockResolvedValue([{ name }])
    const opts = { historyTTL: '500ms' }

    await useTTL(opts)
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
  })

  it('should not recreate the index if it already exists with the correct TTL', async () => {
    const ttl = '1h'
    const expireAfterSeconds = ms(ttl) / 1000

    indexes.mockResolvedValue([{ name, expireAfterSeconds }])
    const opts = { historyTTL: ttl }

    await useTTL(opts)
    expect(dropIndexSpy).not.toHaveBeenCalled()
    expect(createIndexSpy).not.toHaveBeenCalled()
  })

  it('should drop and recreate the index if TTL is different', async () => {
    const ttlBefore = '1h'
    const ttlAfter = '2h'

    const expireAfterSecondsBefore = ms(ttlBefore) / 1000
    const expireAfterSecondsAfter = ms(ttlAfter) / 1000

    indexes.mockResolvedValue([{ name, expireAfterSeconds: expireAfterSecondsBefore }])
    const opts = { historyTTL: ttlAfter }

    await useTTL(opts)
    expect(dropIndexSpy).toHaveBeenCalledWith(name)
    expect(createIndexSpy).toHaveBeenCalledWith({ createdAt: 1 }, { expireAfterSeconds: expireAfterSecondsAfter, name })
  })

  it('should create the index if it does not exist', async () => {
    const opts = { historyTTL: '1h' }
    const expireAfterSeconds = ms(opts.historyTTL) / 1000

    indexes.mockResolvedValue([])

    await useTTL(opts)
    expect(createIndexSpy).toHaveBeenCalledWith({ createdAt: 1 }, { expireAfterSeconds, name })
  })
})
