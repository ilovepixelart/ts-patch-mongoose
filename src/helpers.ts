import type { QueryOptions, ToObjectOptions } from 'mongoose'

export const isHookIgnored = <T>(options: QueryOptions<T>): boolean => {
  return options['ignoreHook'] === true || (options['ignoreEvent'] === true && options['ignorePatchHistory'] === true)
}

export const toObjectOptions: ToObjectOptions = {
  depopulate: true,
  virtuals: false
}