'use strict'

// Document saves: the save hooks record a create for a new document and a patch for an existing one.

module.exports = [
  { name: 'save:new', run: ({ M, o, fresh }) => new M(fresh(10, 'new')).save(o) },
  {
    name: 'save:existing',
    run: async ({ M, o, oid }) => {
      const doc = await M.findById(oid(1), null, o)
      doc.n += 1
      doc.tags.push('t2')
      doc.meta.color = 'blue'
      return doc.save(o)
    },
  },
  // Saved with owner populated: the recorded document keeps the owner id, not the owner.
  {
    name: 'save:populated',
    run: async ({ M, o, oid }) => {
      const doc = await M.findById(oid(1), null, o).populate('owner')
      doc.n += 1
      return doc.save(o)
    },
  },
  { name: 'save:unchanged', run: async ({ M, o, oid }) => (await M.findById(oid(1), null, o)).save(o) },
  // Successive saves of one document: the history version counts up from 0.
  {
    name: 'save:repeated',
    run: async ({ M, o, fresh }) => {
      const doc = await new M(fresh(10, 'new')).save(o)
      doc.n = 20
      await doc.save(o)
      doc.tags.push('t9')
      return doc.save(o)
    },
  },
  {
    name: 'save:subdocument-array',
    run: async ({ M, o, oid }) => {
      const doc = await M.findById(oid(1), null, o)
      doc.items.push({ name: 'i1', qty: 1 })
      await doc.save(o)
      doc.items[0].qty = 3
      return doc.save(o)
    },
  },
]
