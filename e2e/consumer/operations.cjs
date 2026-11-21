'use strict'

// Every model operation the plugin hooks, plus bulkWrite, which it does not, grouped by hook in
// operations/. Each `run` gets the model, the session options of the current mode (`o`), and
// helpers for fixed ids and documents. `available` gates operations that a mongoose major does
// not have. Names are scenario ids, so they must be unique.

const GROUPS = ['save', 'insert', 'update', 'operators', 'upsert', 'delete', 'query-options']

const operations = GROUPS.flatMap((group) => require(`./operations/${group}.cjs`))

const names = operations.map((operation) => operation.name)
const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
if (duplicates.length > 0) throw new Error(`duplicate operation names: ${duplicates.join(', ')}`)

module.exports = { operations }
