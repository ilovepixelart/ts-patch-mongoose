import { applyUpdate } from '../assign-update'
import { cloneDeep, isArray, isEmpty, isHookIgnored, isObjectLike, toObjectOptions } from '../helpers'
import { createPatch, updatePatch } from '../patch'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema, UpdateQuery, UpdateWithAggregationPipeline } from 'mongoose'
import type { HookContext, PluginOptions } from '../types'

const updateMethods = ['update', 'updateOne', 'replaceOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'findByIdAndUpdate']

const trackChangedFields = (fields: Record<string, unknown> | undefined, updated: Record<string, unknown>, changed: Map<string, unknown>): void => {
  if (!fields) return
  for (const key of Object.keys(fields)) {
    const [root = key] = key.split('.')
    changed.set(root, updated[root])
  }
}

export const assignUpdate = <T>(document: HydratedDocument<T>, update: UpdateQuery<T>, commands: Record<string, unknown>[]): HydratedDocument<T> => {
  let updated = applyUpdate(document.toObject(toObjectOptions) as Record<string, unknown>, update)
  const changedByCommand = new Map<string, unknown>()

  for (const command of commands) {
    const [op = ''] = Object.keys(command)
    const fields = command[op] as Record<string, unknown> | undefined
    updated = applyUpdate(updated, command)
    trackChangedFields(fields, updated, changedByCommand)
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

// The _id an upsert inserted, as the write reports it: upsertedId of an update result, the upserted id of
// a raw findOneAndUpdate result, or the _id of the document a findOneAndUpdate returns after the write.
const insertedId = (result: unknown): unknown => {
  if (!isObjectLike(result)) return undefined
  const { upsertedId, lastErrorObject, _id } = result as { upsertedId?: unknown; lastErrorObject?: { upserted?: unknown }; _id?: unknown }
  return upsertedId ?? lastErrorObject?.upserted ?? _id ?? undefined
}

// Without a reported _id, the filter finds the inserted document first: nothing matched it before the
// upsert. The values the update sets come after, newest _id first.
const findInserted = async <T>(model: Model<T>, filter: Record<string, unknown>, updateQuery: UpdateWithAggregationPipeline | UpdateQuery<T> | null): Promise<HydratedDocument<T> | null> => {
  const { update, commands } = splitUpdateAndCommands(updateQuery)
  const simulated = assignUpdate(model.hydrate({}), update, commands) as unknown as Record<string, unknown>
  const simulatedFilter = Object.fromEntries(Object.entries(simulated).filter(([, v]) => v !== undefined))

  for (const query of [filter, update, simulatedFilter]) {
    if (isEmpty(query)) continue
    const found = await model
      .findOne(query as never)
      .sort({ _id: -1 })
      .lean()
      .exec()
    if (found) return found as HydratedDocument<T>
  }
  return null
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

  schema.post(updateMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: HookContext<T>, result: unknown) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return
    if (!this._context) return

    if (!this._context.isNew) return

    const model = this.model as Model<T>
    const id = insertedId(result)
    const current = id === undefined ? await findInserted(model, this.getFilter(), this.getUpdate()) : ((await model.findById(id).lean().exec()) as HydratedDocument<T> | null)

    if (current) {
      this._context.createdDocs = [current] as HydratedDocument<T>[]

      await createPatch(opts, this._context)
    }
  })
}
