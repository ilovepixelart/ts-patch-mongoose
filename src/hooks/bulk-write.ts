import mongoose from 'mongoose'
import { cloneDeep, isArray, isEmpty, isHookIgnored, isObjectLike, mapSeries, reportErrors } from '../helpers'
import { createPatch, deletePatch, type UpdateChange, updatePatches } from '../patch'
import { findDeleteTargets, findLeanStates, findUpdatedStates, findUpdateTargets, idKey, type ReadOptions, type Snapshot } from '../state'

import type { HydratedDocument, Model, Schema } from 'mongoose'
import type { PatchContext, PluginOptions } from '../types'
import type { SavingIds } from './save-hooks'

type Op = Record<string, Record<string, unknown> | undefined>
type BulkOptions = Record<string, unknown> & { session?: mongoose.ClientSession | null }
type BulkWrite = (this: unknown, ops: unknown, options?: unknown, callback?: unknown) => Promise<unknown>

interface Target<T> {
  op: string
  doc: Snapshot<T>
}

interface Plan<T> {
  updated: Map<string, Target<T>>
  deleted: Map<string, Target<T>>
  skippedIds: Set<string>
  opNames: string[]
}

const updateOps = new Set(['updateOne', 'updateMany', 'replaceOne'])
const deleteOps = new Set(['deleteOne', 'deleteMany'])

const opName = (op: unknown): string => (isObjectLike(op) ? (Object.keys(op)[0] ?? '') : '')

// bulkSave() runs the save hooks, which record the documents, and then writes them through bulkWrite().
const targetId = (name: string, spec: Record<string, unknown>): unknown => {
  if (name === 'insertOne') return (spec.document as { _id?: unknown } | undefined)?._id
  const filter = spec.filter as { _id?: unknown } | undefined
  return isObjectLike(filter?._id) && !('_bsontype' in filter._id) ? undefined : filter?._id
}

const remember = <T>(targets: Map<string, Target<T>>, op: string, docs: Snapshot<T>[]): void => {
  for (const doc of docs) {
    const key = idKey(doc._id)
    if (!targets.has(key)) targets.set(key, { op, doc })
  }
}

const capture = async <T>(model: Model<T>, ops: Op[], read: ReadOptions, saving: SavingIds): Promise<Plan<T>> => {
  const plan: Plan<T> = { updated: new Map(), deleted: new Map(), skippedIds: new Set(), opNames: ops.map(opName) }

  await mapSeries(ops, async (op, index) => {
    const name = plan.opNames[index] ?? ''
    const spec = op[name] ?? {}
    const id = targetId(name, spec)
    if (id != null && saving.delete(idKey(id))) {
      plan.skippedIds.add(idKey(id))
      return
    }

    const filter = (spec.filter ?? {}) as object
    const many = name.endsWith('Many')
    const opRead = { ...read, ...(spec.collation !== undefined && { collation: spec.collation }), ...(spec.sort !== undefined && { sort: spec.sort }) }
    if (updateOps.has(name)) remember(plan.updated, name, await findUpdateTargets(model, filter, many, opRead))
    if (deleteOps.has(name)) remember(plan.deleted, name, await findDeleteTargets(model, filter, many, opRead))
  })

  return plan
}

const groupByOp = <T>(targets: Target<T>[]): Map<string, Snapshot<T>[]> => {
  const groups = new Map<string, Snapshot<T>[]>()
  for (const { op, doc } of targets) groups.set(op, [...(groups.get(op) ?? []), doc])
  return groups
}

const idsOf = (ids: unknown): [string, unknown][] => (isObjectLike(ids) ? Object.entries(ids) : [])

