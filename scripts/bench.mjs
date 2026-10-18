import { parseIocsFromText } from '../src/shared/ioc.js';
import { parserFixtures } from '../tests/fixtures/performance.js';
import { measureGrowth, assertGrowthBudget, measureScan, measureStorage, measurePopup } from '../tests/helpers/performance.js';

console.log(`Performance benchmark (${process.version}); milliseconds are diagnostic, not absolute budgets.`);
for (const fixture of parserFixtures) {
  const result = await measureGrowth(parseIocsFromText, fixture.make);
  console.log(`parser ${fixture.name}: 12,500 -> 200,000 chars; ${result.small.toFixed(3)} -> ${result.large.toFixed(3)} ms; ${(result.large / result.small).toFixed(2)}x (budget <= 48x)`);
  assertGrowthBudget(fixture.name, result);
}
console.log('scan 20,000-node no-IOC page:', JSON.stringify(await measureScan(20000)));
console.log('storage 16 identical 500-IOC lists:', JSON.stringify(await measureStorage()));
console.log('popup summary / 20,000 history entries:', JSON.stringify(measurePopup(20000)));
