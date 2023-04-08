import EventEmitter from 'events'

class MongooseEmitter extends EventEmitter {}
const em = new MongooseEmitter()

export default em
