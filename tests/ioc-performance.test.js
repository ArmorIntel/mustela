import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseIocsFromText } from '../src/shared/ioc.js';

for (const token of ['a.', '1.']) {
  test(`parser bounds pathological ${token} runs with linear growth`, () => {
    const measure = (length) => {
      const text = token.repeat(length / 2);
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        parseIocsFromText(text);
        samples.push(performance.now() - start);
      }
      return samples.sort((a, b) => a - b)[2];
    };
    const small = measure(10000);
    const large = measure(40000);
    console.log(JSON.stringify({ token, small, large }));
    assert.ok(large < 50, `40k took ${large} ms`);
    assert.ok(large <= small * 6 + 2, `nonlinear growth: ${small} -> ${large}`);
  });
}
test('parser bounds minified 200k JSON', () => {
  const text = JSON.stringify({ payload: 'a.'.repeat(99990) });
  const start = performance.now();
  assert.deepEqual(parseIocsFromText(text), []);
  const duration = performance.now() - start;
  console.log(JSON.stringify({ json: duration }));
  assert.ok(duration < 100, `JSON took ${duration} ms`);
});

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

test('dense mixed indicators retain ranges and scale without pairwise overlap scans', () => {
  const row = '8.8.8.8 2001:db8::1 https://evil.example.org/a evil[.]example.org d41d8cd98f00b204e9800998ecf8427e A@evil.org AS13335 10.0.0.0/24\n';
  const expected = parseIocsFromText(row);
  const measure = (count) => {
    const start = performance.now();
    const result = parseIocsFromText(row.repeat(count));
    const duration = performance.now() - start;
    assert.equal(result.length, expected.length * count);
    for (let i = 0; i < count; i++) {
      assert.deepEqual(result.slice(i * expected.length, (i + 1) * expected.length), expected.map((ioc) => ({ ...ioc, index: ioc.index + i * row.length })));
    }
    return duration;
  };
  measure(100); // Warm the JIT outside measured growth.
  const small = measure(400);
  const large = measure(1600);
  console.log(JSON.stringify({ mixedSmall: small, mixedLarge: large, characters: row.length * 1600 }));
  assert.ok(large < 500, `dense log took ${large} ms`);
  assert.ok(large <= small * 6 + 10, `nonlinear dense growth: ${small} -> ${large}`);
});
