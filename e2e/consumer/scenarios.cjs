'use strict'

const { aliasObjectIds, createRecorder, errorShape, isObjectId, plain, resultShape } = require('./capture.cjs')
const { operations } = require('./operations.cjs')

// Runs every operation of every profile in every session mode against a fresh replica set and
// returns one normalized record per scenario, keyed `profile/operation/mode`. The caller passes
// in the modules it loaded, so the same scenarios run through require and through import.

const MODES = ['none', 'committed', 'aborted', 'als-committed', 'als-aborted']
const ALS_MODES = new Set(['als-committed', 'als-aborted'])
const SUBSET = ['save:new', 'save:existing', 'insertMany', 'updateOne', 'updateMany', 'upsert:updateOne-insert', 'deleteOne', 'deleteMany']

// `big` and `bigs` only where the mongoose major has a BigInt schema type. `extra` is Mixed, so updates
// reach paths the typed fields cannot: through scalars and nulls, into missing parents, keys with / and ~.
// `price` (Decimal128) and `dict` (Map) read back as BSON and plain objects; `owner` can be populated.
const OWNER_MODEL = 'E2eowner'
const OWNER_ID = 100
const hasBigInt = (mongoose) => Boolean(mongoose.Schema.Types.BigInt)

const fields = (mongoose) => ({
  sku: String,
  n: Number,
  tags: [String],
  labels: [String],
  meta: { color: String, size: Number },
  secret: String,
  score: Number,
  note: String,
  at: Date,
  items: [{ name: String, qty: Number }],
  extra: mongoose.Schema.Types.Mixed,
  price: mongoose.Schema.Types.Decimal128,
  dict: { type: Map, of: Number },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: OWNER_MODEL },
  ...(hasBigInt(mongoose) && { big: mongoose.Schema.Types.BigInt, bigs: [mongoose.Schema.Types.BigInt] }),
})

const events = (profile) => ({ eventCreated: `${profile}:created`, eventUpdated: `${profile}:updated`, eventDeleted: `${profile}:deleted` })

// Profiles whose event listeners throw after recording the event.
const THROWING_LISTENERS = new Set(['listener'])

// Schema options per profile; the rest use the defaults.
const SCHEMA_OPTIONS = { timestamps: { timestamps: true }, nonstrict: { strict: false } }

// Plugin options per profile. `full` uses every option, `faulty` has getters that throw or reject
// (one with a non-Error), `disabled` keeps events but turns history off, `named` overrides the
// recorded model and collection names, `listener` has event listeners that throw, `badwrite`
// returns a reason the history schema cannot cast, `no-events` records history only, `omit` exercises
// each omit rule, `omit-all-but-new` and `omit-all-but-secret` omit all but a few paths, `omit-string`
// and `omit-invalid` pass omit as a string and as a value that is not a list, `predelete-fails` has
// a preDelete that rejects, `nonstrict` runs on a schema with strict off, and `timestamps` runs on a
// schema with timestamps.
// Every path of the profile schema except `keep`, for omit lists that leave only those paths.
const omitAllBut = (mongoose, keep) => ['_id', '__v', ...Object.keys(fields(mongoose))].filter((path) => !keep.includes(path))

const profiles = (rec, mongoose) => ({
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
  named: { ...events('named'), omit: ['__v'], modelName: 'Renamed', collectionName: 'renamed', onError: rec.onError },
  listener: { ...events('listener'), omit: ['__v'], onError: rec.onError },
  badwrite: { ...events('badwrite'), omit: ['__v'], getReason: () => ({ not: 'a string' }), onError: rec.onError },
  // `k` at any depth, `qty` in every items element, `color` only under meta, and dotted keys whose
  // head is an unsafe property name, which are ignored: extra.constructor.x and extra.prototype.x stay.
  omit: { ...events('omit'), omit: ['__v', 'k', 'items.qty', 'meta.color', '__proto__.x', 'constructor.x', 'prototype.x'], onError: rec.onError },
  'omit-string': { ...events('omit-string'), omit: 'secret', onError: rec.onError },
  'omit-invalid': { ...events('omit-invalid'), omit: { secret: true }, onError: rec.onError },
  'predelete-fails': {
    ...events('predelete-fails'),
    omit: ['__v'],
    preDelete: async (docs) => {
      rec.preDelete(docs)
      throw new Error('e2e: preDelete refused')
    },
    onError: rec.onError,
  },
  nonstrict: { ...events('nonstrict'), omit: ['__v'], onError: rec.onError },
  // History without any event configured.
  'no-events': { omit: ['__v'], onError: rec.onError },
  // Only paths the fixtures lack, or only `secret`: an update can then start or end on an empty document.
  'omit-all-but-new': { ...events('omit-all-but-new'), omit: omitAllBut(mongoose, ['score', 'note']), onError: rec.onError },
  'omit-all-but-secret': { ...events('omit-all-but-secret'), omit: omitAllBut(mongoose, ['secret']), onError: rec.onError },
  // updatedAt is omitted: two writes in the same millisecond leave it unchanged, so its patch op would depend on the clock.
  timestamps: { ...events('timestamps'), omit: ['__v', 'updatedAt'], onError: rec.onError },
})

