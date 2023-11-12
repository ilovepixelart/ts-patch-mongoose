import _ from 'lodash'
import { assign } from 'power-assign'

import { createPatch, updatePatch } from '../patch'
import { isHookIgnored } from '../helpers'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema, UpdateQuery, UpdateWithAggregationPipeline } from 'mongoose'
import type IPluginOptions from '../interfaces/IPluginOptions'
import type IHookContext from '../interfaces/IHookContext'

const updateMethods = [
  'update',
  'updateOne',
  'replaceOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findByIdAndUpdate'
]

export const assignUpdate = <T>(document: HydratedDocument<T>, update: UpdateQuery<T>, commands: Record<string, unknown>[]): HydratedDocument<T> => {
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

export const splitUpdateAndCommands = <T>(updateQuery: UpdateWithAggregationPipeline | UpdateQuery<T> | null): { update: UpdateQuery<T>, commands: Record<string, unknown>[] } => {
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

export const updateHooksInitialize = <T>(schema: Schema<T>, opts: IPluginOptions<T>): void => {
  schema.pre(updateMethods as MongooseQueryMiddleware[], async function (this: IHookContext<T>) {
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
      ignoreEvent: options['ignoreEvent'] as boolean,
      ignorePatchHistory: options['ignorePatchHistory'] as boolean
    }

    const updateQuery = this.getUpdate()
    const { update, commands } = splitUpdateAndCommands(updateQuery)

    const cursor = model.find(filter).lean().cursor()
    await cursor.eachAsync(async (doc: HydratedDocument<T>) => {
      await updatePatch(opts, this._context, assignUpdate(doc, update, commands), doc)
    })
  })

  schema.post(updateMethods as MongooseQueryMiddleware[], async function (this: IHookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    if (!this._context.isNew) return

    const model = this.model as Model<T>
    const updateQuery = this.getUpdate()
    const { update, commands } = splitUpdateAndCommands(updateQuery)

    const filter = assignUpdate({} as HydratedDocument<T>, update, commands)
    if (!_.isEmpty(filter)) {
      const current = await model.findOne(update).lean().exec()
      if (current) {
        this._context.createdDocs = [current] as HydratedDocument<T>[]

        await createPatch(opts, this._context)
      }
    }
  })
}