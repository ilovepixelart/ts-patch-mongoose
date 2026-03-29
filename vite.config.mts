import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    dir: 'tests',
    include: ['**/*.test.ts'],
    name: 'node',
    environment: 'node',
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
      ],
    },
  },
})
