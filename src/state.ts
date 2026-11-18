import { chunk, isObjectLike, sessionOptions, toObjectOptions } from './helpers'

import type { ClientSession, HydratedDocument, Model, QueryOptions } from 'mongoose'

export type Snapshot<T> = HydratedDocument<T>

export interface ReadOptions {
  session?: ClientSession | null | undefined
  collation?: unknown
  sort?: unknown
}

const BATCH = 1000

export const idKey = (id: unknown): string => String(id)

export const readOptionsOf = <T>(options: QueryOptions<T>, withSort: boolean): ReadOptions => ({
  session: options.session ?? null,
  collation: options.collation,
  ...(withSort && { sort: options.sort }),
})

const queryOptions = (read: ReadOptions): Record<string, unknown> => ({
  ...sessionOptions(read.session),
  ...(read.collation !== undefined && { collation: read.collation }),
})

// Paths declared with `select: false` are part of the stored state, so reads that diff states include them.
export const hiddenPaths = <T>(model: Model<T>): string => {
  const paths = model.schema.paths as Record<string, { options?: { select?: unknown } }>
  return Object.keys(paths)
    .filter((path) => paths[path]?.options?.select === false)
    .map((path) => `+${path}`)
    .join(' ')
}

const toSnapshot = <T>(doc: HydratedDocument<T>): Snapshot<T> => doc.toObject(toObjectOptions) as Snapshot<T>

/** Stored state, as `toObject`, of the documents an update will touch: the first match for a single-document operation, every match otherwise. */
export const findUpdateTargets = async <T>(model: Model<T>, filter: object, many: boolean, read: ReadOptions): Promise<Snapshot<T>[]> => {
  const hidden = hiddenPaths(model)
  if (many) {
    const docs = await model.find(filter, hidden || null, queryOptions(read)).exec()
    return (docs as HydratedDocument<T>[]).map(toSnapshot)
  }
  const query = model.findOne(filter, hidden || null, queryOptions(read))
  if (read.sort) query.sort(read.sort as never)
  const doc = await query.exec()
  return doc ? [toSnapshot(doc as HydratedDocument<T>)] : []
}

/** Stored state, as lean objects, of the documents a delete will remove. */
export const findDeleteTargets = async <T>(model: Model<T>, filter: object, many: boolean, read: ReadOptions): Promise<Snapshot<T>[]> => {
  if (many) {
    return (await model.find<T>(filter, null, queryOptions(read)).lean().exec()) as Snapshot<T>[]
  }
  const query = model.findOne<T>(filter, null, queryOptions(read))
  if (read.sort) query.sort(read.sort as never)
  const doc = await query.lean().exec()
  return doc ? [doc as Snapshot<T>] : []
}

/** Stored state, as `toObject`, of the given ids, keyed by id. */
export const findUpdatedStates = async <T>(model: Model<T>, ids: unknown[], read: ReadOptions): Promise<Map<string, Snapshot<T>>> => {
  const hidden = hiddenPaths(model)
  const states = new Map<string, Snapshot<T>>()
  for (const batch of chunk(ids, BATCH)) {
    const docs = (await model.find({ _id: { $in: batch } } as never, hidden || null, queryOptions(read)).exec()) as HydratedDocument<T>[]
    for (const doc of docs) states.set(idKey(doc._id), toSnapshot(doc))
  }
  return states
}

/** Stored state, as lean objects, of the given ids, keyed by id. */
export const findLeanStates = async <T>(model: Model<T>, ids: unknown[], read: ReadOptions, projection: string | null = null): Promise<Map<string, Snapshot<T>>> => {
  const states = new Map<string, Snapshot<T>>()
  for (const batch of chunk(ids, BATCH)) {
    const docs = (await model
      .find<T>({ _id: { $in: batch } } as never, projection, queryOptions(read))
      .lean()
      .exec()) as Snapshot<T>[]
    for (const doc of docs) states.set(idKey(doc._id), doc)
  }
  return states
}

/** The document a findOneAnd* query returned, unwrapping `includeResultMetadata` / `rawResult` results. */
export const resultDocument = (res: unknown): { _id?: unknown } | null => {
  if (!isObjectLike(res)) return null
  if ('lastErrorObject' in res && 'value' in res) return isObjectLike(res.value) ? (res.value as { _id?: unknown }) : null
  return res as { _id?: unknown }
}

/** The id an upsert inserted, when the result reports it. */
export const upsertedId = (res: unknown): unknown => {
  if (!isObjectLike(res)) return undefined
  if (res.upsertedId != null) return res.upsertedId
  const last = res.lastErrorObject
  return isObjectLike(last) && last.updatedExisting === false ? last.upserted : undefined
}

export const countOf = (res: unknown, key: 'modifiedCount' | 'deletedCount' | 'upsertedCount'): number | undefined => {
  if (!isObjectLike(res)) return undefined
  const value = res[key]
  return typeof value === 'number' ? value : undefined
}
