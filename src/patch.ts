import _ from 'lodash'
import omit from 'omit-deep'
import jsonpatch from 'fast-json-patch'

import type { HydratedDocument, Types } from 'mongoose'

import type IEvent from './interfaces/IEvent'
import type IContext from './interfaces/IContext'
import type IPluginOptions from './interfaces/IPluginOptions'
import type { User, Metadata } from './interfaces/IPluginOptions'

import History from './models/History'
import em from './em'

function isPatchHistoryEnabled<T>(opts: IPluginOptions<T>, context: IContext<T>): boolean {
  return !opts.patchHistoryDisabled && !context.ignorePatchHistory
}

export function getJsonOmit<T>(opts: IPluginOptions<T>, doc: HydratedDocument<T>): Partial<T> {
  const object = JSON.parse(JSON.stringify(doc)) as Partial<T>

  if (opts.omit) {
    return omit(object, opts.omit)
  }

  return object
}

export function getObjectOmit<T>(opts: IPluginOptions<T>, doc: HydratedDocument<T>): Partial<T> {
  if (opts.omit) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/unbound-method
    return omit(_.isFunction(doc?.toObject) ? doc.toObject() : doc, opts.omit)
  }

  return doc
}

export async function getUser<T>(opts: IPluginOptions<T>): Promise<User | undefined> {
  if (_.isFunction(opts.getUser)) {
    return await opts.getUser()
  }
  return undefined
}

export async function getReason<T>(opts: IPluginOptions<T>): Promise<string | undefined> {
  if (_.isFunction(opts.getReason)) {
    return await opts.getReason()
  }
  return undefined
}

export async function getMetadata<T>(opts: IPluginOptions<T>): Promise<Metadata | undefined> {
  if (_.isFunction(opts.getMetadata)) {
    return await opts.getMetadata()
  }
  return undefined
}

export function getValue<T>(item: PromiseSettledResult<T>): T | undefined {
  return item.status === 'fulfilled' ? item.value : undefined
}

export async function getData<T>(opts: IPluginOptions<T>): Promise<[User | undefined, string | undefined, Metadata | undefined]> {
  return Promise
    .allSettled([getUser(opts), getReason(opts), getMetadata(opts)])
    .then(([user, reason, metadata]) => {
      return [
        getValue(user),
        getValue(reason),
        getValue(metadata),
      ]
    })
}

export function emitEvent<T>(context: IContext<T>, event: string | undefined, data: IEvent<T>): void {
  if (event && !context.ignoreEvent) {
    em.emit(event, data)
  }
}

export async function bulkPatch<T>(opts: IPluginOptions<T>, context: IContext<T>, eventKey: 'eventCreated' | 'eventDeleted', docsKey: 'createdDocs' | 'deletedDocs'): Promise<void> {
  const history = isPatchHistoryEnabled(opts, context)
  const event = opts[eventKey]
  const docs = context[docsKey]
  const key = eventKey === 'eventCreated' ? 'doc' : 'oldDoc'

  if (_.isEmpty(docs) || (!event && !history)) return

  const [user, reason, metadata] = await getData(opts)

  const chunks = _.chunk(docs, 1000)
  for await (const chunk of chunks) {
    const bulk = []

    for (const doc of chunk) {
      emitEvent(context, event, { [key]: doc })

      if (history) {
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

    if (history) {
      await History.bulkWrite(bulk, { ordered: false })
    }
  }
}

export async function createPatch<T>(opts: IPluginOptions<T>, context: IContext<T>): Promise<void> {
  await bulkPatch(opts, context, 'eventCreated', 'createdDocs')
}

export async function updatePatch<T>(opts: IPluginOptions<T>, context: IContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Promise<void> {
  const history = isPatchHistoryEnabled(opts, context)

  const currentObject = getJsonOmit(opts, current)
  const originalObject = getJsonOmit(opts, original)
  if (_.isEmpty(originalObject) || _.isEmpty(currentObject)) return

  const patch = jsonpatch.compare(originalObject, currentObject, true)
  if (_.isEmpty(patch)) return

  emitEvent(context, opts.eventUpdated, { oldDoc: original, doc: current, patch })

  if (history) {
    let version = 0

    const lastHistory = await History.findOne({ collectionId: original._id as Types.ObjectId }).sort('-version').exec()

    if (lastHistory && lastHistory.version >= 0) {
      version = lastHistory.version + 1
    }

    const [user, reason, metadata] = await getData(opts)

    await History.create({
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

export async function deletePatch<T>(opts: IPluginOptions<T>, context: IContext<T>): Promise<void> {
  await bulkPatch(opts, context, 'eventDeleted', 'deletedDocs')
}
