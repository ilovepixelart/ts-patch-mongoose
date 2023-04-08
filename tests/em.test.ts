import em from '../src/em'

describe('em', () => {
  it('should subscribe and count', async () => {
    let count = 0
    const fn = () => {
      count++
    }
    em.on('test', fn)
    em.emit('test')
    expect(count).toBe(1)
    em.off('test', fn)
    em.emit('test')
    expect(count).toBe(1)
  })
})
