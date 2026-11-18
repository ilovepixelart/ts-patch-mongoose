// Cold-start transaction check. Each start is a new process on a new database: it connects,
// defines a model without awaiting init, and immediately runs manual transactions while mongoose
// is still creating and indexing the history collection. Writing history inside the caller's
// transaction made 1.25% of such transactions fail with LockTimeout (5 of 400, 20 per start).
//
//   node cold-start.mjs <out.json>        parent: one replica set, runs the starts in sequence
//   node cold-start.mjs child <uri>       one start, prints its result as JSON

import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const FAILURE_RATE = 0.0125
const CONFIDENCE = 0.99
const TRANSACTIONS_PER_START = 20

// Smallest n with 1 - (1 - FAILURE_RATE)^n >= CONFIDENCE, rounded up to whole starts.
const plan = () => {
  const transactions = Math.ceil(Math.log(1 - CONFIDENCE) / Math.log(1 - FAILURE_RATE))
  const starts = Math.ceil(transactions / TRANSACTIONS_PER_START)
  const total = starts * TRANSACTIONS_PER_START
  return { failureRate: FAILURE_RATE, confidence: CONFIDENCE, transactions, starts, perStart: TRANSACTIONS_PER_START, total, missProbability: (1 - FAILURE_RATE) ** total }
}

const child = async (uri) => {
  const { default: mongoose } = await import('mongoose')
  const { patchHistoryPlugin } = await import('ts-patch-mongoose')
  await mongoose.connect(uri)
  const schema = new mongoose.Schema({ sku: String, n: Number })
  schema.plugin(patchHistoryPlugin, { omit: ['__v'] })
  const Model = mongoose.model('ColdStart', schema)
  const _id = new mongoose.Types.ObjectId()
  await Model.collection.insertOne({ _id, sku: 'cold', n: 0 })

  const failures = []
  for (let i = 0; i < TRANSACTIONS_PER_START; i++) {
    const session = await mongoose.startSession()
    try {
      session.startTransaction()
      await Model.updateOne({ _id }, { $inc: { n: 1 } }, { session })
      await session.commitTransaction()
    } catch (error) {
      failures.push({ transaction: i, codeName: error.codeName ?? error.name, message: String(error.message).slice(0, 300) })
      if (session.inTransaction()) await session.abortTransaction().catch(() => undefined)
    } finally {
      await session.endSession()
    }
  }

  const { n } = await Model.collection.findOne({ _id })
  const history = await mongoose.connection.collection('history').countDocuments({ collectionId: _id })
  console.log(JSON.stringify({ committed: TRANSACTIONS_PER_START - failures.length, n, history, failures }))
  await mongoose.disconnect()
}

const parent = async (out) => {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server')
  const run = promisify(execFile)
  const self = fileURLToPath(import.meta.url)
  const settings = plan()
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  const started = Date.now()
  const starts = []
  try {
    for (let start = 0; start < settings.starts; start++) {
      const { stdout } = await run(process.execPath, [self, 'child', replSet.getUri(`cold-start-${start}`)], { timeout: 120_000 })
      starts.push(JSON.parse(stdout.trim().split('\n').at(-1)))
    }
  } finally {
    await replSet.stop()
  }
  writeFileSync(out, JSON.stringify({ plan: settings, starts, ms: Date.now() - started }))
}

if (process.argv[2] === 'child') await child(process.argv[3])
else await parent(process.argv[2])
