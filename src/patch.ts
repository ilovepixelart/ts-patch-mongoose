import em from './em'
import { chunk, isEmpty, isFunction, sessionOptions } from './helpers'
import { compare as jsonPatchCompare, type Operation } from './json-patch'
import { HistoryModel } from './model'
import { omitDeep as omit } from './omit-deep'

import type { ClientSession, HydratedDocument, MongooseError, Types } from 'mongoose'
import type { Metadata, PatchContext, PatchEvent, PluginOptions, User } from './types'

const isPatchHistoryEnabled = <T>(opts: PluginOptions<T>, context: PatchContext<T>): boolean => {
  return !opts.patchHistoryDisabled && !context.ignorePatchHistory
}

const applyOmit = <T>(object: Partial<T>, opts: PluginOptions<T>): Partial<T> => {
  return opts.omit ? omit(object, opts.omit) : object
}

// toObject() keeps Map paths as Map instances, which JSON.stringify would write as {}.
const replacer = (_key: string, value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}

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

export const getData = async <T>(opts: PluginOptions<T>, doc?: HydratedDocument<T>): Promise<[User | undefined, string | undefined, Metadata | undefined]> => {
  return Promise.allSettled([getUser(opts, doc), getReason(opts, doc), getMetadata(opts, doc)]).then(([user, reason, metadata]) => {
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

  const chunks = chunk(docs, 1000)
  for (const batch of chunks) {
    const bulk = []
    const omittedDocs = batch.map((doc) => getObjectOmit(opts, doc))

    if (history) {
      for (const [index, doc] of batch.entries()) {
        const [user, reason, metadata] = await getData(opts, doc)
        bulk.push({
          insertOne: {
            document: {
              op: context.op,
              modelName: context.modelName,
              collectionName: context.collectionName,
              collectionId: doc._id as Types.ObjectId,
              doc: omittedDocs[index],
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
      await HistoryModel.bulkWrite(bulk, { ordered: false, ...sessionOptions(context.session) }).catch((error: MongooseError) => {
        onError(error)
      })
    }

    for (const omitted of omittedDocs) {
      emitEvent(context, event, { [key]: omitted })
    }
  }
}

export const createPatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> => {
  await bulkPatch(opts, context, 'eventCreated', 'createdDocs')
}

export interface UpdateChange<T> {
  original: HydratedDocument<T>
  current: HydratedDocument<T>
  op?: string
}

interface DiffedChange<T> extends UpdateChange<T> {
  patch: Operation[]
}

const diffChange = <T>(opts: PluginOptions<T>, change: UpdateChange<T>): DiffedChange<T> | null => {
  const currentObject = getJsonOmit(opts, change.current)
  const originalObject = getJsonOmit(opts, change.original)
  if (isEmpty(originalObject) || isEmpty(currentObject)) return null

  const patch = jsonPatchCompare(originalObject, currentObject, true)
  return isEmpty(patch) ? null : { ...change, patch }
}

const nextVersions = async (ids: Types.ObjectId[], session?: ClientSession | null): Promise<Map<string, number>> => {
  const versions = new Map<string, number>()
  if (ids.length === 1) {
    const id = ids[0] as Types.ObjectId
    const last = await HistoryModel.findOne({ collectionId: id }, null, sessionOptions(session)).sort('-version').exec()
    if (last) versions.set(String(id), last.version + 1)
    return versions
  }
  const rows = await HistoryModel.aggregate<{ _id: Types.ObjectId; version: number }>([{ $match: { collectionId: { $in: ids } } }, { $group: { _id: '$collectionId', version: { $max: '$version' } } }]).session(session ?? null)
  for (const row of rows) versions.set(String(row._id), row.version + 1)
  return versions
}

const writeUpdateHistory = async <T>(opts: PluginOptions<T>, context: PatchContext<T>, changes: DiffedChange<T>[]): Promise<void> => {
  const onError = opts.onError ?? console.error
  try {
    const versions = await nextVersions(
      changes.map((change) => change.original._id as Types.ObjectId),
      context.session,
    )
    const entries = []
    for (const change of changes) {
      const [user, reason, metadata] = await getData(opts, change.current)
      entries.push({
        op: change.op ?? context.op,
        modelName: context.modelName,
        collectionName: context.collectionName,
        collectionId: change.original._id as Types.ObjectId,
        patch: change.patch,
        version: versions.get(String(change.original._id)) ?? 0,
        ...(user !== undefined && { user }),
        ...(reason !== undefined && { reason }),
        ...(metadata !== undefined && { metadata }),
      })
    }
    if (entries.length === 1) {
      await HistoryModel.create(entries, sessionOptions(context.session))
    } else {
      await HistoryModel.insertMany(entries, sessionOptions(context.session))
    }
  } catch (error) {
    onError(error as MongooseError)
  }
}

/** Records the stored state before and after each change: history entries first, in one write per batch, then the update events. */
export const updatePatches = async <T>(opts: PluginOptions<T>, context: PatchContext<T>, changes: UpdateChange<T>[]): Promise<void> => {
  for (const batch of chunk(changes, 1000)) {
    const diffed = batch.map((change) => diffChange(opts, change)).filter((change): change is DiffedChange<T> => change !== null)
    if (isEmpty(diffed)) continue

    if (isPatchHistoryEnabled(opts, context)) {
      await writeUpdateHistory(opts, context, diffed)
    }

    for (const { original, current, patch } of diffed) {
      emitEvent(context, opts.eventUpdated, { oldDoc: original, doc: current, patch })
    }
  }
}

export const updatePatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Promise<void> => {
  await updatePatches(opts, context, [{ original, current }])
}

export const deletePatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> => {
  await bulkPatch(opts, context, 'eventDeleted', 'deletedDocs')
}
