import type { HydratedDocument, Types } from 'mongoose'

interface IContext<T> {
  op: string
  modelName: string
  collectionName: string
  isNew?: boolean
  oldDoc?: HydratedDocument<T>
  deletedDocs?: HydratedDocument<T>[]
  updatedIds?: Types.ObjectId[]
}

export default IContext
