import path from 'node:path'
import base from './stryker.config.mjs'

// Mutation testing of src/ against the end-to-end suite on the packed package: npm run test:mutation:e2e
// Each mutant runs the scenarios until the first record that differs from the unmutated build (e2e/mutation/mutant.mjs),
// so a full run takes hours; scope it with --mutate src/file.ts or src/file.ts:10-40 while working on one area.
// The diff behind every kill is written to reports/mutation/e2e-kills/<mutant id>.json.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: base.mutate,
  tempDirName: base.tempDirName,
  tsconfigFile: base.tsconfigFile,
  testRunner: 'command',
  buildCommand: 'node e2e/mutation/mutant.mjs prepare',
  commandRunner: { command: `MUTANT_KILLS_DIR=${path.resolve('reports/mutation/e2e-kills')} node e2e/mutation/mutant.mjs run` },
  coverageAnalysis: 'off',
  concurrency: 4,
  timeoutMS: 300_000,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/e2e.html' },
  jsonReporter: { fileName: 'reports/mutation/e2e.json' },
  ignorePatterns: [...base.ignorePatterns, '.stryker-e2e'],
}
