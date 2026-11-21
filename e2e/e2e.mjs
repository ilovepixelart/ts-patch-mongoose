// End-to-end check of the packed package. Packs this repository (or takes --candidate), installs
// it and the latest published version (or --baseline) into two fresh consumer projects outside
// the repository, runs the same scenarios in each through require and through import against
// real replica sets, and fails on any difference that allowlist.json does not list, on any
// difference between require and import, and on any failed cold-start transaction.
//
//   npm run test:e2e -- [--mongoose 9.4.1] [--candidate <spec|file.tgz>] [--baseline <spec>] [--keep]

import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { compareBuilds, differingIds, loadAllowlist, versionMismatches } from './compare.mjs'

const PACKAGE = 'ts-patch-mongoose'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const exec = promisify(execFile)
const failures = []

const { values: args } = parseArgs({
  options: {
    mongoose: { type: 'string' },
    candidate: { type: 'string' },
    baseline: { type: 'string' },
    allowlist: { type: 'string', default: join(here, 'allowlist.json') },
    keep: { type: 'boolean', default: false },
  },
})

const elapsed = (started) => `${((Date.now() - started) / 1000).toFixed(1)}s`

const phase = async (name, fn) => {
  const started = Date.now()
  const result = await fn()
  console.log(`[e2e] ${name} (${elapsed(started)})`)
  return result
}

const tail = (text, lines = 40) =>
  String(text ?? '')
    .trim()
    .split('\n')
    .slice(-lines)
    .join('\n')

const npm = async (cwd, npmArgs) => (await exec('npm', npmArgs, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout

const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const mongooseVersion = (args.mongoose ?? rootPackage.devDependencies.mongoose).replace(/^mongoose@/, '')
// The MongoDB server version unit tests use (package.json config.mongodbMemoryServer), unless overridden.
const mongodbVersion = process.env.MONGOMS_VERSION ?? rootPackage.config.mongodbMemoryServer.version
const env = { ...process.env, MONGOMS_VERSION: mongodbVersion, MONGOMS_DOWNLOAD_DIR: process.env.MONGOMS_DOWNLOAD_DIR ?? join(homedir(), '.cache', 'mongodb-binaries') }
// After the binary is downloaded once, a run that would download another version fails instead.
const runEnv = { ...env, MONGOMS_RUNTIME_DOWNLOAD: 'false' }

// A dependency value for package.json: a tarball path, or a version of the published package.
const dependencySpec = (spec) => {
  if (spec.endsWith('.tgz')) return `file:${resolve(spec)}`
  return spec.startsWith(`${PACKAGE}@`) ? spec.slice(PACKAGE.length + 1) : spec
}

const packRepository = async (work) => {
  if (!existsSync(join(root, 'dist', 'index.cjs')) || !existsSync(join(root, 'dist', 'index.mjs'))) throw new Error('dist/ is missing: run `npm run build` first')
  // npm 10 and 11 print an array, npm 12 an object keyed by package name.
  const packed = JSON.parse(await npm(root, ['pack', '--ignore-scripts', '--json', '--pack-destination', work]))
  const [{ filename }] = Array.isArray(packed) ? packed : Object.values(packed)
  return `file:${join(work, filename)}`
}

const createConsumer = async (work, name, spec) => {
  const dir = join(work, name)
  mkdirSync(dir)
  cpSync(join(here, 'consumer'), dir, { recursive: true })
  const dependencies = { [PACKAGE]: spec, mongoose: mongooseVersion, 'mongodb-memory-server': rootPackage.devDependencies['mongodb-memory-server'] }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `e2e-consumer-${name}`, private: true, type: 'commonjs', dependencies }, null, 2))
  await npm(dir, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'])
  const installed = JSON.parse(readFileSync(join(dir, 'node_modules', PACKAGE, 'package.json'), 'utf8')).version
  const mongoose = JSON.parse(readFileSync(join(dir, 'node_modules', 'mongoose', 'package.json'), 'utf8')).version
  return { name, dir, spec, installed, mongoose }
}

const runNode = async (consumer, script, out, timeout) => {
  try {
    await exec(process.execPath, [script, out], { cwd: consumer.dir, env: runEnv, timeout, maxBuffer: 64 * 1024 * 1024 })
    return JSON.parse(readFileSync(join(consumer.dir, out), 'utf8'))
  } catch (error) {
    const reason = error.killed ? `timed out after ${timeout / 1000}s` : `exited with ${error.code}`
    failures.push(`${consumer.name} ${script} ${reason}:\n${tail(error.stderr || error.message)}`)
    return undefined
  }
}

const checkFormats = (consumer, cjs, esm) => {
  if (!cjs || !esm) return
  const ids = differingIds(cjs.scenarios, esm.scenarios)
  if (ids.length > 0) failures.push(`${consumer.name}: require and import disagree on ${ids.length} scenarios: ${ids.slice(0, 10).join(', ')}`)
}

const checkBuilds = (baseline, candidate) => {
  const allowlist = loadAllowlist(args.allowlist)
  const { failures: diffs, allowed, unused } = compareBuilds(baseline.scenarios, candidate.scenarios, allowlist, mongooseVersion)
  for (const { id, paths, reason } of allowed) console.log(`[e2e] allowed difference ${id} (${reason})\n  ${paths.join('\n  ')}`)
  for (const { id, paths } of diffs) failures.push(`behaviour differs from the baseline in ${id} at paths allowlist.json does not allow:\n  ${paths.join('\n  ')}`)
  for (const { scenario, reason } of unused) failures.push(`allowlist.json entry "${scenario}" (${reason}) matches no difference: remove it`)
}

