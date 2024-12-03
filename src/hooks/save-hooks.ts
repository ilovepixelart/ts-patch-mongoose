import { toObjectOptions } from '../helpers'
import { createPatch, updatePatch } from '../patch'

import type { HydratedDocument, Model, Schema } from 'mongoose'
import type IContext from '../interfaces/IContext'
import type IPluginOptions from '../interfaces/IPluginOptions'

export const saveHooksInitialize = <T>(schema: Schema<T>, opts: IPluginOptions<T>): void => {
  schema.pre('save', async function () {
    if (this.constructor.name !== 'model') return

    const current = this.toObject(toObjectOptions) as HydratedDocument<T>
    const model = this.constructor as Model<T>

    const context: IContext<T> = {
      op: this.isNew ? 'create' : 'update',
      modelName: opts.modelName ?? model.modelName,
      collectionName: opts.collectionName ?? model.collection.collectionName,
      createdDocs: [current],
    }

    if (this.isNew) {
      await createPatch(opts, context)
    } else {
      const original = await model.findById(current._id).exec()
      if (original) {
        await updatePatch(opts, context, current, original as HydratedDocument<T>)
      }
    }
  })
}
