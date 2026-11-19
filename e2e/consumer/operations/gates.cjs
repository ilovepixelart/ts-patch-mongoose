'use strict'

// `available` predicates for operations that a mongoose major does not have.

const has = (name) => (M) => typeof M[name] === 'function'
const hasDocument = (name) => (M) => typeof M.prototype[name] === 'function'
const fromMajor = (major) => (M) => Number.parseInt(M.base.version, 10) >= major
const hasPath = (path) => (M) => Boolean(M.schema.path(path))

module.exports = { has, hasDocument, fromMajor, hasPath }
