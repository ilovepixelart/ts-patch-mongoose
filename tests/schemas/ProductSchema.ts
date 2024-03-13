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
    required: true
  },
  description: {
    type: DescriptionSchema,
    required: true
  },
  addedBy: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  }
}, { timestamps: true })

export default ProductSchema
