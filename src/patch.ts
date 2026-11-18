import em from './em'
import { chunk, HISTORY_BATCH_SIZE, isEmpty, isFunction } from './helpers'
import { compare as jsonPatchCompare } from './json-patch'
import { HistoryModel } from './model'
import { omitDeep as omit } from './omit-deep'

import type { HydratedDocument, MongooseError, Types } from 'mongoose'
import type { Operation } from './json-patch'
import type { Metadata, PatchContext, PatchEvent, PluginOptions, User } from './types'

const isPatchHistoryEnabled = <T>(opts: PluginOptions<T>, context: PatchContext<T>): boolean => {
  return !opts.patchHistoryDisabled && !context.ignorePatchHistory
}

const applyOmit = <T>(object: Partial<T>, opts: PluginOptions<T>): Partial<T> => {
  return opts.omit ? omit(object, opts.omit) : object
}

const replacer = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value)

export const getJsonOmit = <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Partial<T> => {
  // NOSONAR — structuredClone cannot handle mongoose documents (they contain non-cloneable methods)
  return applyOmit(JSON.parse(JSON.stringify(doc, replacer)) as Partial<T>, opts)
}

export const getObjectOmit = <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Partial<T> => {
  return applyOmit(isFunction(doc?.toObject) ? (doc.toObject() as Partial<T>) : doc, opts)
}

const getOptionalField = async <T, R>(fn: ((doc: HydratedDocument<T>) => Promise<R> | R) | undefined, doc?: HydratedDocument<T>): Promise<R | undefined> => {
  if (isFunction(fn)) {
    return await fn(doc as HydratedDocument<T>)
  }
  return undefined
}

export const getUser = async <T>(opts: PluginOptions<T>, doc?: HydratedDocument<T>): Promise<User | undefined> => getOptionalField(opts.getUser, doc)

export const getReason = async <T>(opts: PluginOptions<T>, doc?: HydratedDocument<T>): Promise<string | undefined> => getOptionalField(opts.getReason, doc)

export const getMetadata = async <T>(opts: PluginOptions<T>, doc?: HydratedDocument<T>): Promise<Metadata | undefined> => getOptionalField(opts.getMetadata, doc)

export const getValue = <T>(item: PromiseSettledResult<T>): T | undefined => {
  return item.status === 'fulfilled' ? item.value : undefined
}

// Getters already reported for an operation, by position (user, reason, metadata), so a getter
// failing for every document of a multi-document operation is reported once.
const reportedGetters = new WeakMap<object, Set<number>>()

const reportRejections = <T>(opts: PluginOptions<T>, context: PatchContext<T> | undefined, results: PromiseSettledResult<unknown>[]): void => {
  const onError = opts.onError ?? console.error
  const reported = context ? (reportedGetters.get(context) ?? new Set<number>()) : new Set<number>()
  if (context) reportedGetters.set(context, reported)

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled' || reported.has(index)) continue
    reported.add(index)
    onError(result.reason instanceof Error ? result.reason : new Error(String(result.reason)))
  }
}

export const getData = async <T>(opts: PluginOptions<T>, doc?: HydratedDocument<T>, context?: PatchContext<T>): Promise<[User | undefined, string | undefined, Metadata | undefined]> => {
  return Promise.allSettled([getUser(opts, doc), getReason(opts, doc), getMetadata(opts, doc)]).then(([user, reason, metadata]) => {
    reportRejections(opts, context, [user, reason, metadata])
    return [getValue(user), getValue(reason), getValue(metadata)]
  })
}

export const emitEvent = <T>(context: PatchContext<T>, event: string | undefined, data: PatchEvent<T>): void => {
  if (event && !context.ignoreEvent) {
    try {
      em.emit(event, data)
    } catch {
      // Listener errors must not crash patch history recording
    }
  }
}

