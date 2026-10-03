import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Some tests load large libraries (Prettier, terser, hash-wasm) on first use; with
    // many files running in parallel a cold import can exceed the 5 s default.
    testTimeout: 20_000,
  },
});
