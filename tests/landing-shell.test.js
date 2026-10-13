import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startLandingServer } from './helpers/landing-server.js';

const root = new URL('../docs/', import.meta.url);
test('complete landing stays local and scoped', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /class="landing"/);
  assert.match(html, /name="description"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /#installation/);
  assert.match(html, /external pivots/);
  assert.match(html, /configured MISP/);
  assert.match(html, /optional Analyst Assist/i);
  assert.doesNotMatch(html, /fonts\.google|chromewebstore|guarantees? zero disclosure|no analytics/i);
  assert.deepEqual([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]), ['assets/landing/demo.js', 'assets/landing/signal.js', 'assets/landing/chapters.js', 'assets/landing/orb.js']);
  for (const name of ['demo.js', 'demo-state.js']) {
    const script = await readFile(new URL('assets/landing/' + name, root), 'utf8');
    assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|innerHTML|localStorage|chrome\./);
  }
  for (const name of ['landing.css', 'demo.css']) {
    const css = await readFile(new URL('assets/landing/' + name, root), 'utf8');
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
    for (const name of ['', ...['landing.css', 'demo.css', 'demo.js', 'demo-state.js', 'scene-loop.js', 'signal.js', 'chapters.js', 'orb.js', 'icon128.png'].map(n => 'assets/landing/' + n)]) {
      const response = await fetch(server.url + name);
      assert.equal(response.status, 200);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    for (const path of ['missing.js', '../package.json', '%2e%2e/package.json', 'README.md']) {
      assert.equal((await fetch(server.url + path)).status, 404);
    }
    const published = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(published, /fixtures\/landing|shell-art|reserved for the complete/);
  } finally {
    await server.close();
  }
});
