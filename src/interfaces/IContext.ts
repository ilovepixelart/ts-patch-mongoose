import type { HydratedDocument } from 'mongoose'

interface IContext<T> {
  op: string
  modelName: string
  collectionName: string
  isNew?: boolean
  createdDocs?: HydratedDocument<T>[]
  deletedDocs?: HydratedDocument<T>[]
  ignoreEvent?: boolean
  ignorePatchHistory?: boolean
}

export default IContext
