import { Schema } from 'mongoose'

export interface User {
  name: string
  role: string
  createdAt?: Date
  updatedAt?: Date
}

export const UserSchema = new Schema<User>(
  {
    name: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
)
