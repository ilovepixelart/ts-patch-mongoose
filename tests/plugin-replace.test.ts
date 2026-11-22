import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

// What MongoDB stores for a replacement depends on the method and the mongoose version: replaceOne
// adds a version key, and mongoose 6 applies schema defaults to a findOneAndReplace only with
// runValidators. Whatever it stores is what the updated event's doc and the history must describe.

interface Card {
  name: string
  role?: string
  tags: string[]
  count: number
}

const UPDATED = 'replace-updated'

const schema = new Schema<Card>({ name: String, role: String, tags: [String], count: { type: Number, default: 0 } }, { timestamps: true })
schema.plugin(patchHistoryPlugin, { eventUpdated: UPDATED })
const CardModel = mongoose.model<Card>('ReplaceCard', schema)

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

describe('replacements record what MongoDB stores', () => {
  const instance = server('plugin-replace')
  const updates: Record<string, unknown>[] = []
  const listen = (payload: { doc: unknown }) => updates.push(json(payload.doc))

  beforeAll(async () => {
    await instance.create()
    em.on(UPDATED, listen)
  })

  afterAll(async () => {
    em.off(UPDATED, listen)
    await instance.destroy()
  })

  beforeEach(async () => {
    await CardModel.collection.deleteMany({})
    await HistoryModel.deleteMany({})
    updates.length = 0
  })

  const cases = [
    { method: 'replaceOne', runValidators: false },
    { method: 'replaceOne', runValidators: true },
    { method: 'findOneAndReplace', runValidators: false },
    { method: 'findOneAndReplace', runValidators: true },
  ] as const

  for (const { method, runValidators } of cases) {
    it(`${method}${runValidators ? ' with runValidators' : ''}: the updated event's doc is the stored document and the patch removes the dropped field`, async () => {
      const created = await CardModel.create({ name: 'a', role: 'admin', tags: ['x'], count: 2 })
      const replacement = { name: 'b' }
      if (method === 'replaceOne') await CardModel.replaceOne({ _id: created._id }, replacement, { runValidators })
      else await CardModel.findOneAndReplace({ _id: created._id }, replacement, { runValidators })

      const stored = json(await CardModel.collection.findOne({ _id: created._id }))
      expect(stored.name).toBe('b')
      expect(stored).not.toHaveProperty('role')
      expect(updates).toEqual([stored])

      const entry = await HistoryModel.findOne({ op: method }).lean()
      expect(entry?.patch).toEqual(
        expect.arrayContaining([
          { op: 'test', path: '/role', value: 'admin' },
          { op: 'remove', path: '/role' },
        ]),
      )
    })
  }
})
