import { isEmpty, reportErrors, sessionOptions, toObjectOptions } from '../helpers'
import { createPatch, updatePatch } from '../patch'
import { findUpdatedStates, hiddenPaths, idKey } from '../state'
import { sessionOf } from './model-statics'

import type { ClientSession, HydratedDocument, Model, Schema } from 'mongoose'
import type { PatchContext, PluginOptions } from '../types'

type Pending<T> = { created: HydratedDocument<T> } | { original: HydratedDocument<T> }

export const saveHooksInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>): void => {
  const pending = new WeakMap<object, Pending<T>>()

  const sessionOfDoc = (doc: { $session: () => ClientSession | null }) => doc.$session() ?? sessionOf(doc) ?? null

  const contextOf = (doc: HydratedDocument<T>, op: string): PatchContext<T> => {
    const model = doc.constructor as Model<T>
    return {
      op,
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      session: sessionOfDoc(doc),
    }
  }

  schema.pre('save', async function () {
    if (this.constructor.name !== 'model') return

    if (this.isNew) {
      pending.set(this, { created: this.toObject(toObjectOptions) as HydratedDocument<T> })
    } else if (this.isModified()) {
      const model = this.constructor as Model<T>
      const original = await model
        .findById(this._id, hiddenPaths(model) || null, sessionOptions(sessionOfDoc(this)))
        .lean()
        .exec()
      if (original) pending.set(this, { original: original as HydratedDocument<T> })
    }
  })

  schema.post('save', async function (this: HydratedDocument<T>) {
    const entry = pending.get(this)
    if (!entry) return
    pending.delete(this)

    await reportErrors(opts.onError, async () => {
      if ('created' in entry) {
        await createPatch(opts, { ...contextOf(this, 'create'), createdDocs: [entry.created] })
        return
      }

      const context = contextOf(this, 'update')
      const states = await findUpdatedStates(this.constructor as Model<T>, [this._id], { session: context.session })
      const current = states.get(idKey(this._id))
      if (current && !isEmpty(current)) await updatePatch(opts, context, current, entry.original)
    })
  })

  schema.post('save', function (this: HydratedDocument<T>, error: Error, _doc: unknown, next: (error?: Error) => void) {
    pending.delete(this)
    next(error)
  })
}
