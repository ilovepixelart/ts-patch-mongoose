import { assign } from 'power-assign'
import { cloneDeep, isArray, isEmpty, isHookIgnored, isObjectLike, toObjectOptions } from '../helpers'
import { createPatch, updatePatch } from '../patch'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema, UpdateQuery, UpdateWithAggregationPipeline } from 'mongoose'
import type { HookContext, PluginOptions } from '../types'

const updateMethods = ['update', 'updateOne', 'replaceOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'findByIdAndUpdate']

const trackChangedFields = (fields: Record<string, unknown> | undefined, updated: Record<string, unknown>, changed: Map<string, unknown>): void => {
  if (!fields) return
  for (const key of Object.keys(fields)) {
    const root = key.split('.')[0] as string
    changed.set(root, updated[root])
  }
}

const applyPullAll = (updated: Record<string, unknown>, fields: Record<string, unknown[]>, changed: Map<string, unknown>): void => {
  for (const [field, values] of Object.entries(fields)) {
    const arr = updated[field]
    if (Array.isArray(arr)) {
      const filtered = arr.filter((item: unknown) => !values.some((v) => JSON.stringify(v) === JSON.stringify(item)))
      updated[field] = filtered
      changed.set(field, filtered)
    }
  }
}

export const assignUpdate = <T>(document: HydratedDocument<T>, update: UpdateQuery<T>, commands: Record<string, unknown>[]): HydratedDocument<T> => {
  let updated = assign(document.toObject(toObjectOptions), update) as Record<string, unknown>
  const changedByCommand = new Map<string, unknown>()

  for (const command of commands) {
    const op = Object.keys(command)[0] as string
    const fields = command[op] as Record<string, unknown> | undefined
    try {
      updated = assign(updated, command) as Record<string, unknown>
      trackChangedFields(fields, updated, changedByCommand)
    } catch {
      if (op === '$pullAll' && fields) {
        applyPullAll(updated, fields as Record<string, unknown[]>, changedByCommand)
      }
    }
  }

  const doc = document.set(updated).toObject(toObjectOptions) as HydratedDocument<T> & { createdAt?: Date }
  for (const [field, value] of changedByCommand) {
    ;(doc as unknown as Record<string, unknown>)[field] = value
  }
  if (update.createdAt) doc.createdAt = update.createdAt
  return doc
}

export const splitUpdateAndCommands = <T>(updateQuery: UpdateWithAggregationPipeline | UpdateQuery<T> | null): { update: UpdateQuery<T>; commands: Record<string, unknown>[] } => {
  let update: UpdateQuery<T> = {}
  const commands: Record<string, unknown>[] = []

  if (!isEmpty(updateQuery) && !isArray(updateQuery) && isObjectLike(updateQuery)) {
    update = cloneDeep(updateQuery)
    const keysWithDollarSign = Object.keys(update).filter((key) => key.startsWith('$'))
    if (!isEmpty(keysWithDollarSign)) {
      for (const key of keysWithDollarSign) {
        commands.push({ [key]: update[key] as unknown })
        delete update[key]
      }
    }
  }

  return { update, commands }
}

export const updateHooksInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>): void => {
  schema.pre(updateMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: HookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    const model = this.model as Model<T>
    const filter = this.getFilter()

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      isNew: Boolean(options.upsert) && (await model.countDocuments(filter).exec()) === 0,
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

  schema.post(updateMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: HookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return
    if (!this._context) return

    if (!this._context.isNew) return

    const model = this.model as Model<T>
    const updateQuery = this.getUpdate()
    const { update, commands } = splitUpdateAndCommands(updateQuery)

    const filter = this.getFilter()
    const candidates = [update, assignUpdate(model.hydrate({}), update, commands), filter]

    let current: HydratedDocument<T> | null = null
    for (const query of candidates) {
      if (current || isEmpty(query)) continue
      current = (await model.findOne(query).sort({ _id: -1 }).lean().exec()) as HydratedDocument<T>
    }

    if (current) {
      this._context.createdDocs = [current] as HydratedDocument<T>[]

      await createPatch(opts, this._context)
    }
  })
}
