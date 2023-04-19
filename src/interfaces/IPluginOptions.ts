import type { HydratedDocument } from 'mongoose'

interface IPluginOptions<T> {
  modelName?: string
  collectionName?: string
  eventUpdated?: string
  eventCreated?: string
  eventDeleted?: string
  patchHistoryDisabled?: boolean
  preDeleteCallback?: (docs: HydratedDocument<T>[]) => Promise<void>
  getUser?: () => Promise<Record<string, unknown>> | Record<string, unknown>
  omit?: string[]
}

export default IPluginOptions