export const bulkPatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>, eventKey: 'eventCreated' | 'eventDeleted', docsKey: 'createdDocs' | 'deletedDocs'): Promise<void> => {
  const history = isPatchHistoryEnabled(opts, context)
  const event = opts[eventKey]
  const docs = context[docsKey]
  const key = eventKey === 'eventCreated' ? 'doc' : 'oldDoc'

  if (isEmpty(docs) || !docs || (!event && !history)) return

  const chunks = chunk(docs, HISTORY_BATCH_SIZE)
  for (const batch of chunks) {
    const bulk = []

    for (const doc of batch) {
      const omitted = getObjectOmit(opts, doc)
      emitEvent(context, event, { [key]: omitted })

      if (history) {
        const [user, reason, metadata] = await getData(opts, doc, context)
        bulk.push({
          insertOne: {
            document: {
              op: context.op,
              modelName: context.modelName,
              collectionName: context.collectionName,
              collectionId: doc._id as Types.ObjectId,
              doc: omitted,
              version: 0,
              ...(user !== undefined && { user }),
              ...(reason !== undefined && { reason }),
              ...(metadata !== undefined && { metadata }),
            },
          },
        })
      }
    }

    if (history && !isEmpty(bulk)) {
      const onError = opts.onError ?? console.error
      await HistoryModel.bulkWrite(bulk, { ordered: false }).catch((error: MongooseError) => {
        onError(error)
      })
    }
  }
}

export const createPatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> => {
  await bulkPatch(opts, context, 'eventCreated', 'createdDocs')
}

type HistoryData = [User | undefined, string | undefined, Metadata | undefined]

const diffAndEmit = <T>(opts: PluginOptions<T>, context: PatchContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Operation[] | undefined => {
  const currentObject = getJsonOmit(opts, current)
  const originalObject = getJsonOmit(opts, original)
  if (isEmpty(originalObject) || isEmpty(currentObject)) return undefined

  const patch = jsonPatchCompare(originalObject, currentObject, true)
  if (isEmpty(patch)) return undefined

  emitEvent(context, opts.eventUpdated, { oldDoc: original, doc: current, patch })
  return patch
}

const updateEntry = <T>(context: PatchContext<T>, original: HydratedDocument<T>, patch: Operation[], version: number, [user, reason, metadata]: HistoryData) => ({
  op: context.op,
  modelName: context.modelName,
  collectionName: context.collectionName,
  collectionId: original._id as Types.ObjectId,
  patch,
  version,
  ...(user !== undefined && { user }),
  ...(reason !== undefined && { reason }),
  ...(metadata !== undefined && { metadata }),
})

export const updatePatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Promise<void> => {
  const patch = diffAndEmit(opts, context, current, original)
  if (!patch || !isPatchHistoryEnabled(opts, context)) return

  let version = 0

  const lastHistory = await HistoryModel.findOne({ collectionId: original._id as Types.ObjectId })
    .sort('-version')
    .exec()

  if (lastHistory) {
    version = lastHistory.version + 1
  }

  const data = await getData(opts, current, context)
  const onError = opts.onError ?? console.error
  await HistoryModel.create([updateEntry(context, original, patch, version, data)]).catch((error: MongooseError) => {
    onError(error)
  })
}

// History is written outside the caller's session, as in 4.0. Inside a transaction it conflicts
// with mongoose creating and indexing the history collection at startup: manual transactions
// then fail with LockTimeout (TransientTransactionError).
const nextVersions = async (ids: Types.ObjectId[]): Promise<Map<string, number>> => {
  const last = await HistoryModel.aggregate<{ _id: Types.ObjectId; version: number }>([{ $match: { collectionId: { $in: ids } } }, { $group: { _id: '$collectionId', version: { $max: '$version' } } }]).exec()
  return new Map(last.map(({ _id, version }) => [String(_id), version + 1]))
}

// One version lookup and one insert per batch instead of a findOne and a create per document.
// A single pair keeps the exact commands of updatePatch.
export const updatePatchBatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>, pairs: { current: HydratedDocument<T>; original: HydratedDocument<T> }[]): Promise<void> => {
  const [first] = pairs
  if (pairs.length === 1 && first) {
    await updatePatch(opts, context, first.current, first.original)
    return
  }

  const history = isPatchHistoryEnabled(opts, context)
  const pending: { original: HydratedDocument<T>; patch: Operation[]; data: HistoryData }[] = []
  for (const { current, original } of pairs) {
    const patch = diffAndEmit(opts, context, current, original)
    if (patch && history) {
      pending.push({ original, patch, data: await getData(opts, current, context) })
    }
  }
  if (isEmpty(pending)) return

  const versions = await nextVersions(pending.map(({ original }) => original._id as Types.ObjectId))
  const entries = pending.map(({ original, patch, data }) => updateEntry(context, original, patch, versions.get(String(original._id)) ?? 0, data))
  const onError = opts.onError ?? console.error
  await HistoryModel.insertMany(entries, { ordered: false }).catch((error: MongooseError) => {
    onError(error)
  })
}

export const deletePatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> => {
  await bulkPatch(opts, context, 'eventDeleted', 'deletedDocs')
}
