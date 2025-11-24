import mongoose from 'mongoose'
import { satisfies } from 'semver'

export const isMongooseLessThan9 = satisfies(mongoose.version, '<9')
export const isMongooseLessThan8 = satisfies(mongoose.version, '<8')
export const isMongooseLessThan7 = satisfies(mongoose.version, '<7')
export const isMongoose6 = satisfies(mongoose.version, '6')
export const isMongoose9OrGreater = satisfies(mongoose.version, '>=9')

/* v8 ignore start */
if (isMongoose6) {
  mongoose.set('strictQuery', false)
}
/* v8 ignore end */
