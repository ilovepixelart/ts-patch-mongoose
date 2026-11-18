import mongoose from 'mongoose'
import { cloneDeep, isArray, isEmpty, isHookIgnored, isObjectLike, mapSeries, reportErrors } from '../helpers'
import { createPatch, deletePatch, type UpdateChange, updatePatches } from '../patch'
import { findDeleteTargets, findLeanStates, findUpdatedStates, findUpdateTargets, idKey, type ReadOptions, type Snapshot } from '../state'
import { isMongooseLessThan8 } from '../version'
import { isFromBulkSave, type Override, type Static } from './model-statics'

import type { HydratedDocument, Model } from 'mongoose'
import type { PatchContext, PluginOptions } from '../types'

type Op = Record<string, Record<string, unknown> | undefined>
type BulkOptions = Record<string, unknown> & { session?: mongoose.ClientSession | null }

interface Target<T> {
  op: string
  doc: Snapshot<T>
}

interface Plan<T> {
  updated: Map<string, Target<T>>
  deleted: Map<string, Target<T>>
  ops: Op[]
  opNames: string[]
  fromBulkSave: boolean
}

const updateOps = new Set(['updateOne', 'updateMany', 'replaceOne'])
const deleteOps = new Set(['deleteOne', 'deleteMany'])

const opName = (op: unknown): string => (isObjectLike(op) ? (Object.keys(op)[0] ?? '') : '')

const remember = <T>(targets: Map<string, Target<T>>, op: string, docs: Snapshot<T>[]): void => {
  for (const doc of docs) {
    const key = idKey(doc._id)
    if (!targets.has(key)) targets.set(key, { op, doc })
  }
}

const captureOp = async <T>(model: Model<T>, plan: Plan<T>, name: string, spec: Record<string, unknown>, read: ReadOptions): Promise<void> => {
  const filter = (spec.filter ?? {}) as object
  const many = name.endsWith('Many')
  const opRead = { ...read, ...(spec.collation !== undefined && { collation: spec.collation }), ...(spec.sort !== undefined && { sort: spec.sort }) }
  try {
    if (updateOps.has(name)) remember(plan.updated, name, await findUpdateTargets(model, filter, many, opRead))
    if (deleteOps.has(name)) remember(plan.deleted, name, await findDeleteTargets(model, filter, many, opRead))
  } catch (error) {
    // An operation mongoose cannot cast is left out of an unordered call and rejects an ordered one before any write.
    if (!(error instanceof mongoose.Error)) throw error
  }
}

const capture = async <T>(model: Model<T>, ops: Op[], read: ReadOptions, fromBulkSave: boolean): Promise<Plan<T>> => {
  const plan: Plan<T> = { updated: new Map(), deleted: new Map(), ops, opNames: ops.map(opName), fromBulkSave }

  await mapSeries(ops, async (op, index) => {
    const name = plan.opNames[index] ?? ''
    // bulkSave() writes the documents its save hooks record, and never deletes.
    if (fromBulkSave && !deleteOps.has(name)) return
    await captureOp(model, plan, name, op[name] ?? {}, read)
  })

  return plan
}

const groupByOp = <T>(targets: Target<T>[]): Map<string, Snapshot<T>[]> => {
  const groups = new Map<string, Snapshot<T>[]>()
  for (const { op, doc } of targets) groups.set(op, [...(groups.get(op) ?? []), doc])
  return groups
}

const idsOf = (ids: unknown): [number, unknown][] => (isObjectLike(ids) ? Object.entries(ids).map(([index, id]) => [Number(index), id]) : [])

const indexOf = (writeError: unknown): number => (isObjectLike(writeError) ? Number(writeError.index) : Number.NaN)

const idOfFailed = (writeError: unknown): unknown => {
  const op = isObjectLike(writeError) && isObjectLike(writeError.err) ? writeError.err.op : undefined
  return isObjectLike(op) ? op._id : undefined
}

/**
 * Ids of the documents the call inserted, taken from its insertOne operations (the driver sets a missing `_id`):
 * not those whose insert failed, nor, in an ordered call, those after the first failure. The driver's own
 * insertedIds are not used: below driver 7 an unordered call numbers them apart from the operations.
 */
