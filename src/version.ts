import mongoose from 'mongoose'

const major = Number.parseInt(mongoose.version, 10)

export const isMongooseLessThan8 = major < 8
export const isMongooseLessThan7 = major < 7
export const isMongoose6 = major === 6

/* v8 ignore start */
if (isMongoose6) {
  mongoose.set('strictQuery', false)
}
/* v8 ignore end */
