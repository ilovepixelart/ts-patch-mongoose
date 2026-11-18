'use strict'

const { aliasObjectIds, createRecorder, errorShape, isObjectId, plain, resultShape } = require('./capture.cjs')
const { operations } = require('./operations.cjs')

// Runs every operation of every profile in every session mode against a fresh replica set and
// returns one normalized record per scenario, keyed `profile/operation/mode`. The caller passes
// in the modules it loaded, so the same scenarios run through require and through import.

const MODES = ['none', 'committed', 'aborted', 'als-committed', 'als-aborted']
const ALS_MODES = new Set(['als-committed', 'als-aborted'])
const SUBSET = ['save:new', 'save:existing', 'insertMany', 'updateOne', 'updateMany', 'upsert:updateOne-insert', 'deleteOne', 'deleteMany']

const fields = { sku: String, n: Number, tags: [String], labels: [String], meta: { color: String, size: Number }, secret: String }

const events = (profile) => ({ eventCreated: `${profile}:created`, eventUpdated: `${profile}:updated`, eventDeleted: `${profile}:deleted` })

// Plugin options per profile. `full` uses every option, `faulty` has getters that throw or reject
// (one with a non-Error), `disabled` keeps events but turns history off.
const profiles = (rec) => ({
  full: {
    ...events('full'),
    omit: ['__v', 'secret', 'meta.size'],
    getUser: async (doc) => {
      rec.getter('user', doc)
      return { name: 'alice', role: 'admin' }
    },
    getReason: (doc) => {
      rec.getter('reason', doc)
      return `reason:${doc?.sku}`
    },
    getMetadata: async (doc) => {
      rec.getter('metadata', doc)
      return { source: 'e2e', sku: doc?.sku }
    },
    preDelete: async (docs) => rec.preDelete(docs),
    onError: rec.onError,
  },
  faulty: {
    ...events('faulty'),
    omit: ['__v'],
    getUser: async () => {
      throw new Error('user lookup failed')
    },
    getReason: () => {
      throw new TypeError('reason lookup failed')
    },
    getMetadata: () => Promise.reject('metadata lookup failed'),
    onError: rec.onError,
  },
  disabled: { ...events('disabled'), patchHistoryDisabled: true, onError: rec.onError },
})

const PROFILE_OPERATIONS = { full: operations.map((op) => op.name), faulty: SUBSET, disabled: SUBSET.filter((name) => !name.startsWith('upsert')) }

const ABORT = new Error('e2e: abort the transaction')

const sessionModes = (mongoose) => {
  const manual = async (run, end) => {
    const session = await mongoose.startSession()
    try {
      session.startTransaction()
      const result = await run({ session })
      await session[end]()
      return result
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction()
      throw error
    } finally {
      await session.endSession()
    }
  }
  const asyncLocalStorage = async (run, abort) => {
    let result
    try {
      await mongoose.connection.transaction(async () => {
        result = await run({})
        if (abort) throw ABORT
      })
    } catch (error) {
      if (error !== ABORT) throw error
    }
    return result
  }
  return {
    none: (run) => run({}),
    committed: (run) => manual(run, 'commitTransaction'),
    aborted: (run) => manual(run, 'abortTransaction'),
    'als-committed': (run) => asyncLocalStorage(run, false),
    'als-aborted': (run) => asyncLocalStorage(run, true),
  }
}

// transactionAsyncLocalStorage exists from mongoose 8.4; older versions reject the option.
const supportsAsyncLocalStorage = (mongoose) => {
  try {
    mongoose.set('transactionAsyncLocalStorage', false)
    return true
  } catch {
    return false
  }
}

const fixtures = (mongoose) => {
  const oid = (n) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, '0'))
  const fresh = (n, sku) => ({ _id: oid(n), sku, n, tags: ['t1'], labels: ['l1', 'l2'], meta: { color: 'red', size: n }, secret: `s${n}` })
  const seeds = () => [fresh(1, 'a'), fresh(2, 'b'), fresh(3, 'c')]
  return { oid, fresh, seeds }
}

const historyEntry = (entry) => ({ ...plain(entry), _id: isObjectId(entry._id) ? '<ObjectId>' : plain(entry._id) })

const exportsShape = (pkg) =>
  Object.keys(pkg)
    .sort()
    .map((key) => `${key}: ${typeof pkg[key]}`)

const historyIndexes = async (history, setPatchHistoryTTL, rec) => {
  await setPatchHistoryTTL('1h', rec.onError)
  await setPatchHistoryTTL('2h', rec.onError)
  const indexes = await history.indexes()
  return { indexes: indexes.map(plain).sort((a, b) => a.name.localeCompare(b.name)), onError: [...rec.seen.onError] }
}

module.exports = async ({ mongoose, pkg, MongoMemoryReplSet }) => {
  const { patchHistoryPlugin, patchEventEmitter, setPatchHistoryTTL } = pkg
  const rec = createRecorder()
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  try {
    await mongoose.connect(replSet.getUri('e2e'))
    const models = {}
    for (const [profile, options] of Object.entries(profiles(rec))) {
      const schema = new mongoose.Schema(fields)
      schema.plugin(patchHistoryPlugin, options)
      models[profile] = mongoose.model(`E2e${profile}`, schema)
      for (const name of Object.values(events(profile))) patchEventEmitter.on(name, (payload) => rec.event(name, payload))
    }
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))

    const history = mongoose.connection.collection('history')
    const { oid, fresh, seeds } = fixtures(mongoose)
    const modes = sessionModes(mongoose)
    const als = supportsAsyncLocalStorage(mongoose)
    const scenarios = { 'package/exports': exportsShape(pkg) }

    const runOne = async (M, operation, mode) => {
      await M.collection.deleteMany({})
      await history.deleteMany({})
      await M.collection.insertMany(seeds())
      rec.clear()
      const record = {}
      try {
        record.result = resultShape(await modes[mode]((o) => operation.run({ M, o, oid, fresh })))
      } catch (error) {
        record.thrown = errorShape(error)
      }
      record.state = (await M.collection.find({}).sort({ _id: 1 }).toArray()).map(plain)
      record.history = (await history.find({}).sort({ _id: 1 }).toArray()).map(historyEntry)
      Object.assign(record, structuredClone(rec.seen))
      return aliasObjectIds(record)
    }

    const unavailable = (M, operation, mode) => {
      if (ALS_MODES.has(mode) && !als) return `transactionAsyncLocalStorage needs mongoose 8.4+, have ${mongoose.version}`
      if (operation.available && !operation.available(M)) return `${operation.name} is not available in mongoose ${mongoose.version}`
      return undefined
    }

    for (const mode of MODES) {
      if (als) mongoose.set('transactionAsyncLocalStorage', ALS_MODES.has(mode))
      for (const [profile, names] of Object.entries(PROFILE_OPERATIONS)) {
        for (const operation of operations.filter((op) => names.includes(op.name))) {
          const skipped = unavailable(models[profile], operation, mode)
          scenarios[`${profile}/${operation.name}/${mode}`] = skipped ? { skipped } : await runOne(models[profile], operation, mode)
        }
      }
    }
    if (als) mongoose.set('transactionAsyncLocalStorage', false)

    rec.clear()
    scenarios['history/indexes'] = await historyIndexes(history, setPatchHistoryTTL, rec)
    return { mongoose: mongoose.version, scenarios }
  } finally {
    await mongoose.disconnect()
    await replSet.stop()
  }
}
