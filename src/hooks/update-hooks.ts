import _ from 'lodash'
import { assign } from 'power-assign'
import { isHookIgnored, toObjectOptions } from '../helpers'
import { createPatch, updatePatch } from '../patch'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema, UpdateQuery, UpdateWithAggregationPipeline } from 'mongoose'
import type { HookContext, PluginOptions } from '../types'

const updateMethods = ['update', 'updateOne', 'replaceOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'findByIdAndUpdate']

export const assignUpdate = <T>(document: HydratedDocument<T>, update: UpdateQuery<T>, commands: Record<string, unknown>[]): HydratedDocument<T> => {
  let updated = assign(document.toObject(toObjectOptions), update)
  // Try catch not working for of loop, keep it as is
  _.forEach(commands, (command) => {
    try {
      updated = assign(updated, command)
    } catch {
      // we catch assign keys that are not implemented
    }
  })

  const doc = document.set(updated).toObject(toObjectOptions) as HydratedDocument<T> & { createdAt?: Date }
  if (update.createdAt) doc.createdAt = update.createdAt
  return doc
}

export const splitUpdateAndCommands = <T>(updateQuery: UpdateWithAggregationPipeline | UpdateQuery<T> | null): { update: UpdateQuery<T>; commands: Record<string, unknown>[] } => {
  let update: UpdateQuery<T> = {}
  const commands: Record<string, unknown>[] = []

  if (!_.isEmpty(updateQuery) && !_.isArray(updateQuery) && _.isObjectLike(updateQuery)) {
    update = _.cloneDeep(updateQuery)
    const keysWithDollarSign = _.keys(update).filter((key) => key.startsWith('$'))
    if (!_.isEmpty(keysWithDollarSign)) {
      _.forEach(keysWithDollarSign, (key) => {
        commands.push({ [key]: update[key] as unknown })
        delete update[key]
      })
    }
  }

  return { update, commands }
}

export const updateHooksInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>): void => {
  schema.pre(updateMethods as MongooseQueryMiddleware[], async function (this: HookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    const model = this.model as Model<T>
    const filter = this.getFilter()
    const count = await this.model.countDocuments(filter).exec()

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName,
      isNew: Boolean(options.upsert) && count === 0,
      ignoreEvent: options.ignoreEvent as boolean,
      ignorePatchHistory: options.ignorePatchHistory as boolean,
    }

    const updateQuery = this.getUpdate()
    const { update, commands } = splitUpdateAndCommands(updateQuery)

    const cursor = model.find(filter).cursor()
    await cursor.eachAsync(async (doc: HydratedDocument<T>) => {
      const origDoc = doc.toObject(toObjectOptions) as HydratedDocument<T>
      await updatePatch(opts, this._context, assignUpdate(doc, update, commands), origDoc)
    })
  })

  schema.post(updateMethods as MongooseQueryMiddleware[], async function (this: HookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    if (!this._context.isNew) return

    const model = this.model as Model<T>
    const updateQuery = this.getUpdate()
    const { update, commands } = splitUpdateAndCommands(updateQuery)

    let current: HydratedDocument<T> | null = null
    const filter = this.getFilter()
    const combined = assignUpdate(model.hydrate({}), update, commands)
    if (!_.isEmpty(update) && !current) {
      current = (await model.findOne(update).sort('desc').lean().exec()) as HydratedDocument<T>
    }

    if (!_.isEmpty(combined) && !current) {
      current = (await model.findOne(combined).sort('desc').lean().exec()) as HydratedDocument<T>
    }

    if (!_.isEmpty(filter) && !current) {
      console.log('filter', filter)
      current = (await model.findOne(filter).sort('desc').lean().exec()) as HydratedDocument<T>
    }

    if (current) {
      this._context.createdDocs = [current] as HydratedDocument<T>[]

      await createPatch(opts, this._context)
    }
  })
}
