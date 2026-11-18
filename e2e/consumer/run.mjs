// ES module consumer: loads the installed package through import.
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import * as pkg from 'ts-patch-mongoose'

const runScenarios = createRequire(import.meta.url)('./scenarios.cjs')

writeFileSync(process.argv[2], JSON.stringify(await runScenarios({ mongoose, pkg, MongoMemoryReplSet })))
