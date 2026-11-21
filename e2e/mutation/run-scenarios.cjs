'use strict'

// Runs the e2e scenarios against the installed package and writes the result to <out>. Given a
// reference result, it exits with code 3 at the first scenario whose record differs, after writing
// that scenario, its record and the reference record to <out>.
//
//   node run-scenarios.cjs <out.json> [reference.json]

const { readFileSync, writeFileSync } = require('node:fs')
const { MongoMemoryReplSet } = require('mongodb-memory-server')
const runScenarios = require('./scenarios.cjs')

const DIFFERS = 3
const [out, referenceFile] = process.argv.slice(2)
const reference = referenceFile ? JSON.parse(readFileSync(referenceFile, 'utf8')).scenarios : undefined

const onScenario = (scenario, observed) => {
  if (reference && JSON.stringify(reference[scenario]) !== JSON.stringify(observed)) {
    writeFileSync(out, JSON.stringify({ scenario, observed, reference: reference[scenario] }, null, 1))
    process.exit(DIFFERS)
  }
}

runScenarios({ mongoose: require('mongoose'), pkg: require('ts-patch-mongoose'), MongoMemoryReplSet, onScenario })
  .then((result) => writeFileSync(out, JSON.stringify(result)))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
