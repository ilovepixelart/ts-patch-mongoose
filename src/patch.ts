import jsonpatch from 'fast-json-patch'
import em from './em'
import { chunk, isEmpty, isFunction } from './helpers'
import { HistoryModel } from './model'
import { omitDeep as omit } from './omit-deep'

import type { HydratedDocument, MongooseError, Types } from 'mongoose'
import type { Metadata, PatchContext, PatchEvent, PluginOptions, User } from './types'

const isPatchHistoryEnabled = <T>(opts: PluginOptions<T>, context: PatchContext<T>): boolean => {
  return !opts.patchHistoryDisabled && !context.ignorePatchHistory
}

export const getJsonOmit = <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Partial<T> => {
  // NOSONAR — structuredClone cannot handle mongoose documents (they contain non-cloneable methods)
  const object = JSON.parse(JSON.stringify(doc)) as Partial<T>

  if (opts.omit) {
    return omit(object, opts.omit)
  }

  return object
}

export const getObjectOmit = <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Partial<T> => {
  if (opts.omit) {
    return omit(isFunction(doc?.toObject) ? doc.toObject() : doc, opts.omit)
  }

  return doc
}

export const getUser = async <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<User | undefined> => {
  if (isFunction(opts.getUser)) {
    return await opts.getUser(doc)
  }
  return undefined
}

export const getReason = async <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<string | undefined> => {
  if (isFunction(opts.getReason)) {
    return await opts.getReason(doc)
  }
  return undefined
}

export const getMetadata = async <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<Metadata | undefined> => {
  if (isFunction(opts.getMetadata)) {
    return await opts.getMetadata(doc)
  }
  return undefined
}

export const getValue = <T>(item: PromiseSettledResult<T>): T | undefined => {
  return item.status === 'fulfilled' ? item.value : undefined
}

export const getData = async <T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<[User | undefined, string | undefined, Metadata | undefined]> => {
  return Promise.allSettled([getUser(opts, doc), getReason(opts, doc), getMetadata(opts, doc)]).then(([user, reason, metadata]) => {
    return [getValue(user), getValue(reason), getValue(metadata)]
  })
}

export const emitEvent = <T>(context: PatchContext<T>, event: string | undefined, data: PatchEvent<T>): void => {
  if (event && !context.ignoreEvent) {
    em.emit(event, data)
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

    for (const doc of batch) {
      emitEvent(context, event, { [key]: doc })

      if (history) {
        const [user, reason, metadata] = await getData(opts, doc)
        bulk.push({
          insertOne: {
            document: {
              op: context.op,
              modelName: context.modelName,
              collectionName: context.collectionName,
              collectionId: doc._id as Types.ObjectId,
              doc: getObjectOmit(opts, doc),
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
      await HistoryModel.bulkWrite(bulk, { ordered: false }).catch((error: MongooseError) => {
        console.error(error.message)
      })
    }
  }
}

export const createPatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> => {
  await bulkPatch(opts, context, 'eventCreated', 'createdDocs')
}

export const updatePatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Promise<void> => {
  const history = isPatchHistoryEnabled(opts, context)

  const currentObject = getJsonOmit(opts, current)
  const originalObject = getJsonOmit(opts, original)
  if (isEmpty(originalObject) || isEmpty(currentObject)) return

  const patch = jsonpatch.compare(originalObject, currentObject, true)
  if (isEmpty(patch)) return

  emitEvent(context, opts.eventUpdated, { oldDoc: original, doc: current, patch })

  if (history) {
    let version = 0

    const lastHistory = await HistoryModel.findOne({ collectionId: original._id as Types.ObjectId })
      .sort('-version')
      .exec()

    if (lastHistory && lastHistory.version >= 0) {
      version = lastHistory.version + 1
    }

    const [user, reason, metadata] = await getData(opts, current)
    await HistoryModel.create({
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
  }
}

export const deletePatch = async <T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> => {
  await bulkPatch(opts, context, 'eventDeleted', 'deletedDocs')
}
