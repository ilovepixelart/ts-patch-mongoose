import _ from 'lodash'
import omit from 'omit-deep'
import jsonpatch from 'fast-json-patch'
import { assign } from 'power-assign'

import type { CallbackError, HydratedDocument, Model, MongooseError, Query, Schema, Types } from 'mongoose'

import type IPluginOptions from './interfaces/IPluginOptions'
import type IContext from './interfaces/IContext'
import type IHookContext from './interfaces/IHookContext'

import em from './em'
import History from './models/History'

const options = {
  document: false,
  query: true
}

function getObjects<T> (opts: IPluginOptions<T>, original: HydratedDocument<T>, updated: T & { _id: Types.ObjectId }): { originalObject: Partial<T>, updatedObject: Partial<T> } {
  let originalObject = JSON.parse(JSON.stringify(original)) as Partial<T>
  let updatedObject = JSON.parse(JSON.stringify(updated)) as Partial<T>

  if (opts.omit) {
    originalObject = omit(originalObject, opts.omit)
    updatedObject = omit(updatedObject, opts.omit)
  }

  return { originalObject, updatedObject }
}

async function bulkPatch<T> (opts: IPluginOptions<T>, context: IContext<T>): Promise<void> {
  const chunks = _.chunk(context.deletedDocs, 1000)
  for await (const chunk of chunks) {
    const bulk = []
    for (const oldDoc of chunk) {
      if (opts.eventDeleted) {
        em.emit(opts.eventDeleted, { oldDoc })
      }
      if (!opts.patchHistoryDisabled) {
        bulk.push({
          insertOne: {
            document: {
              op: context.op,
              modelName: context.modelName,
              collectionName: context.collectionName,
              collectionId: oldDoc._id as Types.ObjectId,
              doc: oldDoc as HydratedDocument<T>,
              version: 0
            }
          }
        })
      }
    }

    if (opts.patchHistoryDisabled) continue
    await History.bulkWrite(bulk, { ordered: false }).catch((err: MongooseError) => {
      console.error(err)
    })
  }
}

async function updatePatch<T> (opts: IPluginOptions<T>, context: IContext<T>, current: HydratedDocument<T>, original: HydratedDocument<T>): Promise<void> {
  const updated = current.toObject({ depopulate: true }) as T & { _id: Types.ObjectId }

  const { originalObject, updatedObject } = getObjects(opts, original, updated)

  if (_.isEmpty(originalObject) || _.isEmpty(updatedObject)) return

  const patch = jsonpatch.compare(originalObject, updatedObject, true)

  if (_.isEmpty(patch)) return

  if (opts.eventUpdated) {
    const oldDoc = assign(current, originalObject)
    const doc = assign(current, updatedObject)
    em.emit(opts.eventUpdated, { oldDoc, doc, patch })
  }

  if (opts.patchHistoryDisabled) return

  let version = 0

  const lastHistory = await History.findOne({ collectionId: updated._id }).sort('-version').exec()

  if (lastHistory && lastHistory.version >= 0) {
    version = lastHistory.version + 1
  }

  const history = new History({
    op: context.op,
    modelName: context.modelName,
    collectionName: context.collectionName,
    collectionId: current._id as Types.ObjectId,
    patch,
    version
  })

  await history.save()
}

async function createPatch<T> (opts: IPluginOptions<T>, context: IContext<T>, current: HydratedDocument<T>): Promise<void> {
  if (opts.patchHistoryDisabled) return

  const history = new History({
    op: context.op,
    modelName: context.modelName,
    collectionName: context.collectionName,
    collectionId: current._id as Types.ObjectId,
    doc: current
  })

  await history.save()
}

async function saveDiffs<T> (opts: IPluginOptions<T>, context: IContext<T>, query: Query<T, T> & { op: string }): Promise<void> {
  const filter = query.getFilter()
  const update = query.getUpdate()
  const cursor = query.model.find(filter).cursor()

  await cursor.eachAsync(async (original: HydratedDocument<T>) => {
    const current = assign(original, update)
    await updatePatch(opts, context, original, current)
  })
}

const plugin = function plugin<T> (schema: Schema<T>, opts: IPluginOptions<T>): void {
  schema.pre('save', async function (next) {
    const current = this as HydratedDocument<T>
    const model = this.constructor as Model<T>

    const context: IContext<T> = {
      op: this.isNew ? 'create' : 'update',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName
    }

    try {
      if (this.isNew) {
        if (opts.eventCreated) {
          em.emit(opts.eventCreated, { doc: current })
        }
        await createPatch(opts, context, current)
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

  schema.pre(['findOneAndUpdate', 'update', 'updateOne', 'updateMany'], async function (this: IHookContext<T>, next) {
    const filter = this.getFilter()
    const options = this.getOptions()
    const count = await this.model.count(filter).exec()

    const context: IContext<T> = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName,
      isNew: options.upsert === true && count === 0
    }

    this._context = context

    try {
      await saveDiffs(opts, context, this)
      next()
    } catch (error) {
      next(error as CallbackError)
    }
  })

  schema.post(['findOneAndUpdate', 'update', 'updateOne', 'updateMany'], async function (this: IHookContext<T>) {
    if (this._context.isNew) {
      const filter = this.getFilter()
      const cursor = this.model.find(filter).cursor()
      await cursor.eachAsync(async (current: HydratedDocument<T>) => {
        if (opts.eventCreated) {
          em.emit(opts.eventCreated, { doc: current })
        }

        await createPatch(opts, this._context, current)
      })
    }
  })

  schema.pre('updateMany', options, async function (this: IHookContext<T>, next) {
    const filter = this.getFilter()
    const options = this.getOptions()
    const ignore = options.__ignore as boolean

    const context: IContext<T> = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName,
      isNew: options.upsert
    }

    if (!ignore) {
      const ids = await this.model.distinct<Types.ObjectId>('_id', filter).exec()
      context.updatedIds = ids
    }

    this._context = context

    next()
  })

  schema.post('updateMany', options, async function (this: IHookContext<T>) {
    if (this._context.updatedIds?.length) return

    const cursor = this.model.find({ _id: { $in: this._context.updatedIds } }).cursor()
    await cursor.eachAsync((current: HydratedDocument<T>) => {
      if (opts.eventUpdated) {
        em.emit(opts.eventUpdated, { doc: current })
      }
    })
  })

  schema.pre(['remove', 'findOneAndDelete', 'findOneAndRemove', 'deleteOne', 'deleteMany'], options, async function (this: IHookContext<T>, next) {
    const filter = this.getFilter()
    const options = this.getOptions()
    const ignore = options.__ignore as boolean

    const context: IContext<T> = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName
    }

    if (!ignore) {
      context.deletedDocs = await this.model.find(filter).exec()
      if (opts.preDeleteManyCallback) {
        await opts.preDeleteManyCallback(context.deletedDocs)
      }
    }

    this._context = context

    next()
  })

  schema.post(['remove', 'findOneAndDelete', 'findOneAndRemove', 'deleteOne', 'deleteMany'], options, async function (this: IHookContext<T>) {
    if (this._context.deletedDocs?.length) return

    await bulkPatch(opts, this._context)
  })
}

export default plugin
