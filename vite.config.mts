import { defineConfig } from 'vitest/config'

// The randomized suites that drive the shared mongod hardest (hundreds of generated command
// sequences each) run as a second group, after the example tests, so they never compete with them
// for the server and push an ordinary test past its timeout.
const randomized = ['laws/**/*.test.ts', '**/*.property.test.ts']

export default defineConfig({
  test: {
    dir: 'tests',
    environment: 'node',
    globalSetup: ['tests/mongo/global-setup.ts'],
    // Before every test: mocks lose their recorded calls and per-test implementations, and spies are restored.
    mockReset: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['**/*.test.ts'], exclude: randomized, sequence: { groupOrder: 0 } },
      },
      {
        extends: true,
        test: { name: 'randomized', include: randomized, sequence: { groupOrder: 1 } },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/tests/**',
        'examples/**',
        'src/types.ts',
      ],
    },
  },
})
