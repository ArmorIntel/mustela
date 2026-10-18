import test from 'node:test';
import assert from 'node:assert/strict';
import { parserFixtures, makePageNodes } from './fixtures/performance.js';
import { measureGrowth, assertGrowthBudget, measureScan, measureStorage, measurePopup } from './helpers/performance.js';
import { parseIocsFromText } from '../src/shared/ioc.js';

for (const fixture of parserFixtures) {
  test(`performance budget: parser ${fixture.name}`, async () => {
    const length = fixture.length || 200000;
    const result = await measureGrowth((text) => parseIocsFromText(text), fixture.make, length);
    assertGrowthBudget(fixture.name, result);
    assert.equal(fixture.make(length).length, length);
    if (fixture.empty) assert.deepEqual(parseIocsFromText(fixture.make(length)), []);
  });
}

test('growth budget explicitly rejects quadratic work', () => {
  assert.throws(() => assertGrowthBudget('quadratic parser', { small: 1, large: 256, scale: 16 }), /Performance budget exceeded.*quadratic parser.*48/);
});

test('performance budget: 20,000-node page without IOC has bounded scan work', async () => {
  assert.equal(makePageNodes(20000).length, 20000);
  const small = await measureScan(1250);
  const large = await measureScan(20000);
  assert.ok(large.visited <= 1500, JSON.stringify(large));
  assert.ok(large.parsed <= 1500, JSON.stringify(large));
  assert.ok(large.maxText <= 8192, JSON.stringify(large));
  assert.ok(large.visited <= small.visited * 3);
  assert.equal(large.messages, 1, 'unchanged empty scan must not republish');
  assert.equal(large.retained, 0);
});

test('performance budget: repeated detected lists never write to disk or rewrite session', async () => {
  const result = await measureStorage();
  assert.equal(result.sessionWrites, 1);
  assert.equal(result.localWrites, 0);
  assert.equal(result.restored, result.count);
});

test('performance budget: popup summary reads only its bounded recent history', () => {
  const small = measurePopup(1250);
  const large = measurePopup(20000);
  assert.equal(small.reads, large.reads);
  assert.ok(large.reads <= 8, JSON.stringify(large));
  assert.equal(large.displayed, 5);
});
