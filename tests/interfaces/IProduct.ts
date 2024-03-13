import type IDescription from './IDescription'

interface IProduct {
  name: string
  description?: IDescription
  createdAt?: Date
  updatedAt?: Date
}

export default IProduct