const insertedIds = (ops: Op[], outcome: Record<string, unknown>, ordered: boolean): unknown[] => {
  const errors = [outcome.writeErrors ?? []].flat()
  const failed = new Set(
    errors
      .map(idOfFailed)
      .filter((id) => id != null)
      .map(idKey),
  )
  const last = ordered && !isEmpty(errors) ? Math.min(...errors.map(indexOf)) : ops.length
  return ops.flatMap((op, index) => {
    const id = (op.insertOne?.document as { _id?: unknown } | undefined)?._id
    return id != null && index <= last && !failed.has(idKey(id)) ? [id] : []
  })
}

/**
 * The index in the call of each operation the driver numbered: an unordered call leaves out the operations that
 * failed casting. Mongoose 8+ reports which; older versions do not report it in an order that can be mapped back.
 */
const sentIndexes = (count: number, outcome: Record<string, unknown>): number[] | undefined => {
  const all = Array.from({ length: count }, (_, index) => index)
  const reported = isObjectLike(outcome.mongoose) ? outcome.mongoose : outcome
  const errors = reported.validationErrors
  if (!isArray(errors) || isEmpty(errors)) return all
  const results = reported.results
  if (isMongooseLessThan8 || !isArray(results)) return undefined
  return all.filter((index) => !errors.includes(results[index]))
}

const createdIds = (plan: Plan<unknown>, settled: unknown, ordered: boolean): { op: string; id: unknown }[] => {
  const outcome = isObjectLike(settled) ? settled : {}
  // A MongooseBulkWriteError, thrown after the write for operations that failed casting, carries the driver result.
  const result = isObjectLike(outcome.rawResult) ? outcome.rawResult : outcome
  const sent = sentIndexes(plan.opNames.length, outcome)
  const inserted = insertedIds(plan.ops, outcome, ordered).map((id) => ({ op: 'create', id }))
  const upserted = idsOf(result.upsertedIds).map(([index, id]) => {
    const position = sent?.[index]
    return { op: (position === undefined ? undefined : plan.opNames[position]) ?? 'bulkWrite', id }
  })
  return [...inserted, ...upserted]
}

const recordCreated = async <T>(model: Model<T>, opts: PluginOptions<T>, context: PatchContext<T>, plan: Plan<T>, settled: unknown, read: ReadOptions, ordered: boolean): Promise<void> => {
  if (plan.fromBulkSave) return
  const created: Target<T>[] = []
  const wanted = createdIds(plan as Plan<unknown>, settled, ordered)
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

const trackBulkWrite = async <T>(model: Model<T>, opts: PluginOptions<T>, base: Static, ops: unknown, options: BulkOptions | undefined): Promise<unknown> => {
  if (!isArray(ops) || isHookIgnored(options ?? {})) return base.call(model, ops, options)

  const read: ReadOptions = { session: options?.session ?? null }
  const plan = await capture(model, ops as Op[], read, isFromBulkSave(options))

  if (opts.preDelete && plan.deleted.size > 0) {
    await opts.preDelete(cloneDeep([...plan.deleted.values()].map(({ doc }) => doc as HydratedDocument<T>)))
  }

  // A call that rejects may still have applied some operations, which are recorded before it rejects.
  const write = base.call(model, ops, options)
  const settled = await write.catch((error: unknown) => error)

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
    await recordCreated(model, opts, context, plan, settled, read, options?.ordered !== false)
  })
  return write
}

/**
 * Records Model.bulkWrite(). Its post middleware (mongoose 8.2+) receives only the result, with no reference
 * to the operations or their options, so concurrent calls on one model could not be paired with the states
 * captured before them; wrapping the static keeps each call's states together on every mongoose version.
 */
export const bulkWriteOverride =
  <T>(opts: PluginOptions<T>): Override =>
  (base) =>
    function (this: unknown, ops: unknown, options?: unknown, callback?: unknown) {
      // Callbacks are left to mongoose untouched: mongoose 6 accepts them, later versions reject them.
      if (typeof options === 'function' || typeof callback === 'function') return base.call(this, ops, options, callback)
      return trackBulkWrite(this as Model<T>, opts, base, ops, options as BulkOptions | undefined)
    }
