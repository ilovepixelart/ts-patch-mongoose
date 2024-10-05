import mongoose from 'mongoose'
import { satisfies } from 'semver'

export const isMongooseLessThan8 = satisfies(mongoose.version, '<8')
export const isMongooseLessThan7 = satisfies(mongoose.version, '<7')
export const isMongoose6 = satisfies(mongoose.version, '6')

if (isMongoose6) {
  mongoose.set('strictQuery', false)
}
