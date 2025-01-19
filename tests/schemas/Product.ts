import { Schema } from 'mongoose'
import { DescriptionSchema } from './Description'

import type { Types } from 'mongoose'
import type { Description } from './Description'

export interface Product {
  name: string
  groups?: string[]
  description?: Description
  addedBy?: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

export const ProductSchema = new Schema<Product>(
  {
    name: {
      type: String,
      required: true,
    },
    groups: {
      type: [String],
      required: false,
      default: undefined,
    },
    description: {
      type: DescriptionSchema,
      required: false,
    },
    addedBy: {
      type: Schema.Types.ObjectId,
      required: false,
      ref: 'User',
    },
  },
  { timestamps: true },
)
