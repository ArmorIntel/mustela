import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startLandingServer } from './helpers/landing-server.js';

const root = new URL('../tests/fixtures/landing/', import.meta.url);
test('landing preparation stays local, scoped and separate from the published site', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /class="landing"/);
  assert.match(html, /name="description"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /#installation/);
  assert.match(html, /external pivots/);
  assert.match(html, /configured MISP/);
  assert.match(html, /optional Analyst Assist/i);
  assert.doesNotMatch(html, /<script|fonts\.google|chromewebstore|guarantees? zero disclosure|no analytics/i);
  for (const name of ['landing.css', 'demo.css']) {
    const css = await readFile(new URL(name, root), 'utf8');
    assert.doesNotMatch(css, /@import|https?:|--light|data-step|\.investigation\b|\.mustela-search/);
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g);
    for (const [, selector] of selectors) {
      if (selector.trim().startsWith('@')) continue;
      for (const part of selector.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^\.landing(?:\b|\s)/);
    }
  }
});

test('HTTP fixture serves only its explicit local assets under the Pages prefix', async () => {
  const server = await startLandingServer();
  try {
    for (const name of ['', 'landing.css', 'demo.css', 'icon128.png']) {
      const response = await fetch(server.url + name);
      assert.equal(response.status, 200);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    for (const path of ['missing.js', '../package.json', '%2e%2e/package.json', 'README.md']) {
      assert.equal((await fetch(server.url + path)).status, 404);
    }
    const published = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(published, /fixtures\/landing|landing\.css|demo\.css/);
  } finally {
    await server.close();
  }
});