const PROFILE_OPERATIONS = {
  full: operations.map((op) => op.name),
  faulty: SUBSET,
  disabled: SUBSET.filter((name) => !name.startsWith('upsert')),
  named: SUBSET,
  listener: SUBSET,
  badwrite: SUBSET,
  omit: [...SUBSET, 'save:subdocument-array', 'updateOne:operators', 'updateOne:subdocument-push', 'updateOne:set-new-object-path', 'updateOne:push', 'insertMany:lean'],
  'omit-string': SUBSET,
  'omit-invalid': SUBSET,
  'predelete-fails': ['deleteOne', 'deleteOne:document', 'deleteMany', 'findOneAndDelete'],
  nonstrict: [...SUBSET, 'updateOne:pipeline', 'updateOne:implicit-set', 'updateOne:set-unknown-field'],
  'no-events': SUBSET,
  'omit-all-but-new': ['updateOne', 'updateOne:inc-missing', 'updateOne:rename-visible'],
  'omit-all-but-secret': ['updateOne', 'updateOne:operators'],
  timestamps: [...SUBSET, 'save:repeated', 'replaceOne', 'findOneAndUpdate', 'upsert:findOneAndUpdate-insert', 'upsert:setOnInsert-insert'],
}

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
  const extra = () => ({ a: 1, nul: null, list: ['x', 'y'], empty: [], obj: { k: 'v' }, 'sl/ash': 1, 'ti~lde': 2, constructor: { x: 1, y: 2 }, prototype: { x: 1, y: 2 } })
  const bigs = hasBigInt(mongoose) ? { bigs: [5n, 6n] } : {}
  const typed = () => ({ at: new Date(Date.UTC(2020, 0, 1)), price: mongoose.Types.Decimal128.fromString('1.5'), dict: { a: 1 }, owner: oid(OWNER_ID) })
  const fresh = (n, sku) => ({ _id: oid(n), sku, n, tags: ['t1'], labels: ['l1', 'l2'], meta: { color: 'red', size: n }, secret: `s${n}`, extra: extra(), ...typed(), ...bigs })
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

// The TTL index after each call: unchanged TTL, a new TTL, under a second, removal with 0, exactly
// one second over an existing index (the boundary), and a value ms() cannot parse.
const TTL_STEPS = ['1h', '1h', '30m', '500ms', '2h', 0, '1 day', '1s', 'not a duration']

const historyTtlSteps = async (history, setPatchHistoryTTL, rec) => {
  await history.dropIndex('createdAt_1_TTL').catch(() => undefined)
  const steps = []
  for (const ttl of TTL_STEPS) {
    rec.clear()
    await setPatchHistoryTTL(ttl, rec.onError)
    const ttlIndex = (await history.indexes()).find((index) => index.name === 'createdAt_1_TTL')
    steps.push({ ttl, index: ttlIndex ? { key: ttlIndex.key, expireAfterSeconds: ttlIndex.expireAfterSeconds } : null, onError: [...rec.seen.onError] })
  }
  return steps
}

// Every unit alias and number form setPatchHistoryTTL parses, each from no TTL index. Numbers are
// milliseconds; anything that is not a number with an optional unit is not a duration.
const UNIT_ALIASES = ['ms', 'msec', 'msecs', 'millisecond', 'milliseconds', 's', 'sec', 'secs', 'second', 'seconds', 'm', 'min', 'mins', 'minute', 'minutes', 'h', 'hr', 'hrs', 'hour', 'hours', 'd', 'day', 'days', 'w', 'week', 'weeks', 'mo', 'month', 'months', 'y', 'yr', 'yrs', 'year', 'years']
// Millisecond units get an amount over a second: below one, every factor truncates to the same index.
const MILLISECOND_UNITS = new Set(['ms', 'msec', 'msecs', 'millisecond', 'milliseconds'])
const TTL_INPUTS = [...UNIT_ALIASES.map((unit) => `${MILLISECOND_UNITS.has(unit) ? 3000 : 2}${unit}`), 7_200_000, '7200000', '2 hours', '2   h', '2H', '2Hours', '1.5h', '.5h', '-1h', '1000ms', '999ms', '2hours ', ' 2h', 'h', '', `${'1'.repeat(98)}ms`, `${'1'.repeat(99)}ms`]

