import type { HydratedDocument } from 'mongoose'

export type User = Record<string, unknown>
export type Reason = string
export type Metadata = Record<string, unknown>

interface IPluginOptions<T> {
  modelName?: string
  collectionName?: string
  eventUpdated?: string
  eventCreated?: string
  eventDeleted?: string
  getUser?: () => Promise<User> | User
  getReason?: () => Promise<Reason> | Reason
  getMetadata?: () => Promise<Metadata> | Metadata
  omit?: string[]
  patchHistoryDisabled?: boolean
  preDelete?: (docs: HydratedDocument<T>[]) => Promise<void>
}

export default IPluginOptions
