import type { HydratedDocument } from 'mongoose'

interface IPluginOptions<T> {
  modelName?: string
  collectionName?: string
  eventUpdated?: string
  eventCreated?: string
  eventDeleted?: string
  patchHistoryDisabled?: boolean
  preDeleteManyCallback?: (docs: HydratedDocument<T>[]) => Promise<void>
  omit?: string[]
}

export default IPluginOptions
