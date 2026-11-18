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

1. Run the full check: `npm run type:check && npm run type:check:tests && npm run biome && npm test && npm run build`
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

## End-to-end check of the packed package

```bash
npm run test:e2e                            # mongoose from devDependencies
npm run test:e2e -- --mongoose 6.12.2       # another mongoose version
```

`npm run test:e2e` builds, packs the package with `npm pack`, and installs the tarball and the latest published version into two fresh consumer projects in the system temp directory. Each project runs the scenarios in `e2e/consumer/` twice, through `require` and through `import`, against its own in-memory replica set: every hooked operation in every session mode, with the history entries, events, getter calls and `onError` calls each one produces. The run fails when:

- `require` or `import` of the package fails, or the two disagree on any scenario
- any scenario differs from the published version at a path that no `e2e/allowlist.json` entry for that scenario allows
- an `e2e/allowlist.json` entry allows no difference (remove entries once their change is published)
- any manual transaction of the cold-start check fails

An intended behaviour change goes into `e2e/allowlist.json` with the scenarios it changes, the difference paths it changes in them (for example `$.events[*].payload.doc.**`, where `*` matches one key or index and `**` any rest of the path) and the reason. The tooling's own tests run with `npm run test:e2e:tools`. `--candidate <version|file.tgz>` and `--baseline <version>` replace the packed build or the published version; `--keep` keeps the consumer projects and their outputs (they are always kept when the run fails). CI runs it for every mongoose major.
