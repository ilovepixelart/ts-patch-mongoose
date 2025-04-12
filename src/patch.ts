import jsonpatch from 'fast-json-patch'
import _ from 'lodash'
import omit from 'omit-deep'

import type { HydratedDocument, MongooseError, Types } from 'mongoose'
import type { Metadata, PatchContext, PatchEvent, PluginOptions, User } from './types'

import em from './em'
import { HistoryModel } from './model'

function isPatchHistoryEnabled<T>(opts: PluginOptions<T>, context: PatchContext<T>): boolean {
  return !opts.patchHistoryDisabled && !context.ignorePatchHistory
}

export function getJsonOmit<T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Partial<T> {
  const object = JSON.parse(JSON.stringify(doc)) as Partial<T>

  if (opts.omit) {
    return omit(object, opts.omit)
  }

  return object
}

export function getObjectOmit<T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Partial<T> {
  if (opts.omit) {
    return omit(_.isFunction(doc?.toObject) ? doc.toObject() : doc, opts.omit)
  }

  return doc
}

export async function getUser<T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<User | undefined> {
  if (_.isFunction(opts.getUser)) {
    return await opts.getUser(doc)
  }
  return undefined
}

export async function getReason<T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<string | undefined> {
  if (_.isFunction(opts.getReason)) {
    return await opts.getReason(doc)
  }
  return undefined
}

export async function getMetadata<T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<Metadata | undefined> {
  if (_.isFunction(opts.getMetadata)) {
    return await opts.getMetadata(doc)
  }
  return undefined
}

export function getValue<T>(item: PromiseSettledResult<T>): T | undefined {
  return item.status === 'fulfilled' ? item.value : undefined
}

export async function getData<T>(opts: PluginOptions<T>, doc: HydratedDocument<T>): Promise<[User | undefined, string | undefined, Metadata | undefined]> {
  return Promise.allSettled([getUser(opts, doc), getReason(opts, doc), getMetadata(opts, doc)]).then(([user, reason, metadata]) => {
    return [getValue(user), getValue(reason), getValue(metadata)]
  })
}

export function emitEvent<T>(context: PatchContext<T>, event: string | undefined, data: PatchEvent<T>): void {
  if (event && !context.ignoreEvent) {
    em.emit(event, data)
  }
}

export async function bulkPatch<T>(opts: PluginOptions<T>, context: PatchContext<T>, eventKey: 'eventCreated' | 'eventDeleted', docsKey: 'createdDocs' | 'deletedDocs'): Promise<void> {
  const history = isPatchHistoryEnabled(opts, context)
  const event = opts[eventKey]
  const docs = context[docsKey]
  const key = eventKey === 'eventCreated' ? 'doc' : 'oldDoc'

  if (_.isEmpty(docs) || (!event && !history)) return

  const chunks = _.chunk(docs, 1000)
  for await (const chunk of chunks) {
    const bulk = []

    for (const doc of chunk) {
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
              user,
              reason,
              metadata,
              version: 0,
            },
          },
        })
      }
    }

    if (history && !_.isEmpty(bulk)) {
      await HistoryModel.bulkWrite(bulk, { ordered: false }).catch((error: MongooseError) => {
        console.error(error.message)
      })
    }
  }
}

export async function createPatch<T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> {
  await bulkPatch(opts, context, 'eventCreated', 'createdDocs')
}

export async function updatePatch<T>(opts: PluginOptions<T>, context: PatchContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Promise<void> {
  const history = isPatchHistoryEnabled(opts, context)

  const currentObject = getJsonOmit(opts, current)
  const originalObject = getJsonOmit(opts, original)
  if (_.isEmpty(originalObject) || _.isEmpty(currentObject)) return

  const patch = jsonpatch.compare(originalObject, currentObject, true)
  if (_.isEmpty(patch)) return

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
      user,
      reason,
      metadata,
      version,
    })
  }
}

export async function deletePatch<T>(opts: PluginOptions<T>, context: PatchContext<T>): Promise<void> {
  await bulkPatch(opts, context, 'eventDeleted', 'deletedDocs')
}
