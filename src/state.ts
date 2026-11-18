import { chunk, HISTORY_BATCH_SIZE, isObjectLike, mapSeries, sessionOptions, toObjectOptions } from './helpers'

import type { ClientSession, HydratedDocument, Model, QueryOptions, Schema } from 'mongoose'
import type { PluginOptions } from './types'

export type Snapshot<T> = HydratedDocument<T>

export interface ReadOptions {
  session?: ClientSession | null | undefined
  collation?: unknown
  sort?: unknown
  /** Projection that adds the `select: false` paths, when the plugin records them. */
  select?: string
}

export const idKey = String

export const readOptionsOf = <T>(options: QueryOptions<T>, withSort: boolean, select: string): ReadOptions => ({
  session: options.session ?? null,
  collation: options.collation,
  ...(withSort && { sort: options.sort }),
  select,
})

const queryOptions = (read: ReadOptions): Record<string, unknown> => ({
  ...sessionOptions(read.session),
  ...(read.collation !== undefined && { collation: read.collation }),
})

type PathType = { options?: { select?: unknown }; schema?: Schema }

// A schema that nests itself is walked once along each path.
const selectFalsePathsOf = (schema: Schema, prefix: string, walked: Set<Schema>): string[] => {
  if (walked.has(schema)) return []
  const within = new Set(walked).add(schema)
  return Object.entries(schema.paths as Record<string, PathType>).flatMap(([path, type]) => {
    if (type.options?.select === false) return [`${prefix}${path}`]
    return type.schema ? selectFalsePathsOf(type.schema, `${prefix}${path}.`, within) : []
  })
}

const selectFalseCache = new WeakMap<Schema, string[]>()

const selectFalsePaths = (schema: Schema): string[] => {
  const cached = selectFalseCache.get(schema)
  if (cached) return cached
  const paths = selectFalsePathsOf(schema, '', new Set())
  selectFalseCache.set(schema, paths)
  return paths
}

/** Paths declared with `select: false`, including those of subdocuments, as dotted paths. */
export const hiddenPaths = <T>(model: Model<T>): string[] => selectFalsePaths(model.schema as Schema)

/** Projection for reads of the stored state: the `select: false` paths are added only when the plugin records them. */
export const hiddenSelect = <T>(model: Model<T>, opts: PluginOptions<T>): string =>
  opts.includeHiddenPaths
    ? hiddenPaths(model)
        .map((path) => `+${path}`)
        .join(' ')
    : ''

// Mongoose registers every discriminator on the root model: a discriminator cannot have discriminators of its own.
const discriminatorSchemas = (model: { discriminators?: Record<string, { schema: Schema }> | undefined }): Schema[] => Object.values(model.discriminators ?? {}).map(({ schema }) => schema)

/**
 * The `select: false` paths to leave out of every state the plugin records or emits: those of the model's schema
 * and of every discriminator registered on it. A read through the base model applies only the base schema's
 * projection, and a document cannot be relied on to name its discriminator (the key can be missing, unknown,
 * changed by the update or left out by `omit`), so every document has the whole set left out.
 */
export const hiddenOmit = <T>(model: Model<T>, opts: PluginOptions<T>): string[] => {
  if (opts.includeHiddenPaths) return []
  const schemas = [model.schema as Schema, ...discriminatorSchemas(model as never)]
  return [...new Set(schemas.flatMap(selectFalsePaths))]
}

const toSnapshot = <T>(doc: HydratedDocument<T>): Snapshot<T> => doc.toObject(toObjectOptions) as Snapshot<T>

/** Stored state, as `toObject`, of the documents an update will touch: the first match for a single-document operation, every match otherwise. */
export const findUpdateTargets = async <T>(model: Model<T>, filter: object, many: boolean, read: ReadOptions): Promise<Snapshot<T>[]> => {
  if (many) {
    const docs = await model.find(filter, read.select || null, queryOptions(read)).exec()
    return (docs as HydratedDocument<T>[]).map(toSnapshot)
  }
  const query = model.findOne(filter, read.select || null, queryOptions(read))
  if (read.sort) query.sort(read.sort as never)
  const doc = await query.exec()
  return doc ? [toSnapshot(doc as HydratedDocument<T>)] : []
}

/** Stored state, as lean objects, of the documents a delete will remove. */
export const findDeleteTargets = async <T>(model: Model<T>, filter: object, many: boolean, read: ReadOptions): Promise<Snapshot<T>[]> => {
  if (many) {
    return (await model
      .find<T>(filter, read.select || null, queryOptions(read))
      .lean()
      .exec()) as unknown as Snapshot<T>[]
  }
  const query = model.findOne<T>(filter, read.select || null, queryOptions(read))
  if (read.sort) query.sort(read.sort as never)
  const doc = await query.lean().exec()
  return doc ? [doc as Snapshot<T>] : []
}

/** Stored state, as `toObject`, of the given ids, keyed by id. */
export const findUpdatedStates = async <T>(model: Model<T>, ids: unknown[], read: ReadOptions): Promise<Map<string, Snapshot<T>>> => {
  const batches = await mapSeries(chunk(ids, HISTORY_BATCH_SIZE), async (batch) => (await model.find({ _id: { $in: batch } } as never, read.select || null, queryOptions(read)).exec()) as HydratedDocument<T>[])
  return new Map(batches.flat().map((doc) => [idKey(doc._id), toSnapshot(doc)]))
}

/** Stored state, as lean objects, of the given ids, keyed by id. */
export const findLeanStates = async <T>(model: Model<T>, ids: unknown[], read: ReadOptions, projection: string | null = read.select || null): Promise<Map<string, Snapshot<T>>> => {
  const batches = await mapSeries(
    chunk(ids, HISTORY_BATCH_SIZE),
    async (batch) =>
      (await model
        .find<T>({ _id: { $in: batch } } as never, projection, queryOptions(read))
        .lean()
        .exec()) as unknown as Snapshot<T>[],
  )
  return new Map(batches.flat().map((doc) => [idKey(doc._id), doc]))
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
