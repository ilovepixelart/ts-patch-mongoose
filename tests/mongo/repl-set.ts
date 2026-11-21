import server from './server'

// Transactions need a replica set; the run's shared server is one (tests/mongo/global-setup.ts).
const replSet = () => server('repl-set')

export default replSet
