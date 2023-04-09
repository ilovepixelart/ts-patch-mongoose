import mongoose from 'mongoose'

describe('mongoose - in-memory test', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  beforeAll(async () => {
    await mongoose.connect(uri)
  })

  afterAll(async () => {
    await mongoose.connection.close()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('tests').deleteMany({})
    await mongoose.connection.collection('patches').deleteMany({})
  })

  it('should insert a doc into collection', async () => {
    const users = mongoose.connection.db.collection('users')

    const doc = { name: 'John' }
    const user = await users.insertOne(doc)

    const insertedUser = await users.findOne({ _id: user.insertedId })
    expect(insertedUser).toEqual(doc)
  })
})
