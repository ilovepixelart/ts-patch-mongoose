// The e2e scenarios as a Stryker command runner (npm run test:mutation:e2e). Stryker instruments src/ once and
// switches mutants through __STRYKER_ACTIVE_MUTANT__, which every spawned process inherits.
//   prepare  build and pack the instrumented package, install it once, and record its scenarios with no mutant
//            active (Stryker runs the build before activating any) as the reference
//   run      exit 1 on the first scenario whose record differs from the reference. Stryker's dry run is a run
//            with no mutant active, so a scenario that is not deterministic fails it instead of killing mutants.
// The reference is this build, not the published baseline, so allowlisted changes do not count as kills.
// Concurrent runs share the install, which they only read. A run that crashes instead of finishing is retried
// once, so a passing infrastructure failure such as a replica set that did not start is not counted as a
// kill; a crash in both attempts is, as the mutant crashing the run, and its stderr is kept with the kill.
// MUTANT_MONGOOSE installs another mongoose version in the consumer, for the code only older majors run.
import { execFile } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const STATE = resolve('.stryker-e2e')
const CONSUMER = join(STATE, 'consumer')
const REFERENCE = join(STATE, 'reference.json')
const DIFFERS = 3
const MAX_BUFFER = 64 * 1024 * 1024

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'))
const env = {
  ...process.env,
  MONGOMS_VERSION: process.env.MONGOMS_VERSION ?? rootPackage.config.mongodbMemoryServer.version,
  MONGOMS_DOWNLOAD_DIR: process.env.MONGOMS_DOWNLOAD_DIR ?? join(homedir(), '.cache', 'mongodb-binaries'),
}

const runScenarios = (out, against) => exec(process.execPath, ['run-scenarios.cjs', out, ...(against ? [against] : [])], { cwd: CONSUMER, env, maxBuffer: MAX_BUFFER })

const prepare = async () => {
  rmSync(STATE, { recursive: true, force: true })
  mkdirSync(CONSUMER, { recursive: true })
  await exec('npm', ['run', 'build'])
  const packed = JSON.parse((await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', STATE])).stdout)
  // npm 10 and 11 print an array, npm 12 an object keyed by package name.
  const [{ filename }] = Array.isArray(packed) ? packed : Object.values(packed)
  cpSync(join(here, '..', 'consumer'), CONSUMER, { recursive: true })
  cpSync(join(here, 'run-scenarios.cjs'), join(CONSUMER, 'run-scenarios.cjs'))
  const dependencies = { 'ts-patch-mongoose': `file:${join(STATE, filename)}`, mongoose: process.env.MUTANT_MONGOOSE ?? rootPackage.devDependencies.mongoose, 'mongodb-memory-server': rootPackage.devDependencies['mongodb-memory-server'] }
  writeFileSync(join(CONSUMER, 'package.json'), JSON.stringify({ name: 'e2e-mutant-consumer', private: true, type: 'commonjs', dependencies }, null, 2))
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], { cwd: CONSUMER })
  await runScenarios(REFERENCE)
}

const recordKill = (kill) => {
  const dir = process.env.MUTANT_KILLS_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${process.env.__STRYKER_ACTIVE_MUTANT__ ?? 'none'}.json`), `${JSON.stringify(kill, null, 1)}\n`)
}

// The scenario that told the mutant apart, or undefined when every record matched the reference.
const runMutant = async (attemptsLeft) => {
  const out = join(STATE, `out-${process.pid}.json`)
  try {
    await runScenarios(out, REFERENCE)
    return undefined
  } catch (error) {
    if (error.code === DIFFERS) {
      const kill = JSON.parse(readFileSync(out, 'utf8'))
      recordKill(kill)
      return kill.scenario
    }
    if (attemptsLeft > 0) return runMutant(attemptsLeft - 1)
    recordKill({ scenario: 'crash', stderr: String(error.stderr ?? error.message).slice(-4000) })
    return 'a crash in every attempt'
  } finally {
    rmSync(out, { force: true })
  }
}

const [mode] = process.argv.slice(2)
if (mode === 'prepare') await prepare()
else if (mode === 'run') {
  const killedBy = await runMutant(1)
  console.log(killedBy ? `killed by ${killedBy}` : 'survived')
  process.exitCode = killedBy ? 1 : 0
} else throw new Error(`Unknown mode '${String(mode)}': use prepare or run`)
