import { toObjectOptions } from '../helpers'
import { createPatch, updatePatch } from '../patch'

import type { HydratedDocument, Model, Schema } from 'mongoose'
import type { PatchContext, PluginOptions } from '../types'

type PendingSave<T> = { context: PatchContext<T>; current: HydratedDocument<T>; original?: HydratedDocument<T> | null }

// What pre('save') captured, recorded by post('save'), which runs only once the write succeeded.
const pending = new WeakMap<object, PendingSave<unknown>>()

export const saveHooksInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>): void => {
  schema.pre('save', async function () {
    if (this.constructor.name !== 'model') return

    const current = this.toObject(toObjectOptions) as HydratedDocument<T>
    const model = this.constructor as Model<T>

    const context: PatchContext<T> = {
      op: this.isNew ? 'create' : 'update',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      createdDocs: [current],
    }

    const original = this.isNew ? undefined : ((await model.findById(current._id).lean().exec()) as HydratedDocument<T> | null)
    pending.set(this, { context, current, original } as PendingSave<unknown>)
  })

  schema.post('save', async function () {
    const saved = pending.get(this) as PendingSave<T> | undefined
    if (!saved) return
    pending.delete(this)

    const { context, current, original } = saved
    if (original === undefined) {
      await createPatch(opts, context)
    } else if (original) {
      await updatePatch(opts, context, current, original)
    }
  })
}
