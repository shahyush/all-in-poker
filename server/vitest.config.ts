import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 60000, fileParallelism: false }, resolve: { alias: { '@allin/engine': new URL('../engine/src/index.ts', import.meta.url).pathname } } });
