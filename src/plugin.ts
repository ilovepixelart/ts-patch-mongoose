import _ from 'lodash'
import { assign } from 'power-assign'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema, ToObjectOptions } from 'mongoose'

import type IPluginOptions from './interfaces/IPluginOptions'
import type IContext from './interfaces/IContext'
import type IHookContext from './interfaces/IHookContext'

import { createPatch, updatePatch, deletePatch } from './patch'
import em from './em'

const options = {
  document: false,
  query: true
}

const toObjectOptions: ToObjectOptions = {
  depopulate: true,
  virtuals: false
}

const updateMethods = [
  'update',
  'updateOne',
  'replaceOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findByIdAndUpdate'
]

const deleteMethods = [
  'remove',
  'findOneAndDelete',
  'findOneAndRemove',
  'findByIdAndDelete',
  'findByIdAndRemove',
  'deleteOne',
  'deleteMany'
]

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
    const current = this.toObject(toObjectOptions) as HydratedDocument<T>
    const model = this.constructor as Model<T>

    const context: IContext<T> = {
      op: this.isNew ? 'create' : 'update',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      createdDocs: [current]
    }

    if (this.isNew) {
      await createPatch(opts, context)
    } else {
      const original = await model.findById(current._id).exec()
      if (original) {
        await updatePatch(opts, context, current, original)
      }
    }

    next()
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

  schema.pre(updateMethods as MongooseQueryMiddleware[], async function (this: IHookContext<T>, next) {
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
      let current = doc.toObject(toObjectOptions) as HydratedDocument<T>
      const original = doc.toObject(toObjectOptions) as HydratedDocument<T>

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
  })

  schema.post(updateMethods as MongooseQueryMiddleware[], async function (this: IHookContext<T>) {
    const update = this.getUpdate()
    if (!update || !this._context.isNew) return

    const found = await this.model.findOne<HydratedDocument<T>>(update).exec()
    if (found) {
      const current = found.toObject(toObjectOptions) as HydratedDocument<T>
      this._context.createdDocs = [current]

      await createPatch(opts, this._context)
    }
  })

  schema.post('remove', async function (this: HydratedDocument<T>) {
    const original = this.toObject(toObjectOptions)
    const model = this.constructor as Model<T>

    const context: IContext<T> = {
      op: 'delete',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName
    }

    if (opts.eventDeleted) {
      em.emit(opts.eventDeleted, { oldDoc: original })
    }

    await deletePatch(opts, context)
  })

  schema.pre(deleteMethods as MongooseQueryMiddleware[], options, async function (this: IHookContext<T>, next) {
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

    if (opts.preDeleteCallback && _.isArray(this._context.deletedDocs) && !_.isEmpty(this._context.deletedDocs)) {
      await opts.preDeleteCallback(this._context.deletedDocs)
    }

    next()
  })

  schema.post(deleteMethods as MongooseQueryMiddleware[], options, async function (this: IHookContext<T>) {
    await deletePatch(opts, this._context)
  })
}
