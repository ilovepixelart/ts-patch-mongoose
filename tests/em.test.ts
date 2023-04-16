import { patchEventEmitter } from '../src/plugin'

describe('em', () => {
  it('should subscribe and count', async () => {
    let count = 0
    const fn = () => {
      count++
    }
    patchEventEmitter.on('test', fn)
    patchEventEmitter.emit('test')
    expect(count).toBe(1)
    patchEventEmitter.off('test', fn)
    patchEventEmitter.emit('test')
    expect(count).toBe(1)
  })
})
