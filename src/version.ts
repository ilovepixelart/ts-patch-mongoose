import { satisfies } from 'semver'
import mongoose from 'mongoose'

export const isMongooseLessThan7 = satisfies(mongoose.version, '<7')
export const isMongoose6 = satisfies(mongoose.version, '6')

if (isMongoose6) {
  mongoose.set('strictQuery', false)
}