const recordCreated = async <T>(model: Model<T>, opts: PluginOptions<T>, context: PatchContext<T>, plan: Plan<T>, res: unknown, read: ReadOptions): Promise<void> => {
  const result = (isObjectLike(res) ? res : {}) as { insertedIds?: unknown; upsertedIds?: unknown }
  const created: Target<T>[] = []
  const inserted = idsOf(result.insertedIds).map(([, id]) => ({ op: 'create', id }))
  const upserted = idsOf(result.upsertedIds).map(([index, id]) => ({ op: plan.opNames[Number(index)] ?? 'bulkWrite', id }))
  const wanted = [...inserted, ...upserted].filter(({ id }) => !plan.skippedIds.has(idKey(id)))
  if (isEmpty(wanted)) return

  const states = await findLeanStates(
    model,
    wanted.map(({ id }) => id),
    read,
  )
  for (const { op, id } of wanted) {
    const doc = states.get(idKey(id))
    if (doc) created.push({ op, doc })
  }
  await mapSeries([...groupByOp(created)], async ([op, docs]) => {
    await createPatch(opts, { ...context, op, createdDocs: docs as HydratedDocument<T>[] })
  })
}

const recordChanged = async <T>(model: Model<T>, opts: PluginOptions<T>, context: PatchContext<T>, plan: Plan<T>, read: ReadOptions): Promise<void> => {
  if (plan.updated.size === 0 && plan.deleted.size === 0) return

  const states = await findUpdatedStates(
    model,
    [...plan.updated.values(), ...plan.deleted.values()].map(({ doc }) => doc._id),
    read,
  )

  const changes: UpdateChange<T>[] = []
  for (const [key, { op, doc }] of plan.updated) {
    const current = states.get(key)
    if (current) changes.push({ op, original: doc, current })
  }
  await updatePatches(opts, context, changes)

  const removed = [...plan.deleted.entries()].filter(([key]) => !states.has(key)).map(([, target]) => target)
  await mapSeries([...groupByOp(removed)], async ([op, docs]) => {
    await deletePatch(opts, { ...context, op, deletedDocs: docs as HydratedDocument<T>[] })
  })
}

const trackBulkWrite = async <T>(model: Model<T>, opts: PluginOptions<T>, saving: SavingIds, base: BulkWrite, ops: unknown, options: BulkOptions | undefined): Promise<unknown> => {
  if (!isArray(ops) || isHookIgnored(options ?? {})) return base.call(model, ops, options)

  const read: ReadOptions = { session: options?.session ?? null }
  const plan = await capture(model, ops as Op[], read, saving)

  if (opts.preDelete && plan.deleted.size > 0) {
    await opts.preDelete(cloneDeep([...plan.deleted.values()].map(({ doc }) => doc as HydratedDocument<T>)))
  }

  const res = await base.call(model, ops, options)

  const context: PatchContext<T> = {
    op: 'bulkWrite',
    modelName: opts.modelName ?? model.modelName,
    collectionName: opts.collectionName ?? model.collection.collectionName,
    ignoreEvent: options?.ignoreEvent as boolean,
    ignorePatchHistory: options?.ignorePatchHistory as boolean,
    session: read.session ?? null,
  }
  await reportErrors(opts.onError, async () => {
    await recordChanged(model, opts, context, plan, read)
    await recordCreated(model, opts, context, plan, res, read)
  })
  return res
}

/**
 * Records Model.bulkWrite(). Its post middleware (mongoose 8.2+) receives only the result, with no reference
 * to the operations or their options, so concurrent calls on one model could not be paired with the states
 * captured before them; wrapping the static keeps each call's states together on every mongoose version.
 */
export const bulkWriteInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>, saving: SavingIds): void => {
  const base = mongoose.Model.bulkWrite as unknown as BulkWrite

  schema.static('bulkWrite', function (this: Model<T>, ops: unknown, options?: unknown, callback?: unknown) {
    // Callbacks are left to mongoose untouched: mongoose 6 accepts them, later versions reject them.
    if (typeof options === 'function' || typeof callback === 'function') return base.call(this, ops, options, callback)
    return trackBulkWrite(this, opts, saving, base, ops, options as BulkOptions | undefined)
  })
}
