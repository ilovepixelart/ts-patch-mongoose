import { Schema } from 'mongoose'

import DescriptionSchema from './DescriptionSchema'

import type IProduct from '../interfaces/IProduct'

const ProductSchema = new Schema<IProduct>({
  name: {
    type: String,
    required: true
  },
  description: {
    type: DescriptionSchema,
    required: false
  }
}, { timestamps: true })

export default ProductSchema
