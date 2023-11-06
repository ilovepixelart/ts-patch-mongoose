import { createPatch, updatePatch } from '../patch'
import { toObjectOptions } from '../helpers'

import type { HydratedDocument, Model, Schema } from 'mongoose'
import type IPluginOptions from '../interfaces/IPluginOptions'
import type IContext from '../interfaces/IContext'

export const saveHooksInitialize = <T>(schema: Schema<T>, opts: IPluginOptions<T>): void => {
  schema.pre('save', async function () {
    const current = this.toObject(toObjectOptions) as HydratedDocument<T>
    const model = this.constructor as Model<T>

    const context: IContext<T> = {
      op: this.isNew ? 'create' : 'update',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      createdDocs: [current]
    }

    if (this.isNew) {
      await createPatch(opts, context)
    } else {
      const original = await model.findById(current._id).lean().exec()
      if (original) {
        await updatePatch(opts, context, current, original as HydratedDocument<T>)
      }
    }
  })
}