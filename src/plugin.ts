import _ from 'lodash'
import omit from 'omit-deep'
import jsonpatch from 'fast-json-patch'
import { assign } from 'power-assign'

import type { CallbackError, HydratedDocument, Model, MongooseError, Schema, Types } from 'mongoose'

import type IPluginOptions from './interfaces/IPluginOptions'
import type IContext from './interfaces/IContext'
import type IHookContext from './interfaces/IHookContext'

import em from './em'
import History from './models/History'

const options = {
  document: false,
  query: true
}

function getObjects<T> (opts: IPluginOptions<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): { currentObject: Partial<T>, originalObject: Partial<T> } {
  let currentObject = JSON.parse(JSON.stringify(current)) as Partial<T>
  let originalObject = JSON.parse(JSON.stringify(original)) as Partial<T>

  if (opts.omit) {
    currentObject = omit(currentObject, opts.omit)
    originalObject = omit(originalObject, opts.omit)
  }

  return { currentObject, originalObject }
}

async function updatePatch<T> (opts: IPluginOptions<T>, context: IContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Promise<void> {
  const { currentObject, originalObject } = getObjects(opts, current, original)

  if (_.isEmpty(originalObject) || _.isEmpty(currentObject)) return

  const patch = jsonpatch.compare(originalObject, currentObject, true)

  if (_.isEmpty(patch)) return

  if (opts.eventUpdated) {
    em.emit(opts.eventUpdated, { oldDoc: original, doc: current, patch })
  }

  if (opts.patchHistoryDisabled) return

  let version = 0

  const lastHistory = await History.findOne({ collectionId: original._id as Types.ObjectId }).sort('-version').exec()

  if (lastHistory && lastHistory.version >= 0) {
    version = lastHistory.version + 1
  }

  await History.create({
    op: context.op,
    modelName: context.modelName,
    collectionName: context.collectionName,
    collectionId: original._id as Types.ObjectId,
    patch,
    version
  })
}

async function bulkPatch<T> (opts: IPluginOptions<T>, context: IContext<T>, eventKey: 'eventCreated' | 'eventDeleted', docsKey: 'createdDocs' | 'deletedDocs'): Promise<void> {
  const event = opts[eventKey]
  const docs = context[docsKey]
  const key = eventKey === 'eventCreated' ? 'doc' : 'oldDoc'

  if (_.isEmpty(docs) || (!event && opts.patchHistoryDisabled)) return

  const chunks = _.chunk(docs, 1000)
  for await (const chunk of chunks) {
    const bulk = []
    for (const doc of chunk) {
      if (event) em.emit(event, { [key]: doc })

      if (!opts.patchHistoryDisabled) {
        bulk.push({
          insertOne: {
            document: {
              op: context.op,
              modelName: context.modelName,
              collectionName: context.collectionName,
              collectionId: doc._id as Types.ObjectId,
              doc,
              version: 0
            }
          }
        })
      }
    }

    if (!opts.patchHistoryDisabled) {
      await History
        .bulkWrite(bulk, { ordered: false })
        .catch((err: MongooseError) => {
          console.error(err)
        })
    }
  }
}

async function createPatch<T> (opts: IPluginOptions<T>, context: IContext<T>): Promise<void> {
  await bulkPatch(opts, context, 'eventCreated', 'createdDocs')
}

async function deletePatch<T> (opts: IPluginOptions<T>, context: IContext<T>): Promise<void> {
  await bulkPatch(opts, context, 'eventDeleted', 'deletedDocs')
}

/**
 * @description Patch patch event emitter
 */
export const patchEventEmitter = em

/**
 * @description Patch history plugin
 * @param {Schema} schema
 * @param {IPluginOptions} opts
 * @returns {void}
 */
export const patchHistoryPlugin = function plugin<T> (schema: Schema<T>, opts: IPluginOptions<T>): void {
  schema.pre('save', async function (next) {
    const current = this.toObject({ depopulate: true }) as HydratedDocument<T>
    const model = this.constructor as Model<T>

    const context: IContext<T> = {
      op: this.isNew ? 'create' : 'update',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      createdDocs: [current]
    }

    try {
      if (this.isNew) {
        await createPatch(opts, context)
      } else {
        const original = await model.findById(current._id).exec()
        if (original) {
          await updatePatch(opts, context, current, original)
        }
      }
      next()
    } catch (error) {
      next(error as CallbackError)
    }
  })

  schema.post('insertMany', async function (docs) {
    const context = {
      op: 'create',
      modelName: opts.modelName ?? this.modelName,
      collectionName: opts.collectionName ?? this.collection.collectionName,
      createdDocs: docs as unknown as HydratedDocument<T>[]
    }

    await createPatch(opts, context)
  })

  schema.pre(['update', 'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace'], async function (this: IHookContext<T>, next) {
    const filter = this.getFilter()
    const update = this.getUpdate() as Record<string, Partial<T>> | null
    const options = this.getOptions()

    const count = await this.model.count(filter).exec()
    const commands: Record<string, Partial<T>>[] = []

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName,
      isNew: options.upsert && count === 0
    }

    try {
      const keys = _.keys(update).filter((key) => key.startsWith('$'))
      if (update && !_.isEmpty(keys)) {
        _.forEach(keys, (key) => {
          commands.push({ [key]: update[key] })
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete update[key]
        })
      }
      const cursor = this.model.find<HydratedDocument<T>>(filter).cursor()
      await cursor.eachAsync(async (doc) => {
        let current = doc.toObject({ depopulate: true }) as HydratedDocument<T>
        const original = doc.toObject({ depopulate: true }) as HydratedDocument<T>
        current = assign(current, update)
        _.forEach(commands, (command) => {
          try {
            current = assign(current, command)
          } catch (error) {
            // we catch assign keys that are not implemented
          }
        })
        await updatePatch(opts, this._context, current, original)
      })
      next()
    } catch (error) {
      next(error as CallbackError)
    }
  })

  schema.post(['update', 'updateOne', 'updateMany', 'findOneAndUpdate'], async function (this: IHookContext<T>) {
    const update = this.getUpdate()

    if (update && this._context.isNew) {
      const cursor = this.model.findOne<HydratedDocument<T>>(update).cursor()
      await cursor.eachAsync((doc) => {
        const current = doc.toObject({ depopulate: true }) as HydratedDocument<T>
        if (this._context.createdDocs) {
          this._context.createdDocs.push(current)
        } else {
          this._context.createdDocs = [current]
        }
      })
      await createPatch(opts, this._context)
    }
  })

  schema.pre('remove', async function (this: HydratedDocument<T>, next) {
    const original = this.toObject({ depopulate: true })
    const model = this.constructor as Model<T>

    const context: IContext<T> = {
      op: 'delete',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName
    }

    try {
      if (opts.eventDeleted) {
        em.emit(opts.eventDeleted, { oldDoc: original })
      }
      await deletePatch(opts, context)
      next()
    } catch (error) {
      next(error as CallbackError)
    }
  })

  schema.pre(['remove', 'findOneAndDelete', 'findOneAndRemove', 'deleteOne', 'deleteMany'], options, async function (this: IHookContext<T>, next) {
    const filter = this.getFilter()
    const options = this.getOptions()
    const ignore = options.__ignore as boolean

    if (ignore) return next()

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName
    }

    if (['remove', 'deleteMany'].includes(this._context.op) && !options.single) {
      const docs = await this.model.find<HydratedDocument<T>>(filter).exec()
      if (!_.isEmpty(docs)) {
        this._context.deletedDocs = docs
      }
    } else {
      const doc = await this.model.findOne<HydratedDocument<T>>(filter).exec()
      if (!_.isEmpty(doc)) {
        this._context.deletedDocs = [doc]
      }
    }

    if (opts.preDeleteManyCallback && _.isArray(this._context.deletedDocs) && !_.isEmpty(this._context.deletedDocs)) {
      await opts.preDeleteManyCallback(this._context.deletedDocs)
    }

    next()
  })

  schema.post(['remove', 'findOneAndDelete', 'findOneAndRemove', 'deleteOne', 'deleteMany'], options, async function (this: IHookContext<T>) {
    await deletePatch(opts, this._context)
  })
}
