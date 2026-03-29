import { afterEach, describe, expect, it, vi } from 'vitest'

import { patchEventEmitter } from '../src/index'
import { emitEvent } from '../src/patch'

describe('em', () => {
  afterEach(() => {
    patchEventEmitter.removeAllListeners()
  })

  it('should subscribe and count', () => {
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

  it('emitEvent', () => {
    const fn = vi.fn()
    patchEventEmitter.on('test', fn)

    const context = {
      op: 'test',
      modelName: 'Test',
      collectionName: 'tests',
    }

    // @ts-expect-error expected
    emitEvent(context, 'test', { doc: { name: 'test' } })
    expect(fn).toHaveBeenCalledOnce()
  })

  it('emitEvent ignore', () => {
    const fn = vi.fn()
    patchEventEmitter.on('test', fn)

    const context = {
      ignoreEvent: true,
      op: 'test',
      modelName: 'Test',
      collectionName: 'tests',
    }

    // @ts-expect-error expected
    emitEvent(context, 'test', { doc: { name: 'test' } })
    expect(fn).toHaveBeenCalledTimes(0)
  })

  it('emitEvent should not throw when listener throws', () => {
    const fn = () => {
      throw new Error('listener error')
    }
    patchEventEmitter.on('throw-test', fn)

    const context = {
      op: 'test',
      modelName: 'Test',
      collectionName: 'tests',
    }

    // @ts-expect-error expected
    expect(() => emitEvent(context, 'throw-test', { doc: { name: 'test' } })).not.toThrow()
  })
})
