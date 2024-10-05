import EventEmitter from 'node:events'

class PatchEventEmitter extends EventEmitter {}
const em = new PatchEventEmitter()

export default em
