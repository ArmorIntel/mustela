import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIocsFromText } from '../src/shared/ioc.js';
import { mixedRow } from './fixtures/performance.js';

// Growth and latency measurements live in performance-budget.test.js / npm run bench.
test('domain chains keep greedy matches, original boundaries and recovery after invalid labels', () => {
  const cases = [
    ['a'.repeat(800) + '.evil.org', ['evil.org']],
    ['a.'.repeat(400) + '--.evil.org', ['evil.org']],
    ['a.'.repeat(400) + 'com.evil.org', []],
    ['_evil.org evil.org_foo', []],
    ['a.com.1.1 a.com-xx a.com-xx.evil.org', ['a.com', 'a.com', 'a.com-xx.evil.org']],
    ['a[.]b(.)evil.org', ['a[.]b(.)evil.org']]
  ];
  for (const [text, expected] of cases) {
    const domains = parseIocsFromText(text).filter((ioc) => ioc.type === 'domain');
    assert.deepEqual(domains.map((ioc) => ioc.raw), expected);
    for (const ioc of domains) assert.equal(text.slice(ioc.index, ioc.index + ioc.length), ioc.raw);
  }
});

test('dense mixed indicators retain ranges throughout the shared long log', () => {
  const expected = parseIocsFromText(mixedRow);
  const count = 1600;
  const result = parseIocsFromText(mixedRow.repeat(count));
  assert.equal(result.length, expected.length * count);
  for (let i = 0; i < count; i++) {
    assert.deepEqual(result.slice(i * expected.length, (i + 1) * expected.length), expected.map((ioc) => ({ ...ioc, index: ioc.index + i * mixedRow.length })));
  }
});
