# Contributing

## Getting Started

```bash
git clone https://github.com/ilovepixelart/ts-patch-mongoose.git
cd ts-patch-mongoose
npm install
npx simple-git-hooks    # install pre-commit + pre-push hooks (one-time)
```

## Development

```bash
npm run type:check     # type check
npm run biome          # lint check
npm run biome:fix      # lint + auto-fix
npm test               # run tests with coverage
npm run build          # build with pkgroll
```

## Before Submitting a PR

1. Run the full check: `npm run type:check && npm run type:check:tests && npm run biome && npm test && npm run test:e2e:tools && npm run build`
2. Ensure no test regressions
3. Follow the existing code style (Biome handles formatting)
4. Keep changes focused: one feature or fix per PR

## Code Style

- ESM (`"type": "module"`)
- Strict TypeScript
- Biome formatting: no semicolons, single quotes, 2-space indent
- Arrow functions for standalone functions (no `this`)
- No unnecessary comments or docstrings

## Testing

- Framework: vitest
- Database: mongodb-memory-server
- Write tests for new features and bug fixes
- Test behavior, not implementation details
- `npm run test:shuffle` runs the tests in random order: run it on a new test to check it does not depend on another
- Property tests (fast-check) use a fixed seed (`tests/setup/fast-check.ts`). A failure prints the seed and path to replay; `FC_SEED=<seed>` picks another seed and `FC_SEED=random` draws fresh inputs

## End-to-end check of the packed package

```bash
npm run test:e2e                            # mongoose from devDependencies
npm run test:e2e -- --mongoose 6.12.2       # another mongoose version
```

`npm run test:e2e` builds, packs the package with `npm pack`, and installs the tarball and the latest published version into two fresh consumer projects in the system temp directory. Each project runs the scenarios in `e2e/consumer/` twice, through `require` and through `import`, against its own in-memory replica set: every hooked operation and update operator in every session mode, under plugin option profiles defined in `e2e/consumer/scenarios.cjs`, with the history entries, events, getter calls and `onError` calls each one produces, plus the TTL index after each `setPatchHistoryTTL` call and a batch larger than one history bulk write. The run fails when:

- a consumer project installed another mongoose version than the exact one requested
- `require` or `import` of the package fails, or the two disagree on any scenario
- any scenario differs from the published version at a path that no `e2e/allowlist.json` entry for that scenario allows
- an `e2e/allowlist.json` entry allows no difference (remove entries once their change is published)
- any manual transaction of the cold-start check fails

An intended behaviour change goes into `e2e/allowlist.json` with the scenarios it changes, the difference paths it changes in them (for example `$.events[*].payload.doc.**`, where `*` matches one key or index and `**` any rest of the path) and the reason. The tooling's own tests run with `npm run test:e2e:tools`. `--candidate <version|file.tgz>` and `--baseline <version>` replace the packed build or the published version; `--keep` keeps the consumer projects and their outputs (they are always kept when the run fails). CI runs it for every mongoose major.

## Mutation testing

Mutation testing changes `src/` one small edit at a time and checks that a test fails for each. It runs
locally, not in CI: a full run of either suite takes hours.

- `npm run test:mutation` runs it against the unit and integration suite (`stryker.config.mjs`).
- `npm run test:mutation:e2e` runs it against the end-to-end suite on the packed package
  (`stryker.e2e.config.mjs`, `e2e/mutation/mutant.mjs`). A mutant counts as killed when any scenario's
  record differs from the unmutated build. A full run takes hours, so scope it while working on
  one area: `npm run test:mutation:e2e -- --mutate src/assign-update.ts` or `--mutate src/patch.ts:40-90`.
  The record that killed each mutant is saved in `reports/mutation/e2e-kills/`. Code that only older mongoose
  majors run is mutation tested on them with `MUTANT_MONGOOSE=7.8.14 npm run test:mutation:e2e -- --mutate src/index.ts`.
- Reports are written to `reports/mutation/`. A surviving mutant needs a test or scenario (`e2e/consumer/operations/`,
  grouped by hook), or, when no input can tell it apart from the original, a
  `// Stryker disable next-line <mutator>: <reason>` comment.

## Laws

```bash
npm run laws         # the gate: proofs (with --verdict), claims, generated modules
npm run laws:fast    # the same without --verdict, when Lean is not installed
npm run laws:write   # regenerate laws/generated/ after changing a model
```

`laws/` states the library's contract in [Bend](https://bend-lang.com) and proves it. Each model (`laws/*.bend`, listed in `MODELS` in `laws/check.mjs`) mirrors a part of `src/`. `SPEC.bend` holds the predicates the laws use, `LAWS.bend` the proven laws, `PROOF.bend` their proofs and lemmas, and `CLAIMS.bend` any law stated but not yet proven. The tests in `tests/laws/` import the models as compiled ES modules (`laws/generated/`) and hold the TypeScript to them on random inputs; each model and each `tests/laws/*.laws.test.ts` says what it covers in its header. A known defect the model does not share is left out of the random sequences and pinned by a characterization test next to them.

A change to `src/` needs no Bend: the law tests run on the committed `laws/generated/` modules, and one that fails means the change departs from the model. Either the change is wrong, or the model must change with it; say which in the pull request, and the model, `npm run laws:write` and the proofs can follow in a separate change. The `laws` CI job reports on the proofs without blocking a merge. When changing a model, run `npm run laws:write` and `npm run laws`; a proof that fails means the change breaks a law. A claim moves from `CLAIMS.bend` to `LAWS.bend` with its proof. `--verdict` rechecks the proofs with BendTT's kernel, which has a proof in Lean; it needs Bend 2.0.40 and Lean v4.34.0 (`leanprover/lean4:v4.34.0` through elan), the versions CI pins in the `laws` job. Bend's guide (`bend guide`) and the demos in its repository show the conventions followed here: a `LAWS.bend` that states only the contract, a `SPEC.bend` kept apart from the models, constructor arms rather than fallback arms in anything a proof splits on, and no `@unsafe`.
