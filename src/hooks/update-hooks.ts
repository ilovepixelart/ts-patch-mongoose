import { applyUpdate } from '../assign-update'
import { cloneDeep, isArray, isEmpty, isHookIgnored, isObjectLike, reportErrors, sessionOptions, toObjectOptions } from '../helpers'
import { createPatch, updatePatches } from '../patch'
import { countOf, findLeanStates, findUpdatedStates, findUpdateTargets, hiddenOmit, hiddenSelect, idKey, type ReadOptions, readOptionsOf, resultDocument, type Snapshot, upsertedId } from '../state'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema, UpdateQuery, UpdateWithAggregationPipeline } from 'mongoose'
import type { RecordContext } from '../patch'
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

type UpdateContext<T> = RecordContext<T> & { targets?: Snapshot<T>[]; read?: ReadOptions }
type UpdateHookContext<T> = Omit<HookContext<T>, '_context'> & { _context?: UpdateContext<T> }

const findOneAndMethods = new Set(['findOneAndUpdate', 'findOneAndReplace'])

// Mongoose 6 sends the deprecated update() through the driver's update(), which updates every match.
const isMulti = (op: string): boolean => op === 'updateMany' || op === 'update'

// The upserted document cannot be read by id when the query returns neither the document nor its id
// (findOneAnd* without `new`), so it is looked up by the update and the filter.
const findUpsertedByQuery = async <T>(query: Pick<HookContext<T>, 'getUpdate' | 'getFilter'>, model: Model<T>, read: ReadOptions): Promise<HydratedDocument<T> | null> => {
  const { update, commands } = splitUpdateAndCommands(query.getUpdate())
  const simulated = assignUpdate(model.hydrate({}), update, commands) as unknown as Record<string, unknown>
  const simulatedFilter = Object.fromEntries(Object.entries(simulated).filter(([, v]) => v !== undefined))
  const candidates = [update, simulatedFilter, query.getFilter()]

  for (const candidate of candidates) {
    if (isEmpty(candidate)) continue
    const found = await model
      .findOne(candidate as never, read.select || null, sessionOptions(read.session))
      .sort({ _id: -1 })
      .lean()
      .exec()
    if (found) return found as HydratedDocument<T>
  }
  return null
}

const findUpserted = async <T>(query: Pick<HookContext<T>, 'getUpdate' | 'getFilter'>, model: Model<T>, res: unknown, read: ReadOptions): Promise<HydratedDocument<T> | null> => {
  const id = upsertedId(res) ?? resultDocument(res)?._id
  if (id != null) {
    const states = await findLeanStates(model, [id], read)
    return states.get(idKey(id)) ?? null
  }
  if (countOf(res, 'upsertedCount') === 0) return null
  return findUpsertedByQuery(query, model, read)
}

const changedTargets = <T>(op: string, targets: Snapshot<T>[], res: unknown): Snapshot<T>[] => {
  // findOneAnd* returns the document, whose own fields may include one named modifiedCount.
  if (!findOneAndMethods.has(op)) return countOf(res, 'modifiedCount') === 0 ? [] : targets
  const doc = resultDocument(res)
  if (!doc) return []
  return doc._id == null ? targets : targets.filter((target) => idKey(target._id) === idKey(doc._id))
}

const recordUpdate = async <T>(query: Pick<HookContext<T>, 'getUpdate' | 'getFilter' | 'op' | 'model'>, opts: PluginOptions<T>, context: UpdateContext<T>, read: ReadOptions, res: unknown): Promise<void> => {
  const model = query.model as Model<T>

  if (context.isNew) {
    const created = await findUpserted(query, model, res, read)
    if (created) await createPatch(opts, { ...context, createdDocs: [created] })
    return
  }

  const targets = changedTargets(query.op, context.targets ?? [], res)
  if (isEmpty(targets)) return

  const states = await findUpdatedStates(
    model,
    targets.map((target) => target._id),
    read,
  )
  const changes = targets.flatMap((original) => {
    const current = states.get(idKey(original._id))
    return current ? [{ original, current }] : []
  })
  await updatePatches(opts, context, changes)
}

export const updateHooksInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>): void => {
  schema.pre(updateMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: UpdateHookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    const model = this.model as Model<T>
    const read = readOptionsOf(options, findOneAndMethods.has(this.op), hiddenSelect(model, opts))
    const targets = await findUpdateTargets(model, this.getFilter(), isMulti(this.op), read)

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      isNew: Boolean(options.upsert) && targets.length === 0,
      ignoreEvent: options.ignoreEvent as boolean,
      ignorePatchHistory: options.ignorePatchHistory as boolean,
      session: read.session ?? null,
      hiddenPaths: hiddenOmit(model, opts),
      targets,
      read,
    }
  })

  schema.post(updateMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: UpdateHookContext<T>, res: unknown) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return
    const context = this._context
    const read = context?.read
    if (!context || !read) return

    await reportErrors(opts.onError, async () => {
      await recordUpdate(this, opts, context, read, res)
    })
  })
}
