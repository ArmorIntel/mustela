import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { detectSingleIoc } from '../src/shared/ioc.js';

// Every indicator rendered in the source report belongs to this synthetic set.
test('store report uses only reserved addresses, example domains and a fabricated hash', async () => {
  const html = await fs.readFile(new URL('fixtures/store/report.html', import.meta.url), 'utf8');
  const values = [...html.matchAll(/<code>([^<]+)<\/code>/g)].map((match) => match[1]);
  assert.deepEqual(values, [
    '192.0.2.42', 'signal.example.org', '198.51.100.24',
    'https://signal.example.org/sample', 'a'.repeat(32)
  ]);
  assert.deepEqual(values.map((value) => detectSingleIoc(value)?.type), ['ip', 'domain', 'ip', 'url', 'md5']);
});

const assets = new URL('../docs/store/assets/', import.meta.url);
const screenshots = ['01-highlights.png', '02-investigation.png', '03-popup-history.png', '04-settings.png', '05-global-pause.png'];

test('committed store assets have exact PNG dimensions and no unexpected files', async () => {
  assert.deepEqual((await fs.readdir(assets)).sort(), [...screenshots, 'promo-small.png'].sort());
  for (const name of [...screenshots, 'promo-small.png']) {
    const png = await fs.readFile(new URL(name, assets));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
    assert.equal(png.readUInt32BE(8), 13, name);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', name);
    const expected = name === 'promo-small.png' ? [440, 280] : [1280, 800];
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], expected, name);
  }
});