const checkColdStart = (result) => {
  if (!result) return
  const { plan, starts, ms } = result
  const failed = starts.flatMap((start, index) => start.failures.map((failure) => ({ start: index, ...failure })))
  const lost = starts.filter((start) => start.n !== start.committed || start.history !== start.committed).length
  console.log(`[e2e] cold start: ${plan.starts} starts x ${plan.perStart} = ${plan.total} manual transactions (n >= ${plan.transactions} catches a ${plan.failureRate * 100}% failure rate with probability ${((1 - plan.missProbability) * 100).toFixed(2)}%), ${failed.length} failed, ${(ms / 1000).toFixed(1)}s`)
  if (failed.length > 0) failures.push(`cold start: ${failed.length} of ${plan.total} manual transactions failed, e.g. start ${failed[0].start} transaction ${failed[0].transaction}: ${failed[0].codeName}: ${failed[0].message}`)
  if (lost > 0) failures.push(`cold start: in ${lost} starts the committed transactions, the document and its history disagree`)
}

const coverage = (scenarios) => {
  const rows = new Map()
  const modes = new Set()
  let run = 0
  let skipped = 0
  for (const [id, record] of Object.entries(scenarios)) {
    const [profile, operation, mode] = id.split('/')
    if (!mode) continue
    modes.add(mode)
    if (record.skipped) skipped++
    else run++
    const key = `${operation} (${profile})`
    rows.set(key, { ...rows.get(key), [mode]: record.skipped ? '-' : 'x' })
  }
  const header = ['operation (profile)', ...modes]
  const lines = [header, header.map(() => '---'), ...[...rows].map(([key, cells]) => [key, ...[...modes].map((mode) => cells[mode] ?? ' ')])]
  console.log(`[e2e] ${run} scenarios run, ${skipped} not available in mongoose ${mongooseVersion} (-)\n${lines.map((cells) => `| ${cells.join(' | ')} |`).join('\n')}`)
}

const main = async () => {
  const started = Date.now()
  const work = mkdtempSync(join(tmpdir(), `${PACKAGE}-e2e-`))
  try {
    const candidateSpec = args.candidate ? dependencySpec(args.candidate) : await phase('packed the repository', () => packRepository(work))
    const baselineSpec = dependencySpec(args.baseline ?? `${PACKAGE}@${(await npm(root, ['view', `${PACKAGE}@latest`, 'version'])).trim()}`)
    const [candidate, baseline] = await phase(`installed candidate (${candidateSpec}) and baseline (${baselineSpec}) with mongoose@${mongooseVersion}`, async () => [await createConsumer(work, 'candidate', candidateSpec), await createConsumer(work, 'baseline', baselineSpec)])
    console.log(`[e2e] candidate ${PACKAGE}@${candidate.installed}, baseline ${PACKAGE}@${baseline.installed}, mongoose ${candidate.mongoose}`)
    const installedMongoose = [candidate, baseline].map(({ name, mongoose }) => ({ name, version: mongoose }))
    failures.push(...versionMismatches('mongoose', mongooseVersion, installedMongoose))
    await phase('MongoDB binary ready', () => exec(process.execPath, [join('node_modules', 'mongodb-memory-server', 'postinstall.js')], { cwd: candidate.dir, env }))

    const [candidateCjs, candidateEsm, baselineCjs, baselineEsm] = await phase('ran the scenarios through require and import', () =>
      Promise.all([runNode(candidate, 'run.cjs', 'out.cjs.json', 300_000), runNode(candidate, 'run.mjs', 'out.mjs.json', 300_000), runNode(baseline, 'run.cjs', 'out.cjs.json', 300_000), runNode(baseline, 'run.mjs', 'out.mjs.json', 300_000)]),
    )
    checkFormats(candidate, candidateCjs, candidateEsm)
    checkFormats(baseline, baselineCjs, baselineEsm)
    const runs = Object.entries({ candidateCjs, candidateEsm, baselineCjs, baselineEsm }).filter(([, run]) => run)
    const servers = runs.map(([name, run]) => ({ name, version: run.mongodb }))
    failures.push(...versionMismatches('mongodb', mongodbVersion, servers))
    if (candidateCjs) coverage(candidateCjs.scenarios)
    if (candidateCjs && baselineCjs) checkBuilds(baselineCjs, candidateCjs)

    checkColdStart(await phase('ran the cold-start check', () => runNode(candidate, 'cold-start.mjs', 'cold-start.json', 900_000)))
  } finally {
    const keep = args.keep || failures.length > 0
    if (keep) console.log(`[e2e] consumer projects and outputs kept in ${work}`)
    else rmSync(work, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.error(`\n[e2e] FAILED (${failures.length}) after ${elapsed(started)}:\n\n${failures.map((failure) => `- ${failure}`).join('\n\n')}`)
    process.exitCode = 1
  } else {
    console.log(`[e2e] passed in ${elapsed(started)}`)
  }
}

await main()
