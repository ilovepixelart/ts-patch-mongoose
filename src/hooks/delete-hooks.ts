import { cloneDeep, isEmpty, isHookIgnored, reportErrors } from '../helpers'
import { deletePatch } from '../patch'
import { countOf, findDeleteTargets, findLeanStates, hiddenSelect, idKey, type ReadOptions, readOptionsOf, resultDocument, type Snapshot } from '../state'

import type { HydratedDocument, Model, MongooseQueryMiddleware, QueryOptions, Schema } from 'mongoose'
import type { HookContext, PatchContext, PluginOptions } from '../types'

const deleteMethods = ['remove', 'findOneAndDelete', 'findOneAndRemove', 'findByIdAndDelete', 'findByIdAndRemove', 'deleteOne', 'deleteMany']

const findOneAndMethods = new Set(['findOneAndDelete', 'findOneAndRemove'])

type DeleteContext<T> = PatchContext<T> & { read?: ReadOptions }
type DeleteHookContext<T> = Omit<HookContext<T>, '_context'> & { _context?: DeleteContext<T> }

const isMulti = <T>(op: string, options: QueryOptions<T>): boolean => ['remove', 'deleteMany'].includes(op) && !options.single

// A delete can remove fewer documents than matched before it ran (another client removed some first),
// and findOneAnd* names the one it removed; only those are recorded.
const removedDocs = async <T>(model: Model<T>, op: string, docs: Snapshot<T>[], res: unknown, read: ReadOptions): Promise<Snapshot<T>[]> => {
  if (findOneAndMethods.has(op)) {
    const doc = resultDocument(res)
    if (!doc) return []
    return doc._id == null ? docs : docs.filter((d) => idKey(d._id) === idKey(doc._id))
  }

  const deleted = countOf(res, 'deletedCount')
  if (deleted === undefined || deleted >= docs.length) return docs
  if (deleted === 0) return []

  const remaining = await findLeanStates(
    model,
    docs.map((d) => d._id),
    read,
    '_id',
  )
  return docs.filter((d) => !remaining.has(idKey(d._id)))
}

export const deleteHooksInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>): void => {
  schema.pre(deleteMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: DeleteHookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    const model = this.model as Model<T>
    const read = readOptionsOf(options, findOneAndMethods.has(this.op), hiddenSelect(model, opts))
    const docs = await findDeleteTargets(model, this.getFilter(), isMulti(this.op, options), read)

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      ignoreEvent: options.ignoreEvent as boolean,
      ignorePatchHistory: options.ignorePatchHistory as boolean,
      session: read.session ?? null,
      read,
      ...(!isEmpty(docs) && { deletedDocs: docs as HydratedDocument<T>[] }),
    }

    if (opts.preDelete && !isEmpty(docs)) {
      await opts.preDelete(cloneDeep(docs as HydratedDocument<T>[]))
    }
  })

  schema.post(deleteMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: DeleteHookContext<T>, res: unknown) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return
    const context = this._context
    const read = context?.read
    const docs = context?.deletedDocs as Snapshot<T>[] | undefined
    if (!context || !read || !docs) return

    await reportErrors(opts.onError, async () => {
      const deletedDocs = await removedDocs(this.model as Model<T>, this.op, docs, res, read)
      if (!isEmpty(deletedDocs)) await deletePatch(opts, { ...context, deletedDocs })
    })
  })
}
