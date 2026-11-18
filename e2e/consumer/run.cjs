'use strict'

// CommonJS consumer: loads the installed package through require.
const { writeFileSync } = require('node:fs')
const { MongoMemoryReplSet } = require('mongodb-memory-server')
const mongoose = require('mongoose')
const pkg = require('ts-patch-mongoose')
const runScenarios = require('./scenarios.cjs')

runScenarios({ mongoose, pkg, MongoMemoryReplSet })
  .then((result) => writeFileSync(process.argv[2], JSON.stringify(result)))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
