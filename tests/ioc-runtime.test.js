import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkIocRuntime } from './helpers/check-ioc-runtime.mjs';

test('generated IOC runtime matches the source in both working tree and Git index', async () => {
  await checkIocRuntime(fileURLToPath(new URL('../', import.meta.url)));
});
