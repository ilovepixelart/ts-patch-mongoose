import { describe, expect, it, vi } from 'vitest'

import { patchEventEmitter } from '../src/index'
import { emitEvent } from '../src/patch'

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

  it('emitEvent', async () => {
    const fn = vi.fn()
    patchEventEmitter.on('test', fn)

    const context = {
      op: 'test',
      modelName: 'Test',
      collectionName: 'tests',
    }

    emitEvent(context, 'test', { doc: { name: 'test' } })
    expect(fn).toHaveBeenCalledTimes(1)

    patchEventEmitter.off('test', fn)
  })

  it('emitEvent ignore', async () => {
    const fn = vi.fn()
    patchEventEmitter.on('test', fn)

    const context = {
      ignoreEvent: true,
      op: 'test',
      modelName: 'Test',
      collectionName: 'tests',
    }

    emitEvent(context, 'test', { doc: { name: 'test' } })
    expect(fn).toHaveBeenCalledTimes(0)

    patchEventEmitter.off('test', fn)
  })
})
