import { afterAll, beforeAll, describe, it } from 'vitest'

import mongoose from 'mongoose'
import { patchHistoryPlugin } from '../../src/index'
import server from '../mongo/server'
import { type Cfg, createHarness, type LawDoc, type Omit } from './history-harness'

// Applied with mongoose.plugin, the plugin reaches every schema, subdocument schemas included. It must
// record exactly what laws/history.bend says the plugin on the model's own schema records: the
// subdocuments' hooks add no history entry and no event. Mongoose plugins registered this way apply to
// every model this file compiles, which is why this test has a file of its own.

const cfg: Cfg = { history: true, events: true }
const omit: Omit = { keys: [], id: false }

describe('the plugin applied globally keeps the laws of laws/history.bend', () => {
  const instance = server('laws-global')
  const { pluginOptions, checkSequences } = createHarness()
  mongoose.plugin(patchHistoryPlugin, pluginOptions('GlobalLawDoc', cfg, omit))
  const Single = new mongoose.Schema({ x: Number })
  const Item = new mongoose.Schema({ y: Number })
  // No default for the array: a default [] reaches the upsert lookup defect pinned in history.laws.test.ts.
  const schema = new mongoose.Schema<LawDoc & { single?: { x: number }; items?: { y: number }[] }>({ f0: Number, f1: Number, f2: Number, f3: Number, single: Single, items: { type: [Item], default: undefined } })
  const M = mongoose.model('GlobalLawDoc', schema) as unknown as mongoose.Model<LawDoc>

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  it('records what the model records for documents with single and array subdocuments', async () => {
    await checkSequences({ cfg, omit, rejected: false, M, extra: { single: { x: 1 }, items: [{ y: 1 }, { y: 2 }] } }, 200)
  }, 120_000)
})
