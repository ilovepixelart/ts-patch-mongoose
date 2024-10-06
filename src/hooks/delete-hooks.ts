import _ from 'lodash'

import { isHookIgnored } from '../helpers'
import { deletePatch } from '../patch'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema } from 'mongoose'
import type IHookContext from '../interfaces/IHookContext'
import type IPluginOptions from '../interfaces/IPluginOptions'

const deleteMethods = ['remove', 'findOneAndDelete', 'findOneAndRemove', 'findByIdAndDelete', 'findByIdAndRemove', 'deleteOne', 'deleteMany']

export const deleteHooksInitialize = <T>(schema: Schema<T>, opts: IPluginOptions<T>): void => {
  schema.pre(deleteMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: IHookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    const model = this.model as Model<T>
    const filter = this.getFilter()

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName,
      ignoreEvent: options.ignoreEvent as boolean,
      ignorePatchHistory: options.ignorePatchHistory as boolean,
    }

    if (['remove', 'deleteMany'].includes(this._context.op) && !options.single) {
      const docs = await model.find(filter).lean().exec()
      if (!_.isEmpty(docs)) {
        this._context.deletedDocs = docs as HydratedDocument<T>[]
      }
    } else {
      const doc = await model.findOne(filter).lean().exec()
      if (!_.isEmpty(doc)) {
        this._context.deletedDocs = [doc] as HydratedDocument<T>[]
      }
    }

    if (opts.preDelete && _.isArray(this._context.deletedDocs) && !_.isEmpty(this._context.deletedDocs)) {
      await opts.preDelete(this._context.deletedDocs)
    }
  })

  schema.post(deleteMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: IHookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    await deletePatch(opts, this._context)
  })
}
