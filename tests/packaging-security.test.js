import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Resolve the parser through the CRX packaging dependency chain, including
// nested installations, rather than assuming a hoisted top-level package.
const require = createRequire(import.meta.url);
const crxRequire = createRequire(require.resolve('crx3'));
const pbfRequire = createRequire(crxRequire.resolve('pbf'));
const resolverRequire = createRequire(pbfRequire.resolve('resolve-protobuf-schema'));
const schema = resolverRequire('protocol-buffers-schema');

test('CRX schema parser does not pollute Object.prototype through field options', () => {
  const marker = 'mustelaPackagingPollution';
  const malicious = `message Example {
    optional string value = 1 [(__proto__).${marker} = true];
  }`;
  assert.equal(Object.hasOwn(Object.prototype, marker), false);
  try {
    // Rejecting unsafe input is also an acceptable parser response.
    try {
      schema.parse(malicious);
    } catch (error) {
      assert.ok(error instanceof Error);
    }
    assert.equal(Object.hasOwn(Object.prototype, marker), false);
    assert.equal({}[marker], undefined);
  } finally {
    delete Object.prototype[marker];
  }
});