const historyTtlInputs = async (history, setPatchHistoryTTL, rec) => {
  const results = []
  for (const ttl of TTL_INPUTS) {
    await history.dropIndex('createdAt_1_TTL').catch(() => undefined)
    rec.clear()
    await setPatchHistoryTTL(ttl, rec.onError)
    const ttlIndex = (await history.indexes()).find((index) => index.name === 'createdAt_1_TTL')
    results.push({ ttl, expireAfterSeconds: ttlIndex ? ttlIndex.expireAfterSeconds : null, onError: [...rec.seen.onError] })
  }
  return results
}

// The plugin registered globally on its own mongoose instance also reaches the subdocument schemas,
// whose save hooks it must skip; history is written through the package's own history model.
const globalPlugin = async (mongoose, uri, patchHistoryPlugin, patchEventEmitter, history, oid) => {
  const instance = new mongoose.Mongoose()
  instance.plugin(patchHistoryPlugin, { omit: ['__v'], eventCreated: 'global:created', eventUpdated: 'global:updated' })
  await instance.connect(uri)
  try {
    const line = new instance.Schema({ name: String, qty: Number })
    const Order = instance.model('E2eglobal', new instance.Schema({ ref: String, lines: [line], main: line }))
    await Order.init()
    const recorder = createRecorder()
    for (const name of ['global:created', 'global:updated']) patchEventEmitter.on(name, (payload) => recorder.event(name, payload))
    await history.deleteMany({})
    const order = await Order.create({ _id: oid(200), ref: 'o1', lines: [{ name: 'l1', qty: 1 }], main: { name: 'm', qty: 2 } })
    order.lines[0].qty = 5
    order.main.qty = 3
    await order.save()
    const entries = (await history.find({}).sort({ _id: 1 }).toArray()).map(historyEntry)
    return aliasObjectIds({ history: entries, events: recorder.seen.events })
  } finally {
    await instance.disconnect()
  }
}

// A history collection whose validator rejects every write: each failed history write (the bulk
// write of creates and deletes, the single write of an update) goes to onError, and the model write
// itself still succeeds.
const historyRejected = async ({ mongoose, M, history, rec, oid, fresh, seeds }) => {
  await M.collection.deleteMany({})
  await history.deleteMany({})
  await M.collection.insertMany(seeds())
  const { db } = mongoose.connection
  await db.command({ collMod: 'history', validator: { never: { $exists: true } }, validationAction: 'error' })
  rec.clear()
  try {
    await M.insertMany([fresh(10, 'new')])
    await M.updateOne({ _id: oid(1) }, { $set: { n: 50 } })
    await M.deleteOne({ _id: oid(2) })
  } finally {
    await db.command({ collMod: 'history', validator: {} })
  }
  const state = (await M.collection.find({}).sort({ _id: 1 }).toArray()).map(plain)
  return aliasObjectIds({ state, history: await history.countDocuments(), ...structuredClone(rec.seen) })
}

// More documents than one history bulk write takes (1000): every one is recorded and announced.
const CHUNKED = 1001

const chunkedBatch = async (mongoose, patchHistoryPlugin, patchEventEmitter, history) => {
  const schema = new mongoose.Schema({ n: Number })
  schema.plugin(patchHistoryPlugin, { omit: ['__v'], eventCreated: 'chunk:created', eventDeleted: 'chunk:deleted' })
  const Chunk = mongoose.model('E2echunk', schema)
  await Chunk.init()
  const counts = { 'chunk:created': 0, 'chunk:deleted': 0 }
  for (const name of Object.keys(counts)) patchEventEmitter.on(name, () => counts[name]++)
  await history.deleteMany({})
  await Chunk.insertMany(Array.from({ length: CHUNKED }, (_, n) => ({ n })))
  await Chunk.deleteMany({})
  const recorded = await history.aggregate([{ $group: { _id: '$op', count: { $sum: 1 }, distinctIds: { $addToSet: '$collectionId' } } }, { $project: { count: 1, distinctIds: { $size: '$distinctIds' } } }, { $sort: { _id: 1 } }]).toArray()
  return { documents: CHUNKED, events: counts, history: recorded }
}

