import _ from 'lodash'
import { assign } from 'power-assign'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema, ToObjectOptions, UpdateQuery, UpdateWithAggregationPipeline } from 'mongoose'

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

function splitUpdateAndCommands<T> (updateQuery: UpdateWithAggregationPipeline | UpdateQuery<T> | null): { update: UpdateQuery<T>, commands: Record<string, unknown>[] } {
  let update: UpdateQuery<T> = {}
  const commands: Record<string, unknown>[] = []

  if (!_.isEmpty(updateQuery) && !_.isArray(updateQuery) && _.isObjectLike(updateQuery)) {
    update = _.cloneDeep(updateQuery)
    const keys = _.keys(update).filter((key) => key.startsWith('$'))
    if (!_.isEmpty(keys)) {
      _.forEach(keys, (key) => {
        commands.push({ [key]: update[key] as unknown })
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete update[key]
      })
    }
  }

  return { update, commands }
}

function assignUpdate<T> (document: HydratedDocument<T>, update: UpdateQuery<T>, commands: Record<string, unknown>[]): HydratedDocument<T> {
  let updated = assign(document, update)
  _.forEach(commands, (command) => {
    try {
      updated = assign(updated, command)
    } catch {
      // we catch assign keys that are not implemented
    }
  })

  return updated
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
  schema.pre('save', async function () {
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

  schema.pre(updateMethods as MongooseQueryMiddleware[], async function (this: IHookContext<T>) {
    const options = this.getOptions()
    if (options.ignoreHook) return

    const filter = this.getFilter()
    const count = await this.model.count(filter).exec()

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName,
      isNew: options.upsert && count === 0
    }

    const updateQuery = this.getUpdate()
    const { update, commands } = splitUpdateAndCommands(updateQuery)

    const cursor = this.model.find<HydratedDocument<T>>(filter).cursor()
    await cursor.eachAsync(async (doc) => {
      const current = assignUpdate(doc.toObject(toObjectOptions) as HydratedDocument<T>, update, commands)
      const original = doc.toObject(toObjectOptions) as HydratedDocument<T>

      await updatePatch(opts, this._context, current, original)
    })
  })

  schema.post(updateMethods as MongooseQueryMiddleware[], async function (this: IHookContext<T>) {
    const options = this.getOptions()
    if (options.ignoreHook) return

    if (!this._context.isNew) return

    const updateQuery = this.getUpdate()
    const { update, commands } = splitUpdateAndCommands(updateQuery)

    const filter = assignUpdate({} as HydratedDocument<T>, update, commands)
    if (!_.isEmpty(filter)) {
      const found = await this.model.findOne<HydratedDocument<T>>(update).exec()
      if (found) {
        const current = found.toObject(toObjectOptions) as HydratedDocument<T>
        this._context.createdDocs = [current]

        await createPatch(opts, this._context)
      }
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

  schema.pre(deleteMethods as MongooseQueryMiddleware[], options, async function (this: IHookContext<T>) {
    const options = this.getOptions()
    if (options.ignoreHook) return

    const filter = this.getFilter()

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
  })

  schema.post(deleteMethods as MongooseQueryMiddleware[], options, async function (this: IHookContext<T>) {
    const options = this.getOptions()
    if (options.ignoreHook) return

    await deletePatch(opts, this._context)
  })
}
