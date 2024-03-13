import { Schema } from 'mongoose'

import DescriptionSchema from './DescriptionSchema'

import type IProduct from '../interfaces/IProduct'

const ProductSchema = new Schema<IProduct>({
  name: {
    type: String,
    required: true
  },
  groups: {
    type: [String],
    required: false,
    default: undefined
  },
  description: {
    type: DescriptionSchema,
    required: false
  },
  addedBy: {
    type: Schema.Types.ObjectId,
    required: false,
    ref: 'User'
  }
}, { timestamps: true })

export default ProductSchema