// `onScenario(id, record)` sees each record as soon as it exists, so a caller can stop at the first one it rejects.
module.exports = async ({ mongoose, pkg, MongoMemoryReplSet, onScenario = () => {} }) => {
  const { patchHistoryPlugin, patchEventEmitter, setPatchHistoryTTL } = pkg
  const rec = createRecorder()
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  try {
    await mongoose.connect(replSet.getUri('e2e'))
    const models = {}
    const profileOptions = profiles(rec, mongoose)
    for (const [profile, options] of Object.entries(profileOptions)) {
      const schema = new mongoose.Schema(fields(mongoose), SCHEMA_OPTIONS[profile])
      schema.plugin(patchHistoryPlugin, options)
      models[profile] = mongoose.model(`E2e${profile}`, schema)
      for (const name of Object.values(events(profile))) {
        patchEventEmitter.on(name, (payload) => {
          rec.event(name, payload)
          if (THROWING_LISTENERS.has(profile)) throw new Error(`e2e: ${name} listener failed`)
        })
      }
    }
    const Owner = mongoose.model(OWNER_MODEL, new mongoose.Schema({ name: String }))
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))

    const history = mongoose.connection.collection('history')
    const { oid, fresh, seeds } = fixtures(mongoose)
    await Owner.collection.insertOne({ _id: oid(OWNER_ID), name: 'owner' })
    const modes = sessionModes(mongoose)
    const als = supportsAsyncLocalStorage(mongoose)
    const scenarios = {}
    const keep = async (id, value) => {
      scenarios[id] = value
      await onScenario(id, value)
    }
    await keep('package/exports', exportsShape(pkg))

    // A stored document in the form the plugin diffs it: as mongoose reads it, through JSON.
    // A BSON Timestamp differs on every run, so it keeps the shape plain() gives it.
    const jsonValue = function (key, value) {
      if (this[key]?._bsontype === 'Timestamp') return '<Timestamp>'
      return typeof value === 'bigint' ? value.toString() : value
    }
    const json = (doc) => plain(JSON.parse(JSON.stringify(doc.toObject({ depopulate: true, virtuals: false, flattenMaps: true }), jsonValue)))
    const jsonState = async (M) => (await M.find({}).sort({ _id: 1 }).exec()).map(json)

    const runOne = async (M, operation, mode, options) => {
      await M.collection.deleteMany({})
      await history.deleteMany({})
      await M.collection.insertMany(seeds())
      rec.clear()
      // What the store oracles (e2e/store-oracle.mjs) judge a scenario by, besides what it recorded.
      const record = { omit: options.omit ?? null, silent: operation.silent === true, historyExpected: !options.patchHistoryDisabled && operation.history !== false }
      record.before = (await M.collection.find({}).sort({ _id: 1 }).toArray()).map(plain)
      record.jsonBefore = await jsonState(M)
      try {
        record.result = resultShape(await modes[mode]((o) => operation.run({ M, o, oid, fresh })))
      } catch (error) {
        record.thrown = errorShape(error)
      }
      record.state = (await M.collection.find({}).sort({ _id: 1 }).toArray()).map(plain)
      // The stored documents as mongoose reads them, the form an event's doc has.
      record.read = (await M.find({}).sort({ _id: 1 }).exec()).map(plain)
      record.jsonAfter = await jsonState(M)
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
          await keep(`${profile}/${operation.name}/${mode}`, skipped ? { skipped } : await runOne(models[profile], operation, mode, profileOptions[profile]))
        }
      }
    }
    if (als) mongoose.set('transactionAsyncLocalStorage', false)

    rec.clear()
    await keep('history/indexes', await historyIndexes(history, setPatchHistoryTTL, rec))
    await keep('history/ttl-steps', await historyTtlSteps(history, setPatchHistoryTTL, rec))
    await keep('history/ttl-inputs', await historyTtlInputs(history, setPatchHistoryTTL, rec))
    await keep('history/write-rejected', await historyRejected({ mongoose, M: models.full, history, rec, oid, fresh, seeds }))
    await keep('plugin/global-subdocuments', await globalPlugin(mongoose, replSet.getUri('e2e'), patchHistoryPlugin, patchEventEmitter, history, oid))
    await keep('insertMany/chunked', await chunkedBatch(mongoose, patchHistoryPlugin, patchEventEmitter, history))
    const { version: mongodb } = await mongoose.connection.db.admin().serverInfo()
    return { mongoose: mongoose.version, mongodb, scenarios }
  } finally {
    await mongoose.disconnect()
    await replSet.stop()
  }
}
