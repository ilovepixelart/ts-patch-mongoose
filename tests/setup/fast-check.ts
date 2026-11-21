import fc from 'fast-check'

// Every property draws the same inputs on every run, so CI cells and mutation runs test the same cases.
// FC_SEED picks another seed (a failing property prints the seed and path to replay); FC_SEED=random
// draws fresh inputs on each run.
const seed = process.env.FC_SEED ?? '20261121'
if (seed !== 'random') fc.configureGlobal({ seed: Number(seed) })
